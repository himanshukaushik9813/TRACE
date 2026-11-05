/**
 * Deterministic Uniswap V3 position reconstruction.
 *
 * Input: raw lifecycle events (as decoded from NonfungiblePositionManager logs —
 * see @trace/chain-data for the viem side). Output: a ReconstructionSummary in
 * the shared IR.
 *
 * Invariants this module guarantees:
 *  - Events are replayed in strict (block, logIndex) order — out-of-order
 *    input is sorted, so the result is order-independent.
 *  - Principal withdrawals (MINT/INCREASE/DECREASE token amounts) are kept
 *    strictly distinct from fees (COLLECT amounts) in accounting.
 *  - feesUncollected is reported as 0 in the pure event reconstruction:
 *    accrued-but-uncollected fees require a price/fee model, which the
 *    backtester owns. This keeps the two engines from double-counting.
 */

import { eventsFingerprint } from "@trace/strategy-ir";
import type {
  PositionAccounting,
  ReconstructionSummary,
  V3Event,
  V3Position,
} from "@trace/strategy-ir";

type Num = number | bigint;

const toNum = (v: Num | undefined): number => (v == null ? 0 : typeof v === "bigint" ? Number(v) : v);

/**
 * Boundary helper: the chain-data layer decodes raw quantities as bigint (the
 * on-chain truth). The reconstruction engine works in `number` (safe for
 * uint128 liquidity, which fits well under Number.MAX_SAFE_INTEGER, and for
 * display-grade amounts). Convert once, at the edge.
 */
export type NumV3Event = Omit<V3Event, "liquidityDelta" | "amount0" | "amount1" | "fee0" | "fee1"> & {
  liquidityDelta: number;
  amount0: number;
  amount1: number;
  fee0: number;
  fee1: number;
};

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
  token0?: string;
  token1?: string;
  feeTier?: number;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  status: "active" | "closed";
  openedBlock?: number;
  closedBlock?: number;
  lastActivityBlock?: number;
  deposited: { t0: number; t1: number };
  withdrawn: { t0: number; t1: number };
  feesCollected: { t0: number; t1: number };
  /** Each distinct range the position was observed at, in order. */
  rangeHistory: { tickLower: number; tickUpper: number; atBlock: number }[];
};

/** Replay events into per-token position state. Pure function. */
export function reconstructPositions(events: V3Event[]): Map<number, TokenLedger> {
  const sorted = [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const ledger = new Map<number, TokenLedger>();

  for (const e of sorted) {
    let t = ledger.get(e.tokenId);
    if (!t) {
      t = {
        tokenId: e.tokenId,
        pool: undefined,
        token0: undefined,
        token1: undefined,
        feeTier: undefined,
        tickLower: 0,
        tickUpper: 0,
        liquidity: 0,
        status: "active",
        openedBlock: undefined,
        closedBlock: undefined,
        lastActivityBlock: undefined,
        deposited: { t0: 0, t1: 0 },
        withdrawn: { t0: 0, t1: 0 },
        feesCollected: { t0: 0, t1: 0 },
        rangeHistory: [],
      };
      ledger.set(e.tokenId, t);
    }

    // Pool identity is known from MINT (and re-asserted by later events).
    if (e.kind === "MINT" && t.liquidity === 0 && t.status === "active") {
      t.openedBlock = e.block;
    }
    if (t.openedBlock == null) t.openedBlock = e.block;
    t.lastActivityBlock = e.block;

    const dL = toNum(e.liquidityDelta);
    const a0 = toNum(e.amount0);
    const a1 = toNum(e.amount1);
    const f0 = toNum(e.fee0);
    const f1 = toNum(e.fee1);

    switch (e.kind) {
      case "MINT":
      case "INCREASE": {
        t.liquidity = Math.max(0, t.liquidity + dL);
        // Principal IN — always distinct from fees.
        t.deposited.t0 += a0;
        t.deposited.t1 += a1;
        break;
      }
      case "DECREASE":
      case "BURN": {
        t.liquidity = Math.max(0, t.liquidity - dL);
        // Principal OUT.
        t.withdrawn.t0 += a0;
        t.withdrawn.t1 += a1;
        break;
      }
      case "COLLECT": {
        // Fees ONLY. Never touch principal counters.
        t.feesCollected.t0 += f0;
        t.feesCollected.t1 += f1;
        // Some decoders report collected amounts in amount0/1 for COLLECT;
        // treat those as fees in that case, never as principal.
        if (f0 === 0 && a0 !== 0) t.feesCollected.t0 += a0;
        if (f1 === 0 && a1 !== 0) t.feesCollected.t1 += a1;
        break;
      }
      case "TRANSFER":
        break; // ownership change; not position state
    }

    if (e.kind === "BURN") t.status = "closed";
    if (e.kind === "BURN") t.closedBlock = e.block;

    // Range change tracking: record whenever the ticks differ from the last.
    const last = t.rangeHistory[t.rangeHistory.length - 1];
    if (!last || last.tickLower !== e.tickLower || last.tickUpper !== e.tickUpper) {
      t.rangeHistory.push({ tickLower: e.tickLower, tickUpper: e.tickUpper, atBlock: e.block });
      t.tickLower = e.tickLower;
      t.tickUpper = e.tickUpper;
    }
  }
  return ledger;
}

export type ReconstructOptions = {
  wallet: string;
  chainId: number;
  network: string;
};

/**
 * poolMeta is keyed by tokenId (string form), typically filled from the NPM
 * tokenURI JSON. Unknown tokens simply keep `pool: "unknown"`.
 */
export function reconstructSummary(
  events: V3Event[],
  poolMeta: Record<string, { token0: string; token1: string; feeTier: number }> = {},
  opts: ReconstructOptions,
): ReconstructionSummary {
  const ledger = reconstructPositions(events);
  const periods = events.length
    ? { fromTs: Math.min(...events.map((e) => e.timestamp)), toTs: Math.max(...events.map((e) => e.timestamp)) }
    : { fromTs: 0, toTs: 0 };

  const positions: V3Position[] = [];
  const accounting: PositionAccounting[] = [];

  for (const t of ledger.values()) {
    const lastRange = t.rangeHistory[t.rangeHistory.length - 1];
    const meta = poolMeta[String(t.tokenId)];
    const poolKey = meta ? `pool:${t.tokenId}` : "unknown";
    positions.push({
      tokenId: t.tokenId,
      pool: poolKey ?? "unknown",
      token0: meta?.token0 ?? t.token0 ?? "unknown",
      token1: meta?.token1 ?? t.token1 ?? "unknown",
      feeTier: meta?.feeTier ?? 0,
      tickLower: lastRange?.tickLower ?? 0,
      tickUpper: lastRange?.tickUpper ?? 0,
      liquidity: t.liquidity,
      status: t.status,
      openedBlock: t.openedBlock,
      closedBlock: t.closedBlock,
      lastActivityBlock: t.lastActivityBlock,
    });
    accounting.push({
      tokenId: t.tokenId,
      deposited: { token0: t.deposited.t0, token1: t.deposited.t1 },
      withdrawn: { token0: t.withdrawn.t0, token1: t.withdrawn.t1 },
      feesCollected: { token0: t.feesCollected.t0, token1: t.feesCollected.t1 },
      // Requires a price/fee model (backtester's job) — never estimated here.
      feesUncollected: { token0: 0, token1: 0 },
      netPosition: {
        token0: t.deposited.t0 - t.withdrawn.t0,
        token1: t.deposited.t1 - t.withdrawn.t1,
      },
    });
  }

  const pools = new Set(positions.map((p) => p.pool)).size;
  const closed = positions.filter((p) => p.status === "closed").length;

  return {
    wallet: opts.wallet,
    chainId: opts.chainId,
    network: opts.network,
    eventsFingerprint: eventsFingerprint(events),
    period: periods,
    counts: {
      events: events.length,
      positions: positions.length,
      pools,
      closed,
    },
    positions,
    accounting,
  };
}

/**
 * Number of range re-sets: distinct ranges in rangeHistory minus the first.
 * Feeds the inference engine's "range adjustment frequency" fingerprint.
 */
export function rangeResets(ledger: Map<number, TokenLedger>): number {
  let n = 0;
  for (const t of ledger.values()) n += Math.max(0, t.rangeHistory.length - 1);
  return n;
}
