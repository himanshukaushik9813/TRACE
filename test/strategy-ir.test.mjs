// @trace/strategy-ir — canonical hashing, deterministic identity, and the
// schema-validation gate ("the AI is not the source of blockchain truth").
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentHash,
  canonicalString,
  shortHash,
  validateStrategyIR,
  validateProgram,
  strategyVersionHash,
  finalizeStrategyIR,
} from "@trace/strategy-ir";

test("canonicalString is order-independent and bigint-safe", () => {
  const a = { b: 1, a: 2, c: [1n, 2n] };
  const b = { c: [1n, 2n], a: 2, b: 1 };
  assert.equal(canonicalString(a), canonicalString(b));
  // bigint must never collide with a number
  assert.notEqual(canonicalString({ x: 1 }), canonicalString({ x: 1n }));
});

test("contentHash is deterministic across key order", () => {
  assert.equal(contentHash({ x: 1, y: 2 }).digest, contentHash({ y: 2, x: 1 }).digest);
  assert.equal(contentHash("abc").digest.length, 32); // fnv1a-128
});

function validIR() {
  return {
    version: "1",
    id: "ir_abc123",
    wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C",
    family: "active_range_management",
    confidence: 0.78,
    rules: [
      {
        rule: "Re-sets the liquidity range after sustained price movement",
        evidence: "0x9f3a…b21c · 4 re-sets",
        confidence: 0.8,
        alternative: "could be external targets",
        uncertainty: "timing-inferred",
        mapsTo: "trigger",
      },
    ],
    alternatives: [{ label: "passive", family: "passive_concentrated", score: 41, why: "…" }],
    evidenceRefs: ["0x9f3a…b21c"],
    limitations: ["triggers inferred from timing"],
    source: {
      model: "TraceInfer deterministic v0.4",
      provider: "DETERMINISTIC_ONLY",
      schemaValid: true,
      attested: false,
      ts: 1_700_000_000,
    },
  };
}

test("validateStrategyIR accepts a well-formed IR", () => {
  const v = validateStrategyIR(validIR());
  assert.deepEqual(v.issues, []);
  assert.equal(v.ok, true);
});

test("validateStrategyIR rejects a 41-hex (invalid) wallet", () => {
  const bad = { ...validIR(), wallet: "0x" + "f".repeat(41) };
  const v = validateStrategyIR(bad);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.path === "wallet" && i.code === "format"));
});

test("validateStrategyIR requires rules and evidenceRefs", () => {
  const v1 = validateStrategyIR({ ...validIR(), rules: [] });
  assert.ok(v1.issues.some((i) => i.path === "rules"));
  const v2 = validateStrategyIR({ ...validIR(), evidenceRefs: [] });
  assert.ok(v2.issues.some((i) => i.path === "evidenceRefs"));
});

test("a rule with no evidence is rejected as a guess", () => {
  const v = validateStrategyIR({ ...validIR(), rules: [{ ...validIR().rules[0], evidence: "  " }] });
  assert.ok(v.issues.some((i) => i.path.startsWith("rules[0].evidence")));
});

test("finalizeStrategyIR stamps a deterministic content-based id", () => {
  const { id: _drop, ...body } = validIR();
  const a = finalizeStrategyIR(body);
  const b = finalizeStrategyIR(body);
  assert.ok(a.id.startsWith("ir_"));
  assert.equal(a.id, b.id);
  assert.equal(strategyVersionHash(a), strategyVersionHash(b));
});

test("validateProgram enforces the deterministic format + assumptions", () => {
  const okProgram = {
    strategyId: "ir_x",
    programHash: "0000000000",
    format: "aqua_program_v1",
    steps: [{ op: "observe", intervalMinutes: 60, source: "pool_price", ref: "ir_x" }],
    approvals: [],
    assumptions: { slippageBps: 12, gasGweiAssumption: 32, minOutPct: 99.2 },
    deterministic: true,
  };
  assert.equal(validateProgram(okProgram).ok, true);
  const bad = { ...okProgram, format: "wrong" };
  assert.ok(validateProgram(bad).issues.some((i) => i.path === "format"));
});

test("shortHash is a stable display form", () => {
  assert.ok(shortHash({ k: 1 }).startsWith("fnv1a:"));
});
