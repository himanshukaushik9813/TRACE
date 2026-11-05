/**
 * @trace/strategy-ir — shared data contract + validation + canonical hashing.
 *
 * Entry point. Everything else in the TRACE monorepo emits or consumes
 * these shapes; the validators here are the deterministic gate the product
 * relies on ("the AI is not the source of blockchain truth").
 */
export * from "./types.js";
export * as canonical from "./canonical.js";
export { contentHash, canonicalString, shortHash } from "./canonical.js";
export { validateStrategyIR, validateCompatibility, validateBacktest, validatePlan } from "./validate.js";
import { shortHash } from "./canonical.js";
/**
 * Stamp a StrategyIR with its deterministic identity: id = hash of the IR's
 * own content (minus the volatile id field). Recomputing on the same content
 * always yields the same id — this is how downstream components (Aqua
 * compile, World proof) pin to *this* strategy version.
 */
export function finalizeStrategyIR(draft) {
    const body = { ...draft, id: undefined };
    const id = `ir_${shortHash(body).replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
    const ir = { ...draft, id };
    return ir;
}
/** Deterministic digest of a StrategyIR, for pinning in proofs/archives. */
export function strategyVersionHash(ir) {
    return shortHash(ir);
}
/** Deterministic fingerprint of an event set — the evidence anchor. */
export function eventsFingerprint(events) {
    return shortHash(events);
}
/** Group a strategy's rules by category (entry / adjustment / exit / risk / fee). */
export function rulesByCategory(ir) {
    const out = { entry: [], adjustment: [], exit: [], risk: [], fee: [] };
    for (const r of ir.rules)
        out[r.category].push(r);
    return out;
}
