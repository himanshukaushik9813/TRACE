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
import { createRequire } from "node:module";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { contentHash, validatePlan, } from "@trace/strategy-ir";
// @1inch/swap-vm-sdk@0.5.0's ESM build has an extensionless deep import that
// Node cannot resolve; its CommonJS build is correct. Both SDKs are loaded via
// CJS so they share one @1inch/sdk-core instance (Address/HexString classes).
const require = createRequire(import.meta.url);
const { AquaProtocolContract } = require("@1inch/aqua-sdk");
const { Address, AquaXYCAmmStrategy, HexString, MakerTraits, Order } = require("@1inch/swap-vm-sdk");
const FULL_RANGE_TICKS = 1_700_000;
/** sqrt(P·1e18) for P = 1.0001^tick, as the on-chain fixed-point bigint. */
export function sqrtPriceFromTick(tick) {
    const v = Math.pow(1.0001, tick / 2) * 1e9;
    if (!Number.isFinite(v) || v < 1)
        throw new Error(`tick ${tick} is outside the representable SwapVM price range`);
    return BigInt(Math.round(v));
}
export function feeBpsFromTier(feeTier) {
    return Math.round(feeTier / 100); // hundredths of a bip → bps (3000 → 30)
}
export function compilePlan(input) {
    const { ir, compat, basis } = input;
    if (compat.verdict === "INCOMPATIBLE")
        throw new Error("strategy is INCOMPATIBLE with Aqua — nothing to compile");
    if (basis.decimals0 == null || basis.decimals1 == null)
        throw new Error("token decimals unknown — cannot build exact amounts");
    const a0 = BigInt(input.amount0);
    const a1 = BigInt(input.amount1);
    if (a0 < 0n || a1 < 0n || a0 + a1 === 0n)
        throw new Error("ship amounts must be non-negative and not both zero");
    const maker = getAddress(input.maker);
    const registry = getAddress(input.registry);
    const app = getAddress(input.app);
    const token0 = getAddress(basis.token0);
    const token1 = getAddress(basis.token1);
    const feeBps = feeBpsFromTier(basis.feeTier);
    const salt = BigInt(`0x${contentHash({ strategy: ir.id, maker }).digest.slice(0, 16)}`);
    const fullRange = basis.tickUpper - basis.tickLower >= FULL_RANGE_TICKS;
    const sqrtPriceMin = fullRange ? 0n : sqrtPriceFromTick(basis.tickLower);
    const sqrtPriceMax = fullRange ? 0n : sqrtPriceFromTick(basis.tickUpper);
    const strategy = fullRange ? AquaXYCAmmStrategy.new() : AquaXYCAmmStrategy.newConcentrate({ sqrtPriceMin, sqrtPriceMax });
    if (feeBps > 0)
        strategy.withFeeTokenIn(feeBps);
    strategy.withSalt(salt);
    const program = strategy.build();
    const order = Order.new({ maker: new Address(maker), program, traits: MakerTraits.default() });
    const orderHex = order.encode();
    const strategyHash = AquaProtocolContract.calculateStrategyHash(orderHex).toString();
    const aqua = new AquaProtocolContract(new Address(registry));
    const tokens = [
        { address: token0, symbol: basis.symbol0, decimals: basis.decimals0, amount: a0.toString() },
        { address: token1, symbol: basis.symbol1, decimals: basis.decimals1, amount: a1.toString() },
    ].filter((t) => BigInt(t.amount) > 0n);
    const steps = [];
    for (const t of tokens) {
        steps.push({
            op: "approve",
            description: `Approve exactly ${t.amount} base units of ${t.symbol} to the Aqua registry (pulled only when a swap fills)`,
            to: t.address,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [registry, BigInt(t.amount)] }),
            value: "0",
            approval: { token: t.address, spender: registry, amount: t.amount },
        });
    }
    const ship = aqua.ship({
        app: new Address(app),
        strategy: orderHex,
        amountsAndTokens: tokens.map((t) => ({ token: new Address(t.address), amount: BigInt(t.amount) })),
    });
    steps.push({
        op: "ship",
        description: `Ship the strategy: set virtual balances (${tokens.map((t) => t.symbol).join(" + ")}) for strategy hash ${strategyHash.slice(0, 10)}…`,
        to: ship.to.toString(),
        data: ship.data.toString(),
        value: ship.value.toString(),
    });
    const dock = aqua.dock({
        app: new Address(app),
        strategyHash: new HexString(strategyHash),
        tokens: [token0, token1].map((t) => new Address(t)),
    });
    steps.push({
        op: "dock",
        description: "Dock the strategy: zero its virtual balances (no tokens move)",
        to: dock.to.toString(),
        data: dock.data.toString(),
        value: dock.value.toString(),
    });
    const priceLow = Math.pow(1.0001, basis.tickLower) * 10 ** (basis.decimals0 - basis.decimals1);
    const priceHigh = Math.pow(1.0001, basis.tickUpper) * 10 ** (basis.decimals0 - basis.decimals1);
    const body = {
        strategyId: ir.id,
        format: "aqua_swapvm_order_v1",
        chainId: input.chainId,
        maker,
        registry,
        app,
        tokens,
        order: orderHex.toString(),
        strategyHash,
        params: {
            priceLow: fullRange ? 0 : priceLow,
            priceHigh: fullRange ? Number.POSITIVE_INFINITY : priceHigh,
            sqrtPriceMin: sqrtPriceMin.toString(),
            sqrtPriceMax: sqrtPriceMax.toString(),
            feeBps,
            salt: salt.toString(),
        },
        steps,
        notCompiled: compat.rules.filter((r) => r.status !== "supported").map((r) => `${r.rule} (${r.status}): ${r.gap ?? ""}`),
        deterministic: true,
    };
    if (!Number.isFinite(body.params.priceHigh))
        body.params.priceHigh = 0; // JSON-safe: 0 = unbounded (full range)
    const plan = { ...body, planHash: contentHash(body).digest };
    const v = validatePlan(plan);
    if (!v.ok)
        throw new Error(`compiled plan failed validation: ${v.issues.map((i) => i.message).join("; ")}`);
    return plan;
}
