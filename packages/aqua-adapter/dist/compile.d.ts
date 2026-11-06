/**
 * Deterministic compile: StrategyIR + its real basis position + the pool's real
 * spot price → ExecutionPlan.
 *
 * The SwapVM program is built ONLY with the official typed builders
 * (@1inch/swap-vm-sdk AquaXYCAmmStrategy), never from model output:
 *   - range  → newConcentrate({ sqrtPriceMin, sqrtPriceMax }) from the position's
 *              real ticks, exact: Uniswap TickMath → sqrt(P)·1e18 (P = token1/token0
 *              in base units = tokenGt/tokenLt). A full-range position → plain XYC.
 *   - amounts → sized with the SDK's concentrate math (computeLiquidityFromAmounts)
 *              against the pool's on-chain spot price, never above what the user
 *              offered, so the shipped balances start the strategy at the market price.
 *   - fee    → withFeeTokenIn(bps) from the Uniswap fee tier,
 *   - salt   → derived from (strategy id, maker): same inputs → same bytes and hash.
 * Both tokens are always registered on ship (Aqua's safeBalances reverts for a
 * token not registered at ship time), even when one side ships 0.
 * Transactions (exact-amount approvals, ship, dock) are encoded with @1inch/aqua-sdk.
 *
 * After building, verifyCompiledPlan decodes everything back with the SDKs and
 * cross-checks it (order round-trip, strategy hash, ship calldata, approvals,
 * price bounds against an independent computation, implied start price). A plan
 * that fails any check is never returned.
 *
 * planHash = content hash of the canonical plan; the user's EIP-712
 * authorization pins it, so a changed plan cannot reuse an old signature.
 */
import { type CompatibilityAssessment, type ExecutionPlan, type PositionMeta, type StrategyIR } from "@trace/strategy-ir";
export { sqrtPriceFromTick } from "./price.js";
export declare const COMPILER_VERSION = "trace-aqua-compiler/2 (@1inch/swap-vm-sdk 0.5.0, @1inch/aqua-sdk 0.4.0)";
export type PoolSpot = {
    /** slot0.sqrtPriceX96 of the basis pool, read on-chain (decimal string). */
    sqrtPriceX96: string;
    tick: number;
    block: number;
};
export type CompileInput = {
    ir: StrategyIR;
    compat: CompatibilityAssessment;
    basis: PositionMeta;
    maker: string;
    /** Most the user is willing to commit, in token base units (decimal strings). */
    amount0: string;
    amount1: string;
    /** The basis pool's current price, read on-chain. Amounts are sized against it. */
    spot: PoolSpot;
    registry: string;
    app: string;
    chainId: number;
    strategyVersionHash?: string;
};
export declare function feeBpsFromTier(feeTier: number): number;
export declare function isFullRangeTicks(tickLower: number, tickUpper: number): boolean;
/**
 * Size the shipped amounts so the strategy starts at the pool's spot price and never
 * uses more than offered. Concentrated: the SDK's computeLiquidityFromAmounts (exact
 * integer inverse of the contract's computeBalances). Outside the range only one
 * token can back the position, as on Uniswap.
 */
export declare function allocate(avail0: bigint, avail1: bigint, sqrtSpot: bigint, bounds: {
    sqrtMin: bigint;
    sqrtMax: bigint;
} | null): {
    a0: bigint;
    a1: bigint;
    position: NonNullable<ExecutionPlan["allocation"]>["position"];
    note: string;
};
export declare function compilePlan(input: CompileInput): ExecutionPlan;
/**
 * Decode a compiled plan back with the SDKs and check it against independent
 * computations. Used by compilePlan (never returns a failing plan) and by tests.
 */
export declare function verifyCompiledPlan(plan: ExecutionPlan, basis: PositionMeta): {
    key: string;
    ok: boolean;
    detail: string;
}[];
