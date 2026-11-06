/**
 * Deterministic, evidence-only inference: Fingerprints + events → StrategyIR v2.
 *
 * This is the ground truth the 0G proposal is audited against, and the
 * analysis shown (labelled "evidence-only, no AI") when the model is not
 * available. Every rule cites the real transaction hashes it was drawn from.
 * When the evidence cannot support a hypothesis the family is "inconclusive"
 * and no rule is invented.
 */
import { finalizeStrategyIR } from "@trace/strategy-ir";
import { computeFingerprints } from "./fingerprints.js";
export const CONFIDENCE_NOTE = "Heuristic fit of the hypothesis to the observed on-chain evidence (0–1). It is not the probability that this is the wallet's actual strategy.";
const MIN_EVENTS = 3;
export function inferFromEvidence(input) {
    const fp = input.fingerprints ?? computeFingerprints(input.events, input.meta ?? {}, {}, input.window);
    return { ir: buildStrategyIR(input, fp), fingerprints: fp };
}
const txs = (events, kinds, max = 6) => [...new Set(events.filter((e) => kinds.includes(e.kind)).map((e) => e.tx))].slice(0, max);
const cadence = (days) => (days >= 1 ? `${days.toFixed(1)} days` : `${(days * 24).toFixed(1)} hours`);
const width = (x) => !Number.isFinite(x) || x >= 1e6
    ? "spanning more than a million× in price (effectively unbounded)"
    : x >= 1
        ? `spanning ${(1 + x).toLocaleString("en-US", { maximumFractionDigits: 1 })}× in price`
        : `${pct(x)} wide`;
const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function familyLabel(f) {
    return {
        passive_concentrated: "Passive concentrated liquidity",
        passive_full_range: "Passive full-range liquidity",
        periodic_range_adjustment: "Periodic range adjustment",
        active_range_management: "Active range management",
        capital_redeployment: "Repeated capital deploy / withdraw",
        inconclusive: "Inconclusive",
    }[f];
}
export function scoreFamilies(fp) {
    const out = [];
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
    out.push({
        family: "capital_redeployment",
        score: clamp01((fp.withdrawRedeployCount >= 2 ? 0.45 : fp.withdrawRedeployCount === 1 ? 0.25 : 0.05) + (fp.maxLiquiditySwingPct > 0.4 ? 0.2 : 0) + (fp.poolCount > 1 ? 0.1 : 0)),
        why: `${fp.withdrawRedeployCount} withdraw→redeploy cycles; liquidity swings up to ${pct(fp.maxLiquiditySwingPct)}; ${fp.poolCount} pool(s)`,
    });
    return out.sort((a, b) => b.score - a.score);
}
function mineRules(fp, events, meta) {
    const rules = [];
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
    if (fp.collectCount >= 2) {
        rules.push({
            category: "fee",
            rule: fp.collectCadenceDays != null ? `Collects fees roughly every ${cadence(fp.collectCadenceDays)}` : "Collects fees repeatedly",
            evidence: `${fp.collectCount} Collect events`,
            evidenceRefs: txs(events, ["COLLECT"]),
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
            evidence: `Measured against real pool Swap prices during each position's life`,
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
function buildLimitations(fp, meta) {
    const l = ["Testnet (Sepolia) liquidity and prices are not representative of mainnet markets."];
    if (Object.values(meta).some((m) => !m.historyComplete))
        l.push("Some positions were opened before the observation window; their earlier history is not included.");
    if (fp.timeInRangePct == null)
        l.push("Time-in-range not measured: no swap price data was available for the pool(s).");
    if (fp.repositionCount === 0)
        l.push("No range re-sets observed — no adjustment trigger can be inferred.");
    if (fp.collectCadenceDays == null)
        l.push("Fee-collection cadence not established (fewer than 2 collects).");
    return l;
}
function buildStrategyIR(input, fp) {
    const meta = input.meta ?? {};
    const families = scoreFamilies(fp);
    const rules = mineRules(fp, input.events, meta);
    const insufficient = fp.eventCount < MIN_EVENTS || fp.positionCount === 0 || rules.length === 0 || families[0].score < 0.3;
    const top = insufficient ? { family: "inconclusive", score: 0 } : families[0];
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
