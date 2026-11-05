/**
 * Structural validation of the Strategy IR and the artifacts derived from it.
 *
 * A model may *propose* a StrategyIR; this deterministic layer validates it
 * before it is ever treated as a strategy. Nothing here trusts the proposal —
 * it checks shape and the invariants the product depends on (confidence
 * bounds, every rule cites evidence, Sepolia-only, ordered train/test split,
 * no unlimited approvals, …).
 */
import type { BacktestResult, CompatibilityAssessment, ExecutionPlan, StrategyIR } from "./types.js";
export type ValidationIssue = {
    path: string;
    code: string;
    message: string;
};
export type ValidationResult = {
    ok: boolean;
    issues: ValidationIssue[];
};
export declare function validateStrategyIR(ir: unknown): ValidationResult;
export declare function validateCompatibility(c: unknown): ValidationResult;
export declare function validateBacktest(b: unknown): ValidationResult;
export declare function validatePlan(p: unknown): ValidationResult;
export type { BacktestResult, CompatibilityAssessment, ExecutionPlan, StrategyIR };
