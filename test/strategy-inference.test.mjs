// @trace/strategy-inference — deterministic fingerprints, rule mining, and the
// 0G gate (schema + evidence audit + deterministic id).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFingerprints,
  inferFromEvidence,
  buildEvidencePack,
  runZeroGInference,
  gateProposal,
} from "@trace/strategy-inference";
import { validateStrategyIR } from "@trace/strategy-ir";

const wallet = "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C";
function ev(p) {
  return {
    kind: "MINT",
    tokenId: 1,
    owner: wallet,
    tx: "0x" + "1".repeat(40),
    block: 100,
    logIndex: 0,
    timestamp: 1_700_000_000,
    liquidityDelta: 0,
    amount0: 0,
    amount1: 0,
    fee0: 0,
    fee1: 0,
    tickLower: -128,
    tickUpper: 154,
    ...p,
  };
}

const events = [
  ev({ kind: "MINT", block: 100, liquidityDelta: 4218, amount0: 312, amount1: 1_048_200 }),
  ev({ kind: "COLLECT", block: 130, tx: "0x" + "2".repeat(40), timestamp: 1_700_100_000, fee1: 214 }),
  ev({ kind: "DECREASE", block: 160, tx: "0x" + "3".repeat(40), timestamp: 1_700_200_000, liquidityDelta: 1180 }),
  ev({ kind: "INCREASE", block: 190, tx: "0x" + "4".repeat(40), timestamp: 1_700_300_000, liquidityDelta: 980 }),
  ev({ kind: "COLLECT", block: 220, tx: "0x" + "5".repeat(40), timestamp: 1_700_400_000, fee1: 331 }),
  ev({ kind: "INCREASE", block: 250, tx: "0x" + "6".repeat(40), timestamp: 1_700_500_000, liquidityDelta: 1420, tickLower: -64, tickUpper: 80 }),
];

test("computeFingerprints derives range re-sets + collect cadence", () => {
  const fp = computeFingerprints(events);
  assert.ok(fp.rangeResets >= 1);
  assert.equal(fp.collectCount, 2);
  assert.ok(typeof fp.collectCadenceDays === "number");
  assert.equal(fp.eventCount, events.length);
});

test("inferFromEvidence yields a schema-valid, evidence-anchored IR", () => {
  const { ir } = inferFromEvidence({ events, wallet });
  const v = validateStrategyIR(ir);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.ok(ir.id.startsWith("ir_"));
  assert.ok(ir.rules.length >= 1);
  assert.ok(ir.rules.every((r) => r.evidence.trim() !== ""));
  assert.equal(ir.source.provider, "DETERMINISTIC_ONLY");
});

test("the 0G demo gate is schema-valid and NOT a silent fallback", async () => {
  const det = inferFromEvidence({ events, wallet });
  const pack = buildEvidencePack(events, det.fingerprints);
  const res = await runZeroGInference({ pack, wallet, events, cfg: {} });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(validateStrategyIR(res.ir).ok, true);
  assert.equal(res.proposalsRejected, 0);
});

test("a proposal citing no citable evidence is rejected + falls back", () => {
  const det = inferFromEvidence({ events, wallet });
  const pack = buildEvidencePack(events, det.fingerprints);
  const res = gateProposal(
    {
      family: "passive_concentrated",
      confidence: 0.5,
      rules: [{ rule: "x", evidence: "0xdeadbeef", confidence: 0.5, alternative: "a", uncertainty: "u" }],
      evidenceRefs: ["0xdeadbeef"], // not in the citable set
      limitations: [],
    },
    pack,
    { events, wallet },
    "0G_PRIVATE_COMPUTER",
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "no_citable_evidence");
  assert.ok(res.fallback.rules.length >= 1);
  assert.ok(validateStrategyIR(res.fallback).ok);
});

test("uncited evidence is down-weighted, not wholesale-rejected", () => {
  const det = inferFromEvidence({ events, wallet });
  const pack = buildEvidencePack(events, det.fingerprints);
  const res = gateProposal(
    {
      family: "active_range_management",
      confidence: 0.9,
      rules: [
        { rule: "good", evidence: events[0].tx, confidence: 0.8, alternative: "a", uncertainty: "u" },
        { rule: "bad", evidence: "0x" + "e".repeat(40), confidence: 0.8, alternative: "a", uncertainty: "u" },
      ],
      evidenceRefs: [events[0].tx],
      limitations: [],
    },
    pack,
    { events, wallet },
    "0G_PRIVATE_COMPUTER",
  );
  assert.equal(res.ok, true);
  assert.equal(res.proposalsRejected, 1);
});

test("an out-of-range confidence is rejected as schema_invalid", () => {
  const det = inferFromEvidence({ events, wallet });
  const pack = buildEvidencePack(events, det.fingerprints);
  const res = gateProposal(
    { family: "unknown", confidence: 4.2, rules: [], evidenceRefs: [events[0].tx], limitations: [] },
    pack,
    { events, wallet },
    "0G_PRIVATE_COMPUTER",
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "schema_invalid");
});
