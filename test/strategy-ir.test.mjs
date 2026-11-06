import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, canonicalString, finalizeStrategyIR, strategyVersionHash, eventsFingerprint, validateStrategyIR, validateBacktest, validatePlan } from "@trace/strategy-ir";

const tx = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const ir = (over = {}) => ({
  version: "2",
  id: "x",
  wallet: "0x4A2268D5047E9A03c4C6A279d833337D9DD1909e",
  chainId: 11155111,
  sourceProtocol: "uniswap-v3",
  evidencePeriod: { fromBlock: 1, toBlock: 2, fromTs: 1, toTs: 2 },
  family: "active_range_management",
  confidence: 0.6,
  confidenceNote: "fit, not probability",
  rules: [{ category: "entry", rule: "r", evidence: "e", evidenceRefs: [tx(1)], confidence: 0.5, alternative: "a", uncertainty: "u" }],
  alternatives: [],
  evidenceRefs: [tx(1)],
  limitations: [],
  source: { model: "m", provider: "DETERMINISTIC_ONLY", schemaValid: true, attested: false, ts: 1 },
  ...over,
});

test("canonical hashing is key-order independent and bigint-safe", () => {
  assert.equal(canonicalString({ b: 1, a: 2n }), canonicalString({ a: 2n, b: 1 }));
  assert.notEqual(contentHash({ a: 1 }).digest, contentHash({ a: "1" }).digest);
});

test("strategy id is a content hash: same content → same id, changed content → new version", () => {
  const a = finalizeStrategyIR(ir());
  const b = finalizeStrategyIR(ir());
  const c = finalizeStrategyIR(ir({ confidence: 0.61 }));
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test("strategy ids and version hashes carry 64 bits, so distinct strategies never share an id", () => {
  const a = finalizeStrategyIR(ir());
  assert.match(a.id, /^ir_[0-9a-f]{16}$/);
  assert.match(strategyVersionHash(a), /^fnv1a:[0-9a-f]{16}$/);
  assert.match(eventsFingerprint([{ block: 1 }]), /^fnv1a:[0-9a-f]{16}$/);
  // 5,000 distinct IRs: the old ~24-bit ids collide here with probability ~0.5;
  // a collision silently mapped one investigation's strategy onto another's.
  const ids = new Set();
  const versions = new Set();
  for (let i = 0; i < 5_000; i++) {
    const s = finalizeStrategyIR(ir({ confidence: i / 10_000 }));
    ids.add(s.id);
    versions.add(strategyVersionHash(s));
  }
  assert.equal(ids.size, 5_000);
  assert.equal(versions.size, 5_000);
});

test("validator accepts a well-formed v2 IR", () => {
  assert.deepEqual(validateStrategyIR(ir()).issues, []);
});

test("validator rejects mainnet, rules without tx evidence, and 0G results without a request id", () => {
  assert.ok(validateStrategyIR(ir({ chainId: 1 })).issues.some((i) => i.path === "chainId"));
  const noRefs = ir({ rules: [{ ...ir().rules[0], evidenceRefs: [] }] });
  assert.ok(validateStrategyIR(noRefs).issues.some((i) => i.path === "rules[0].evidenceRefs"));
  const zg = ir({ source: { ...ir().source, provider: "0G_ROUTER" } });
  assert.ok(validateStrategyIR(zg).issues.some((i) => i.path === "source.requestRef"));
});

test("inconclusive strategies may have no rules but must still be labelled", () => {
  assert.equal(validateStrategyIR(ir({ family: "inconclusive", rules: [], confidence: 0 })).ok, true);
});

test("backtest validator enforces the look-ahead split and a reason for incomplete runs", () => {
  const bad = validateBacktest({ status: "completed", runs: [{}], assumptions: {}, split: { trainEndBlock: 10, testStartBlock: 10, gapBlocks: 0, lookaheadGuard: "enforced" } });
  assert.equal(bad.ok, false);
  const noReason = validateBacktest({ status: "insufficient_data", runs: [], assumptions: {}, split: { trainEndBlock: 1, testStartBlock: 2, gapBlocks: 1, lookaheadGuard: "enforced" } });
  assert.ok(noReason.issues.some((i) => i.path === "reason"));
});

test("plan validator refuses unlimited approvals and non-Sepolia plans", () => {
  const plan = {
    format: "aqua_swapvm_order_v1",
    chainId: 11155111,
    planHash: "0123456789abcdef0123",
    order: "0xabcd",
    steps: [{ op: "approve", approval: { amount: (2n ** 256n - 1n).toString() } }],
  };
  assert.ok(validatePlan(plan).issues.some((i) => i.code === "policy"));
  assert.ok(validatePlan({ ...plan, chainId: 1, steps: [{ op: "ship" }] }).issues.some((i) => i.path === "chainId"));
});
