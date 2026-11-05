/**
 * Structural validation of the Strategy IR.
 *
 * The LLM may *propose* a StrategyIR; the deterministic layer validates it
 * against the evidence before it is ever treated as a strategy. Nothing in
 * this module trusts the proposal — it only checks shape and the invariants
 * the product depends on (confidence bounds, evidence refs present, splits
 * ordered, no unlimited approvals, etc.).
 */

import type {
  AquaProgram,
  BacktestResult,
  CompatibilityAssessment,
  StrategyIR,
} from "./types.js";

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

const okResult: ValidationResult = { ok: true, issues: [] };

function fail(issues: ValidationIssue[]): ValidationResult {
  return { ok: issues.length === 0, issues };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

export function validateStrategyIR(ir: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof ir !== "object" || ir === null) return fail([at("", "type", "StrategyIR must be an object")]);
  const s = ir as Record<string, unknown>;

  if (s.version !== "1") issues.push(at("version", "enum", 'must be "1"'));
  if (!isStr(s.wallet) || !/^0x[0-9a-fA-F]{40}$/.test(s.wallet))
    issues.push(at("wallet", "format", "must be a 0x-prefixed 40-hex address"));

  const families = ["passive_concentrated", "periodic_range_adjustment", "active_range_management", "capital_redeployment", "unknown"];
  if (!families.includes(String(s.family))) issues.push(at("family", "enum", `must be one of ${families.join(", ")}`));

  if (!isNum(s.confidence) || s.confidence < 0 || s.confidence > 1)
    issues.push(at("confidence", "range", "must be a finite number in [0,1]"));

  if (!Array.isArray(s.rules) || s.rules.length === 0) {
    issues.push(at("rules", "minItems", "at least one rule is required"));
  } else {
    s.rules.forEach((r, i) => {
      const o = r as Record<string, unknown>;
      if (!isStr(o.rule) || o.rule.trim() === "") issues.push(at(`rules[${i}].rule`, "minLength", "rule text required"));
      if (!isStr(o.evidence) || o.evidence.trim() === "")
        issues.push(at(`rules[${i}].evidence`, "minLength", "evidence is mandatory — a rule with no evidence is a guess"));
      if (!isNum(o.confidence) || o.confidence < 0 || o.confidence > 1)
        issues.push(at(`rules[${i}].confidence`, "range", "must be in [0,1]"));
    });
  }

  if (!Array.isArray(s.evidenceRefs) || s.evidenceRefs.length === 0)
    issues.push(at("evidenceRefs", "minItems", "every strategy must cite at least one deterministic evidence ref"));

  if (!Array.isArray(s.limitations))
    issues.push(at("limitations", "type", "must be an array (state at least one limitation, even if '[]' — empty is a review flag)"));

  const src = s.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== "object") issues.push(at("source", "type", "provenance block required"));
  else {
    if (src.provider !== "0G_PRIVATE_COMPUTER" && src.provider !== "DETERMINISTIC_ONLY")
      issues.push(at("source.provider", "enum", 'must be "0G_PRIVATE_COMPUTER" or "DETERMINISTIC_ONLY"'));
    if (src.schemaValid !== true)
      issues.push(at("source.schemaValid", "boolean", "must be true — an IR that failed schema validation cannot be a StrategyIR"));
    if (!isNum(src.ts) || src.ts <= 0) issues.push(at("source.ts", "range", "unix seconds required"));
  }

  if (!isStr(s.id) || s.id.trim() === "") issues.push(at("id", "minLength", "strategy id required"));

  return fail(issues);
}

function at(path: string, code: string, message: string): ValidationIssue {
  return { path: path || "(root)", code, message };
}

/* ------------------------------------------------------------------ */

export function validateCompatibility(c: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof c !== "object" || c === null) return fail([at("", "type", "CompatibilityAssessment must be an object")]);
  const x = c as Record<string, unknown>;
  if (!["FULL", "PARTIAL", "INCOMPATIBLE"].includes(String(x.verdict)))
    issues.push(at("verdict", "enum", 'FULL | PARTIAL | INCOMPATIBLE'));

  // Product rule: no unlimited token approvals by default.
  const approvals = Array.isArray(x.approvals) ? (x.approvals as Array<Record<string, unknown>>) : [];
  approvals.forEach((a, i) => {
    if (a.unlimited === true)
      issues.push(at(`approvals[${i}].unlimited`, "policy", "unlimited token approvals are never produced by the compiler; scope by amount"));
  });
  if (!Array.isArray(x.rules) || x.rules.length === 0)
    issues.push(at("rules", "minItems", "a per-rule compatibility list is required"));

  return fail(issues);
}

/* ------------------------------------------------------------------ */

export function validateBacktest(b: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof b !== "object" || b === null) return fail([at("", "type", "BacktestResult must be an object")]);
  const x = b as Record<string, unknown>;
  const split = x.split as Record<string, unknown> | undefined;
  if (!split || typeof split !== "object") issues.push(at("split", "type", "train/test split is mandatory"));
  else {
    if (!isNum(split.testStartBlock) || !isNum(split.trainEndBlock)) {
      issues.push(at("split", "type", "trainEndBlock and testStartBlock must be numbers"));
    } else {
      // The look-ahead invariant: the test window starts strictly after the
      // training window ends (an explicit gap makes the boundary auditable).
      if (split.lookaheadGuard === "enforced" && split.testStartBlock <= split.trainEndBlock)
        issues.push(at("split", "invariant", "look-ahead violation: test window must start strictly after the train window"));
      if (split.lookaheadGuard === "waived" && !isStr(split.waiveReason))
        issues.push(at("split.waiveReason", "minLength", "waiving the guard requires an explicit reason"));
    }
  }
  if (!Array.isArray(x.runs) || x.runs.length === 0) issues.push(at("runs", "minItems", "at least one run required"));

  const a = x.assumptions as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") issues.push(at("assumptions", "type", "gas/slippage assumptions must be stated"));

  return fail(issues);
}

/* ------------------------------------------------------------------ */

export function validateProgram(p: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof p !== "object" || p === null) return fail([at("", "type", "AquaProgram must be an object")]);
  const x = p as Record<string, unknown>;
  if (x.format !== "aqua_program_v1") issues.push(at("format", "enum", 'must be "aqua_program_v1"'));
  if (!Array.isArray(x.steps) || x.steps.length === 0)
    issues.push(at("steps", "minItems", "a program needs at least one step"));
  (x.steps as unknown[]).forEach((s, i) => {
    if (typeof s !== "object" || s === null) return issues.push(at(`steps[${i}]`, "type", "step must be an object"));
    const op = (s as Record<string, unknown>).op;
    if (!["observe", "adjust_range", "collect_fees", "redeploy", "execute_swap", "stop"].includes(String(op)))
      issues.push(at(`steps[${i}].op`, "enum", "unknown operation"));
  });
  if (!isStr(x.programHash) || x.programHash.length < 8)
    issues.push(at("programHash", "minLength", "program hash must be computed (deterministic compile)"));
  const a = x.assumptions as Record<string, unknown> | undefined;
  if (!a || !isNum(a.slippageBps) || !isNum(a.gasGweiAssumption) || !isNum(a.minOutPct))
    issues.push(at("assumptions", "type", "slippageBps, gasGweiAssumption, minOutPct must all be numbers"));

  return fail(issues);
}

export type { AquaProgram, BacktestResult, CompatibilityAssessment, StrategyIR };
export const OK = okResult;
