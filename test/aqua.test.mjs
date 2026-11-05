import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, erc20Abi } from "viem";
import { assessCompatibility, compilePlan, sqrtPriceFromTick, feeBpsFromTier } from "@trace/aqua-adapter";
import { inferFromEvidence } from "@trace/strategy-inference";
import { AQUA } from "@trace/chain-config";
import { walletHistory } from "./helpers.mjs";

const h = walletHistory();
const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });
const basis = Object.values(h.positions).find((p) => p.pool && p.decimals0 != null && p.tickUpper - p.tickLower < 1_700_000);
const args = (over = {}) => ({
  ir,
  compat: assessCompatibility(ir, basis),
  basis,
  maker: "0x000000000000000000000000000000000000dEaD",
  amount0: "1000000000000000",
  amount1: "2000000000000000",
  registry: AQUA.registry.address,
  app: AQUA.swapVmRouter.address,
  chainId: 11155111,
  ...over,
});

test("tick → SwapVM sqrt price matches sqrt(1.0001^tick · 1e18)", () => {
  assert.equal(sqrtPriceFromTick(0), 1_000_000_000n);
  assert.ok(sqrtPriceFromTick(600) > sqrtPriceFromTick(-600));
  assert.equal(feeBpsFromTier(3000), 30);
  assert.equal(feeBpsFromTier(500), 5);
});

test("compatibility is rule-by-rule; risk/adjustment rules are never claimed as fully supported", () => {
  const c = assessCompatibility(ir, basis);
  assert.notEqual(c.verdict, "INCOMPATIBLE");
  for (const r of c.rules) if (r.category === "adjustment" || r.category === "exit") assert.equal(r.status, "partial");
  assert.ok(c.unsupportedNotes.at(-1).includes("not a migration"));
});

test("inconclusive strategies are INCOMPATIBLE and cannot be compiled", () => {
  const { ir: thin } = inferFromEvidence({ events: h.events.slice(0, 1), wallet: h.wallet, window: h.window, meta: h.positions });
  const c = assessCompatibility(thin, basis);
  assert.equal(c.verdict, "INCOMPATIBLE");
  assert.throws(() => compilePlan(args({ ir: thin, compat: c })));
});

test("compile is deterministic (same inputs → same plan hash, order and strategy hash)", () => {
  const a = compilePlan(args());
  const b = compilePlan(args());
  assert.equal(a.planHash, b.planHash);
  assert.equal(a.order, b.order);
  assert.equal(a.strategyHash, b.strategyHash);
  assert.notEqual(compilePlan(args({ amount0: "1000000000000001" })).planHash, a.planHash, "amounts are bound into the plan");
});

test("approvals are EXACT amounts to the Aqua registry — never unlimited", () => {
  const p = compilePlan(args());
  const approvals = p.steps.filter((s) => s.op === "approve");
  assert.equal(approvals.length, 2);
  for (const s of approvals) {
    const d = decodeFunctionData({ abi: erc20Abi, data: s.data });
    assert.equal(d.functionName, "approve");
    assert.equal(d.args[0].toLowerCase(), AQUA.registry.address.toLowerCase());
    assert.equal(d.args[1].toString(), s.approval.amount);
    assert.ok(d.args[1] < 2n ** 128n);
  }
  assert.equal(p.steps.find((s) => s.op === "ship").to.toLowerCase(), AQUA.registry.address.toLowerCase());
});
