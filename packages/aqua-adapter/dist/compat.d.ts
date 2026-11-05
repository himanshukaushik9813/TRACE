/**
 * Compatibility: a historical Uniswap V3 NFT is NOT a 1inch Aqua strategy.
 * This module produces an explicit, rule-by-rule assessment of how much of a
 * StrategyIR Aqua can actually express — and what the gaps are.
 */
import type { CompatibilityAssessment, StrategyIR } from "@trace/strategy-ir";
export declare function assessCompatibility(ir: StrategyIR): CompatibilityAssessment;
