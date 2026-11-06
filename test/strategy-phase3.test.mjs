// Phase 3: strategy reverse engineering — fingerprints, candidate classifications, rule
// fields — and the backtest's slippage/capital accounting. Real captured Sepolia data;
// test-only inputs are labelled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFingerprints, inferFromEvidence, scoreFamilies } from "@trace/strategy-inference";
import { runBacktest } from "@trace/backtester";
import { validateStrategyIR } from "@trace/strategy-ir";
import { walletHistory, wethUsdcSeries } from "./helpers.mjs";

const h = walletHistory();
const s = wethUsdcSeries();
const pool = s.pool;

test("every rule carries its observation window (inside the evidence) and its missing evidence", () => {
  const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });
  assert.deepEqual(validateStrategyIR(ir).issues, []);
  assert.ok(ir.rules.length > 0);
  for (const r of ir.rules) {
    assert.ok(r.observationWindow, `${r.rule}: window`);
    const cited = h.events.filter((e) => r.evidenceRefs.includes(e.tx));
    assert.equal(r.observationWindow.fromBlock, Math.min(...cited.map((e) => e.block)));
    assert.equal(r.observationWindow.toBlock, Math.max(...cited.map((e) => e.block)));
    assert.ok(r.observationWindow.fromBlock >= h.window.fromBlock && r.observationWindow.toBlock <= h.window.toBlock);
    assert.ok(Array.isArray(r.missingEvidence) && r.missingEvidence.length > 0, `${r.rule}: missing evidence stated`);
    assert.ok(r.alternative && r.uncertainty && r.confidence >= 0 && r.confidence <= 1);
  }
});

test("all five candidate classifications are scored, with a reason each", () => {
  const fp = computeFingerprints(h.events, h.positions, {}, h.window);
  const fams = scoreFamilies(fp).map((f) => f.family);
  for (const f of ["passive_concentrated", "periodic_range_adjustment", "price_triggered_repositioning", "active_range_management", "capital_redeployment"]) assert.ok(fams.includes(f), f);
  const pt = scoreFamilies(fp).find((f) => f.family === "price_triggered_repositioning");
  assert.match(pt.why, /No pool price data/, "without prices the price trigger is not claimed");
  assert.ok(pt.score < 0.1);
});

test("price-triggered repositioning: an exit answered by a re-set is detected, with its transactions", () => {
  // Test-only positions over the REAL captured prices: #1 holds [173800, 174200); the real price
  // leaves it at block 12061884 (never returns). The wallet reduces #1 and opens #2 higher.
  const exit = s.points.find((p) => p.block === 12061884);
  const ev = (o) => ({ logIndex: 0, owner: h.wallet, liquidityDelta: 0n, amount0: 0n, amount1: 0n, fee0: 0n, fee1: 0n, pool, ...o });
  const events = [
    ev({ kind: "MINT", tokenId: 1, tx: "0x" + "01".repeat(32), block: 12060000, timestamp: s.points[0].timestamp - 600, tickLower: 173800, tickUpper: 174200, liquidityDelta: 10n ** 12n, amount0: 10n ** 6n, amount1: 10n ** 15n }),
    ev({ kind: "DECREASE", tokenId: 1, tx: "0x" + "02".repeat(32), block: 12061900, timestamp: exit.timestamp + 1800, tickLower: 173800, tickUpper: 174200, liquidityDelta: 10n ** 12n, amount0: 10n ** 6n }),
    ev({ kind: "MINT", tokenId: 2, tx: "0x" + "03".repeat(32), block: 12061910, timestamp: exit.timestamp + 2000, tickLower: 174100, tickUpper: 174500, liquidityDelta: 10n ** 12n, amount0: 10n ** 6n, amount1: 10n ** 15n }),
  ];
  const meta = {
    1: { tokenId: 1, pool, token0: "", token1: "", symbol0: s.symbol0, symbol1: s.symbol1, decimals0: s.decimals0, decimals1: s.decimals1, feeTier: s.feeTier, tickLower: 173800, tickUpper: 174200, currentLiquidity: "0", burned: false, historyComplete: true },
    2: { tokenId: 2, pool, token0: "", token1: "", symbol0: s.symbol0, symbol1: s.symbol1, decimals0: s.decimals0, decimals1: s.decimals1, feeTier: s.feeTier, tickLower: 174100, tickUpper: 174500, currentLiquidity: "1", burned: false, historyComplete: true },
  };
  const fp = computeFingerprints(events, meta, { [pool]: s });
  assert.equal(fp.priceRangeExits, 1);
  assert.equal(fp.exitsAnsweredByReset, 1);
  assert.deepEqual(fp.exitResponseRefs, ["0x" + "02".repeat(32), "0x" + "03".repeat(32)]);
  assert.ok(fp.outOfRangeHours > 0, "out-of-range time measured between real swaps");
  const pt = scoreFamilies(fp).find((f) => f.family === "price_triggered_repositioning");
  assert.ok(pt.score >= 0.7, `scored ${pt.score}`);
  const { ir } = inferFromEvidence({ events, wallet: h.wallet, window: { fromBlock: 12059000, toBlock: 12071746, fromTs: s.points[0].timestamp - 3600, toTs: s.points.at(-1).timestamp }, meta, fingerprints: fp });
  const rule = ir.rules.find((r) => r.rule.startsWith("Moves to a new range after the price leaves"));
  assert.ok(rule, "price-triggered rule emitted");
  assert.deepEqual(rule.evidenceRefs, fp.exitResponseRefs);
  assert.ok(rule.missingEvidence.some((m) => /coincidence/.test(m)));
});

test("thin evidence stays INCONCLUSIVE: no rules, no invented classification", () => {
  const { ir } = inferFromEvidence({ events: h.events.slice(0, 2), wallet: h.wallet, window: h.window, meta: h.positions });
  assert.equal(ir.family, "inconclusive");
  assert.equal(ir.rules.length, 0);
});

test("backtest capital breakdown: slippage is paid only on counterfactual moves and is accounted for", () => {
  const basis = { tokenId: 1, pool, token0: "", token1: "", symbol0: s.symbol0, symbol1: s.symbol1, decimals0: s.decimals0, decimals1: s.decimals1, feeTier: s.feeTier, tickLower: 173800, tickUpper: 174300, currentLiquidity: "1", burned: false, historyComplete: true };
  const ir = { id: "ir_test", family: "periodic_range_adjustment", rules: [{ category: "adjustment", rule: "re-set", evidence: "x", evidenceRefs: ["0x"], confidence: 0.5, alternative: "", uncertainty: "", mapsTo: "trigger" }] };
  const bt = runBacktest({ ir, series: s, basis, events: [], meta: {}, opts: { startCapital: 0.01, slippagePct: 0.01, widthMultiplier: 0.25, recentre: true } });
  if (bt.status !== "completed") return assert.ok(bt.reason);
  const cf = bt.runs.find((r) => r.kind === "counterfactual");
  const hold = bt.runs.find((r) => r.label.startsWith("Buy & hold"));
  assert.equal(hold.slippageCost, 0);
  if (cf.rebalances > 0) assert.ok(cf.slippageCost > 0, "every move pays the stated slippage");
  else assert.equal(cf.slippageCost, 0);
  for (const r of bt.runs) assert.ok(Math.abs(r.net - (r.finalValue - bt.assumptions.startCapital) / bt.assumptions.startCapital) < 1e-12, "net return = (end − start) / start");
});

test("fee collection counts only collects that carried fees (principal-only collects are not fee events)", () => {
  const fp = computeFingerprints(h.events, h.positions, {}, h.window);
  const collects = h.events.filter((e) => e.kind === "COLLECT");
  const withFees = collects.filter((e) => Number(e.fee0) > 0 || Number(e.fee1) > 0);
  assert.equal(fp.collectEventCount, collects.length);
  assert.equal(fp.collectCount, withFees.length);
  assert.ok(fp.collectCount < fp.collectEventCount, "this real wallet has principal-only collects");
  const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions, fingerprints: fp });
  const fee = ir.rules.find((r) => r.category === "fee");
  if (fp.collectCount < 2) assert.equal(fee, undefined, "no cadence rule from a single fee collect");
  else for (const t of fee.evidenceRefs) assert.ok(withFees.some((e) => e.tx === t), "fee rule cites only fee-bearing collects");
});

test("time in range needs at least 15 real swaps; fewer are reported as not reliable, never as a number", async () => {
  const { MIN_PRICE_SAMPLES } = await import("@trace/strategy-inference");
  // Test-only: one REAL position placed in the pool with REAL captured swaps, open for the whole series vs. only its last few swaps.
  const id = 234012;
  const meta = { [id]: { ...h.positions[id], pool, tickLower: 173000, tickUpper: 175000 } };
  const mint = (block) => [{ ...h.events.find((e) => e.tokenId === id && e.kind === "MINT"), pool, block, tickLower: 173000, tickUpper: 175000 }];
  const full = computeFingerprints(mint(s.points[0].block - 1), meta, { [pool]: s });
  assert.equal(full.timeInRangeSamples, s.points.length);
  assert.ok(s.points.length >= MIN_PRICE_SAMPLES && full.timeInRangePct != null);
  const late = computeFingerprints(mint(s.points.at(-5).block - 1), meta, { [pool]: s });
  assert.equal(late.timeInRangeSamples, 5);
  assert.equal(late.timeInRangePct, null, "5 swaps are too few to report occupancy");
  const { ir } = inferFromEvidence({ events: mint(s.points.at(-5).block - 1), wallet: h.wallet, window: h.window, meta, fingerprints: late });
  assert.ok(!ir.rules.some((r) => r.category === "risk"), "no occupancy rule from sparse prices");
  assert.ok(ir.limitations.some((l) => /only 5 real swap/.test(l)));
});
