/**
 * Deterministic, evidence-only inference: Fingerprints + events → StrategyIR v2.
 *
 * This is the ground truth the 0G proposal is audited against, and the
 * analysis shown (labelled "evidence-only, no AI") when the model is not
 * available. Every rule cites the real transaction hashes it was drawn from.
 * When the evidence cannot support a hypothesis the family is "inconclusive"
 * and no rule is invented.
 */

import { finalizeStrategyIR, type PositionMeta, type StrategyFamily, type StrategyIR, type StrategyRule, type V3Event } from "@trace/strategy-ir";
import { computeFingerprints, type Fingerprints } from "./fingerprints.js";

export type EvidenceWindow = { fromBlock: number; toBlock: number; fromTs: number; toTs: number };

export type InferenceInput = {
  events: V3Event[];
  wallet: string;
  window: EvidenceWindow;
  meta?: Record<string, PositionMeta>;
  fingerprints?: Fingerprints;
};

export const CONFIDENCE_NOTE =
  "Heuristic fit of the hypothesis to the observed on-chain evidence (0–1). It is not the probability that this is the wallet's actual strategy.";

const MIN_EVENTS = 3;

export function inferFromEvidence(input: InferenceInput): { ir: StrategyIR; fingerprints: Fingerprints } {
  const fp = input.fingerprints ?? computeFingerprints(input.events, input.meta ?? {}, {}, input.window);
  return { ir: buildStrategyIR(input, fp), fingerprints: fp };
}

const txs = (events: V3Event[], kinds: V3Event["kind"][], max = 6) =>
  [...new Set(events.filter((e) => kinds.includes(e.kind)).map((e) => e.tx))].slice(0, max);

const cadence = (days: number) => (days >= 1 ? `${days.toFixed(1)} days` : `${(days * 24).toFixed(1)} hours`);
const width = (x: number) =>
  !Number.isFinite(x) || x >= 1e6
    ? "spanning more than a million× in price (effectively unbounded)"
    : x >= 1
      ? `spanning ${(1 + x).toLocaleString("en-US", { maximumFractionDigits: 1 })}× in price`
      : `${pct(x)} wide`;
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function familyLabel(f: StrategyFamily): string {
  return {
    passive_concentrated: "Passive concentrated liquidity",
    passive_full_range: "Passive full-range liquidity",
    periodic_range_adjustment: "Periodic range adjustment",
    price_triggered_repositioning: "Price-triggered repositioning",
    active_range_management: "Active range management",
    capital_redeployment: "Repeated capital deploy / withdraw",
    inconclusive: "Inconclusive",
  }[f];
}

export function scoreFamilies(fp: Fingerprints): { family: StrategyFamily; score: number; why: string }[] {
  const out: { family: StrategyFamily; score: number; why: string }[] = [];
  const noResets = fp.repositionCount === 0;

  out.push({
    family: "passive_full_range",
    score: clamp01(fp.fullRangeShare * (noResets ? 0.9 : 0.5)),
    why: `${pct(fp.fullRangeShare)} of positions span the full tick range or reach its edge; ${fp.repositionCount} range re-sets`,
  });
  out.push({
    family: "passive_concentrated",
    score: clamp01((1 - fp.fullRangeShare) * (noResets ? 0.75 : 0.25) * (fp.decreaseCount <= 1 ? 1 : 0.7)),
    why: fp.avgRangeWidthPct != null
      ? `Concentrated ranges ${width(fp.avgRangeWidthPct)} on average; ${fp.repositionCount} re-sets, ${fp.decreaseCount} withdrawals`
      : "No concentrated range observed",
  });
  out.push({
    family: "active_range_management",
    score: clamp01((fp.repositionCount >= 2 ? 0.5 : fp.repositionCount === 1 ? 0.3 : 0.05) + (fp.medianReentryHours != null && fp.medianReentryHours < 96 ? 0.2 : 0) + Math.min(0.2, fp.repositionsPerWeek / 5)),
    why: `${fp.repositionCount} range re-sets (${fp.repositionsPerWeek.toFixed(2)}/week)${fp.medianReentryHours != null ? `, median re-entry ${fp.medianReentryHours.toFixed(1)}h after exit` : ""}`,
  });
  out.push({
    family: "periodic_range_adjustment",
    score: clamp01(fp.collectCount >= 3 && fp.collectCadenceDays != null ? 0.55 : fp.collectCount >= 2 ? 0.3 : 0.05),
    why: fp.collectCadenceDays != null ? `${fp.collectCount} fee collects, median every ${cadence(fp.collectCadenceDays)}` : `${fp.collectCount} fee collect(s) — no cadence measurable`,
  });
  const exits = fp.priceRangeExits ?? 0;
  const resets = fp.exitsAnsweredByReset ?? 0;
  out.push({
    family: "price_triggered_repositioning",
    score: exits > 0 && resets > 0 ? clamp01(0.35 + 0.35 * (resets / exits) + (resets >= 2 ? 0.1 : 0)) : 0.03,
    why:
      fp.priceRangeExits == null
        ? "No pool price data, so range re-sets cannot be compared with price exits"
        : `${resets} of ${exits} price exit(s) were followed by a range re-set before the price came back`,
  });
  out.push({
    family: "capital_redeployment",
    score: clamp01((fp.withdrawRedeployCount >= 2 ? 0.45 : fp.withdrawRedeployCount === 1 ? 0.25 : 0.05) + (fp.maxLiquiditySwingPct > 0.4 ? 0.2 : 0) + (fp.poolCount > 1 ? 0.1 : 0)),
    why: `${fp.withdrawRedeployCount} withdraw→redeploy cycles; liquidity swings up to ${pct(fp.maxLiquiditySwingPct)}; ${fp.poolCount} pool(s)`,
  });
  return out.sort((a, b) => b.score - a.score);
}

function mineRules(fp: Fingerprints, events: V3Event[], meta: Record<string, PositionMeta>): StrategyRule[] {
  const rules: StrategyRule[] = [];
  const mints = txs(events, ["MINT"]);
  const latestMeta = Object.values(meta).sort((a, b) => b.tokenId - a.tokenId)[0];

  if (mints.length && fp.avgRangeWidthTicks != null) {
    const full = fp.fullRangeShare >= 0.5;
    rules.push({
      category: "entry",
      rule: full ? "Provides liquidity across the full price range" : `Opens concentrated positions ${width(fp.avgRangeWidthPct ?? 0)}`,
      evidence: `${fp.positionCount} position(s) observed; mean width ${Math.round(fp.avgRangeWidthTicks)} ticks${full ? " (full range)" : ""}`,
      evidenceRefs: mints,
      confidence: clamp01(0.55 + Math.min(0.3, fp.positionCount * 0.05)),
      alternative: full ? "Could be a one-off liquidity bootstrap rather than a strategy" : "Width may follow a UI default rather than a deliberate rule",
      uncertainty: "The decision process behind the chosen width is not observable on-chain",
      mapsTo: "allocation",
      params: latestMeta
        ? { widthTicks: Math.round(fp.avgRangeWidthTicks), tickLower: latestMeta.tickLower, tickUpper: latestMeta.tickUpper, feeTier: latestMeta.feeTier }
        : { widthTicks: Math.round(fp.avgRangeWidthTicks) },
    });
  }

  if (fp.repositionCount > 0) {
    rules.push({
      category: "adjustment",
      rule: "Re-sets the range by opening a new position after reducing the previous one",
      evidence: `${fp.repositionCount} range re-set(s) across ${fp.periodDays.toFixed(1)} days`,
      evidenceRefs: txs(events, ["DECREASE", "BURN", "MINT"]),
      confidence: clamp01(0.45 + Math.min(0.35, fp.repositionCount * 0.1)),
      alternative: "New positions may be independent bets rather than re-sets of one strategy",
      uncertainty: "The trigger (price move, schedule, discretion) is inferred from timing only",
      mapsTo: "trigger",
      params: { repositions: fp.repositionCount },
    });
  }

  const resets = fp.exitsAnsweredByReset ?? 0;
  const resetRefs = fp.exitResponseRefs ?? [];
  if (resets > 0 && resetRefs.length) {
    rules.push({
      category: "adjustment",
      rule: "Moves to a new range after the price leaves the old one",
      evidence: `${resets} of ${fp.priceRangeExits} price exit(s) were followed by a range re-set before the price came back${
        fp.medianResponseHours != null ? `; median reaction ${fp.medianResponseHours.toFixed(1)}h after the exit` : ""
      }`,
      evidenceRefs: resetRefs.slice(0, 12),
      confidence: clamp01(Math.min(0.8, 0.4 + 0.1 * resets)),
      alternative: "The re-sets may follow a schedule or discretion that happened to coincide with the exits",
      uncertainty: `Based on ${resets} exit(s); the price is only sampled at swaps`,
      mapsTo: "trigger",
      params: { exits: fp.priceRangeExits ?? 0, exitsAnsweredByReset: resets },
    });
  }

  if (fp.collectCount >= 2) {
    rules.push({
      category: "fee",
      rule: fp.collectCadenceDays != null ? `Collects fees roughly every ${cadence(fp.collectCadenceDays)}` : "Collects fees repeatedly",
      evidence: `${fp.collectCount} fee-bearing Collect event(s)${fp.collectEventCount != null && fp.collectEventCount > fp.collectCount ? ` (of ${fp.collectEventCount} Collects; the rest only returned withdrawn principal)` : ""}`,
      evidenceRefs: [...new Set(events.filter((e) => e.kind === "COLLECT" && (Number(e.fee0 ?? 0) > 0 || Number(e.fee1 ?? 0) > 0)).map((e) => e.tx))].slice(0, 6),
      confidence: clamp01(fp.collectCount >= 4 ? 0.75 : 0.55),
      alternative: "Collects may be incidental to withdrawals (V3 collect also returns principal)",
      uncertainty: "Cadence measured from few samples",
      mapsTo: "schedule",
      params: fp.collectCadenceDays != null ? { cadenceDays: Number(fp.collectCadenceDays.toFixed(2)) } : {},
    });
  }

  if (fp.decreaseCount > 0) {
    rules.push({
      category: "exit",
      rule: fp.withdrawRedeployCount > 0 ? "Withdraws liquidity and redeploys it" : "Withdraws liquidity without redeploying in the window",
      evidence: `${fp.decreaseCount} withdrawal(s)${fp.medianReentryHours != null ? `; median ${fp.medianReentryHours.toFixed(1)}h to redeploy` : ""}`,
      evidenceRefs: txs(events, ["DECREASE", "BURN"]),
      confidence: clamp01(0.5 + Math.min(0.3, fp.decreaseCount * 0.05)),
      alternative: "Withdrawals may be liquidity needs unrelated to the strategy",
      uncertainty: "Exit conditions are not observable on-chain",
      mapsTo: "action",
      params: fp.medianReentryHours != null ? { reentryHours: Number(fp.medianReentryHours.toFixed(2)) } : {},
    });
  }

  if (fp.timeInRangePct != null) {
    rules.push({
      category: "risk",
      rule: `Keeps price in range about ${pct(fp.timeInRangePct)} of the time`,
      evidence: `Measured against ${fp.timeInRangeSamples ?? "the"} real pool swap price(s) during each position's life`,
      evidenceRefs: mints.length ? mints : txs(events, ["INCREASE"]),
      confidence: 0.7,
      alternative: "Occupancy may be luck in a quiet market rather than risk management",
      uncertainty: "Testnet pool prices can be thin and erratic",
      mapsTo: "limit",
      params: { timeInRange: Number(fp.timeInRangePct.toFixed(3)) },
    });
  }
  return rules;
}

/** Span (block + time) of the events a rule cites. */
export function ruleWindow(refs: string[], events: V3Event[]): StrategyRule["observationWindow"] {
  const set = new Set(refs.map((r) => r.toLowerCase()));
  const ev = events.filter((e) => set.has(e.tx.toLowerCase()));
  if (!ev.length) return undefined;
  const blocks = ev.map((e) => Number(e.block));
  const ts = ev.map((e) => Number(e.timestamp)).filter((t) => t > 0);
  return { fromBlock: Math.min(...blocks), toBlock: Math.max(...blocks), fromTs: ts.length ? Math.min(...ts) : 0, toTs: ts.length ? Math.max(...ts) : 0 };
}

/** What the chain cannot show for each kind of rule. Stated, never filled in. */
function missingFor(r: StrategyRule, fp: Fingerprints, meta: Record<string, PositionMeta>): string[] {
  const partial = Object.values(meta).some((m) => !m.historyComplete);
  if (r.category === "entry")
    return [
      "Why this width was chosen (a UI default, a model, a manual choice) is not recorded on-chain.",
      ...(partial ? ["Positions opened before the window have no entry event here."] : []),
    ];
  if (r.category === "adjustment" && r.mapsTo === "trigger" && r.params?.exitsAnsweredByReset != null)
    return [
      "The price is only known at swaps, so the moment the exit became visible to the wallet is approximate.",
      "A re-set shortly after an exit can still be coincidence; the wallet's reasoning is not on-chain.",
    ];
  if (r.category === "adjustment")
    return [
      "What triggered each re-set is not recorded on-chain; only the timing is.",
      ...(fp.priceRangeExits == null ? ["No pool prices, so the re-sets cannot be compared with price moves."] : []),
    ];
  if (r.category === "fee")
    return [
      "A Collect also returns withdrawn principal; why each collect happened is not recorded.",
      ...(fp.collectCount < 4 ? ["Few collects, so the cadence is a rough estimate."] : []),
    ];
  if (r.category === "exit") return ["Why liquidity was withdrawn (a stop condition, a need for funds) is not observable."];
  return [
    "No wallet transaction records range occupancy; it is computed from the pool's swap prices, and the cited transactions are the positions' openings.",
    "Prices are sampled only at swaps; between swaps the price is unknown.",
  ];
}

function buildLimitations(fp: Fingerprints, meta: Record<string, PositionMeta>): string[] {
  const l: string[] = ["Testnet (Sepolia) liquidity and prices are not representative of mainnet markets."];
  if (Object.values(meta).some((m) => !m.historyComplete)) l.push("Some positions were opened before the observation window; their earlier history is not included.");
  if (fp.timeInRangePct == null)
    l.push(
      fp.timeInRangeSamples
        ? `Time-in-range not reported: only ${fp.timeInRangeSamples} real swap(s) in the pool(s) while the positions were open, too few to be reliable.`
        : "Time-in-range not measured: no swap price data was available for the pool(s).",
    );
  if (fp.repositionCount === 0) l.push("No range re-sets observed — no adjustment trigger can be inferred.");
  if (fp.collectCadenceDays == null) l.push("Fee-collection cadence not established (fewer than 2 collects).");
  return l;
}

function buildStrategyIR(input: InferenceInput, fp: Fingerprints): StrategyIR {
  const meta = input.meta ?? {};
  const families = scoreFamilies(fp);
  const rules = mineRules(fp, input.events, meta).map((r) => {
    const w = ruleWindow(r.evidenceRefs, input.events);
    return { ...r, ...(w ? { observationWindow: w } : {}), missingEvidence: missingFor(r, fp, meta) };
  });
  const insufficient = fp.eventCount < MIN_EVENTS || fp.positionCount === 0 || rules.length === 0 || families[0].score < 0.3;
  const top = insufficient ? { family: "inconclusive" as const, score: 0 } : families[0];
  const evidenceRefs = [...new Set(rules.flatMap((r) => r.evidenceRefs))].slice(0, 24);

  return finalizeStrategyIR({
    version: "2",
    wallet: input.wallet,
    chainId: 11155111,
    sourceProtocol: "uniswap-v3",
    evidencePeriod: input.window,
    family: top.family,
    confidence: Number(top.score.toFixed(3)),
    confidenceNote: CONFIDENCE_NOTE,
    rules: insufficient ? [] : rules,
    alternatives: families.map((f) => ({ label: familyLabel(f.family), family: f.family, score: Math.round(f.score * 100), why: f.why })),
    evidenceRefs: insufficient ? [...new Set(input.events.map((e) => e.tx))].slice(0, 12) : evidenceRefs,
    limitations: insufficient
      ? [`Inconclusive: ${fp.eventCount} event(s) across ${fp.positionCount} position(s) is not enough evidence to support a strategy hypothesis.`, ...buildLimitations(fp, meta)]
      : buildLimitations(fp, meta),
    source: {
      model: "TRACE deterministic evidence engine v2",
      provider: "DETERMINISTIC_ONLY",
      schemaValid: true,
      attested: false,
      ts: Math.floor(Date.now() / 1000),
    },
  });
}
