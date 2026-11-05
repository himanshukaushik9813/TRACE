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
  /** Share of positions spanning (near) the full tick range. */
  fullRangeShare: number;
  /** Range re-sets: a new NFT in the same pool with a different range after reducing/closing the previous one. */
  repositionCount: number;
  repositionsPerWeek: number;
  /** Median hours between opening and closing a position (closed positions only). */
  medianPositionDurationHours: number | null;
  increaseCount: number;
  decreaseCount: number;
  collectCount: number;
  /** Median days between fee collects (null with fewer than 2 collects). */
  collectCadenceDays: number | null;
  /** Number of withdraw→redeploy cycles (decrease/close followed by a new deposit in the same pool). */
  withdrawRedeployCount: number;
  /** Median hours between a withdrawal and the next deposit in the same pool. */
  medianReentryHours: number | null;
  /** Largest peak-to-trough liquidity swing on a single position, as a fraction of its peak. */
  maxLiquiditySwingPct: number;
  /** Share of observed swaps (during each position's life) where price was inside its range. Null without price data. */
  timeInRangePct: number | null;
  /** Total gas paid by the wallet's position transactions, in ETH (null if receipts unavailable). */
  gasSpentEth: number | null;
};

const FULL_RANGE_TICKS = 1_700_000; // ≥ ~96% of the [-887272, 887272] span

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
  const widths = ledgers
    .map((t) => meta[String(t.tokenId)] ?? null)
    .filter((m): m is PositionMeta => m != null)
    .map((m) => m.tickUpper - m.tickLower);
  const avgW = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null;
  const concentrated = widths.filter((w) => w < FULL_RANGE_TICKS);
  const avgConcW = concentrated.length ? concentrated.reduce((a, b) => a + b, 0) / concentrated.length : null;

  const repositions = rangeResets(ledger);

  const durations = ledgers
    .filter((t) => t.status === "closed" && t.openedTs && t.lastActivityTs)
    .map((t) => ((t.closedTs ?? t.lastActivityTs!) - t.openedTs!) / 3600)
    .filter((h) => h >= 0);

  const collects = sorted.filter((e) => e.kind === "COLLECT");
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

  const timeInRangePct = computeTimeInRange(ledgers, meta, priceSeries);

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
    collectCadenceDays: median(collectGaps),
    withdrawRedeployCount: reentry.length,
    medianReentryHours: median(reentry),
    maxLiquiditySwingPct: maxSwing,
    timeInRangePct,
    gasSpentEth,
  };
}

function computeTimeInRange(ledgers: TokenLedger[], meta: Record<string, PositionMeta>, series: Record<string, PriceSeries>): number | null {
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
  return total > 0 ? inside / total : null;
}
