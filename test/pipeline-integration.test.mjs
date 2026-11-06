// Integration (Phase 3): the real investigation pipeline (server/dist runStages) end to end:
// reconstruction → Strategy DNA → evidence baseline + 0G (unconfigured → honest) → backtest →
// archive (unconfigured → no refs) → done. The chain client is a stand-in that serves REAL
// captured Sepolia data (no network); the database is a recorder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChainError } from "@trace/chain-data";
import { validateStrategyIR, validateBacktest } from "@trace/strategy-ir";
import { runStages } from "../server/dist/pipeline.js";
import { walletHistory, wethUsdcSeries } from "./helpers.mjs";

function recorder() {
  const rec = { statuses: [], strategies: [], dna: null, backtests: [], runs: [], storage: null, integrations: {}, events: null, positions: null };
  let n = 0;
  const db = {
    setStatus: async (_id, status, progress) => (rec.statuses.push({ status, progress }), true),
    isCancelled: async () => false,
    query: async () => [],
    saveReconstruction: async () => {},
    insertEvents: async (_id, evs) => { rec.events = evs; },
    insertPositions: async (_id, summary) => { rec.positions = summary.positions; },
    saveDna: async (_id, data) => { rec.dna = data; },
    insertStrategy: async (_id, ir, versionHash, role) => { rec.strategies.push({ ir, versionHash, role }); return `strategy-${++n}`; },
    insertInferenceRun: async (_id, run) => { rec.runs.push(run); return `run-${n}`; },
    insertBacktest: async (strategyId, bt) => { rec.backtests.push({ strategyId, bt }); },
    insertStorage: async (_id, _p, refs) => { rec.storage = refs; },
    setIntegrations: async (_id, v) => { Object.assign(rec.integrations, v); },
  };
  return { db, rec };
}
const cfg = { zeroG: {}, storage: {}, world: {} };
const job = (wallet) => ({ investigationId: "00000000-0000-4000-8000-0000000000bb", wallet, days: 30 });

test("real wallet end to end: reconstruct → DNA → strategy → backtest says insufficient_data without prices → done", async () => {
  const h = walletHistory();
  const { db, rec } = recorder();
  const chain = {
    fetchWalletHistory: async () => h,
    // No captured swaps for this wallet's pools: the real client would fetch them; here they are unavailable.
    fetchPoolPriceSeries: async (pool) => { throw makeChainError("RPC_ERROR", `no captured swaps for ${pool}`); },
    rpcCallCount: () => 0,
  };
  await runStages(job(h.wallet), db, cfg, chain);
  assert.deepEqual(rec.statuses.map((s) => s.status), ["fetching", "reconstructing", "inferring", "backtesting", "archiving", "done"]);
  assert.equal(rec.events.length, h.events.length);
  assert.equal(rec.positions.length, Object.keys(h.positions).length);
  assert.equal(rec.dna.fingerprints.eventCount, h.events.length);
  assert.equal(rec.dna.fingerprints.timeInRangePct, null, "no prices → not measured");
  const base = rec.strategies.find((s) => s.role === "evidence_baseline");
  assert.deepEqual(validateStrategyIR(base.ir).issues, []);
  assert.equal(rec.runs[0].status, "not_configured", "0G unconfigured is reported, never faked");
  assert.equal(rec.backtests.length, 0, "no prices → no backtest numbers");
  assert.equal(rec.integrations.backtest.status, "insufficient_data");
  assert.deepEqual(rec.storage, [], "0G Storage unconfigured → no references");
});

test("with real swap prices the pipeline backtests the stored strategy version (observed vs inferred vs benchmarks)", async () => {
  // Test-only: the wallet's most active REAL pool is mapped onto the pool whose REAL swaps are captured
  // (the pipeline prices only the wallet's two most active pools), with the positions' ranges placed
  // around those prices, so the backtest stage runs on real price data.
  const h = walletHistory();
  const s = wethUsdcSeries();
  const counts = {};
  for (const e of h.events) counts[e.pool] = (counts[e.pool] ?? 0) + 1;
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const ticks = s.points.map((p) => p.tick);
  const positions = Object.fromEntries(
    Object.entries(h.positions).map(([k, m]) => [
      k,
      m.pool === busiest
        ? { ...m, pool: s.pool, decimals0: s.decimals0, decimals1: s.decimals1, symbol0: s.symbol0, symbol1: s.symbol1, feeTier: s.feeTier, tickLower: Math.min(...ticks) - 600, tickUpper: Math.max(...ticks) + 600 }
        : m,
    ]),
  );
  const events = h.events.map((e) => (e.pool === busiest ? { ...e, pool: s.pool } : e));
  const { db, rec } = recorder();
  const chain = {
    fetchWalletHistory: async () => ({ ...h, positions, events }),
    fetchPoolPriceSeries: async (pool) => (pool.toLowerCase() === s.pool.toLowerCase() ? s : Promise.reject(makeChainError("RPC_ERROR", "no captured swaps"))),
    rpcCallCount: () => 0,
  };
  await runStages(job(h.wallet), db, cfg, chain);
  assert.equal(rec.statuses.at(-1).status, "done");
  assert.equal(rec.backtests.length, 1);
  const { bt, strategyId } = rec.backtests[0];
  const stored = rec.strategies.find((x) => x.role === "evidence_baseline");
  assert.equal(strategyId, "strategy-1", "backtest is stored against the strategy row it evaluated");
  assert.equal(bt.strategyId, stored.ir.id, "results are tied to the immutable strategy version (content-addressed id)");
  assert.deepEqual(validateBacktest(bt).issues, []);
  if (bt.status === "completed") {
    assert.equal(bt.split.lookaheadGuard, "enforced");
    assert.ok(bt.split.trainEndBlock < bt.split.testStartBlock);
    assert.deepEqual(new Set(bt.runs.map((r) => r.kind)), new Set(["observed", "counterfactual", "benchmark"]));
    for (const r of bt.runs) assert.ok(Number.isFinite(r.finalValue) && Number.isFinite(r.net));
  } else {
    assert.ok(bt.reason, "insufficient data always states why");
  }
});
