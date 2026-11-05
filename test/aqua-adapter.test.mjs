// @trace/aqua-adapter — NFT→Aqua compatibility assessment + the deterministic
// compiler (structured intent only, never raw bytecode, never unlimited approvals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCompatibility, compileAquaProgram } from "@trace/aqua-adapter";
import { validateProgram, finalizeStrategyIR } from "@trace/strategy-ir";

function ir(rules) {
  return finalizeStrategyIR({
    version: "1",
    wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C",
    family: "active_range_management",
    confidence: 0.78,
    rules,
    alternatives: [],
    evidenceRefs: ["0x9f3a…b21c"],
    limitations: ["triggers inferred from timing"],
    source: {
      model: "TraceInfer deterministic v0.4",
      provider: "DETERMINISTIC_ONLY",
      schemaValid: true,
      attested: false,
      ts: 1_700_000_000,
    },
  });
}
const R = (mapsTo, conf = 0.8) => ({
  rule: `rule-${mapsTo}`,
  evidence: "0x9f3a…b21c · observed",
  confidence: conf,
  alternative: "alt",
  uncertainty: "unc",
  mapsTo,
});

test("assessCompatibility flags which rules Aqua can and cannot express", () => {
  const s = ir([R("schedule"), R("trigger"), R("limit"), R("allocation")]);
  const c = assessCompatibility(s);
  assert.ok(["FULL", "PARTIAL", "INCOMPATIBLE"].includes(c.verdict));
  // trigger + limit are known partials → verdict must not be FULL
  const byRule = Object.fromEntries(c.rules.map((r) => [r.rule, r.status]));
  assert.equal(byRule["rule-trigger"], "partial");
  assert.equal(byRule["rule-limit"], "partial");
  assert.equal(byRule["rule-schedule"], "supported");
  assert.equal(c.verdict, "PARTIAL");
});

test("the compiler is deterministic: same input → same program hash", () => {
  const s = ir([R("schedule"), R("trigger"), R("limit"), R("allocation")]);
  const c = assessCompatibility(s);
  const p1 = compileAquaProgram(s, c, { observedRange: { tickLower: -128, tickUpper: 154 } });
  const p2 = compileAquaProgram(s, c, { observedRange: { tickLower: -128, tickUpper: 154 } });
  assert.equal(p1.programHash, p2.programHash);
  assert.equal(validateProgram(p1).ok, true);
});

test("compiled program changes when an observed range is supplied", () => {
  const s = ir([R("trigger")]);
  const c = assessCompatibility(s);
  const withObs = compileAquaProgram(s, c, { observedRange: { tickLower: -128, tickUpper: 154 } });
  const noObs = compileAquaProgram(s, c, {});
  assert.notEqual(withObs.programHash, noObs.programHash);
  // without observed range, the trigger step degrades to manual, never invented ticks
  const manual = noObs.steps.find((x) => x.op === "adjust_range");
  assert.equal(manual.when.kind, "manual");
  const priced = withObs.steps.find((x) => x.op === "adjust_range");
  assert.equal(priced.when.kind, "price_exit");
});

test("the compiler never requests unlimited token approvals", () => {
  const s = ir([R("schedule"), R("allocation")]);
  const c = assessCompatibility(s);
  const p = compileAquaProgram(s, c, {});
  assert.ok(p.approvals.length > 0);
  assert.ok(p.approvals.every((a) => a.unlimited === false));
});

test("the program carries explicit, stated assumptions", () => {
  const s = ir([R("schedule")]);
  const c = assessCompatibility(s);
  const p = compileAquaProgram(s, c, { slippageBps: 25, gasGweiAssumption: 40, minOutPct: 99.0 });
  assert.equal(p.assumptions.slippageBps, 25);
  assert.equal(p.assumptions.gasGweiAssumption, 40);
  assert.equal(p.assumptions.minOutPct, 99.0);
  assert.equal(p.format, "aqua_program_v1");
  assert.equal(p.deterministic, true);
});
