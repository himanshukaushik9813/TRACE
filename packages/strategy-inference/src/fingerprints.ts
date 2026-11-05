/**
 * Deterministic behavioural fingerprints.
 *
 * This is the part of the pipeline that the product *trusts*: every number
 * here is computed from the reconstructed events, not asserted by a model.
 * The 0G inference layer may reinterpret them, but it cannot add a claim
 * that isn't anchored to one of these.
 */

import { reconstructPositions, rangeResets, type TokenLedger } from "@trace/uniswap-v3";
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

export function computeFingerprints(events: V3Event[]): Fingerprints {
  const sorted = [...events].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const ledger = reconstructPositions(sorted);
  const resets = rangeResets(ledger);

  const times = sorted.map((e) => e.timestamp).filter((t) => t > 0);
  const periodDays =
    times.length >= 2 ? Math.max(1, (Math.max(...times) - Math.min(...times)) / 86_400) : 1;

  // Max liquidity swing: per token, track the running balance and its peak;
  // the biggest peak-to-trough distance within the window.
  let maxLiquiditySwingPct = 0;
  for (const t of ledger.values()) {
    let peak = 0;
    let low = 0;
    let running = 0;
    for (const e of sorted.filter((x) => x.tokenId === t.tokenId)) {
      const d =
        e.kind === "MINT" || e.kind === "INCREASE"
          ? Number(e.liquidityDelta)
          : e.kind === "DECREASE" || e.kind === "BURN"
            ? -Number(e.liquidityDelta)
            : 0;
      running = Math.max(0, running + d);
      peak = Math.max(peak, running);
      low = Math.min(low, running);
      if (peak > 0) maxLiquiditySwingPct = Math.max(maxLiquiditySwingPct, (peak - low) / peak);
    }
  }

  // Re-entry lag: for each DECREASE/BURN, the next MINT/INCREASE on the same token.
  const reentryHours: number[] = [];
  for (const t of ledger.values()) {
    const ev = sorted.filter((e) => e.tokenId === t.tokenId);
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].kind === "DECREASE" || ev[i].kind === "BURN") {
        for (let j = i + 1; j < ev.length; j++) {
          if (ev[j].kind === "MINT" || ev[j].kind === "INCREASE") {
            if (ev[j].timestamp > ev[i].timestamp) {
              reentryHours.push((ev[j].timestamp - ev[i].timestamp) / 3600);
            }
            break;
          }
        }
      }
    }
  }
  const medianReentryHours = reentryHours.length ? median(reentryHours) : null;

  const collects = sorted.filter((e) => e.kind === "COLLECT");
  let collectCadenceDays: number | null = null;
  if (collects.length >= 2 && collects[0].timestamp > 0) {
    const gaps: number[] = [];
    for (let i = 1; i < collects.length; i++) {
      gaps.push((collects[i].timestamp - collects[i - 1].timestamp) / 86_400);
    }
    collectCadenceDays = median(gaps);
  }

  const active = [...ledger.values()].filter((t) => t.status === "active");
  const exposure = active.length
    ? active.filter((t) => t.lastActivityBlock != null).length / active.length
    : 0;

  const persistencePct =
    active.length && times.length >= 2
      ? Math.min(100, (longestContinuousMs(active, sorted, times) / Math.max(1, times[times.length - 1] - times[0])) * 100)
      : 0;

  return {
    rangeResets: resets,
    periodDays,
    rangeResetsPerDay: periodDays > 0 ? resets / periodDays : 0,
    maxLiquiditySwingPct,
    medianReentryHours,
    collectCadenceDays,
    collectCount: collects.length,
    collectTotalT0: collects.reduce((a, e) => a + Number(e.fee0), 0),
    collectTotalT1: collects.reduce((a, e) => a + Number(e.fee1), 0),
    exposure,
    persistencePct,
    poolCount: new Set([...ledger.values()].map((t) => t.pool ?? String(t.tokenId))).size,
    eventCount: sorted.length,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The block-timestamp of the first event at or after `block`, else 0. */
function timeAt(sorted: V3Event[], block: number): number {
  for (const e of sorted) if (e.block >= block) return e.timestamp;
  return sorted.length ? sorted[sorted.length - 1].timestamp : 0;
}

/**
 * Longest continuous open-ness: for each active position the span from its
 * first open to its most recent activity, summed but capped at the window.
 */
function longestContinuousMs(active: TokenLedger[], sorted: V3Event[], times: number[]): number {
  if (active.length === 0 || times.length < 2) return 0;
  const span = Math.max(times[times.length - 1] - times[0], 1);
  let total = 0;
  for (const t of active) {
    const openTs = t.openedBlock != null ? timeAt(sorted, t.openedBlock) : times[0];
    const lastTs = t.lastActivityBlock != null ? timeAt(sorted, t.lastActivityBlock) : times[times.length - 1];
    total += Math.max(0, lastTs - openTs);
  }
  return Math.min(total, span);
}
