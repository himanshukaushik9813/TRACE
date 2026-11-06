import { test } from "node:test";
import assert from "node:assert/strict";
import { positionValue, runBacktest, assertNoLookAhead } from "@trace/backtester";
import { wethUsdcSeries } from "./helpers.mjs";

const series = wethUsdcSeries();
const mid = series.points[Math.floor(series.points.length / 2)].tick;
const basis = {
  tokenId: 1,
  pool: series.pool,
  token0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  token1: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  symbol0: "USDC",
  symbol1: "WETH",
  decimals0: 6,
  decimals1: 18,
  feeTier: 10_000,
  tickLower: Math.floor((mid - 2000) / 200) * 200,
  tickUpper: Math.ceil((mid + 2000) / 200) * 200,
  currentLiquidity: "1",
  burned: false,
  historyComplete: true,
};
const ir = (adjust) => ({ id: "ir_test", rules: adjust ? [{ category: "adjustment" }] : [{ category: "entry" }] });

test("canonical V3 value: all token0 below range, all token1 above, continuous at the bounds", () => {
  const L = 1000, lo = 1, hi = 4;
  assert.ok(Math.abs(positionValue(L, lo, hi, 1) - positionValue(L, lo, hi, 1.000001)) < 0.01);
  assert.equal(positionValue(L, lo, hi, 9), L * (2 - 1));
});

test("look-ahead guard refuses a test window that does not start after training", () => {
  assert.throws(() => assertNoLookAhead({ trainEndBlock: 10, testStartBlock: 10, gapBlocks: 0, lookaheadGuard: "enforced" }));
});

test("backtest on REAL Sepolia WETH/USDC swaps completes with an enforced split", () => {
  const bt = runBacktest({ ir: ir(true), series, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  assert.equal(bt.status, "completed");
  assert.ok(bt.split.testStartBlock > bt.split.trainEndBlock);
  assert.ok(bt.runs.some((r) => r.kind === "counterfactual"));
  assert.ok(bt.runs.some((r) => r.label.startsWith("Buy & hold")));
  for (const v of bt.series.values) assert.equal(v.points.length, bt.series.prices.length);
});

test("deterministic: identical inputs → identical result", () => {
  const a = runBacktest({ ir: ir(true), series, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  const b = runBacktest({ ir: ir(true), series, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  assert.deepEqual(a.runs, b.runs);
});

test("no look-ahead: changing the LAST price does not change any earlier decision value", () => {
  const a = runBacktest({ ir: ir(true), series, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  const tweaked = { ...series, points: series.points.map((p, i, arr) => (i === arr.length - 1 ? { ...p, sqrtPriceX96: (BigInt(p.sqrtPriceX96) * 2n).toString() } : p)) };
  const b = runBacktest({ ir: ir(true), series: tweaked, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  const ca = a.series.values[0].points;
  const cb = b.series.values[0].points;
  assert.deepEqual(ca.slice(0, -1), cb.slice(0, -1));
});

test("too few real swaps → insufficient_data with a reason and no numbers", () => {
  const thin = { ...series, points: series.points.slice(0, 5) };
  const bt = runBacktest({ ir: ir(true), series: thin, basis, events: [], meta: {} });
  assert.equal(bt.status, "insufficient_data");
  assert.match(bt.reason, /swap/);
  assert.equal(bt.runs.length, 0);
});

// What If options (widthMultiplier, recentre) must not change anything when left at their defaults.
// test/data/backtest-golden.json was produced by the engine BEFORE these options existed.
test("What If defaults are byte-identical to the pre-What-If engine", async () => {
  const { readFileSync } = await import("node:fs");
  const golden = JSON.parse(readFileSync(new URL("./data/backtest-golden.json", import.meta.url), "utf8"));
  // slippageCost (Phase 3) is the one field added since the golden file; every pre-existing field must be byte-identical.
  const strip = (bt) => ({ ...bt, runs: bt.runs.map(({ slippageCost, ...r }) => r) });
  const run = (adjust, extra = {}) => JSON.stringify(strip(runBacktest({ ir: ir(adjust), series, basis, events: [], meta: {}, opts: { startCapital: 0.01, ...extra } })));
  assert.equal(run(true), JSON.stringify(golden.adjust));
  assert.equal(run(false), JSON.stringify(golden.hold));
  // Passing the defaults explicitly is also identical.
  assert.equal(run(true, { widthMultiplier: 1, recentre: true }), JSON.stringify(golden.adjust));
  assert.equal(run(false, { widthMultiplier: 1, recentre: false }), JSON.stringify(golden.hold));
});

test("What If changes only the counterfactual run", () => {
  const base = runBacktest({ ir: ir(false), series, basis, events: [], meta: {}, opts: { startCapital: 0.01 } });
  const wi = runBacktest({ ir: ir(false), series, basis, events: [], meta: {}, opts: { startCapital: 0.01, widthMultiplier: 0.25, recentre: true } });
  const cf = (bt) => bt.runs.find((r) => r.kind === "counterfactual");
  assert.match(cf(wi).label, /re-centre on exit, 0\.25× width/);
  assert.notDeepEqual(cf(wi), cf(base));
  assert.deepEqual(wi.runs.filter((r) => r.kind !== "counterfactual"), base.runs.filter((r) => r.kind !== "counterfactual"));
  assert.throws(() => runBacktest({ ir: ir(false), series, basis, events: [], meta: {}, opts: { widthMultiplier: 0 } }), /widthMultiplier/);
});
