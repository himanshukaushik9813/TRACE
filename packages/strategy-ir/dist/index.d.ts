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
export type { ValidationIssue, ValidationResult } from "./validate.js";
import type { StrategyIR } from "./types.js";
/**
 * Stamp a StrategyIR with its deterministic identity: id = hash of the IR's
 * own content (minus the volatile id field). Recomputing on the same content
 * always yields the same id — this is how downstream components (Aqua
 * compile, World proof) pin to *this* strategy version.
 */
export declare function finalizeStrategyIR(draft: Omit<StrategyIR, "id"> & {
    id?: string;
}): StrategyIR;
/** Deterministic digest of a StrategyIR, for pinning in proofs/archives. */
export declare function strategyVersionHash(ir: StrategyIR): string;
/** Deterministic fingerprint of an event set — the evidence anchor. */
export declare function eventsFingerprint(events: unknown[]): string;
/** Group a strategy's rules by category (entry / adjustment / exit / risk / fee). */
export declare function rulesByCategory(ir: StrategyIR): Record<"entry" | "adjustment" | "exit" | "risk" | "fee", import("./types.js").StrategyRule[]>;
