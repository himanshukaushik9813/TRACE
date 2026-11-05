/**
 * Deterministic inference: turn Fingerprints + events into a StrategyIR draft.
 *
 * This is the *ground-truth* producer. The 0G layer can add nuance and
 * alternative framings, but every concrete rule it keeps must still map to
 * evidence the deterministic layer can point to. `buildStrategyIR` is the
 * fallback the product always has: a wallet with no 0G access still gets an
 * honest, evidence-anchored strategy.
 */
import { finalizeStrategyIR, } from "@trace/strategy-ir";
import { computeFingerprints } from "./fingerprints.js";
/**
 * Build a StrategyIR from deterministic evidence alone.
 * Confidence values are calibrated to how well the observed behaviour fits
 * the family, and every rule carries its own evidence string.
 */
export function inferFromEvidence(input) {
    const fp = input.fingerprints ?? computeFingerprints(input.events);
    const ir = buildStrategyIR(input.wallet, input.events, fp);
    return { ir, fingerprints: fp };
}
function buildStrategyIR(wallet, events, fp) {
    const families = scoreFamilies(fp);
    const top = families[0];
    const rules = mineRules(fp, events);
    const draft = {
        version: "1",
        wallet,
        family: top.family,
        confidence: top.score,
        rules,
        alternatives: families.map((f) => ({
            label: familyLabel(f.family),
            family: f.family,
            score: Math.round(f.score * 100),
            why: f.why,
        })),
        evidenceRefs: pickEvidenceRefs(events),
        limitations: buildLimitations(fp),
        source: {
            model: "TraceInfer deterministic v0.4",
            provider: "DETERMINISTIC_ONLY",
            schemaValid: true,
            attested: false,
            ts: Math.floor(Date.now() / 1000),
        },
    };
    return finalizeStrategyIR(draft);
}
const familyLabel = (f) => ({
    passive_concentrated: "Passive concentrated liquidity",
    periodic_range_adjustment: "Periodic range adjustment",
    active_range_management: "Active range management",
    capital_redeployment: "Repeated capital deploy/withdraw",
    unknown: "Undetermined",
})[f];
export function scoreFamilies(fp) {
    // Heuristic, calibrated scores. Each is 0..1 and each has a plain-language
    // justification so the UI can show *why* a family won.
    const out = [];
    const passive = 1 - Math.min(1, fp.rangeResetsPerDay * 20);
    out.push({
        family: "passive_concentrated",
        score: clamp01(passive),
        why: `${fp.rangeResets} range re-sets across ${Math.round(fp.periodDays)}d — ${fp.rangeResets === 0 ? "no re-sets observed (consistent)" : "active re-sets contradict a set-and-forget posture"}`,
    });
    const periodic = fp.collectCadenceDays != null && fp.collectCount >= 2 ? 0.66 : 0.3;
    out.push({
        family: "periodic_range_adjustment",
        score: clamp01(periodic),
        why: fp.collectCadenceDays != null
            ? `Fees swept every ~${Math.round(fp.collectCadenceDays)}d — cadence partly regular, but not a fixed interval`
            : "Insufficient collect cadence to establish a fixed interval",
    });
    const active = clamp01((fp.rangeResets >= 2 ? 0.55 : 0.2) +
        (fp.medianReentryHours != null && fp.medianReentryHours < 96 ? 0.2 : 0) +
        (fp.maxLiquiditySwingPct > 0.25 ? 0.15 : 0));
    out.push({
        family: "active_range_management",
        score: active,
        why: fp.medianReentryHours != null
            ? `Re-entry within ~${Math.round(fp.medianReentryHours)}h after exit; ${fp.rangeResets} re-sets track price, not a clock`
            : "Re-sets present but no clear re-entry lag — timing signal is weak",
    });
    const redeploy = clamp01((fp.poolCount > 1 ? 0.35 : 0.15) + (fp.maxLiquiditySwingPct > 0.4 ? 0.25 : 0));
    out.push({
        family: "capital_redeployment",
        score: redeploy,
        why: `${fp.poolCount} pool${fp.poolCount === 1 ? "" : "s"} touched; liquidity swings up to ${Math.round(fp.maxLiquiditySwingPct * 100)}%`,
    });
    out.sort((a, b) => b.score - a.score);
    return out;
}
/* ------------------------------------------------------------------ */
/*  Rule mining                                                        */
/* ------------------------------------------------------------------ */
function mineRules(fp, events) {
    const rules = [];
    if (fp.rangeResets > 0) {
        rules.push({
            rule: "Re-sets the liquidity range after sustained price movement",
            evidence: `${fp.rangeResets} range re-sets observed across ${Math.round(fp.periodDays)} days`,
            confidence: clamp01(0.5 + fp.rangeResetsPerDay),
            alternative: "Could be reaction to external price targets, not a trigger rule",
            uncertainty: "Trigger threshold not directly observable on-chain; inferred from timing",
            mapsTo: "trigger",
        });
    }
    if (fp.medianReentryHours != null) {
        rules.push({
            rule: "Re-enters the pool after a liquidity decrease (re-deploy)",
            evidence: `Median re-entry lag ~${Math.round(fp.medianReentryHours)}h after exit`,
            confidence: clamp01(0.55 + (fp.medianReentryHours < 48 ? 0.2 : 0)),
            alternative: "Capital redeployment across a new pool, not the same range",
            uncertainty: "Cross-pool movement may not be fully reconstructed",
            mapsTo: "action",
        });
    }
    if (fp.collectCount >= 2) {
        rules.push({
            rule: "Sweeps fees on a regular cadence",
            evidence: `${fp.collectCount} collect events${fp.collectCadenceDays != null ? ` at ~${Math.round(fp.collectCadenceDays)}d cadence` : ""}`,
            confidence: clamp01(0.8),
            alternative: "Fixed cron job; cadence may be gas-gated",
            uncertainty: "Regular and largely unambiguous",
            mapsTo: "schedule",
        });
    }
    if (fp.maxLiquiditySwingPct > 0.25) {
        rules.push({
            rule: "Reallocates liquidity toward the side of the expected range",
            evidence: `Liquidity swings up to ${Math.round(fp.maxLiquiditySwingPct * 100)}% of peak within the window`,
            confidence: clamp01(0.5),
            alternative: "May be passive inventory balancing rather than directional",
            uncertainty: "Direction signal weakly separable from fee optimisation",
            mapsTo: "allocation",
        });
    }
    if (fp.persistencePct > 70) {
        rules.push({
            rule: "Maintains continuous position exposure",
            evidence: `${Math.round(fp.persistencePct)}% of the window with an open position`,
            confidence: clamp01(0.75),
            alternative: "Long-term hold with incidental management",
            uncertainty: "Low — exposure is directly observed",
            mapsTo: "limit",
        });
    }
    // Guarantee at least one rule even for a quiet wallet.
    if (rules.length === 0) {
        rules.push({
            rule: "Holds a concentrated-liquidity position without active management",
            evidence: `${fp.eventCount} events; no range re-sets detected`,
            confidence: 0.4,
            alternative: "Could be a single manual deploy with no follow-up",
            uncertainty: "Low activity limits inference confidence",
            mapsTo: "allocation",
        });
    }
    return rules;
}
/* ------------------------------------------------------------------ */
function pickEvidenceRefs(events) {
    const seen = new Set();
    const refs = [];
    for (const e of events) {
        if (refs.length >= 8)
            break;
        if (!seen.has(e.tx)) {
            seen.add(e.tx);
            refs.push(e.tx);
        }
    }
    return refs;
}
function buildLimitations(fp) {
    const l = [];
    if (fp.rangeResets === 0)
        l.push("No range re-sets observed — cannot infer a trigger rule.");
    if (fp.medianReentryHours == null)
        l.push("Re-entry timing not measurable from the available events.");
    if (fp.collectCadenceDays == null)
        l.push("Fee-cadence not established (fewer than 2 collects).");
    if (l.length === 0)
        l.push("Triggers inferred from timing, not observed directly on-chain.");
    return l;
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
