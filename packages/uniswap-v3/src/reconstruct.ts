/**
 * Deterministic Uniswap V3 position reconstruction.
 *
 * Input: lifecycle events decoded from the real NonfungiblePositionManager
 * (see @trace/chain-data) + per-position metadata read from positions().
 * Output: a ReconstructionSummary in the shared IR.
 *
 * Invariants:
 *  - Events are replayed in strict (block, logIndex) order — the result is
 *    independent of input order.
 *  - Principal and fees are strictly separate. V3 credits principal to
 *    tokensOwed at DECREASE and transfers principal + fees at COLLECT; the
 *    chain-data layer splits each COLLECT into its principal portion
 *    (amount0/1, already counted as withdrawn at DECREASE) and its fee portion
 *    (fee0/1). Here COLLECT only ever adds fee0/1 to feesCollected.
 *  - Uncollected fees are reported as 0: estimating them needs a fee-growth
 *    model, which is never invented here.
 *  - Amounts are normalised with the token's real decimals; when decimals are
 *    unknown they stay in base units and the position is flagged.
 */

import { eventsFingerprint } from "@trace/strategy-ir";
import type { PositionAccounting, PositionMeta, ReconstructionSummary, V3Event, V3Position } from "@trace/strategy-ir";

type Num = number | bigint | string;

const toNum = (v: Num | undefined | null): number => (v == null ? 0 : typeof v === "bigint" ? Number(v) : Number(v));

export type NumV3Event = Omit<V3Event, "liquidityDelta" | "amount0" | "amount1" | "fee0" | "fee1"> & {
  liquidityDelta: number;
  amount0: number;
  amount1: number;
  fee0: number;
  fee1: number;
};

/** Convert bigint/string on-chain quantities to numbers once, at the boundary. */
export function toNumberEvents(events: V3Event[]): NumV3Event[] {
  return events.map((e) => ({
    ...e,
    liquidityDelta: toNum(e.liquidityDelta),
    amount0: toNum(e.amount0),
    amount1: toNum(e.amount1),
    fee0: toNum(e.fee0),
    fee1: toNum(e.fee1),
  }));
}

export type TokenLedger = {
  tokenId: number;
  pool?: string;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  status: "active" | "closed";
  openedBlock?: number;
  openedTs?: number;
  closedBlock?: number;
  closedTs?: number;
  lastActivityBlock?: number;
  lastActivityTs?: number;
  /** Base units. */
  deposited: { t0: number; t1: number };
  withdrawn: { t0: number; t1: number };
  feesCollected: { t0: number; t1: number };
  /** Every distinct range observed for this NFT (constant in V3; kept for safety). */
  rangeHistory: { tickLower: number; tickUpper: number; atBlock: number }[];
  /** Liquidity after each event, for capital-deployment metrics. */
  liquidityPath: { block: number; ts: number; liquidity: number }[];
};

/** Replay events into per-token position state. Pure function. */
export function reconstructPositions(events: (V3Event | NumV3Event)[]): Map<number, TokenLedger> {
  const sorted = [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const ledger = new Map<number, TokenLedger>();

  for (const e of sorted) {
    let t = ledger.get(e.tokenId);
    if (!t) {
      t = {
        tokenId: e.tokenId,
        pool: e.pool,
        tickLower: e.tickLower,
        tickUpper: e.tickUpper,
        liquidity: 0,
        status: "active",
        deposited: { t0: 0, t1: 0 },
        withdrawn: { t0: 0, t1: 0 },
        feesCollected: { t0: 0, t1: 0 },
        rangeHistory: [],
        liquidityPath: [],
      };
      ledger.set(e.tokenId, t);
    }
    if (t.openedBlock == null) {
      t.openedBlock = e.block;
      t.openedTs = e.timestamp;
    }
    t.lastActivityBlock = e.block;
    t.lastActivityTs = e.timestamp;
    if (!t.pool && e.pool) t.pool = e.pool;

    const dL = toNum(e.liquidityDelta);
    switch (e.kind) {
      case "MINT":
      case "INCREASE":
        t.liquidity += dL;
        t.deposited.t0 += toNum(e.amount0);
        t.deposited.t1 += toNum(e.amount1);
        t.status = "active";
        break;
      case "DECREASE":
        t.liquidity = Math.max(0, t.liquidity - dL);
        t.withdrawn.t0 += toNum(e.amount0);
        t.withdrawn.t1 += toNum(e.amount1);
        break;
      case "COLLECT":
        // Fees ONLY. The principal portion of a collect was already counted at DECREASE.
        t.feesCollected.t0 += toNum(e.fee0);
        t.feesCollected.t1 += toNum(e.fee1);
        break;
      case "BURN":
        t.status = "closed";
        t.closedBlock = e.block;
        t.closedTs = e.timestamp;
        t.liquidity = 0;
        break;
      case "TRANSFER":
        break; // ownership change only
    }

    const last = t.rangeHistory[t.rangeHistory.length - 1];
    if (!last || last.tickLower !== e.tickLower || last.tickUpper !== e.tickUpper) {
      t.rangeHistory.push({ tickLower: e.tickLower, tickUpper: e.tickUpper, atBlock: e.block });
      t.tickLower = e.tickLower;
      t.tickUpper = e.tickUpper;
    }
    t.liquidityPath.push({ block: e.block, ts: e.timestamp, liquidity: t.liquidity });
  }
  // A position whose liquidity was fully removed but never burned is effectively closed.
  for (const t of ledger.values()) if (t.status === "active" && t.liquidity === 0 && t.withdrawn.t0 + t.withdrawn.t1 > 0) t.status = "closed";
  return ledger;
}

export type ReconstructOptions = {
  wallet: string;
  chainId: number;
  network: string;
  /** The observed block/time window (from the chain reader). */
  window?: { fromBlock: number; toBlock: number; fromTs: number; toTs: number };
};

const scale = (v: number, decimals: number | null | undefined) => (decimals == null ? v : v / 10 ** decimals);

/** Build the IR reconstruction summary with real decimals and pool identity. */
export function reconstructSummary(
  events: (V3Event | NumV3Event)[],
  meta: Record<string, PositionMeta> = {},
  opts: ReconstructOptions,
): ReconstructionSummary {
  const ledger = reconstructPositions(events);
  const times = events.map((e) => e.timestamp).filter((t) => t > 0);
  const period = opts.window
    ? { fromTs: opts.window.fromTs, toTs: opts.window.toTs }
    : times.length
      ? { fromTs: Math.min(...times), toTs: Math.max(...times) }
      : { fromTs: 0, toTs: 0 };

  const positions: V3Position[] = [];
  const accounting: PositionAccounting[] = [];

  for (const t of ledger.values()) {
    const m = meta[String(t.tokenId)];
    positions.push({
      tokenId: t.tokenId,
      pool: m?.pool ?? t.pool ?? "unresolved",
      token0: m?.symbol0 ?? "unresolved",
      token1: m?.symbol1 ?? "unresolved",
      token0Address: m?.token0,
      token1Address: m?.token1,
      decimals0: m?.decimals0 ?? null,
      decimals1: m?.decimals1 ?? null,
      feeTier: m?.feeTier ?? 0,
      tickLower: m?.tickLower ?? t.tickLower,
      tickUpper: m?.tickUpper ?? t.tickUpper,
      liquidity: t.liquidity,
      status: m?.burned ? "closed" : t.status,
      openedBlock: t.openedBlock,
      closedBlock: t.closedBlock,
      lastActivityBlock: t.lastActivityBlock,
      historyComplete: m?.historyComplete ?? false,
    });
    const d0 = m?.decimals0;
    const d1 = m?.decimals1;
    accounting.push({
      tokenId: t.tokenId,
      deposited: { token0: scale(t.deposited.t0, d0), token1: scale(t.deposited.t1, d1) },
      withdrawn: { token0: scale(t.withdrawn.t0, d0), token1: scale(t.withdrawn.t1, d1) },
      feesCollected: { token0: scale(t.feesCollected.t0, d0), token1: scale(t.feesCollected.t1, d1) },
      feesUncollected: { token0: 0, token1: 0 },
      netPosition: {
        token0: scale(t.deposited.t0 - t.withdrawn.t0, d0),
        token1: scale(t.deposited.t1 - t.withdrawn.t1, d1),
      },
    });
  }

  positions.sort((a, b) => (a.openedBlock ?? 0) - (b.openedBlock ?? 0));
  const pools = new Set(positions.map((p) => p.pool).filter((p) => p !== "unresolved")).size;
  const closed = positions.filter((p) => p.status === "closed").length;

  return {
    wallet: opts.wallet,
    chainId: opts.chainId,
    network: opts.network,
    eventsFingerprint: eventsFingerprint(toNumberEvents(events as V3Event[])),
    period,
    counts: { events: events.length, positions: positions.length, pools, closed },
    positions,
    accounting,
  };
}

/**
 * Repositioning count: in V3 a range is fixed per NFT, so "moving the range"
 * means opening a new NFT in the same pool with a different range after
 * reducing/closing an earlier one. Counted per pool, in open order.
 */
export function rangeResets(ledger: Map<number, TokenLedger>): number {
  const byPool = new Map<string, TokenLedger[]>();
  for (const t of ledger.values()) {
    const k = t.pool ?? `token:${t.tokenId}`;
    byPool.set(k, [...(byPool.get(k) ?? []), t]);
  }
  let n = 0;
  for (const list of byPool.values()) {
    list.sort((a, b) => (a.openedBlock ?? 0) - (b.openedBlock ?? 0));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const prevReduced = prev.withdrawn.t0 + prev.withdrawn.t1 > 0 || prev.status === "closed";
      const rangeChanged = prev.tickLower !== cur.tickLower || prev.tickUpper !== cur.tickUpper;
      if (prevReduced && rangeChanged) n++;
    }
    // Also count any in-NFT range change (not possible in canonical V3, kept for safety).
    for (const t of list) n += Math.max(0, t.rangeHistory.length - 1);
  }
  return n;
}
