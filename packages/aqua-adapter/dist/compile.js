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
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi } from "viem";
import { contentHash, validatePlan, } from "@trace/strategy-ir";
import { humanPriceAtTick, humanPriceFromSqrt1e18, sqrtPrice1e18FromX96, sqrtPriceFromTick } from "./price.js";
export { sqrtPriceFromTick } from "./price.js";
export const COMPILER_VERSION = "trace-aqua-compiler/2 (@1inch/swap-vm-sdk 0.5.0, @1inch/aqua-sdk 0.4.0)";
// @1inch/swap-vm-sdk@0.5.0's ESM build has an extensionless deep import that
// Node cannot resolve; its CommonJS build is correct. Both SDKs are loaded via
// CJS so they share one @1inch/sdk-core instance (Address/HexString classes).
const require = createRequire(import.meta.url);
const { AquaProtocolContract } = require("@1inch/aqua-sdk");
const SVM = require("@1inch/swap-vm-sdk");
const { Address, AquaXYCAmmStrategy, HexString, MakerTraits, Order, instructions } = SVM;
const C = instructions.concentrate;
const FULL_RANGE_TICKS = 1_700_000;
const ONE_E36 = 10n ** 36n;
const SHIP_ABI = parseAbi(["function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)"]);
export function feeBpsFromTier(feeTier) {
    return Math.round(feeTier / 100); // hundredths of a bip → bps (3000 → 30)
}
export function isFullRangeTicks(tickLower, tickUpper) {
    return tickUpper - tickLower >= FULL_RANGE_TICKS;
}
/**
 * Size the shipped amounts so the strategy starts at the pool's spot price and never
 * uses more than offered. Concentrated: the SDK's computeLiquidityFromAmounts (exact
 * integer inverse of the contract's computeBalances). Outside the range only one
 * token can back the position, as on Uniswap.
 */
export function allocate(avail0, avail1, sqrtSpot, bounds) {
    if (!bounds) {
        // Plain XYC: reserve1 / reserve0 = P = (sqrtSpot/1e18)^2.
        const p2 = sqrtSpot * sqrtSpot;
        const need0 = (avail1 * ONE_E36) / p2;
        if (need0 <= avail0)
            return { a0: need0, a1: avail1, position: "full_range", note: `full range: ${avail1 > 0n ? "all of token1 and the token0 that matches it at the spot price" : "nothing"}` };
        return { a0: avail0, a1: (avail0 * p2) / ONE_E36, position: "full_range", note: "full range: all of token0 and the token1 that matches it at the spot price" };
    }
    const { sqrtMin, sqrtMax } = bounds;
    if (sqrtSpot <= sqrtMin)
        return { a0: avail0, a1: 0n, position: "below_range", note: "the pool price is below the range, so only token0 can back it (as on Uniswap); it starts trading when the price rises into the range" };
    if (sqrtSpot >= sqrtMax)
        return { a0: 0n, a1: avail1, position: "above_range", note: "the pool price is above the range, so only token1 can back it (as on Uniswap); it starts trading when the price falls into the range" };
    const r = C.computeLiquidityFromAmounts(avail0, avail1, sqrtSpot, sqrtMin, sqrtMax);
    return { a0: r.actualLt, a1: r.actualGt, position: "in_range", note: "inside the range: both tokens in the ratio the spot price requires, limited by the scarcer one" };
}
export function compilePlan(input) {
    const { ir, compat, basis } = input;
    if (compat.verdict === "INCOMPATIBLE")
        throw new Error("strategy is INCOMPATIBLE with Aqua — nothing to compile");
    if (basis.decimals0 == null || basis.decimals1 == null)
        throw new Error("token decimals unknown — cannot build exact amounts");
    const req0 = BigInt(input.amount0);
    const req1 = BigInt(input.amount1);
    if (req0 < 0n || req1 < 0n || req0 + req1 === 0n)
        throw new Error("amounts must be non-negative and not both zero");
    const maker = getAddress(input.maker);
    const registry = getAddress(input.registry);
    const app = getAddress(input.app);
    const token0 = getAddress(basis.token0);
    const token1 = getAddress(basis.token1);
    if (BigInt(token0) >= BigInt(token1))
        throw new Error("token0 must sort below token1 (Uniswap and SwapVM both order by address)");
    const feeBps = feeBpsFromTier(basis.feeTier);
    const salt = BigInt(`0x${contentHash({ strategy: ir.id, maker }).digest.slice(0, 16)}`);
    const fullRange = isFullRangeTicks(basis.tickLower, basis.tickUpper);
    const sqrtPriceMin = fullRange ? 0n : sqrtPriceFromTick(basis.tickLower);
    const sqrtPriceMax = fullRange ? 0n : sqrtPriceFromTick(basis.tickUpper);
    if (!fullRange)
        C.ConcentrateGrowLiquidity2DArgs.fromSqrtPrices(sqrtPriceMin, sqrtPriceMax); // SDK validates the bounds
    if (!fullRange && sqrtPriceMin >= sqrtPriceMax)
        throw new Error("price bounds are empty (min ≥ max)");
    const spotSqrtX96 = BigInt(input.spot.sqrtPriceX96);
    if (spotSqrtX96 <= 0n)
        throw new Error("pool spot price unavailable");
    const sqrtSpot = sqrtPrice1e18FromX96(spotSqrtX96);
    const alloc = allocate(req0, req1, sqrtSpot, fullRange ? null : { sqrtMin: sqrtPriceMin, sqrtMax: sqrtPriceMax });
    if (alloc.a0 + alloc.a1 === 0n)
        throw new Error(alloc.position === "below_range"
            ? `the pool price is below this range, so it needs ${basis.symbol0}; enter a ${basis.symbol0} amount`
            : alloc.position === "above_range"
                ? `the pool price is above this range, so it needs ${basis.symbol1}; enter a ${basis.symbol1} amount`
                : "these amounts are too small to back any liquidity at the current price");
    const strategy = fullRange ? AquaXYCAmmStrategy.new() : AquaXYCAmmStrategy.newConcentrate({ sqrtPriceMin, sqrtPriceMax });
    if (feeBps > 0)
        strategy.withFeeTokenIn(feeBps);
    strategy.withSalt(salt);
    const program = strategy.build();
    const order = Order.new({ maker: new Address(maker), program, traits: MakerTraits.default() });
    const orderHex = order.encode();
    const strategyHash = AquaProtocolContract.calculateStrategyHash(orderHex).toString();
    const aqua = new AquaProtocolContract(new Address(registry));
    // Both tokens are registered on ship (amount may be 0); only non-zero ones need an approval.
    const tokens = [
        { address: token0, symbol: basis.symbol0, decimals: basis.decimals0, amount: alloc.a0.toString() },
        { address: token1, symbol: basis.symbol1, decimals: basis.decimals1, amount: alloc.a1.toString() },
    ];
    const steps = [];
    for (const t of tokens.filter((x) => BigInt(x.amount) > 0n)) {
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
        description: `Ship the strategy: set virtual balances (${tokens.map((t) => `${t.symbol} ${t.amount}`).join(", ")}) for strategy hash ${strategyHash.slice(0, 10)}…`,
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
    const implied = !fullRange && alloc.position === "in_range" ? C.computeLiquidityAndPrice(alloc.a0, alloc.a1, sqrtPriceMin, sqrtPriceMax).sqrtPriceSpot : null;
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
            priceLow: fullRange ? 0 : humanPriceFromSqrt1e18(sqrtPriceMin, basis.decimals0, basis.decimals1),
            priceHigh: fullRange ? 0 : humanPriceFromSqrt1e18(sqrtPriceMax, basis.decimals0, basis.decimals1), // 0 = unbounded (full range)
            sqrtPriceMin: sqrtPriceMin.toString(),
            sqrtPriceMax: sqrtPriceMax.toString(),
            feeBps,
            salt: salt.toString(),
        },
        steps,
        notCompiled: compat.rules.filter((r) => r.status !== "supported").map((r) => `${r.rule} (${r.status}): ${r.gap ?? ""}`),
        deterministic: true,
        source: { strategyId: ir.id, ...(input.strategyVersionHash ? { strategyVersionHash: input.strategyVersionHash } : {}), compiler: COMPILER_VERSION },
        allocation: {
            requested: [req0.toString(), req1.toString()],
            shipped: [alloc.a0.toString(), alloc.a1.toString()],
            spot: {
                sqrtPriceX96: spotSqrtX96.toString(),
                tick: input.spot.tick,
                block: input.spot.block,
                pool: basis.pool ?? "",
                sqrtPrice1e18: sqrtSpot.toString(),
                price: humanPriceFromSqrt1e18(sqrtSpot, basis.decimals0, basis.decimals1),
            },
            position: alloc.position,
            ...(implied != null ? { impliedSqrtPrice1e18: implied.toString() } : {}),
            note: alloc.note,
        },
    };
    const validation = verifyCompiledPlan(body, basis);
    const bad = validation.filter((v) => !v.ok);
    if (bad.length)
        throw new Error(`compiled plan failed its own checks: ${bad.map((b) => `${b.key}: ${b.detail}`).join("; ")}`);
    const withChecks = { ...body, validation };
    const plan = { ...withChecks, planHash: contentHash(withChecks).digest };
    const v = validatePlan(plan);
    if (!v.ok)
        throw new Error(`compiled plan failed validation: ${v.issues.map((i) => i.message).join("; ")}`);
    return plan;
}
/**
 * Decode a compiled plan back with the SDKs and check it against independent
 * computations. Used by compilePlan (never returns a failing plan) and by tests.
 */
export function verifyCompiledPlan(plan, basis) {
    const out = [];
    const add = (key, ok, detail) => out.push({ key, ok, detail });
    const hex = new HexString(plan.order);
    // 1. Order round-trip and maker binding.
    let decoded = null;
    try {
        decoded = Order.decode(hex);
        add("order.roundtrip", decoded.encode().toString().toLowerCase() === plan.order.toLowerCase(), "Order.decode(order).encode() reproduces the shipped bytes");
        add("order.maker", decoded.maker.toString().toLowerCase() === plan.maker.toLowerCase(), `order maker ${decoded.maker.toString()}`);
    }
    catch (err) {
        add("order.roundtrip", false, `order does not decode: ${err.message}`);
    }
    // 2. Strategy hash = keccak256(order), computed independently of the SDK.
    add("strategy.hash", keccak256(plan.order).toLowerCase() === plan.strategyHash.toLowerCase(), "strategyHash = keccak256(order bytes)");
    // 3. Ship calldata: target, app, exact order bytes, both tokens, amounts.
    const ship = plan.steps.find((s) => s.op === "ship");
    if (!ship)
        add("ship.present", false, "no ship step");
    else {
        try {
            const d = decodeFunctionData({ abi: SHIP_ABI, data: ship.data });
            const [appArg, strat, toks, amts] = d.args;
            add("ship.target", getAddress(ship.to) === getAddress(plan.registry), `ship is sent to the Aqua registry ${plan.registry}`);
            add("ship.app", getAddress(appArg) === getAddress(plan.app), `app = AquaSwapVMRouter ${plan.app}`);
            add("ship.strategy", strat.toLowerCase() === plan.order.toLowerCase(), "ship carries exactly the compiled order bytes");
            const tokOk = toks.length === 2 && plan.tokens.every((t, i) => getAddress(toks[i]) === getAddress(t.address) && amts[i] === BigInt(t.amount));
            add("ship.tokens", tokOk, `both tokens registered with the planned amounts (${plan.tokens.map((t) => `${t.symbol} ${t.amount}`).join(", ")})`);
        }
        catch (err) {
            add("ship.decode", false, `ship calldata does not decode: ${err.message}`);
        }
    }
    // 4. Approvals: exact amounts, to the registry, one per non-zero token, none unlimited.
    const approvals = plan.steps.filter((s) => s.op === "approve");
    const needed = plan.tokens.filter((t) => BigInt(t.amount) > 0n);
    let apOk = approvals.length === needed.length;
    for (const s of approvals) {
        const d = decodeFunctionData({ abi: erc20Abi, data: s.data });
        const tok = plan.tokens.find((t) => getAddress(t.address) === getAddress(s.to));
        apOk &&= d.functionName === "approve" && getAddress(d.args[0]) === getAddress(plan.registry) && tok != null && d.args[1] === BigInt(tok.amount);
    }
    add("approvals.exact", apOk, `${approvals.length} approval(s), each for exactly the shipped amount, spender = registry`);
    // 5. Token ordering and price bounds against an independent float computation from the ticks.
    add("tokens.order", BigInt(plan.tokens[0].address) < BigInt(plan.tokens[1].address), "token0 < token1 by address (P = token1/token0 = tokenGt/tokenLt)");
    const d0 = basis.decimals0 ?? 0;
    const d1 = basis.decimals1 ?? 0;
    if (plan.params.sqrtPriceMin !== "0") {
        const lo = humanPriceFromSqrt1e18(BigInt(plan.params.sqrtPriceMin), d0, d1);
        const hi = humanPriceFromSqrt1e18(BigInt(plan.params.sqrtPriceMax), d0, d1);
        const loRef = humanPriceAtTick(basis.tickLower, d0, d1);
        const hiRef = humanPriceAtTick(basis.tickUpper, d0, d1);
        const rel = Math.max(Math.abs(lo / loRef - 1), Math.abs(hi / hiRef - 1));
        add("price.bounds", rel < 1e-9 && lo < hi, `bounds ${lo.toPrecision(8)}–${hi.toPrecision(8)} ${basis.symbol1}/${basis.symbol0} match the position's ticks (${basis.tickLower}, ${basis.tickUpper}); max relative error ${rel.toExponential(1)}`);
        // Same bounds through the SDK's own Price class (independent of this file's math).
        try {
            const pair = { tokenA: { address: new Address(plan.tokens[0].address), decimals: BigInt(d0) }, tokenB: { address: new Address(plan.tokens[1].address), decimals: BigInt(d1) } };
            const sdkLo = Number(C.Price.fromSqrt(BigInt(plan.params.sqrtPriceMin), pair).toHuman(new Address(plan.tokens[1].address)));
            add("price.sdk", Math.abs(sdkLo / loRef - 1) < Math.max(1e-4, 10 ** -d1 / loRef), `SDK Price.fromSqrt(min).toHuman() = ${sdkLo} vs ${loRef.toPrecision(8)} from the tick`);
        }
        catch (err) {
            add("price.sdk", false, `SDK rejected the bound: ${err.message}`);
        }
    }
    // 6. The shipped balances must start the strategy at the pool's spot price.
    const al = plan.allocation;
    if (al?.position === "in_range") {
        const implied = BigInt(al.impliedSqrtPrice1e18 ?? "0");
        const spot = BigInt(al.spot.sqrtPrice1e18);
        const rel = spot > 0n ? Math.abs(Number(implied - spot) / Number(spot)) : 1;
        add("price.start", rel < 1e-3, `shipped balances imply a start price within ${(rel * 100).toPrecision(2)}% of the pool spot (SDK computeLiquidityAndPrice)`);
    }
    else if (al) {
        add("price.start", true, al.note);
    }
    return out;
}
