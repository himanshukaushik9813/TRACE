/**
 * The investigation pipeline — real data end to end:
 *
 *   fetch (Sepolia, viem) → reconstruct → Strategy DNA (+ real pool prices)
 *   → evidence-only baseline IR → 0G Router hypothesis (gated) → backtest on
 *   real swaps → persist → archive to 0G Storage.
 *
 * Nothing falls back to fixture data. A step that cannot run records why
 * (e.g. inference "provider_error", backtest "insufficient_data", storage
 * "not_configured") and the investigation still completes with what is real.
 */

import { strategyVersionHash, type PositionMeta, type PriceSeries, type StrategyIR } from "@trace/strategy-ir";
import { createTraceClient, type TraceChainError } from "@trace/chain-data";
import { reconstructSummary } from "@trace/uniswap-v3";
import { buildEvidencePack, computeFingerprints, inferFromEvidence, runZeroGInference, type InferenceRun } from "@trace/strategy-inference";
import { runBacktest } from "@trace/backtester";
import { archive } from "@trace/zero-g-storage";
import type { Db } from "./db.js";
import type { TraceConfig } from "./config.js";

export type InvestigationJob = { investigationId: string; wallet: string; days: number };

/** Thrown at a stage boundary when the run was cancelled (restart / new investigation). */
export class InvestigationCancelled extends Error {
  constructor(id: string) {
    super(`investigation ${id} was cancelled`);
    this.name = "InvestigationCancelled";
  }
}

/** Downsample a series for the UI (keeps first/last; the backtest uses the full series). */
function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  out[out.length - 1] = xs[xs.length - 1];
  return out;
}

export async function runInvestigation(job: InvestigationJob, db: Db, cfg: TraceConfig): Promise<void> {
  const { investigationId: id } = job;
  const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
  // Live heartbeat: the real RPC call count, so the UI shows work happening during long chain reads.
  const beat = setInterval(() => {
    db.query(
      `update investigations set progress = progress || jsonb_build_object('liveRpcCalls', $2::int), updated_at = now()
        where id = $1 and status not in ('done','no_positions','failed','cancelled')`,
      [id, chain.rpcCallCount()],
    ).catch(() => undefined);
  }, 2_500);
  try {
    await runStages(job, db, cfg, chain);
  } finally {
    clearInterval(beat);
  }
}

async function runStages(job: InvestigationJob, db: Db, cfg: TraceConfig, chain: ReturnType<typeof createTraceClient>): Promise<void> {
  const { investigationId: id, wallet } = job;
  // Every stage transition doubles as a cancellation checkpoint: once the run is
  // cancelled the status write is refused and the pipeline stops writing.
  const advance = async (...args: Parameters<Db["setStatus"]>) => {
    if (!(await db.setStatus(...args))) throw new InvestigationCancelled(id);
  };

  // 1) Fetch real on-chain history.
  await advance(id, "fetching", { stage: "Reading Sepolia: position NFTs, lifecycle logs, positions(), receipts" });
  let history;
  try {
    history = await chain.fetchWalletHistory(wallet, { days: job.days });
  } catch (err) {
    const e = err as TraceChainError;
    if (e.code === "NO_EVENTS") {
      // A genuine, completed answer: this wallet has no Uniswap V3 positions in the window.
      await advance(id, "no_positions", { stage: "No Uniswap V3 positions found", message: e.message });
      return;
    }
    await advance(id, "failed", { errorCode: e.code ?? "RPC_ERROR" }, `${e.code ?? "RPC_ERROR"}: ${e.message}`);
    return;
  }
  await advance(id, "reconstructing", { events: history.events.length, positions: Object.keys(history.positions).length, rpcCalls: history.rpcCalls });

  // 2) Reconstruct.
  const summary = reconstructSummary(history.events, history.positions, {
    wallet: history.wallet,
    chainId: history.chainId,
    network: "Ethereum Sepolia",
    window: history.window,
  });
  await db.saveReconstruction(id, { summary, window: history.window, notes: history.notes });
  await db.insertEvents(id, history.events);
  await db.insertPositions(id, summary, history.positions);

  // 3) Real pool price history for the most active pool(s) with resolvable decimals.
  const byPool = new Map<string, PositionMeta[]>();
  for (const m of Object.values(history.positions)) if (m.pool && m.decimals0 != null && m.decimals1 != null) byPool.set(m.pool, [...(byPool.get(m.pool) ?? []), m]);
  const activity = (pool: string) => history.events.filter((e) => e.pool === pool).length;
  const pools = [...byPool.keys()].sort((a, b) => activity(b) - activity(a)).slice(0, 2);
  const series: Record<string, PriceSeries> = {};
  const seriesErrors: string[] = [];
  for (const pool of pools) {
    const m = byPool.get(pool)![0];
    try {
      series[pool] = await chain.fetchPoolPriceSeries(pool, history.window.fromBlock, history.window.toBlock, {
        decimals0: m.decimals0,
        decimals1: m.decimals1,
        symbol0: m.symbol0,
        symbol1: m.symbol1,
        feeTier: m.feeTier,
        maxSwaps: 3_000,
      });
    } catch (err) {
      seriesErrors.push(`${pool}: ${(err as Error).message}`);
    }
  }

  // 4) Strategy DNA + evidence-only baseline.
  await advance(id, "inferring", { stage: "Strategy DNA, evidence baseline, 0G inference" });
  const fingerprints = computeFingerprints(history.events, history.positions, series, history.window);
  await db.saveDna(id, {
    fingerprints,
    priceSeries: Object.fromEntries(
      Object.entries(series).map(([k, v]) => [k, { ...v, points: thin(v.points, 400).map((p) => ({ block: p.block, timestamp: p.timestamp, price: p.price, tick: p.tick })) }]),
    ),
    seriesErrors,
  });
  const baseline = inferFromEvidence({ events: history.events, wallet: history.wallet, window: history.window, meta: history.positions, fingerprints }).ir;
  const baselineId = await db.insertStrategy(id, baseline, strategyVersionHash(baseline), "evidence_baseline", null);

  // 5) 0G Router hypothesis (real call; gated against the evidence).
  const pack = buildEvidencePack(
    history.events,
    fingerprints,
    history.window,
    summary.positions.map((p) => ({ tokenId: p.tokenId, pool: p.pool, pair: `${p.token0}/${p.token1}`, feeTier: p.feeTier, tickLower: p.tickLower, tickUpper: p.tickUpper, status: p.status })),
  );
  const zg = await runZeroGInference({ pack, wallet: history.wallet, baseline, cfg: cfg.zeroG });
  const runId = await db.insertInferenceRun(id, zg.run);
  let primary: StrategyIR = baseline;
  let primaryId = baselineId;
  if (zg.ok) {
    primary = zg.ir;
    primaryId = await db.insertStrategy(id, zg.ir, strategyVersionHash(zg.ir), "ai_hypothesis", runId);
  }
  await db.setIntegrations(id, {
    inference: { status: zg.run.status, reason: zg.ok ? null : zg.reason, detail: zg.ok ? null : zg.detail, requestId: zg.run.requestId, model: zg.run.model, teeVerified: zg.run.teeVerified } satisfies Record<string, unknown>,
  });

  // 6) Backtest on real swaps (basis = the wallet's most recent position in the most active priced pool).
  await advance(id, "backtesting", { stage: "Look-ahead-safe backtest on real pool swaps" });
  const basisPool = pools.find((p) => series[p]);
  const basis = basisPool ? byPool.get(basisPool)!.sort((a, b) => b.tokenId - a.tokenId)[0] : null;
  if (basis && basisPool) {
    try {
      // Size the simulation like the wallet's real basis deposit (valued in token1 at the
      // first observed price), so fee share vs. pool liquidity is realistic.
      const acct = summary.accounting.find((a) => a.tokenId === basis.tokenId);
      const p0 = series[basisPool].points[0]?.price;
      const deposit = acct && p0 ? acct.deposited.token0 * p0 + acct.deposited.token1 : 0;
      const bt = runBacktest({
        ir: primary,
        series: series[basisPool],
        basis,
        events: history.events,
        meta: history.positions,
        opts: deposit > 0 && Number.isFinite(deposit) ? { startCapital: deposit } : { startCapital: 1 },
      });
      await db.insertBacktest(primaryId, bt);
    } catch (err) {
      await db.setIntegrations(id, { backtest: { status: "failed", detail: (err as Error).message } });
    }
  } else {
    await db.setIntegrations(id, {
      backtest: { status: "insufficient_data", detail: pools.length ? `price history unavailable: ${seriesErrors.join("; ")}` : "no position with a resolvable pool and token decimals" },
    });
  }

  // 7) Archive to 0G Storage (genuine uploads only).
  await advance(id, "archiving", { stage: "Archiving to 0G Storage (Galileo testnet)" });
  const outcome = await archive({
    cfg: cfg.storage,
    artifacts: [
      { kind: "investigation-summary", content: { investigation: id, summary } },
      { kind: "strategy-dna", content: { investigation: id, fingerprints } },
      { kind: "inference-run", content: { investigation: id, run: zg.run as InferenceRun } },
      { kind: `strategy-ir:${primary.id}`, content: primary },
    ],
  });
  await db.insertStorage(id, primaryId, outcome.refs);
  await db.setIntegrations(id, { storage: { status: outcome.status, errors: outcome.errors.slice(0, 4), uploaded: outcome.refs.length } });

  await advance(id, "done", { stage: "Complete" });
}
