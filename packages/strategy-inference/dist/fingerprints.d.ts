/**
 * Deterministic behavioural fingerprints ("Strategy DNA").
 *
 * Every number here is computed from reconstructed on-chain events and the
 * real position metadata (positions(tokenId)); none is asserted by a model.
 * Metrics that need data we do not have (e.g. time-in-range without a pool
 * price series) are `null`, never estimated.
 */
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
export declare function computeFingerprints(events: V3Event[], meta?: Record<string, PositionMeta>, priceSeries?: Record<string, PriceSeries>, window?: {
    fromTs: number;
    toTs: number;
}): Fingerprints;
