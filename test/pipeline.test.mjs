// The complete wallet-investigation workflow, end to end:
//   reconstruct → infer (0G gate) → backtest → Aqua compile → archive
// plus the World Agent Pass authorization round-trip that pins the strategy
// version + program hash. This is the single most important integration test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline, newChallenge, authorize } from "../server/src/pipeline.ts";
import { strategyVersionHash, validateStrategyIR } from "@trace/strategy-ir";

// A realistic V3 lifecycle for the fixture wallet, in the exact IR shape the
// server/worker pass to the pipeline (bigint-safe, chronological).
const wallet = "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C";
const ev = (o) => ({
  kind: "MINT",
  tokenId: 12841,
  owner: wallet,
  tx: "0x" + "1".repeat(40),
  block: 21_834_102,
  logIndex: 0,
  timestamp: 1_718_124_240,
  liquidityDelta: 0,
  amount0: 0,
  amount1: 0,
  fee0: 0,
  fee1: 0,
  tickLower: -128,
  tickUpper: 154,
  ...o,
});
const events = [
  ev({ kind: "MINT", liquidityDelta: 4218, amount0: 312, amount1: 1_048_200 }),
  ev({ kind: "COLLECT", tx: "0x" + "2".repeat(40), block: 21_890_551, timestamp: 1_720_035_060, fee1: 214 }),
  ev({ kind: "DECREASE", tx: "0x" + "3".repeat(40), block: 21_955_410, timestamp: 1_722_559_620, liquidityDelta: 1180, amount0: 91, amount1: 301_500 }),
  ev({ kind: "INCREASE", tx: "0x" + "4".repeat(40), block: 22_004_990, timestamp: 1_724_764_740, liquidityDelta: 980, amount0: 76, amount1: 258_900 }),
  ev({ kind: "COLLECT", tx: "0x" + "5".repeat(40), block: 22_118_333, timestamp: 1_731_422_580, fee1: 331 }),
  ev({ kind: "INCREASE", tx: "0x" + "6".repeat(40), block: 22_201_777, timestamp: 1_740_004_800, liquidityDelta: 1420, amount0: 111, amount1: 373_600 }),
];
const priceSeries = Array.from({ length: 40 }, (_, i) => ({
  block: 21_800_030 + i * 20_000,
  price: 3400 * (1 + 0.05 * Math.sin(i / 4)),
}));

async function run() {
  return runPipeline({
    events,
    wallet,
    cfg: { observedRange: { tickLower: -128, tickUpper: 154 }, priceSeries },
  });
}

test("the full investigation runs WITHOUT degradation (gate + backtest both satisfied)", async () => {
  const r = await run();
  assert.equal(r.degraded, false, JSON.stringify(r.degradedSteps));
  assert.equal(r.degradedSteps.length, 0);
});

test("reconstruction counts + fingerprint are stable for a given event set", async () => {
  const a = await run();
  const b = await run();
  assert.equal(a.reconstruction.counts.events, events.length);
  assert.equal(a.reconstruction.counts.positions, 1);
  assert.equal(a.reconstruction.eventsFingerprint, b.reconstruction.eventsFingerprint);
});

test("inference produced a schema-valid, evidence-anchored strategy (not a silent fallback)", async () => {
  const r = await run();
  assert.equal(validateStrategyIR(r.strategy).ok, true);
  assert.ok(r.strategy.rules.length >= 1);
  assert.ok(r.strategy.evidenceRefs.length >= 1);
  assert.equal(strategyVersionHash(r.strategy), r.strategyVersionHash);
  // The deterministic gate must have succeeded (no degradation step for inference).
  assert.ok(!r.degradedSteps.some((s) => s.startsWith("inference:")));
});

test("backtest enforces the look-ahead split and states its assumptions", async () => {
  const r = await run();
  assert.ok(r.backtest, "a price series was supplied, so a backtest must exist");
  assert.equal(r.backtest.split.lookaheadGuard, "enforced");
  assert.ok(r.backtest.split.testStartBlock > r.backtest.split.trainEndBlock);
  assert.equal(r.backtest.runs.length, 3); // observed, inferred, buy&hold
  assert.match(r.backtest.assumptions.feeModel, /annualFeeYield/);
});

test("no price series → backtest is null, never fabricated (an honest degradation)", async () => {
  const r = await runPipeline({
    events,
    wallet,
    cfg: { observedRange: { tickLower: -128, tickUpper: 154 } }, // no priceSeries
  });
  assert.equal(r.backtest, null);
  assert.ok(r.degradedSteps.includes("backtest:no_price_series"));
  // the rest of the pipeline still completes
  assert.ok(r.program);
  assert.ok(r.compatibility);
});

test("Aqua compatibility + deterministic compile are consistent", async () => {
  const r = await run();
  assert.ok(["FULL", "PARTIAL", "INCOMPATIBLE"].includes(r.compatibility.verdict));
  assert.ok(r.program.programHash.length >= 8);
  assert.equal(r.program.strategyId, r.strategy.id);
  assert.equal(r.program.deterministic, true);
  assert.ok(r.program.approvals.every((a) => a.unlimited === false));
  // recompile → same hash (the World proof pins this)
  const r2 = await run();
  assert.equal(r2.program.programHash, r.program.programHash);
});

test("0G archives are produced and labelled demo when no endpoint is configured", async () => {
  const r = await run();
  assert.ok(r.archives.length >= 3);
  assert.ok(r.archives.every((a) => a.demo === true));
});

test("World Agent Pass: a matching proof validates; tampering and replay are rejected", async () => {
  const r = await run();
  const action = "compile+ship+2 swaps";
  const worldCfg = { worldId: "0x…demo", demoKey: "trace-demo-key" };
  const { claims } = newChallenge({ strategy: r.strategy, program: r.program, action, cfg: worldCfg });

  const ok = await authorize({
    proof: claims,
    strategy: r.strategy,
    program: r.program,
    cfg: worldCfg,
    expectedStrategyVersionHash: r.strategyVersionHash,
    expectedProgramHash: r.program.programHash,
    expectedAction: action,
  });
  assert.equal(ok.proofValidated, true, JSON.stringify(ok.verification.notes));
  assert.equal(ok.verification.notes.length, 0);

  const tampered = await authorize({
    proof: claims,
    strategy: r.strategy,
    program: r.program,
    cfg: worldCfg,
    expectedStrategyVersionHash: r.strategyVersionHash,
    expectedProgramHash: "0xDEAD", // does not match the compiled program
    expectedAction: action,
  });
  assert.equal(tampered.proofValidated, false);
  assert.ok(tampered.verification.notes.join("").includes("program hash"));

  const replay = await authorize({
    proof: claims,
    strategy: r.strategy,
    program: r.program,
    cfg: worldCfg,
    expectedStrategyVersionHash: r.strategyVersionHash,
    expectedProgramHash: r.program.programHash,
    expectedAction: action,
    usedChallenges: [claims.challenge], // already consumed
  });
  assert.equal(replay.proofValidated, false);
});
