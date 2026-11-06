/**
 * Exact price conversions between Uniswap V3 ticks and SwapVM concentrate bounds.
 *
 * SwapVM (XYCConcentrate) encodes each bound as sqrt(P) in 1e18 fixed-point, where
 * P = tokenGt / tokenLt in token BASE units (@1inch/swap-vm-sdk: Price.toSqrt(),
 * ConcentrateGrowLiquidity2DArgs; "sqrt(P * 1e18)" in the SDK means P already in
 * 1e18 fixed-point). A Uniswap V3 pool sorts token0 < token1 by address, and its
 * price 1.0001^tick is token1/token0 in base units, so the two conventions agree
 * on direction; only the fixed-point scale differs.
 *
 * Everything here is integer math (Uniswap TickMath → Q64.96 → 1e18), so the
 * same tick always yields the same bytes. No floating point reaches the order.
 */
export declare const MIN_TICK = -887272;
export declare const MAX_TICK = 887272;
/** Uniswap V3 TickMath.getSqrtRatioAtTick, ported to BigInt (exact). */
export declare function sqrtRatioX96AtTick(tick: number): bigint;
/** Q64.96 sqrt price → SwapVM sqrt(P) in 1e18 fixed-point (rounded down). */
export declare function sqrtPrice1e18FromX96(sqrtPriceX96: bigint): bigint;
/** SwapVM concentrate bound for a Uniswap tick: sqrt(1.0001^tick) · 1e18, exact. */
export declare function sqrtPriceFromTick(tick: number): bigint;
/** Human price (token1 per 1 token0) from a 1e18 sqrt price — for display and cross-checks only. */
export declare function humanPriceFromSqrt1e18(sqrt: bigint, decimals0: number, decimals1: number): number;
/** Human price (token1 per 1 token0) at a tick, computed independently in float — a cross-check, never encoded. */
export declare function humanPriceAtTick(tick: number, decimals0: number, decimals1: number): number;
