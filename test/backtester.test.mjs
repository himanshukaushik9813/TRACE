// @trace/backtester — look-ahead-safe simulation: the guard, the canonical
// V3 position-value formula, and deterministic, assumption-stated runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateRun,
  positionValue,
  buildBacktestResult,
  assertNoLookAhead,
  passiveRunner,
  buyHoldRunner,
  observedReplayRunner,
} from "@trace/backtester";

function cfg(patch = {}) {
  return {
    startBlock: 21_000_000,
    endBlock: 23_000_000,
    startCapital: 1_200_000,
    liquidity: 4_218_500,
    tickLower: -128,
    tickUpper: 154,
    priceLo: 3080,
    priceHi: 3920,
    feeTier: 5,
    annualFeeYieldAssumption: 0.18,
    gasPerTradeQuote: 12.4,
    slippagePct: 0.0012,
    gasGwei: 32,
    trainEndBlock: 21_800_000,
    testStartBlock: 21_800_030,
    gapBlocks: 30,
    ...patch,
  };
}
function prices(n = 30) {
  return Array.from({ length: n }, (_, i) => ({
    block: 21_800_030 + i * 20_000,
    price: 3400 * (1 + 0.05 * Math.sin(i / 4)),
  }));
}

test("the look-ahead guard rejects a test window that overlaps train", () => {
  assert.throws(() => assertNoLookAhead(cfg({ testStartBlock: 21_800_000 })), /look-ahead/);
  assert.throws(() => assertNoLookAhead(cfg({ testStartBlock: 21_799_999 })), /look-ahead/);
});

test("the look-ahead guard accepts a strictly-ordered split", () => {
  assert.doesNotThrow(() => assertNoLookAhead(cfg()));
});

test("positionValue uses the canonical V3 concentrated-liquidity formula", () => {
  const L = 1_000;
  const lo = 1, hi = 4, x0 = 1, x1 = 2;
  // below range: all base
  assert.ok(Math.abs(positionValue(L, lo, hi, 0.5) - L * (1 / x0 - 1 / x1) * 0.5) < 1e-9);
  // above range: all quote
  assert.ok(Math.abs(positionValue(L, lo, hi, 9) - L * (x1 - x0)) < 1e-9);
  // in range: mixed
  const P = 2.25;
  const x = Math.sqrt(P);
  const expect = L * (1 / x - 1 / x1) * P + L * (x - x0);
  assert.ok(Math.abs(positionValue(L, lo, hi, P) - expect) < 1e-9);
  // degenerate inputs are safe
  assert.equal(positionValue(L, lo, hi, 0), 0);
  assert.equal(positionValue(L, 4, 1, P), 0); // lo >= hi
});

test("simulateRun runs deterministically and respects the runner's view", () => {
  const run = simulateRun(cfg(), prices(), passiveRunner(cfg()));
  assert.equal(run.equity.length, 30);
  assert.ok(typeof run.finalEquity === "number");
  assert.ok(run.maxDrawdown >= 0);
  // two runs on identical inputs → identical outputs
  const again = simulateRun(cfg(), prices(), passiveRunner(cfg()));
  assert.deepEqual(run.equity, again.equity);
});

test("simulateRun throws when the test window has no price points", () => {
  assert.throws(
    () => simulateRun(cfg(), [{ block: 20_000_000, price: 1 }], passiveRunner(cfg())),
    /test window is empty/,
  );
});

test("the runner never sees future prices (look-ahead isolation)", () => {
  const seen = [];
  const runner = (ctx) => {
    seen.push({ current: ctx.current.block, lastHistory: ctx.history.at(-1)?.block });
    return { trades: 0 };
  };
  const ps = prices(5);
  simulateRun(cfg(), ps, runner);
  for (let i = 0; i < ps.length; i++) {
    // history is every price strictly before the current block. For the first
    // test-window step it may be empty; whenever it exists, its last entry
    // must be strictly before the current block — the runner never sees the
    // future.
    const last = seen[i].lastHistory;
    assert.ok(last == null || last < seen[i].current, "history must be strictly before current");
  }
});

test("observedReplayRunner + buildBacktestResult produce an auditable split", () => {
  const observed = prices(30);
  const sim = simulateRun(cfg(), observed, observedReplayRunner(cfg(), observed));
  const res = buildBacktestResult({ strategyId: "ir_test", cfg: cfg(), runs: [{ label: "replay", sim }] });
  assert.equal(res.split.lookaheadGuard, "enforced");
  assert.ok(res.split.testStartBlock > res.split.trainEndBlock);
  assert.ok(res.split.gapBlocks > 0);
  assert.equal(res.runs.length, 1);
  assert.ok(res.runs[0].net !== undefined);
  // assumption is stated, never silent
  assert.match(res.assumptions.feeModel, /annualFeeYield=0\.18/);
  assert.equal(res.equitySeries[0].points.length, 30);
});

test("buyHoldRunner is a pure price benchmark (no fees, no gas)", () => {
  const sim = simulateRun(cfg(), prices(), buyHoldRunner(cfg()));
  assert.ok(Number.isFinite(sim.finalEquity));
});
