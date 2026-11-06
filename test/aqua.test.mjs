// Phase 4 — 1inch Aqua compatibility, deterministic compilation and on-chain
// verification logic. Strategy evidence and pool prices are REAL captured Sepolia
// data (test/data). Where a test needs a position on the captured USDC/WETH pool,
// it is labelled as a test-only position built around that pool's real price.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import {
  assessCompatibility,
  compilePlan,
  verifyCompiledPlan,
  allocate,
  aquaClient,
  sqrtPriceFromTick,
  sqrtRatioX96AtTick,
  sqrtPrice1e18FromX96,
  feeBpsFromTier,
  MIN_TICK,
  MAX_TICK,
  VERDICT_LABEL,
} from "@trace/aqua-adapter";
import { inferFromEvidence } from "@trace/strategy-inference";
import { AQUA } from "@trace/chain-config";
import { walletHistory, wethUsdcSeries } from "./helpers.mjs";
import { startRpcStub, word } from "./rpc-stub.mjs";

const require = createRequire(import.meta.url);
const SVM = require("@1inch/swap-vm-sdk");
const C = SVM.instructions.concentrate;
const SHIP_ABI = parseAbi(["function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)"]);

const h = walletHistory();
const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });
const positions = Object.values(h.positions);
const concentrated = positions.find((p) => p.tokenId === 234012); // ticks [-600, 600], 0.3%
const fullRange = positions.find((p) => p.tokenId === 234019); // ticks [-887270, 887270]

// Real captured USDC/WETH 1% pool: the last swap gives a real spot (sqrtPriceX96 + tick + block).
const series = wethUsdcSeries();
const last = series.points.at(-1);
const realSpot = { sqrtPriceX96: last.sqrtPriceX96, tick: last.tick, block: last.block };
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
// TEST-ONLY position on that real pool: ±2000 ticks around the real spot (tick spacing 200).
const around = (w) => ({
  tokenId: 0,
  pool: series.pool,
  token0: USDC,
  token1: WETH,
  symbol0: "USDC",
  symbol1: "WETH",
  decimals0: 6,
  decimals1: 18,
  feeTier: 10000,
  tickLower: Math.floor((last.tick - w) / 200) * 200,
  tickUpper: Math.ceil((last.tick + w) / 200) * 200,
  currentLiquidity: "0",
  burned: false,
  historyComplete: true,
});
const usdcWeth = around(2000);

const MAKER = "0x000000000000000000000000000000000000dEaD";
const midSpot = (p) => {
  const t = Math.round((p.tickLower + p.tickUpper) / 2);
  return { sqrtPriceX96: sqrtRatioX96AtTick(t).toString(), tick: t, block: 1 }; // test input: the range midpoint
};
const args = (over = {}) => {
  const basis = over.basis ?? concentrated;
  return {
    ir,
    compat: assessCompatibility(ir, basis, [], over.spot ?? midSpot(basis)),
    basis,
    maker: MAKER,
    amount0: "1000000000000000",
    amount1: "2000000000000000",
    spot: midSpot(basis),
    registry: AQUA.registry.address,
    app: AQUA.swapVmRouter.address,
    chainId: 11155111,
    ...over,
  };
};

/* ------------------------------ price math ------------------------------ */

test("tick math is Uniswap's exact TickMath, and bounds are sqrt(P)·1e18 as the SwapVM SDK defines", () => {
  assert.equal(sqrtRatioX96AtTick(0), 2n ** 96n);
  assert.equal(sqrtRatioX96AtTick(MIN_TICK), 4295128739n);
  assert.equal(sqrtRatioX96AtTick(MAX_TICK), 1461446703485210103287273052203988822378723970342n);
  assert.equal(sqrtPriceFromTick(0), 10n ** 18n);
  for (let t = -400000; t <= 400000; t += 7919) {
    const rel = Math.abs(Number(sqrtPriceFromTick(t)) / (Math.pow(1.0001, t / 2) * 1e18) - 1);
    assert.ok(rel < 1e-9, `tick ${t}: ${rel}`);
  }
  // Same bound through the SDK's own Price class: 3000 USDC per WETH.
  const sdk = C.Price.fromHuman("3000", { quoteToken: { address: new SVM.Address(USDC), decimals: 6n }, baseToken: { address: new SVM.Address(WETH), decimals: 18n } }).toSqrt();
  const tick = Math.log(1e18 / 3000e6) / Math.log(1.0001);
  const ours = Number(sqrtPriceFromTick(Math.round(tick)));
  assert.ok(Math.abs(Number(sdk) / ours - 1) < 6e-5, "agrees with the SDK within half a tick");
  assert.equal(feeBpsFromTier(3000), 30);
  assert.equal(feeBpsFromTier(10000), 100);
});

test("regression: the earlier compiler encoded sqrt(P)·1e9 (prices 1e18 too low); the fixed bound is 1e9 × that", () => {
  for (const t of [-600, 600, 173882, 196256]) {
    const old = BigInt(Math.round(Math.pow(1.0001, t / 2) * 1e9)); // the formula plans 7adbbae6…cac98225 were compiled with
    const ratio = Number(sqrtPriceFromTick(t)) / Number(old);
    assert.ok(Math.abs(ratio / 1e9 - 1) < 1e-6, `tick ${t}: ratio ${ratio}`);
  }
});

/* ---------------------------- compatibility ----------------------------- */

test("compatibility: every required check is reported, with plain verdict labels", () => {
  const c = assessCompatibility(ir, usdcWeth, [], realSpot);
  const keys = c.checks.map((x) => x.key);
  for (const k of ["tokens.distinct", "tokens.order", "tokens.decimals", "price.bounds", "info.conditions", "info.operations", "liquidity.requirement", "capital.requirement"]) assert.ok(keys.includes(k), `missing ${k}`);
  assert.equal(c.checks.find((x) => x.key === "tokens.order").ok, true);
  assert.match(c.checks.find((x) => x.key === "liquidity.requirement").detail, /inside the range: both USDC and WETH/);
  assert.equal(c.verdictLabel, VERDICT_LABEL[c.verdict]);
  assert.ok(["Fully compatible within supported scope", "Partially compatible", "Incompatible"].includes(c.verdictLabel));
  assert.ok(c.unsupportedNotes.at(-1).includes("not a migration"), "never claims the Uniswap NFT migrates");
});

test("compatibility is rule-by-rule: adjustment/exit are partial, risk is unsupported, each gap explained", () => {
  const c = assessCompatibility(ir, concentrated, [], midSpot(concentrated));
  assert.notEqual(c.verdict, "INCOMPATIBLE");
  for (const r of c.rules) {
    if (r.category === "adjustment" || r.category === "exit") assert.equal(r.status, "partial");
    if (r.category === "risk") assert.equal(r.status, "unsupported");
    if (r.status !== "supported") assert.ok(r.gap && r.gap.length > 10);
  }
  const riskIr = { ...ir, rules: [...ir.rules, { ...ir.rules[0], category: "risk", rule: "Stops out below a price" }] };
  const rc = assessCompatibility(riskIr, concentrated);
  assert.equal(rc.verdict, "PARTIAL");
  assert.ok(rc.unsupportedNotes.some((n) => n.startsWith("Stops out below a price")));
});

test("incompatible: inconclusive strategy, mis-ordered tokens, missing decimals, no position", () => {
  const { ir: thin } = inferFromEvidence({ events: h.events.slice(0, 1), wallet: h.wallet, window: h.window, meta: h.positions });
  assert.equal(assessCompatibility(thin, concentrated).verdict, "INCOMPATIBLE");
  assert.throws(() => compilePlan(args({ ir: thin, compat: assessCompatibility(thin, concentrated) })), /INCOMPATIBLE/);
  const swapped = { ...usdcWeth, token0: WETH, token1: USDC };
  const s = assessCompatibility(ir, swapped);
  assert.equal(s.checks.find((x) => x.key === "tokens.order").ok, false);
  assert.equal(s.verdict, "INCOMPATIBLE");
  assert.equal(assessCompatibility(ir, { ...usdcWeth, decimals1: null }).verdict, "INCOMPATIBLE");
  assert.equal(assessCompatibility(ir, null).verdict, "INCOMPATIBLE");
});

/* ----------------------------- compilation ------------------------------ */

test("compile is deterministic and bound to the source strategy version", () => {
  const a = compilePlan(args({ strategyVersionHash: "fnv1a:test" }));
  const b = compilePlan(args({ strategyVersionHash: "fnv1a:test" }));
  assert.equal(a.planHash, b.planHash);
  assert.equal(a.order, b.order);
  assert.equal(a.strategyHash, b.strategyHash);
  assert.equal(a.source.strategyId, ir.id);
  assert.equal(a.source.strategyVersionHash, "fnv1a:test");
  assert.match(a.source.compiler, /swap-vm-sdk/);
  assert.notEqual(compilePlan(args({ amount0: "1000000000000001" })).planHash, a.planHash, "amounts are bound into the plan");
  assert.ok(a.validation.length >= 8 && a.validation.every((v) => v.ok), JSON.stringify(a.validation.filter((v) => !v.ok)));
});

test("in range on the real USDC/WETH price: amounts sized to the spot, never above the request, start price = spot", () => {
  const p = compilePlan(args({ basis: usdcWeth, compat: assessCompatibility(ir, usdcWeth, [], realSpot), spot: realSpot, amount0: "5000000", amount1: "1000000000000000" }));
  assert.equal(p.allocation.position, "in_range");
  const [s0, s1] = p.allocation.shipped.map(BigInt);
  assert.ok(s0 <= 5000000n && s1 <= 1000000000000000n);
  assert.ok(s0 === 5000000n || s1 === 1000000000000000n, "the scarcer token is used in full");
  const start = p.validation.find((v) => v.key === "price.start");
  assert.equal(start.ok, true, start.detail);
  // The shipped balances, read back through the SDK, imply the real pool price.
  const implied = C.computeLiquidityAndPrice(s0, s1, BigInt(p.params.sqrtPriceMin), BigInt(p.params.sqrtPriceMax)).sqrtPriceSpot;
  const spot = sqrtPrice1e18FromX96(BigInt(realSpot.sqrtPriceX96));
  assert.ok(Math.abs(Number(implied) / Number(spot) - 1) < 1e-3);
  // Human price bounds bracket the real spot price (USDC is token0: price = WETH per USDC).
  assert.ok(p.params.priceLow < last.price && last.price < p.params.priceHigh, `${p.params.priceLow} < ${last.price} < ${p.params.priceHigh}`);
});

test("outside the range only one token can back it, but both are registered on ship", () => {
  const below = { ...usdcWeth, tickLower: usdcWeth.tickUpper + 2000, tickUpper: usdcWeth.tickUpper + 6000 }; // spot is below this range
  const p = compilePlan(args({ basis: below, compat: assessCompatibility(ir, below, [], realSpot), spot: realSpot, amount0: "5000000", amount1: "1000000000000000" }));
  assert.equal(p.allocation.position, "below_range");
  assert.deepEqual(p.allocation.shipped, ["5000000", "0"]);
  assert.equal(p.steps.filter((s) => s.op === "approve").length, 1, "no approval for a zero amount");
  const d = decodeFunctionData({ abi: SHIP_ABI, data: p.steps.find((s) => s.op === "ship").data });
  assert.equal(d.args[2].length, 2, "both tokens registered (Aqua safeBalances needs both)");
  assert.deepEqual(d.args[3], [5000000n, 0n]);
  assert.throws(() => compilePlan(args({ basis: below, compat: assessCompatibility(ir, below), spot: realSpot, amount0: "0", amount1: "1000000000000000" })), /below this range, so it needs USDC/);

  const above = { ...usdcWeth, tickLower: usdcWeth.tickLower - 6000, tickUpper: usdcWeth.tickLower - 2000 };
  const q = compilePlan(args({ basis: above, compat: assessCompatibility(ir, above), spot: realSpot, amount0: "5000000", amount1: "1000000000000000" }));
  assert.equal(q.allocation.position, "above_range");
  assert.deepEqual(q.allocation.shipped, ["0", "1000000000000000"]);
});

test("full-range position compiles to a plain XYC curve with reserves in the spot ratio", () => {
  const p = compilePlan(args({ basis: fullRange, compat: assessCompatibility(ir, fullRange), spot: realSpot }));
  assert.equal(p.allocation.position, "full_range");
  assert.equal(p.params.sqrtPriceMin, "0");
  const [a0, a1] = p.allocation.shipped.map(BigInt);
  const s = sqrtPrice1e18FromX96(BigInt(realSpot.sqrtPriceX96));
  const ratio = Number(a1) / Number(a0);
  assert.ok(Math.abs(ratio / ((Number(s) / 1e18) ** 2) - 1) < 1e-6);
});

test("approvals are EXACT shipped amounts to the Aqua registry — never unlimited", () => {
  const p = compilePlan(args());
  const approvals = p.steps.filter((s) => s.op === "approve");
  assert.equal(approvals.length, p.tokens.filter((t) => t.amount !== "0").length);
  for (const s of approvals) {
    const d = decodeFunctionData({ abi: erc20Abi, data: s.data });
    assert.equal(d.functionName, "approve");
    assert.equal(d.args[0].toLowerCase(), AQUA.registry.address.toLowerCase());
    assert.equal(d.args[1].toString(), s.approval.amount);
    assert.equal(s.approval.amount, p.tokens.find((t) => t.address === s.to).amount);
    assert.ok(d.args[1] < 2n ** 128n);
  }
  assert.equal(p.steps.find((s) => s.op === "ship").to.toLowerCase(), AQUA.registry.address.toLowerCase());
});

test("the output validator rejects tampered plans (wrong price scale, amounts, approvals, hash, order bytes)", () => {
  const good = compilePlan(args());
  const check = (plan, key) => {
    const v = verifyCompiledPlan(plan, concentrated);
    const hit = v.find((x) => x.key === key);
    assert.ok(hit && !hit.ok, `${key} should fail: ${JSON.stringify(v.filter((x) => !x.ok))}`);
  };
  // The original bug: bounds 1e9 too small.
  check({ ...good, params: { ...good.params, sqrtPriceMin: (BigInt(good.params.sqrtPriceMin) / 10n ** 9n).toString() } }, "price.bounds");
  // Ship carries a different amount than the plan.
  const ship = good.steps.find((s) => s.op === "ship");
  const d = decodeFunctionData({ abi: SHIP_ABI, data: ship.data });
  const badShip = encodeFunctionData({ abi: SHIP_ABI, functionName: "ship", args: [d.args[0], d.args[1], d.args[2], [d.args[3][0] + 1n, d.args[3][1]]] });
  check({ ...good, steps: good.steps.map((s) => (s.op === "ship" ? { ...s, data: badShip } : s)) }, "ship.tokens");
  // An approval larger than the shipped amount.
  const ap = good.steps.find((s) => s.op === "approve");
  const bigger = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [AQUA.registry.address, BigInt(ap.approval.amount) + 1n] });
  check({ ...good, steps: good.steps.map((s) => (s === ap ? { ...s, data: bigger } : s)) }, "approvals.exact");
  // Strategy hash not matching the order bytes.
  check({ ...good, strategyHash: `0x${"ab".repeat(32)}` }, "strategy.hash");
  // Order bytes from another maker.
  const other = compilePlan(args({ maker: "0x000000000000000000000000000000000000bEEF" }));
  check({ ...good, order: other.order }, "order.maker");
});

test("no LLM output reaches the order: the program decodes to the SDK's own concentrate + fee + XYC instructions", () => {
  const p = compilePlan(args());
  const order = SVM.Order.decode(new SVM.HexString(p.order));
  const rebuilt = SVM.AquaXYCAmmStrategy.newConcentrate({ sqrtPriceMin: BigInt(p.params.sqrtPriceMin), sqrtPriceMax: BigInt(p.params.sqrtPriceMax) })
    .withFeeTokenIn(p.params.feeBps)
    .withSalt(BigInt(p.params.salt))
    .build();
  assert.equal(order.program.toString(), rebuilt.toString());
});

/* ------------------------ on-chain verification ------------------------- */

const stubs = [];
after(() => Promise.all(stubs.map((s) => s.close())));

const RAW_SEL = "0x6d58b4cc";
const QUOTE_SEL = "0x44aa5f14";
async function stateWith({ balances, quote }) {
  const plan = compilePlan(args({ basis: usdcWeth, compat: assessCompatibility(ir, usdcWeth, [], realSpot), spot: realSpot, amount0: "5000000", amount1: "1000000000000000" }));
  const stub = await startRpcStub({
    eth_chainId: () => "0xaa36a7",
    eth_blockNumber: () => "0xb84d62",
    eth_call: ([call]) => {
      if (call.data.startsWith(RAW_SEL)) {
        const token = `0x${call.data.slice(-40)}`.toLowerCase();
        const b = (typeof balances === "function" ? balances(plan) : balances)[token] ?? [0n, 0];
        return `0x${word(b[0])}${word(b[1])}`;
      }
      if (call.data.startsWith(QUOTE_SEL)) return quote(call, plan);
      return { __error: { code: 3, message: "execution reverted" } };
    },
  });
  stubs.push(stub);
  return { plan, state: await aquaClient(stub.url).strategyState(plan) };
}
const shippedBalances = (plan, n = 2) => Object.fromEntries(plan.tokens.map((t) => [t.address.toLowerCase(), [BigInt(t.amount), n]]));

test("on-chain state: registered balances + a router quote of this exact order inside its range → active", async () => {
  const fair = (call, plan) => {
    // Quote the spot price minus the fee, return this order's hash: what a correct router does.
    const tin = `0x${call.data.slice(2 + 8 + 64 * 1 + 24, 2 + 8 + 64 * 2)}`.toLowerCase();
    const amountIn = BigInt(`0x${call.data.slice(2 + 8 + 64 * 3, 2 + 8 + 64 * 4)}`);
    const s = BigInt(plan.allocation.spot.sqrtPrice1e18);
    const out = tin === plan.tokens[0].address.toLowerCase() ? (amountIn * s * s) / 10n ** 36n : (amountIn * 10n ** 36n) / (s * s);
    return `0x${word(amountIn)}${word((out * 99n) / 100n)}${plan.strategyHash.slice(2)}`;
  };
  const { plan, state } = await stateWith({ balances: (p) => shippedBalances(p), quote: fair });
  assert.equal(state.status, "active");
  assert.equal(state.quotes.length, 2);
  assert.ok(state.quotes.every((q) => q.orderHashMatches && q.insideRange === true), JSON.stringify(state.quotes));
  assert.ok(state.checks.every((c) => c.ok), JSON.stringify(state.checks.filter((c) => !c.ok)));
  assert.equal(state.strategyHash, plan.strategyHash);
});

test("on-chain state flags a wrong order hash, an out-of-range price, an unregistered token and a docked strategy", async () => {
  const base = await stateWith({ balances: {}, quote: () => "0x" });
  const plan = base.plan;
  const wrong = (call) => {
    const amountIn = BigInt(`0x${call.data.slice(2 + 8 + 64 * 3, 2 + 8 + 64 * 4)}`);
    return `0x${word(amountIn)}${word(amountIn * 10n ** 30n)}${"cd".repeat(32)}`; // absurd price, other order
  };
  const bad = await stateWith({ balances: shippedBalances(plan), quote: wrong });
  assert.ok(bad.state.quotes.some((q) => !q.orderHashMatches));
  assert.ok(bad.state.quotes.some((q) => q.insideRange === false));
  assert.ok(bad.state.checks.some((c) => c.key.startsWith("state.quote") && !c.ok));

  const one = { [plan.tokens[1].address.toLowerCase()]: [BigInt(plan.tokens[1].amount), 1] };
  const single = await stateWith({ balances: one, quote: wrong });
  assert.equal(single.state.checks.find((c) => c.key === "state.registered").ok, false, "a token missing from ship is reported");

  const docked = await stateWith({ balances: Object.fromEntries(plan.tokens.map((t) => [t.address.toLowerCase(), [0n, 2]])), quote: wrong });
  assert.equal(docked.state.status, "docked");
  assert.equal(docked.state.quotes.length, 0, "no quote is attempted on an empty strategy");
  assert.equal(base.state.status, "not_shipped");
});

test("a reverted ship receipt is reported as reverted, never as shipped", async () => {
  const plan = compilePlan(args());
  const ship = plan.steps.find((s) => s.op === "ship");
  const hash = `0x${"77".repeat(32)}`;
  const stub = await startRpcStub({
    eth_chainId: () => "0xaa36a7",
    eth_blockNumber: () => "0x100",
    eth_getTransactionReceipt: () => ({
      transactionHash: hash, blockNumber: "0xf0", blockHash: `0x${"00".repeat(32)}`, transactionIndex: "0x0", from: plan.maker, to: ship.to,
      status: "0x0", gasUsed: "0x5208", effectiveGasPrice: "0x1", cumulativeGasUsed: "0x5208", logs: [], logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null,
    }),
    eth_getTransactionByHash: () => ({
      hash, blockNumber: "0xf0", blockHash: `0x${"00".repeat(32)}`, transactionIndex: "0x0", from: plan.maker, to: ship.to, input: ship.data, value: "0x0",
      gas: "0x30000", nonce: "0x1", type: "0x2", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1", chainId: "0xaa36a7", v: "0x0", r: `0x${"11".repeat(32)}`, s: `0x${"11".repeat(32)}`,
    }),
  });
  stubs.push(stub);
  const v = await aquaClient(stub.url).verifyTx(hash, plan, "ship");
  assert.equal(v.status, "reverted");
  assert.equal(v.outcome, "transaction reverted");
  assert.equal(v.matchesPlan, true, "it was the planned calldata — it just failed");
  assert.equal(v.confirmations, 17);
});
