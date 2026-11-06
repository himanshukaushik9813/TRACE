/**
 * Deterministic behavioural fingerprints ("Strategy DNA").
 *
 * Every number here is computed from reconstructed on-chain events and the
 * real position metadata (positions(tokenId)); none is asserted by a model.
 * Metrics that need data we do not have (e.g. time-in-range without a pool
 * price series) are `null`, never estimated.
 */

import { reconstructPositions, rangeResets, type TokenLedger } from "@trace/uniswap-v3";
import type { PositionMeta, PriceSeries, V3Event } from "@trace/strategy-ir";

export type Fingerprints = {
  periodDays: number;
  eventCount: number;
  positionCount: number;
  activePositions: number;
  closedPositions: number;
  poolCount: number;
  /** Mean range width in ticks (null if no position range is known). */
  avgRangeWidthTicks: number | null;
  /** Mean range width as a price ratio: 1.0001^width − 1 (e.g. 0.2 = 20%). */
  avgRangeWidthPct: number | null;
  /** Share of positions spanning (near) the full tick range or reaching its edge on either side. */
  fullRangeShare: number;
  /** Range re-sets: a new NFT in the same pool with a different range after reducing/closing the previous one. */
  repositionCount: number;
  repositionsPerWeek: number;
  /** Median hours between opening and closing a position (closed positions only). */
  medianPositionDurationHours: number | null;
  increaseCount: number;
  decreaseCount: number;
  /** Collects that actually carried fees (a Collect can also just return withdrawn principal). */
  collectCount: number;
  /** All Collect events, fee-bearing or principal-only. */
  collectEventCount?: number;
  /** Median days between fee-bearing collects (null with fewer than 2). */
  collectCadenceDays: number | null;
  /** Number of withdraw→redeploy cycles (decrease/close followed by a new deposit in the same pool). */
  withdrawRedeployCount: number;
  /** Median hours between a withdrawal and the next deposit in the same pool. */
  medianReentryHours: number | null;
  /** Largest peak-to-trough liquidity swing on a single position, as a fraction of its peak. */
  maxLiquiditySwingPct: number;
  /**
   * Share of observed swaps (during each position's life) where price was inside its range.
   * Null without price data, or with fewer than MIN_PRICE_SAMPLES swaps (too few to be reliable).
   */
  timeInRangePct: number | null;
  /** Real swaps the time-in-range figure is based on (0 when no price data). */
  timeInRangeSamples?: number;
  /** Total gas paid by the wallet's position transactions, in ETH (null if receipts unavailable). */
  gasSpentEth: number | null;
  /**
   * Response to price movement: how often the real pool price (Swap events) left an
   * open position's range. Null when no price series covers the wallet's positions.
   */
  priceRangeExits: number | null;
  /** Of those exits, how many were followed by a liquidity change by the wallet in that pool before the price came back. */
  exitsAnsweredByAction: number | null;
  /** Median hours from the price leaving the range to that liquidity change (null if none). */
  medianResponseHours: number | null;
  /**
   * Exits answered by a range re-set: the old position was reduced and a new position with a
   * different range was opened in the same pool, both before the price came back.
   */
  exitsAnsweredByReset: number | null;
  /** The reduce + mint transactions behind those re-sets (evidence for a price-triggered rule). */
  exitResponseRefs: string[];
  /** Hours positions spent out of range while open, measured between real swaps (null without prices). */
  outOfRangeHours: number | null;
};

/** Fewer real swaps than this during the positions' lives → time in range is not reported (same bar as the backtest split). */
export const MIN_PRICE_SAMPLES = 15;
const FULL_RANGE_TICKS = 1_700_000; // ≥ ~96% of the [-887272, 887272] span
/** |tick| at or beyond this is the edge of the usable range (MAX_TICK = 887272, minus tick-spacing rounding). */
const EDGE_TICK = 880_000;

/** True when a range spans (near) the full tick range or is unbounded on either side. */
export function isFullRangeLike(tickLower: number, tickUpper: number): boolean {
  return tickUpper - tickLower >= FULL_RANGE_TICKS || tickLower <= -EDGE_TICK || tickUpper >= EDGE_TICK;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeFingerprints(
  events: V3Event[],
  meta: Record<string, PositionMeta> = {},
  priceSeries: Record<string, PriceSeries> = {},
  window?: { fromTs: number; toTs: number },
): Fingerprints {
  const sorted = [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const ledger = reconstructPositions(sorted);
  const ledgers = [...ledger.values()];
  const times = sorted.map((e) => e.timestamp).filter((t) => t > 0);
  const fromTs = window?.fromTs || (times.length ? Math.min(...times) : 0);
  const toTs = window?.toTs || (times.length ? Math.max(...times) : 0);
  const periodDays = Math.max(1, (toTs - fromTs) / 86_400);

  // Range widths (from positions(), the authoritative source).
  const ranged = ledgers.map((t) => meta[String(t.tokenId)] ?? null).filter((m): m is PositionMeta => m != null);
  const widths = ranged.map((m) => m.tickUpper - m.tickLower);
  const avgW = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null;
  // Full-range-like: spans (near) the whole tick range, or reaches its edge on either side.
  // A range like [-207244, 887272] is unbounded above, so it is not "concentrated" and its
  // width must not enter the concentrated average (1.0001^width overflows into nonsense).
  const concentrated = ranged.filter((m) => !isFullRangeLike(m.tickLower, m.tickUpper)).map((m) => m.tickUpper - m.tickLower);
  const avgConcW = concentrated.length ? concentrated.reduce((a, b) => a + b, 0) / concentrated.length : null;

  const repositions = rangeResets(ledger);

  const durations = ledgers
    .filter((t) => t.status === "closed" && t.openedTs && t.lastActivityTs)
    .map((t) => ((t.closedTs ?? t.lastActivityTs!) - t.openedTs!) / 3600)
    .filter((h) => h >= 0);

  const allCollects = sorted.filter((e) => e.kind === "COLLECT");
  // Fee collection = collects that carried fees; principal-only collects (after a withdrawal) are not fee events.
  const collects = allCollects.filter((e) => Number(e.fee0 ?? 0) > 0 || Number(e.fee1 ?? 0) > 0);
  const collectGaps: number[] = [];
  for (let i = 1; i < collects.length; i++) if (collects[i].timestamp && collects[i - 1].timestamp) collectGaps.push((collects[i].timestamp - collects[i - 1].timestamp) / 86_400);

  // Withdraw → redeploy cycles, per pool.
  const reentry: number[] = [];
  const byPool = new Map<string, V3Event[]>();
  for (const e of sorted) {
    const k = e.pool ?? `token:${e.tokenId}`;
    byPool.set(k, [...(byPool.get(k) ?? []), e]);
  }
  for (const evs of byPool.values()) {
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].kind !== "DECREASE" && evs[i].kind !== "BURN") continue;
      const next = evs.slice(i + 1).find((e) => e.kind === "MINT" || e.kind === "INCREASE");
      if (next && next.timestamp > evs[i].timestamp) reentry.push((next.timestamp - evs[i].timestamp) / 3600);
    }
  }

  // Liquidity swing per position.
  let maxSwing = 0;
  for (const t of ledgers) {
    let peak = 0;
    let trough = Infinity;
    for (const p of t.liquidityPath) {
      if (p.liquidity > peak) {
        peak = p.liquidity;
        trough = p.liquidity;
      }
      trough = Math.min(trough, p.liquidity);
      if (peak > 0) maxSwing = Math.max(maxSwing, (peak - trough) / peak);
    }
  }

  const occupancy = computeTimeInRange(ledgers, meta, priceSeries);
  const timeInRangePct = occupancy.samples >= MIN_PRICE_SAMPLES ? occupancy.inside / occupancy.samples : null;
  const response = computePriceResponse(ledgers, sorted, meta, priceSeries);

  const gasEvents = new Map<string, number>();
  for (const e of sorted) if (e.gasUsed && e.effectiveGasPrice) gasEvents.set(e.tx, (Number(e.gasUsed) * Number(e.effectiveGasPrice)) / 1e18);
  const gasSpentEth = gasEvents.size ? [...gasEvents.values()].reduce((a, b) => a + b, 0) : null;

  return {
    periodDays,
    eventCount: sorted.length,
    positionCount: ledgers.length,
    activePositions: ledgers.filter((t) => t.status === "active").length,
    closedPositions: ledgers.filter((t) => t.status === "closed").length,
    poolCount: new Set(ledgers.map((t) => meta[String(t.tokenId)]?.pool ?? t.pool ?? `token:${t.tokenId}`)).size,
    avgRangeWidthTicks: avgW,
    avgRangeWidthPct: avgConcW != null ? Math.pow(1.0001, avgConcW) - 1 : null,
    fullRangeShare: widths.length ? (widths.length - concentrated.length) / widths.length : 0,
    repositionCount: repositions,
    repositionsPerWeek: repositions / (periodDays / 7),
    medianPositionDurationHours: median(durations),
    increaseCount: sorted.filter((e) => e.kind === "INCREASE" || e.kind === "MINT").length,
    decreaseCount: sorted.filter((e) => e.kind === "DECREASE").length,
    collectCount: collects.length,
    collectEventCount: allCollects.length,
    collectCadenceDays: median(collectGaps),
    withdrawRedeployCount: reentry.length,
    medianReentryHours: median(reentry),
    maxLiquiditySwingPct: maxSwing,
    timeInRangePct,
    timeInRangeSamples: occupancy.samples,
    gasSpentEth,
    priceRangeExits: response.exits,
    exitsAnsweredByAction: response.answered,
    medianResponseHours: response.exits == null ? null : median(response.delays),
    exitsAnsweredByReset: response.byReset,
    exitResponseRefs: response.resetRefs,
    outOfRangeHours: response.outSeconds == null ? null : response.outSeconds / 3600,
  };
}

const LIQUIDITY_ACTIONS = new Set(["MINT", "INCREASE", "DECREASE", "BURN"]);

/**
 * Walk each position's life over the pool's real swap prices. A range exit is an
 * in-range → out-of-range transition. It counts as answered when the wallet changes
 * liquidity in the same pool (any of its positions) after the exit and before the
 * price returns to the range or the position closes. Observed facts only: this
 * says nothing about why the wallet acted.
 */
export function computePriceResponse(
  ledgers: TokenLedger[],
  events: V3Event[],
  meta: Record<string, PositionMeta>,
  series: Record<string, PriceSeries>,
): { exits: number | null; answered: number | null; delays: number[]; byReset: number | null; resetRefs: string[]; outSeconds: number | null } {
  let covered = false;
  let exits = 0;
  let answered = 0;
  let byReset = 0;
  let outSeconds = 0;
  const resetRefs: string[] = [];
  const delays: number[] = [];
  for (const t of ledgers) {
    const m = meta[String(t.tokenId)];
    if (!m?.pool) continue;
    const s = series[m.pool];
    if (!s || s.points.length === 0) continue;
    const start = t.openedBlock ?? 0;
    const end = t.closedBlock ?? Number.MAX_SAFE_INTEGER;
    const pts = s.points.filter((p) => p.block >= start && p.block <= end);
    if (!pts.length) continue;
    covered = true;
    const pool = m.pool.toLowerCase();
    const actions = events.filter((e) => LIQUIDITY_ACTIONS.has(e.kind) && (e.pool ?? meta[String(e.tokenId)]?.pool ?? "").toLowerCase() === pool);
    const inside = (tick: number) => tick >= m.tickLower && tick < m.tickUpper;
    // Time out of range: between consecutive real swaps, while the earlier one was outside.
    for (let i = 1; i < pts.length; i++) if (!inside(pts[i - 1].tick)) outSeconds += Math.max(0, pts[i].timestamp - pts[i - 1].timestamp);
    const samePool = (e: V3Event) => (e.pool ?? meta[String(e.tokenId)]?.pool ?? "").toLowerCase() === pool;
    for (let i = 1; i < pts.length; i++) {
      if (!(inside(pts[i - 1].tick) && !inside(pts[i].tick))) continue;
      exits++;
      const exit = pts[i];
      // The price is back in range at the first later point inside it (or never in the window).
      const back = pts.slice(i + 1).find((p) => inside(p.tick));
      const limitBlock = Math.min(back?.block ?? Number.MAX_SAFE_INTEGER, end);
      const act = actions.find((e) => e.block > exit.block && e.block <= limitBlock);
      if (act) {
        answered++;
        if (act.timestamp && exit.timestamp && act.timestamp >= exit.timestamp) delays.push((act.timestamp - exit.timestamp) / 3600);
      }
      // Re-set answer: a new position with a different range in the same pool, opened after the
      // exit and before the price re-entered the old range, with the old position reduced first.
      const resetLimit = back?.block ?? Number.MAX_SAFE_INTEGER;
      const mint = events.find(
        (e) => e.kind === "MINT" && e.tokenId !== t.tokenId && samePool(e) && e.block > exit.block && e.block <= resetLimit && (e.tickLower !== m.tickLower || e.tickUpper !== m.tickUpper),
      );
      const reduce = mint && events.find((e) => e.tokenId === t.tokenId && (e.kind === "DECREASE" || e.kind === "BURN") && e.block > exit.block && e.block <= mint.block);
      if (mint && reduce) {
        byReset++;
        for (const tx of [reduce.tx, mint.tx]) if (!resetRefs.includes(tx)) resetRefs.push(tx);
      }
    }
  }
  return covered ? { exits, answered, delays, byReset, resetRefs, outSeconds } : { exits: null, answered: null, delays, byReset: null, resetRefs, outSeconds: null };
}

function computeTimeInRange(ledgers: TokenLedger[], meta: Record<string, PositionMeta>, series: Record<string, PriceSeries>): { inside: number; samples: number } {
  let inside = 0;
  let total = 0;
  for (const t of ledgers) {
    const m = meta[String(t.tokenId)];
    if (!m?.pool) continue;
    const s = series[m.pool];
    if (!s || s.points.length === 0) continue;
    const start = t.openedBlock ?? 0;
    const end = t.closedBlock ?? Number.MAX_SAFE_INTEGER;
    for (const p of s.points) {
      if (p.block < start || p.block > end) continue;
      total++;
      if (p.tick >= m.tickLower && p.tick < m.tickUpper) inside++;
    }
  }
  return { inside, samples: total };
}
