/**
 * Deterministic compile: StrategyIR + its real basis position → ExecutionPlan.
 *
 * The SwapVM program is built ONLY with the official typed builders
 * (@1inch/swap-vm-sdk AquaXYCAmmStrategy), never from model output:
 *   - range  → newConcentrate({ sqrtPriceMin, sqrtPriceMax }) from the
 *              position's real ticks (sqrt(P·1e18), P = token1/token0 raw =
 *              1.0001^tick); a full-range position → plain XYC AMM,
 *   - fee    → withFeeTokenIn(bps) from the Uniswap fee tier,
 *   - salt   → derived from (strategy id, maker) so recompiling the same
 *              inputs yields the same order bytes and strategy hash.
 * Transactions (exact-amount approvals, ship, dock) are encoded with
 * @1inch/aqua-sdk against the configured Aqua registry + router.
 *
 * planHash = content hash of the canonical plan; the user's EIP-712
 * authorization pins it, so a changed plan cannot reuse an old signature.
 */
import { type CompatibilityAssessment, type ExecutionPlan, type PositionMeta, type StrategyIR } from "@trace/strategy-ir";
export type CompileInput = {
    ir: StrategyIR;
    compat: CompatibilityAssessment;
    basis: PositionMeta;
    maker: string;
    /** Exact amounts to ship, in token base units (decimal strings). */
    amount0: string;
    amount1: string;
    registry: string;
    app: string;
    chainId: number;
};
/** sqrt(P·1e18) for P = 1.0001^tick, as the on-chain fixed-point bigint. */
export declare function sqrtPriceFromTick(tick: number): bigint;
export declare function feeBpsFromTier(feeTier: number): number;
export declare function compilePlan(input: CompileInput): ExecutionPlan;
