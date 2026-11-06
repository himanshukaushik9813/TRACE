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
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const Q96 = 1n << 96n;
const ONE_E18 = 10n ** 18n;
/** Uniswap V3 TickMath.getSqrtRatioAtTick, ported to BigInt (exact). */
export function sqrtRatioX96AtTick(tick) {
    if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK)
        throw new Error(`tick ${tick} is outside [${MIN_TICK}, ${MAX_TICK}]`);
    const abs = BigInt(Math.abs(tick));
    let r = abs & 0x1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
    const M = [
        [0x2n, 0xfff97272373d413259a46990580e213an],
        [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
        [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
        [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
        [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
        [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
        [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
        [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
        [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
        [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
        [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
        [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
        [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
        [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
        [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
        [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
        [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
        [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
        [0x80000n, 0x48a170391f7dc42444e8fa2n],
    ];
    for (const [bit, mul] of M)
        if (abs & bit)
            r = (r * mul) >> 128n;
    if (tick > 0)
        r = ((1n << 256n) - 1n) / r;
    return (r >> 32n) + (r % (1n << 32n) === 0n ? 0n : 1n);
}
/** Q64.96 sqrt price → SwapVM sqrt(P) in 1e18 fixed-point (rounded down). */
export function sqrtPrice1e18FromX96(sqrtPriceX96) {
    return (sqrtPriceX96 * ONE_E18) / Q96;
}
/** SwapVM concentrate bound for a Uniswap tick: sqrt(1.0001^tick) · 1e18, exact. */
export function sqrtPriceFromTick(tick) {
    const v = sqrtPrice1e18FromX96(sqrtRatioX96AtTick(tick));
    if (v <= 0n)
        throw new Error(`tick ${tick} is below the smallest price SwapVM can represent (sqrt price rounds to 0)`);
    return v;
}
/** Human price (token1 per 1 token0) from a 1e18 sqrt price — for display and cross-checks only. */
export function humanPriceFromSqrt1e18(sqrt, decimals0, decimals1) {
    const s = Number(sqrt) / 1e18;
    return s * s * 10 ** (decimals0 - decimals1);
}
/** Human price (token1 per 1 token0) at a tick, computed independently in float — a cross-check, never encoded. */
export function humanPriceAtTick(tick, decimals0, decimals1) {
    return Math.pow(1.0001, tick) * 10 ** (decimals0 - decimals1);
}
