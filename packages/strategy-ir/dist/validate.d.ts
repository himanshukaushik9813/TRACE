/**
 * Structural validation of the Strategy IR.
 *
 * The LLM may *propose* a StrategyIR; the deterministic layer validates it
 * against the evidence before it is ever treated as a strategy. Nothing in
 * this module trusts the proposal — it only checks shape and the invariants
 * the product depends on (confidence bounds, evidence refs present, splits
 * ordered, no unlimited approvals, etc.).
 */
import type { AquaProgram, BacktestResult, CompatibilityAssessment, StrategyIR } from "./types.js";
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
export declare function validateProgram(p: unknown): ValidationResult;
export type { AquaProgram, BacktestResult, CompatibilityAssessment, StrategyIR };
export declare const OK: ValidationResult;
