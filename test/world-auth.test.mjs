// @trace/world-auth — World Agent Pass bound-claims: a proof binds
// (worldId · strategy version · program hash · action · expiry · challenge)
// and is only validated when every binding holds. Tampering and replay fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueAgentPassClaims,
  signProof,
  verifyProof,
} from "@trace/world-auth";

const cfg = { worldId: "0x…demo", demoKey: "trace-demo-key", ttlSeconds: 900 };

function roundTrip(patch = {}) {
  const claims = issueAgentPassClaims(cfg, {
    strategyId: "ir_abc",
    strategyVersionHash: "svh_123",
    programHash: "prog_456",
    action: "compile+ship+2 swaps",
    challenge: "chal_001",
  });
  const signed = signProof(claims, cfg);
  const verified = verifyProof(signed, {
    expectedStrategyVersionHash: "svh_123",
    expectedProgramHash: "prog_456",
    expectedAction: "compile+ship+2 swaps",
    worldId: "0x…demo",
    challenge: "chal_001",
    demoKey: "trace-demo-key",
    ...patch,
  });
  return { claims, signed, verified };
}

test("a well-formed proof validates with every binding satisfied", () => {
  const { verified } = roundTrip();
  assert.equal(verified.validated, true);
  assert.deepEqual(verified.validation, {
    signatureOk: true,
    notExpired: true,
    challengeUsed: true,
    strategyVersionMatches: true,
    programHashMatches: true,
    notes: [],
  });
});

test("an unsigned proof is NOT validated", () => {
  const { verified } = roundTrip();
  const unsigned = signProof(verified.claims, cfg);
  assert.equal(unsigned.validated, false);
});

test("a tampered program hash is rejected", () => {
  const { verified } = roundTrip({ expectedProgramHash: "0xDEAD" });
  assert.equal(verified.validated, false);
  assert.ok(verified.validation.notes.join("").includes("program hash"));
});

test("a mismatched strategy version hash is rejected", () => {
  const { verified } = roundTrip({ expectedStrategyVersionHash: "svh_WRONG" });
  assert.equal(verified.validated, false);
  assert.ok(verified.validation.notes.join("").includes("strategy version"));
});

test("a consumed challenge is rejected (replay protection)", () => {
  const { verified } = roundTrip({ usedChallenges: ["chal_001"] });
  assert.equal(verified.validated, false);
  assert.equal(verified.validation.challengeUsed, false);
  assert.ok(verified.validation.notes.join("").includes("challenge"));
});

test("a signature produced with the wrong key is rejected", () => {
  const claims = issueAgentPassClaims({ ...cfg, demoKey: "key-A" }, {
    strategyId: "ir_abc",
    strategyVersionHash: "svh_123",
    programHash: "prog_456",
    action: "compile+ship+2 swaps",
    challenge: "chal_002",
  });
  // signed with key-A, verified with key-B → signature mismatch
  const signed = signProof(claims, { ...cfg, demoKey: "key-A" });
  const verified = verifyProof(signed, {
    expectedStrategyVersionHash: "svh_123",
    expectedProgramHash: "prog_456",
    expectedAction: "compile+ship+2 swaps",
    worldId: "0x…demo",
    challenge: "chal_002",
    demoKey: "key-B",
  });
  assert.equal(verified.validated, false);
  assert.equal(verified.validation.signatureOk, false);
});

test("an expired proof is rejected", () => {
  const claims = issueAgentPassClaims(
    { ...cfg, ttlSeconds: -10 }, // already expired
    { strategyId: "ir_abc", strategyVersionHash: "s", programHash: "p", action: "a", challenge: "c" },
  );
  const signed = signProof(claims, cfg);
  const verified = verifyProof(signed, {
    expectedStrategyVersionHash: "s",
    expectedProgramHash: "p",
    expectedAction: "a",
    worldId: "0x…demo",
    challenge: "c",
    demoKey: "trace-demo-key",
  });
  assert.equal(verified.validated, false);
  assert.equal(verified.validation.notExpired, false);
});
