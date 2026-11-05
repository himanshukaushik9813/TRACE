/**
 * Deterministic behavioural fingerprints.
 *
 * This is the part of the pipeline that the product *trusts*: every number
 * here is computed from the reconstructed events, not asserted by a model.
 * The 0G inference layer may reinterpret them, but it cannot add a claim
 * that isn't anchored to one of these.
 */
import type { V3Event } from "@trace/strategy-ir";
export type Fingerprints = {
    /** Number of range re-sets across all positions. */
    rangeResets: number;
    /** Days covered by the observed window. */
    periodDays: number;
    /** Re-sets per day — the "range adjustment frequency" fingerprint. */
    rangeResetsPerDay: number;
    /** Max intra-window liquidity swing as a fraction of the running peak. */
    maxLiquiditySwingPct: number;
    /** Median hours between a range-exit and the next re-entry on the same position. */
    medianReentryHours: number | null;
    /** COLLECT cadence in days (median gap), or null when <2 collects. */
    collectCadenceDays: number | null;
    collectCount: number;
    collectTotalT0: number;
    collectTotalT1: number;
    /** Fraction of active positions with recent activity (0..1). */
    exposure: number;
    /** Longest continuous open-ness as a share of the window (0..100). */
    persistencePct: number;
    /** Distinct pools touched. */
    poolCount: number;
    /** Total events. */
    eventCount: number;
};
export declare function computeFingerprints(events: V3Event[]): Fingerprints;
