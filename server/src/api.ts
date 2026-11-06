/**
 * TRACE Express API (Sepolia only).
 *
 *   GET  /health                               liveness + config summary
 *   GET  /integrations                         live integration probes (honest labels)
 *   GET  /wallets/suggested                    real active Sepolia LP wallets (found live)
 *   POST /investigations                       queue an investigation {wallet, days, restart?, supersedes?}
 *   POST /investigations/:id/cancel            cancel an unfinished investigation
 *   POST /plans/:id/reconcile                  find + record a tx confirmed while the page was gone
 *   GET  /investigations/recent
 *   GET  /investigations/:id                   status + progress
 *   GET  /investigations/:id/full              everything the screens render
 *   GET  /investigations/:id/case-study        evidence-backed case study (positions, lifecycle, ownership, observations, coverage)
 *   GET  /investigations/:id/events            raw lifecycle evidence (?tokenId=)
 *   GET  /investigations/:id/positions/:tokenId
 *   POST /investigations/:id/archive           retry 0G Storage archiving
 *   GET  /strategies/by-wallet/:wallet         immutable strategy versions
 *   GET  /strategies/:id                       one version with its full IR (read-only)
 *   POST /investigations/:id/whatif            re-run the counterfactual with user settings (not persisted)
 *   POST /strategies/:id/compatibility         on-chain Aqua compatibility {maker?}
 *   POST /strategies/:id/plan                  compile an execution plan {maker, amount0, amount1}
 *   GET  /plans/:id                            plan + authorizations + transactions
 *   POST /plans/:id/challenge                  single-use challenge + EIP-712 payload {wallet, action}
 *   POST /authorizations                       verify a signed authorization {planId, claims, signature, world?}
 *   POST /transactions                         record a submitted tx {authorizationId, op, txHash}
 *   GET  /transactions/:hash                   re-verify a tx from its receipt
 *   GET  /activity/:wallet                     investigations + transactions
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { pad, toEventSelector } from "viem";
import { AQUA, SEPOLIA_CHAIN_ID, isAddress } from "@trace/chain-config";
import { createTraceClient, scrubSecrets } from "@trace/chain-data";
import { assessCompatibility, aquaClient, compilePlan } from "@trace/aqua-adapter";
import {
  WORLD_REQUIREMENTS,
  buildTypedData,
  newChallenge,
  verifyAuthorization,
  verifyWorldProof,
  worldConfigured,
  worldRequired,
  worldRpRequest,
  type WorldProofSubmission,
} from "@trace/world-auth";
import { archive } from "@trace/zero-g-storage";
import { runBacktest } from "@trace/backtester";
import { buildCaseStudy, type Fingerprints } from "@trace/strategy-inference";
import type { AuthorizationClaims, AuthorizationVerification, BacktestResult, ExecutionPlan, PositionMeta, PriceSeries, StrategyIR, V3Event } from "@trace/strategy-ir";
import type { Db } from "./db.js";
import type { TraceConfig } from "./config.js";
import type { InvestigationQueue } from "./worker.js";
import { integrationSnapshot } from "./integrations.js";

export type ApiDeps = {
  db: Db;
  queue: InvestigationQueue;
  cfg: TraceConfig;
  /** Tests only: replaces the HTTP client used to call World's verify API. Production never sets it. */
  worldFetch?: typeof fetch;
};

/** Actions a signed authorization can cover, and the plan steps each allows. */
export const ACTIONS: Record<string, ("approve" | "ship" | "dock" | "swap")[]> = {
  "aqua:ship": ["approve", "ship"],
  "aqua:dock": ["dock"],
};

const AUTH_TTL_SECONDS = 600;
const APPROVAL_TOPIC = toEventSelector("Approval(address,address,uint256)");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);
/** Postgres unique-violation on the "one live ship per plan" index (migration 0003). */
const isLiveShipConflict = (err: unknown) => (err as { code?: string; constraint?: string }).code === "23505" && /transactions_one_live_ship/.test(String((err as { constraint?: string }).constraint ?? (err as Error).message));

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const P = (req: Request, k: string): string => String(req.params[k] ?? "");
const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** Very small fixed-window limiter for expensive routes. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = req.ip ?? "unknown";
    const now = Date.now();
    const e = hits.get(k);
    if (!e || e.reset < now) hits.set(k, { n: 1, reset: now + windowMs });
    else if (++e.n > max) return res.status(429).json({ error: "rate limit exceeded — try again shortly" });
    next();
  };
}

/** Rebuild PositionMeta rows for an investigation (basis selection for compile). */
async function positionMetas(db: Db, investigation: string): Promise<PositionMeta[]> {
  const rows = await db.query(
    `select token_id, pool, token0, token1, symbol0, symbol1, decimals0, decimals1, fee_tier, tick_lower, tick_upper, liquidity, status, history_complete
       from positions where investigation = $1 order by token_id desc`,
    [investigation],
  );
  return rows.map((r) => ({
    tokenId: Number(r.token_id),
    pool: r.pool && r.pool !== "unresolved" ? r.pool : null,
    token0: r.token0,
    token1: r.token1,
    symbol0: r.symbol0,
    symbol1: r.symbol1,
    decimals0: r.decimals0,
    decimals1: r.decimals1,
    feeTier: r.fee_tier,
    tickLower: r.tick_lower,
    tickUpper: r.tick_upper,
    currentLiquidity: String(r.liquidity ?? "0"),
    burned: r.status === "closed",
    historyComplete: r.history_complete,
  }));
}

function pickBasis(metas: PositionMeta[], tokenId?: number): PositionMeta | null {
  const usable = metas.filter((m) => m.pool && m.token0 && m.decimals0 != null && m.decimals1 != null);
  if (tokenId != null) return usable.find((m) => m.tokenId === tokenId) ?? null;
  return usable.find((m) => !m.burned) ?? usable[0] ?? null;
}

/** Real pool price series per (pool, window), reused across What If requests in this process. */
const seriesCache = new Map<string, { series: PriceSeries }>();

export function createApi(deps: ApiDeps): Express {
  const { db, queue, cfg } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  /**
   * CORS policy: the configured origins (CORS_ORIGINS) plus local-dev origins.
   * The Next dev server prints several URLs (localhost, LAN IP, *.local); opening
   * any of them must work against the local API, or the browser silently blocks
   * every call and the UI shows a misleading "API unreachable". TRACE only serves
   * Sepolia public data and the caller's own investigations, so echoing local
   * origins is safe.
   */
  const isLocalDevOrigin = (origin: string): boolean => {
    let host = "";
    try {
      host = new URL(origin).hostname.replace(/^\[|\]$/g, ""); // drop [::1] brackets
    } catch {
      return false;
    }
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
    if (host.endsWith(".local")) return true;
    if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  };
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (cfg.corsOrigins.includes(origin) || isLocalDevOrigin(origin))) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Headers", "content-type");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });

  /* ---------------- health / integrations ---------------- */

  app.get("/health", h(async (_req, res) => {
    let database = "ok";
    try {
      await db.ping();
    } catch (err) {
      database = `error: ${(err as Error).message}`;
    }
    res.json({ ok: database === "ok", chainId: SEPOLIA_CHAIN_ID, network: "Ethereum Sepolia", database, queue: queue.backend });
  }));

  app.get("/integrations", h(async (req, res) => {
    res.json(await integrationSnapshot(cfg, db, queue.backend, req.query.refresh === "1"));
  }));

  let suggested: { at: number; data: unknown } | null = null;
  app.get("/wallets/suggested", h(async (_req, res) => {
    if (!suggested || Date.now() - suggested.at > 10 * 60_000) {
      const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
      const wallets = await chain.findActiveLpWallets(5, 50_000);
      suggested = { at: Date.now(), data: { wallets, source: "Live scan of Uniswap V3 position mints on Sepolia (last ~50,000 blocks), ranked by real swaps in each wallet's pool (last ~10,000 blocks)", computedAt: new Date().toISOString() } };
    }
    res.json(suggested.data);
  }));

  /* ---------------- investigations ---------------- */

  /** Cancel a run: drop its queued job if it hasn't started; a running job stops at its next stage. */
  const cancelRun = async (id: string, reason: string) => {
    const was = await db.cancelInvestigation(id, reason);
    const job = was ? await queue.cancel(id).catch(() => "absent" as const) : "absent";
    return { cancelled: was, job };
  };

  app.post("/investigations", limiter(10, 60_000), h(async (req, res) => {
    const { wallet, days, restart, supersedes } = req.body ?? {};
    if (!isAddress(wallet)) return bad(res, "wallet must be a 0x-prefixed 40-hex address");
    const d = days == null ? 30 : Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) return bad(res, "days must be an integer between 1 and 365");
    // Starting a new investigation supersedes the one the user was watching.
    if (typeof supersedes === "string" && /^[0-9a-f-]{36}$/i.test(supersedes)) await cancelRun(supersedes, "Superseded: a new investigation was started");
    if (restart === true) {
      // Explicit restart: never reattach. Cancel every unfinished run for this wallet and start fresh.
      for (const old of await db.runningForWallet(wallet)) await cancelRun(old, "Restarted: replaced by a fresh investigation");
    } else {
      // Same wallet + window already running → attach to it instead of reading the chain twice
      // (double clicks and multiple tabs otherwise split the RPC budget between identical jobs).
      const running = await db.query<{ id: string; status: string }>(
        `select id, status from investigations
          where lower(wallet) = lower($1) and window_days = $2
            and status not in ('done','no_positions','failed','cancelled') and created_at > now() - interval '30 minutes'
          order by created_at desc limit 1`,
        [wallet, d],
      );
      if (running.length) return res.status(202).json({ investigationId: running[0].id, status: running[0].status, reused: true });
    }
    const id = await db.insertInvestigation(wallet, d);
    await queue.add({ investigationId: id, wallet, days: d });
    res.status(202).json({ investigationId: id, status: "queued" });
  }));

  app.post("/investigations/:id/cancel", limiter(30, 60_000), h(async (req, res) => {
    const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
    if (!inv) return bad(res, "investigation not found", 404);
    const r = await cancelRun(inv.id, "Cancelled by the user");
    res.json({ investigationId: inv.id, ...r, status: r.cancelled ? "cancelled" : inv.status });
  }));

  app.get("/investigations/recent", h(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
    const wallet = typeof req.query.wallet === "string" && isAddress(req.query.wallet) ? req.query.wallet : null;
    const rows = await db.query(
      `select id, wallet, status, progress, error, period_from_ts as "fromTs", period_to_ts as "toTs", created_at as "createdAt", updated_at as "updatedAt",
              (summary_json->'counts') as counts
         from investigations ${wallet ? "where lower(wallet) = lower($2)" : ""} order by created_at desc limit $1`,
      wallet ? [limit, wallet] : [limit],
    );
    res.json({ investigations: rows });
  }));

  app.get("/investigations/:id", h(async (req, res) => {
    const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
    if (!inv) return bad(res, "investigation not found", 404);
    res.json(inv);
  }));

  app.get("/investigations/:id/full", h(async (req, res) => {
    const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
    if (!inv) return bad(res, "investigation not found", 404);
    const [strategies, runs, dna, positions, storage] = await Promise.all([
      db.query(
        `select id, ir_id as "irId", parent_ir_id as "parentIrId", ir_json as ir, version_hash as "versionHash", family, confidence, provider, role, created_at as "createdAt"
           from strategies where investigation = $1 order by created_at`,
        [inv.id],
      ),
      db.query(
        `select id, status, request_id as "requestId", model, provider_address as "providerAddress", tee_verified as "teeVerified", trust_mode as "trustMode",
                http_status as "httpStatus", error_code as "errorCode", error, usage, latency_ms as "latencyMs", rules_rejected as "rulesRejected", created_at as "createdAt"
           from inference_runs where investigation = $1 order by created_at desc`,
        [inv.id],
      ),
      db.query(`select data, computed_at as "computedAt" from strategy_dna where investigation = $1`, [inv.id]),
      db.query(`select * from positions where investigation = $1 order by token_id desc`, [inv.id]),
      db.listStorage(inv.id),
    ]);
    const primary = strategies.find((s) => s.role === "ai_hypothesis") ?? strategies.find((s) => s.role === "evidence_baseline") ?? null;
    const backtest = primary
      ? (await db.query(`select result_json as result, status, created_at as "createdAt" from backtest_runs where strategy_id = $1 order by created_at desc limit 1`, [primary.id]))[0] ?? null
      : null;
    const compatibility = primary
      ? (await db.query(`select id, maker, verdict, report_json as report, created_at as "createdAt" from compatibility_reports where strategy_id = $1 order by created_at desc limit 1`, [primary.id]))[0] ?? null
      : null;
    const plans = primary
      ? await db.query(`select id, maker, plan_hash as "planHash", plan_json as plan, created_at as "createdAt" from execution_plans where strategy_id = $1 order by created_at desc limit 5`, [primary.id])
      : [];
    // Human authorization + execution evidence for this investigation's plans, so the
    // Investigate workflow can show Verify/Execute from what actually happened.
    const planIds = plans.map((p: { id: string }) => p.id);
    const [authorizations, transactions] = planIds.length
      ? await Promise.all([
          db.query(
            `select id, plan_id as "planId", wallet, action, validated, world_status as "worldStatus",
                    claims_json->>'strategyId' as "strategyId", claims_json->>'strategyVersionHash' as "strategyVersionHash",
                    claims_json->>'planHash' as "planHash", (world_nullifier is not null) as "humanBound",
                    verification_json->'notes' as notes,
                    expires_at as "expiresAt", (expires_at > now()) as live, created_at as "createdAt"
               from authorizations where plan_id = any($1::uuid[]) order by created_at desc`,
            [planIds],
          ),
          db.query(`select * from transactions where plan_id = any($1::uuid[]) order by created_at desc`, [planIds]),
        ])
      : [[], []];
    res.json(json({ investigation: inv, strategies, primaryStrategyId: primary?.id ?? null, inferenceRuns: runs, dna: dna[0] ?? null, positions, backtest, compatibility, plans, authorizations, transactions, storage }));
  }));

  /**
   * Case study: the wallet's stored on-chain events, positions() metadata, DNA and
   * primary strategy turned into a report where every observation cites its source
   * events. Computed on request from what the investigation stored; nothing is fetched
   * from the chain here and nothing is estimated.
   */
  app.get("/investigations/:id/case-study", h(async (req, res) => {
    if (!isUuid(P(req, "id"))) return bad(res, "investigation not found", 404);
    const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
    if (!inv) return bad(res, "investigation not found", 404);
    if (inv.status !== "done" && inv.status !== "no_positions")
      return res.status(409).json({ error: `investigation is ${inv.status}; the case study is available once it has finished`, status: inv.status });
    const [events, metas, dna, strategies] = await Promise.all([
      db.getEvents(inv.id),
      positionMetas(db, inv.id),
      db.query<{ data: { fingerprints?: Fingerprints } }>(`select data from strategy_dna where investigation = $1`, [inv.id]),
      db.query<{ role: string; ir: StrategyIR }>(`select role, ir_json as ir from strategies where investigation = $1 order by created_at`, [inv.id]),
    ]);
    const primary = strategies.find((s) => s.role === "ai_hypothesis") ?? strategies.find((s) => s.role === "evidence_baseline") ?? null;
    const n = (v: unknown) => (v == null ? null : Number(v));
    const window =
      inv.fromBlock != null && inv.toBlock != null ? { fromBlock: Number(inv.fromBlock), toBlock: Number(inv.toBlock), fromTs: n(inv.fromTs) ?? 0, toTs: n(inv.toTs) ?? 0 } : null;
    const study = buildCaseStudy({
      wallet: inv.wallet,
      chainId: Number(inv.chainId ?? SEPOLIA_CHAIN_ID),
      events: events as unknown as V3Event[],
      meta: metas,
      window,
      fingerprints: dna[0]?.data?.fingerprints ?? null,
      strategy: primary?.ir ?? null,
    });
    res.json(json({ investigation: { id: inv.id, status: inv.status, windowDays: inv.windowDays, createdAt: inv.createdAt }, ...study }));
  }));

  app.get("/investigations/:id/events", h(async (req, res) => {
    if (!isUuid(P(req, "id"))) return bad(res, "investigation not found", 404);
    const tokenId = typeof req.query.tokenId === "string" && /^\d+$/.test(req.query.tokenId) ? req.query.tokenId : undefined;
    res.json({ events: await db.getEvents(P(req, "id"), tokenId) });
  }));

  app.get("/investigations/:id/positions/:tokenId", h(async (req, res) => {
    if (!isUuid(P(req, "id"))) return bad(res, "investigation not found", 404);
    if (!/^\d+$/.test(P(req, "tokenId"))) return bad(res, "tokenId must be numeric");
    const [pos] = await db.query(`select * from positions where investigation = $1 and token_id = $2`, [P(req, "id"), P(req, "tokenId")]);
    if (!pos) return bad(res, "position not found in this investigation", 404);
    const events = await db.getEvents(P(req, "id"), P(req, "tokenId"));
    const [dna] = await db.query(`select data from strategy_dna where investigation = $1`, [P(req, "id")]);
    const series = pos.pool ? (dna?.data?.priceSeries?.[pos.pool] ?? null) : null;
    res.json({ position: pos, events, priceSeries: series });
  }));

  /**
   * What If: re-run the stored backtest's counterfactual with the user's own
   * settings, on the same real data (the investigation's stored events and
   * positions, and the pool's real swap history, read through the cached,
   * credit-limited chain client). Nothing is persisted. Both results are
   * simulations and labelled as such; the baseline uses the same capital and
   * slippage with the strategy's own width and re-centring, so the difference
   * isolates the user's changes.
   */
  app.post("/investigations/:id/whatif", limiter(10, 60_000), h(async (req, res) => {
    const id = P(req, "id");
    if (!isUuid(id)) return bad(res, "investigation not found", 404);
    const b = req.body ?? {};
    const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
    const startCapital = num(b.startCapital);
    const slippagePct = num(b.slippagePct);
    const widthMultiplier = num(b.widthMultiplier) ?? 1;
    if (startCapital !== undefined && !(startCapital > 0 && startCapital <= 1e12)) return bad(res, "startCapital must be a positive number");
    if (slippagePct !== undefined && !(slippagePct >= 0 && slippagePct <= 0.1)) return bad(res, "slippagePct must be a fraction between 0 and 0.1");
    if (!(widthMultiplier >= 0.25 && widthMultiplier <= 8)) return bad(res, "widthMultiplier must be between 0.25 and 8");
    if (b.recentre != null && typeof b.recentre !== "boolean") return bad(res, "recentre must be true or false");

    const inv = await db.getInvestigation(id).catch(() => null);
    if (!inv || inv.status !== "done") return bad(res, "investigation not found or not finished", 404);
    const [strategy] = await db.query(
      `select id, ir_json as ir from strategies where investigation = $1 order by (role = 'ai_hypothesis') desc, created_at desc limit 1`,
      [id],
    );
    if (!strategy) return bad(res, "no strategy stored for this investigation", 422);
    const [stored] = await db.query(`select result_json as result from backtest_runs where strategy_id = $1 order by created_at desc limit 1`, [strategy.id]);
    const prev = stored?.result as BacktestResult | undefined;
    if (!prev || prev.status !== "completed") return bad(res, "this investigation has no completed backtest to build a What If on", 422);

    // Same basis rule as the pipeline: most recent position in the backtested pool.
    const metas = await positionMetas(db, id);
    const inPool = metas.filter((m) => m.pool && m.pool.toLowerCase() === prev.pool.toLowerCase() && m.decimals0 != null && m.decimals1 != null);
    const basis = inPool.sort((x, y) => y.tokenId - x.tokenId)[0];
    if (!basis) return bad(res, "the backtested position is no longer available", 422);
    const big = (v: unknown) => {
      try {
        return BigInt(String(v ?? 0));
      } catch {
        return Number(v ?? 0);
      }
    };
    const events: V3Event[] = (await db.getEvents(id)).map((e) => ({
      ...e,
      block: Number(e.block),
      timestamp: Number(e.timestamp),
      logIndex: Number(e.logIndex),
      tokenId: Number(e.tokenId),
      liquidityDelta: big(e.liquidityDelta),
      amount0: big(e.amount0),
      amount1: big(e.amount1),
      fee0: big(e.fee0),
      fee1: big(e.fee1),
      gasUsed: e.gasUsed ?? undefined,
      effectiveGasPrice: e.effectiveGasPrice ?? undefined,
    })) as V3Event[];

    const fromBlock = Number(inv.fromBlock);
    const toBlock = Number(inv.toBlock);
    const key = `${basis.pool}:${fromBlock}:${toBlock}`;
    let series = seriesCache.get(key)?.series;
    if (!series) {
      const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
      series = await chain.fetchPoolPriceSeries(basis.pool!, fromBlock, toBlock, {
        decimals0: basis.decimals0,
        decimals1: basis.decimals1,
        symbol0: basis.symbol0,
        symbol1: basis.symbol1,
        feeTier: basis.feeTier,
        maxSwaps: 3_000,
      });
      if (seriesCache.size > 20) seriesCache.delete(seriesCache.keys().next().value as string);
      seriesCache.set(key, { series });
    }

    const meta = Object.fromEntries(metas.map((m) => [String(m.tokenId), m]));
    const shared = { startCapital: startCapital ?? prev.assumptions.startCapital, slippagePct: slippagePct ?? prev.assumptions.slippagePct };
    const ir = strategy.ir as StrategyIR;
    const baseline = runBacktest({ ir, series, basis, events, meta, opts: shared });
    const whatIf = runBacktest({ ir, series, basis, events, meta, opts: { ...shared, widthMultiplier, ...(b.recentre != null ? { recentre: b.recentre } : {}) } });
    res.json({
      simulation: true,
      label: "Simulation, not observed",
      inputs: { ...shared, widthMultiplier, recentre: b.recentre ?? null, basisTokenId: basis.tokenId, pool: basis.pool },
      baseline,
      whatIf,
    });
  }));

  app.post("/investigations/:id/archive", limiter(5, 60_000), h(async (req, res) => {
    const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
    if (!inv || inv.status !== "done") return bad(res, "investigation not found or not finished", 404);
    const [strategy] = await db.query(`select id, ir_json as ir from strategies where investigation = $1 order by (role = 'ai_hypothesis') desc, created_at desc limit 1`, [inv.id]);
    const [dna] = await db.query(`select data from strategy_dna where investigation = $1`, [inv.id]);
    const [run] = await db.query(
      `select status, request_id as "requestId", model, provider_address as "providerAddress", tee_verified as "teeVerified", trust_mode as "trustMode",
              error_code as "errorCode", error, usage, latency_ms as "latencyMs", rules_rejected as "rulesRejected", created_at as "createdAt"
         from inference_runs where investigation = $1 order by created_at desc limit 1`,
      [inv.id],
    );
    // Same four artifacts as the pipeline's archive step (pipeline.ts, step 7).
    const outcome = await archive({
      cfg: cfg.storage,
      artifacts: [
        { kind: "investigation-summary", content: { investigation: inv.id, summary: inv.summary } },
        { kind: "strategy-dna", content: { investigation: inv.id, fingerprints: dna?.data?.fingerprints ?? null } },
        ...(run ? [{ kind: "inference-run", content: { investigation: inv.id, run } }] : []),
        ...(strategy ? [{ kind: `strategy-ir:${strategy.ir.id}`, content: strategy.ir }] : []),
      ],
    });
    await db.insertStorage(inv.id, strategy?.id ?? null, outcome.refs);
    await db.setIntegrations(inv.id, { storage: { status: outcome.status, errors: outcome.errors.slice(0, 4), uploaded: outcome.refs.length } });
    res.json(outcome);
  }));

  /* ---------------- strategies ---------------- */

  app.get("/strategies/by-wallet/:wallet", h(async (req, res) => {
    if (!isAddress(P(req, "wallet"))) return bad(res, "invalid wallet");
    const rows = await db.query(
      `select s.id, s.ir_id as "irId", s.parent_ir_id as "parentIrId", s.version_hash as "versionHash", s.family, s.confidence, s.provider, s.role,
              s.created_at as "createdAt", s.investigation
         from strategies s join investigations i on i.id = s.investigation
        where lower(i.wallet) = lower($1) order by s.created_at desc limit 50`,
      [P(req, "wallet")],
    );
    res.json({ strategies: rows });
  }));

  /** One immutable strategy version with its full IR (read-only; used by version compare). */
  app.get("/strategies/:id", h(async (req, res) => {
    const id = P(req, "id");
    if (!isUuid(id)) return bad(res, "strategy not found", 404);
    const [row] = await db.query(
      `select s.id, s.ir_id as "irId", s.parent_ir_id as "parentIrId", s.ir_json as ir, s.version_hash as "versionHash", s.family, s.confidence,
              s.provider, s.role, s.created_at as "createdAt", s.investigation, i.wallet, i.window_days as "windowDays"
         from strategies s join investigations i on i.id = s.investigation where s.id = $1`,
      [id],
    );
    if (!row) return bad(res, "strategy not found", 404);
    res.json({ strategy: row });
  }));

  const loadForCompile = async (strategyId: string, tokenId?: number) => {
    const st = await db.getStrategy(strategyId).catch(() => null);
    if (!st) return null;
    const metas = await positionMetas(db, st.investigation);
    return { st, ir: st.ir as StrategyIR, basis: pickBasis(metas, tokenId) };
  };

  app.post("/strategies/:id/compatibility", limiter(20, 60_000), h(async (req, res) => {
    const maker = req.body?.maker;
    if (maker != null && !isAddress(maker)) return bad(res, "maker must be an address");
    const ctx = await loadForCompile(P(req, "id"), req.body?.tokenId != null ? Number(req.body.tokenId) : undefined);
    if (!ctx) return bad(res, "strategy not found", 404);
    const aq = aquaClient(cfg.sepoliaRpcUrl);
    const checks = ctx.basis
      ? await aq.makerChecks(maker ?? null, [
          { address: ctx.basis.token0, symbol: ctx.basis.symbol0 },
          { address: ctx.basis.token1, symbol: ctx.basis.symbol1 },
        ])
      : [];
    const spot = ctx.basis?.pool ? await aq.poolSpot(ctx.basis.pool).catch(() => null) : null;
    const compat = assessCompatibility(ctx.ir, ctx.basis, checks, spot);
    const reportId = await db.insertCompatibility(P(req, "id"), maker ?? null, compat);
    res.json({ reportId, compatibility: compat });
  }));

  app.post("/strategies/:id/plan", limiter(20, 60_000), h(async (req, res) => {
    const { maker, amount0, amount1, tokenId } = req.body ?? {};
    if (!isAddress(maker)) return bad(res, "maker must be the connected wallet address");
    if (!/^\d+$/.test(String(amount0 ?? "")) || !/^\d+$/.test(String(amount1 ?? ""))) return bad(res, "amount0/amount1 must be non-negative integer strings (token base units)");
    const ctx = await loadForCompile(P(req, "id"), tokenId != null ? Number(tokenId) : undefined);
    if (!ctx) return bad(res, "strategy not found", 404);
    if (!ctx.basis) return bad(res, "no position with a resolvable pool and token decimals to base an Aqua strategy on", 422);
    const aq = aquaClient(cfg.sepoliaRpcUrl);
    const checks = await aq.makerChecks(maker, [
      { address: ctx.basis.token0, symbol: ctx.basis.symbol0, amount: BigInt(amount0) },
      { address: ctx.basis.token1, symbol: ctx.basis.symbol1, amount: BigInt(amount1) },
    ]);
    // Amounts are sized against the pool's real current price; without it nothing is compiled.
    const spot = ctx.basis.pool ? await aq.poolSpot(ctx.basis.pool).catch(() => null) : null;
    const compat = assessCompatibility(ctx.ir, ctx.basis, checks, spot);
    await db.insertCompatibility(P(req, "id"), maker, compat);
    if (!spot) return res.status(503).json({ error: "could not read the pool's current price from Sepolia; try again", compatibility: compat });
    let plan: ExecutionPlan;
    try {
      plan = compilePlan({
        ir: ctx.ir,
        compat,
        basis: ctx.basis,
        maker,
        amount0: String(amount0),
        amount1: String(amount1),
        spot,
        registry: AQUA.registry.address,
        app: AQUA.swapVmRouter.address,
        chainId: SEPOLIA_CHAIN_ID,
        strategyVersionHash: ctx.st.versionHash ?? undefined,
      });
    } catch (err) {
      return res.status(422).json({ error: (err as Error).message, compatibility: compat });
    }
    // Simulate every pre-ship step from the maker before anyone is asked to sign.
    const simulation: Record<string, { ok: boolean; error?: string }> = {};
    for (const s of plan.steps.filter((x) => x.op !== "dock")) simulation[`${s.op}:${s.to}`] = await aq.simulateStep(maker, s);
    const planId = await db.insertPlan(P(req, "id"), plan);
    res.json({ planId, plan, compatibility: compat, simulation });
  }));

  /* ---------------- plans, challenges, authorizations ---------------- */

  app.get("/plans/:id", h(async (req, res) => {
    const p = await db.getPlan(P(req, "id")).catch(() => null);
    if (!p) return bad(res, "plan not found", 404);
    const auths = await db.query(
      `select id, wallet, action, validated, verification_json as verification, world_status as "worldStatus", expires_at as "expiresAt", created_at as "createdAt"
         from authorizations where plan_id = $1 order by created_at desc limit 10`,
      [p.id],
    );
    res.json({ ...p, authorizations: auths, transactions: await db.listTransactions({ planId: p.id }) });
  }));

  /** Live on-chain state of a plan's strategy: registry balances + a read-only router quote. Reads only. */
  app.get("/plans/:id/state", limiter(30, 60_000), h(async (req, res) => {
    const p = await db.getPlan(P(req, "id")).catch(() => null);
    if (!p) return bad(res, "plan not found", 404);
    const state = await aquaClient(cfg.sepoliaRpcUrl).strategyState(p.plan);
    res.json(json({ planId: p.id, network: "sepolia", ...state }));
  }));

  app.post("/plans/:id/challenge", limiter(30, 60_000), h(async (req, res) => {
    const { wallet, action } = req.body ?? {};
    if (!isAddress(wallet)) return bad(res, "wallet must be an address");
    if (!ACTIONS[action]) return bad(res, `action must be one of ${Object.keys(ACTIONS).join(", ")}`);
    const p = await db.getPlan(P(req, "id")).catch(() => null);
    if (!p) return bad(res, "plan not found", 404);
    if (p.maker.toLowerCase() !== wallet.toLowerCase()) return bad(res, "this plan was compiled for a different wallet", 403);
    const challenge = newChallenge();
    await db.issueChallenge(p.id, wallet, action, challenge, AUTH_TTL_SECONDS);
    const claims: AuthorizationClaims = {
      wallet,
      chainId: SEPOLIA_CHAIN_ID,
      strategyId: p.irId,
      strategyVersionHash: p.strategyVersionHash,
      planHash: p.planHash,
      action,
      challenge,
      expiresAt: Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS,
    };
    const required = worldRequired(cfg.world, action);
    const configured = worldConfigured(cfg.world);
    const world = configured ? await worldRpRequest(cfg.world, claims, AUTH_TTL_SECONDS) : null;
    res.json(
      json({
        claims,
        typedData: buildTypedData(claims),
        world,
        // required: a verified human must authorize this action · unavailable: protected, but World ID is not
        // registered here, so the action stays disabled · optional / not_required: not a protected action.
        worldStatus: required ? (configured ? "required" : "unavailable") : configured ? "optional" : "not_required",
        worldRequirements: required && !configured ? WORLD_REQUIREMENTS : undefined,
        identityNote: "World ID proves a unique human approved this exact plan; the wallet signature separately proves control of the wallet.",
      }),
    );
  }));

  app.post("/authorizations", limiter(30, 60_000), h(async (req, res) => {
    const { planId, claims, signature, world } = req.body ?? {};
    if (typeof planId !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return bad(res, "planId and a hex signature are required");
    const c = claims as AuthorizationClaims;
    if (!c || !isAddress(c.wallet) || typeof c.challenge !== "string" || !ACTIONS[c.action]) return bad(res, "malformed claims");
    const p = await db.getPlan(planId).catch(() => null);
    if (!p) return bad(res, "plan not found", 404);
    const expected = { wallet: p.maker, strategyVersionHash: p.strategyVersionHash, planHash: p.planHash, action: c.action, chainId: SEPOLIA_CHAIN_ID };

    // 1) Check signature + bindings first (no state change), 2) then consume the challenge atomically.
    const pre = await verifyAuthorization({ claims: c, signature: signature as `0x${string}`, expected, challengeFresh: true });
    const fresh = pre.validated ? await db.consumeChallenge(c.challenge, p.id, c.wallet, c.action) : false;
    const result = pre.validated ? await verifyAuthorization({ claims: c, signature: signature as `0x${string}`, expected, challengeFresh: fresh }) : pre;

    // Human verification (World ID 4.0) — independent of the wallet signature above.
    let worldStatus: AuthorizationVerification["worldId"] = "not_required";
    let nullifier: string | null = null;
    const required = worldRequired(cfg.world, c.action);
    if (required && !worldConfigured(cfg.world)) {
      worldStatus = "unavailable";
      result.validated = false;
      result.verification.notes.push(`protected action "${c.action}" needs World ID human verification, which is not registered on this server. ${WORLD_REQUIREMENTS}`);
    } else if (required || (world && worldConfigured(cfg.world))) {
      if (!world) {
        worldStatus = "required";
        result.validated = false;
        result.verification.notes.push("World ID verification is required for this action and was not completed (no proof, or the user cancelled)");
      } else if (!result.validated && required) {
        // The proof is not sent to World when the authorization already failed (replay, changed plan, wrong signer…).
        worldStatus = result.verification.challengeFresh ? "rejected" : "replayed";
        result.verification.notes.push("World ID proof not accepted: the authorization failed its other checks");
      } else {
        const v = await verifyWorldProof(cfg.world, world as WorldProofSubmission, c, { fetchImpl: deps.worldFetch });
        worldStatus = v.status;
        if (v.status === "verified") {
          nullifier = v.nullifier;
          const nonce = String((world as WorldProofSubmission).request.nonce);
          if (!(await db.recordNullifier(nullifier!, `${cfg.world.action}#${nonce}`))) {
            worldStatus = "replayed";
            result.validated = false;
            result.verification.notes.push("this World ID proof was already used");
          }
        } else {
          if (required) result.validated = false;
          result.verification.notes.push(`World ID: ${v.detail}`);
        }
      }
    }
    result.verification.worldId = worldStatus;
    result.verification.worldNullifier = nullifier;
    const authorizationId = await db.insertAuthorization({
      planId: p.id,
      wallet: c.wallet,
      action: c.action,
      claims: c,
      signature,
      validated: result.validated,
      verification: result.verification,
      worldStatus,
      worldNullifier: nullifier,
    });
    if (result.validated) await db.touchWallet(c.wallet, true);
    res.status(result.validated ? 200 : 403).json({ authorizationId, validated: result.validated, signer: result.signer, verification: result.verification });
  }));

  /* ---------------- transactions ---------------- */

  const verifyAndStore = async (planRow: { id: string; plan: ExecutionPlan }, authorizationId: string, op: "approve" | "ship" | "dock" | "swap", txHash: string, wallet: string) => {
    const aq = aquaClient(cfg.sepoliaRpcUrl);
    try {
      const v = await aq.verifyTx(txHash, planRow.plan, op);
      const fromOk = v.from.toLowerCase() === wallet.toLowerCase();
      await db.upsertTransaction({
        planId: planRow.id,
        authorizationId,
        op,
        txHash,
        status: v.status === "success" ? "success" : "reverted",
        from: v.from,
        to: v.to,
        block: v.blockNumber,
        confirmations: v.confirmations,
        gasUsed: v.gasUsed,
        effectiveGasPrice: v.effectiveGasPrice,
        matchesPlan: v.matchesPlan && fromOk,
        outcome: fromOk ? v.outcome : `${v.outcome}; WARNING: sent by ${v.from}, not the authorized wallet`,
      });
      return { ...v, fromMatchesAuthorization: fromOk };
    } catch (err) {
      const msg = scrubSecrets((err as Error).message);
      if (/could not be found|not found|TransactionReceiptNotFound/i.test(msg)) return { status: "pending" as const };
      throw err;
    }
  };

  app.post("/transactions", limiter(60, 60_000), h(async (req, res) => {
    const { authorizationId, op, txHash } = req.body ?? {};
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return bad(res, "txHash must be a 32-byte hex hash");
    if (!["approve", "ship", "dock", "swap"].includes(op)) return bad(res, "unknown op");
    const auth = await db.getAuthorization(authorizationId).catch(() => null);
    if (!auth || !auth.validated) return bad(res, "a validated authorization is required before any execution step", 403);
    if (!ACTIONS[auth.action]?.includes(op)) return bad(res, `authorization for "${auth.action}" does not cover "${op}"`, 403);
    const p = await db.getPlan(auth.planId);
    if (!p.plan.steps.some((s: { op: string }) => s.op === op)) return bad(res, `plan has no "${op}" step`, 422);
    if (!auth.live && op === "ship") return bad(res, "authorization expired — sign a new one", 403);
    // Second gate for protected actions: the authorization must carry a World-verified human.
    if (worldRequired(cfg.world, auth.action) && auth.worldStatus !== "verified")
      return bad(res, `"${auth.action}" is a protected action: it needs an authorization verified by World ID (this one is "${auth.worldStatus}")`, 403);
    // Idempotency: re-posting the same hash is a no-op re-check; a second live ship
    // (or more approvals than the plan has) for the same plan is refused.
    const prior = await db.query<{ tx_hash: string; op: string; status: string }>(`select tx_hash, op, status from transactions where plan_id = $1`, [p.id]);
    const same = prior.find((t) => t.tx_hash.toLowerCase() === txHash.toLowerCase());
    if (!same) {
      const live = prior.filter((t) => t.op === op && t.status !== "reverted");
      const allowed = p.plan.steps.filter((s: { op: string }) => s.op === op).length;
      if (live.length >= allowed)
        return res.status(409).json({ error: `this plan already has ${op === "ship" ? "a ship transaction" : `${live.length} ${op} transaction(s)`} pending or confirmed (${live.map((t) => t.tx_hash.slice(0, 10)).join(", ")}…); not recording a duplicate`, existing: live.map((t) => t.tx_hash) });
      try {
        await db.upsertTransaction({ planId: p.id, authorizationId, op, txHash });
      } catch (err) {
        // Two concurrent ship posts for the same plan: the DB index refuses the second.
        if (isLiveShipConflict(err)) return res.status(409).json({ error: "this plan already has a ship transaction pending or confirmed; not recording a duplicate" });
        throw err;
      }
    }
    const result = await verifyAndStore({ id: p.id, plan: p.plan }, authorizationId, op, txHash, auth.wallet);
    res.status(202).json(json({ txHash, ...result }));
  }));

  /**
   * Recover a transaction the user confirmed in their wallet while the page was
   * gone (refresh during the wallet prompt). The client records the maker's
   * pending nonce and the block before asking the wallet to sign; here we scan
   * Sepolia from that block for a tx from the maker that matches the plan step's
   * exact calldata, and record it. Nothing is sent; this only reads the chain.
   */
  app.post("/plans/:id/reconcile", limiter(20, 60_000), h(async (req, res) => {
    const { op, stepIndex, fromBlock, nonce } = req.body ?? {};
    if (!["approve", "ship", "dock"].includes(op)) return bad(res, "unknown op");
    if (!Number.isInteger(fromBlock) || !Number.isInteger(nonce)) return bad(res, "fromBlock and nonce must be integers");
    const p = await db.getPlan(P(req, "id")).catch(() => null);
    if (!p) return bad(res, "plan not found", 404);
    const steps = p.plan.steps.filter((s: { op: string }) => s.op === op);
    const step = steps[Number(stepIndex ?? 0)];
    if (!step) return bad(res, `plan has no ${op} step ${stepIndex ?? 0}`, 422);
    const known = await db.query(`select * from transactions where plan_id = $1 and op = $2 order by created_at desc`, [p.id, op]);
    // Through the shared, credit-limited chain client (never a raw client: the worker
    // and this route share one Infura budget). Candidates come from the target
    // contract's logs: ERC-20 Approval with the maker as owner, or Aqua Shipped/Docked.
    const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
    const head = await chain.latestBlock();
    const found = await chain.findSentTx({
      from: p.maker,
      to: step.to,
      input: step.data,
      fromBlock: Math.max(fromBlock, head - 150), // ~30 min of Sepolia blocks
      topics: op === "approve" ? [APPROVAL_TOPIC, pad(p.maker.toLowerCase() as `0x${string}`, { size: 32 })] : undefined,
    });
    if (found.hash) {
      const hash = found.hash;
      const already = known.find((k: { tx_hash: string }) => k.tx_hash.toLowerCase() === hash.toLowerCase());
      if (!already) {
        const [auth] = await db.query<{ id: string }>(
          `select id from authorizations where plan_id = $1 and validated and action = $2 order by created_at desc limit 1`,
          [p.id, op === "dock" ? "aqua:dock" : "aqua:ship"],
        );
        if (!auth) return res.json({ status: "found_unauthorized", txHash: hash });
        await db.upsertTransaction({ planId: p.id, authorizationId: auth.id, op, txHash: hash });
        await verifyAndStore({ id: p.id, plan: p.plan }, auth.id, op, hash, p.maker).catch(() => null);
      }
      const [row] = await db.query(`select * from transactions where tx_hash = $1`, [hash]);
      return res.json({ status: "recorded", tx: row ?? null });
    }
    // Not mined in the scanned range: did the wallet send anything at all?
    const pendingNonce = await chain.pendingNonce(p.maker);
    res.json({ status: pendingNonce > nonce ? "sent_not_found" : "not_sent", pendingNonce, scanned: found.scanned });
  }));

  app.get("/transactions/:hash", h(async (req, res) => {
    const [t] = await db.query(`select t.*, a.wallet from transactions t left join authorizations a on a.id = t.authorization_id where t.tx_hash = $1`, [P(req, "hash")]);
    if (!t) return bad(res, "transaction not recorded", 404);
    if (t.status === "submitted" || (t.confirmations ?? 0) < 3) {
      const p = await db.getPlan(t.plan_id);
      await verifyAndStore({ id: p.id, plan: p.plan }, t.authorization_id, t.op, t.tx_hash, t.wallet).catch(() => null);
    }
    const [fresh] = await db.query(`select * from transactions where tx_hash = $1`, [P(req, "hash")]);
    res.json(fresh);
  }));

  app.get("/activity/:wallet", h(async (req, res) => {
    if (!isAddress(P(req, "wallet"))) return bad(res, "invalid wallet");
    const [investigations, transactions] = await Promise.all([
      db.query(
        `select id, wallet, status, error, created_at as "createdAt", updated_at as "updatedAt", (summary_json->'counts') as counts
           from investigations where lower(wallet) = lower($1) order by created_at desc limit 50`,
        [P(req, "wallet")],
      ),
      db.listTransactions({ wallet: P(req, "wallet") }),
    ]);
    res.json({ investigations, transactions });
  }));

  // Error handler: scrubbed message, no stack traces to clients.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const msg = scrubSecrets(err?.message ?? String(err));
    console.error("[api] error:", msg);
    res.status(500).json({ error: msg.slice(0, 300) });
  });

  return app;
}
