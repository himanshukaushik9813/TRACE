/**
 * Structural validation of the Strategy IR and the artifacts derived from it.
 *
 * A model may *propose* a StrategyIR; this deterministic layer validates it
 * before it is ever treated as a strategy. Nothing here trusts the proposal —
 * it checks shape and the invariants the product depends on (confidence
 * bounds, every rule cites evidence, Sepolia-only, ordered train/test split,
 * no unlimited approvals, …).
 */
const SEPOLIA = 11155111;
const FAMILIES = [
    "passive_concentrated",
    "passive_full_range",
    "periodic_range_adjustment",
    "active_range_management",
    "capital_redeployment",
    "inconclusive",
];
const CATEGORIES = ["entry", "adjustment", "exit", "risk", "fee"];
function result(issues) {
    return { ok: issues.length === 0, issues };
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const isTx = (v) => isStr(v) && /^0x[0-9a-fA-F]{64}$/.test(v);
function at(path, code, message) {
    return { path: path || "(root)", code, message };
}
export function validateStrategyIR(ir) {
    const issues = [];
    if (typeof ir !== "object" || ir === null)
        return result([at("", "type", "StrategyIR must be an object")]);
    const s = ir;
    if (s.version !== "2")
        issues.push(at("version", "enum", 'must be "2"'));
    if (!isStr(s.id) || s.id.trim() === "")
        issues.push(at("id", "minLength", "strategy id required"));
    if (!isStr(s.wallet) || !/^0x[0-9a-fA-F]{40}$/.test(s.wallet))
        issues.push(at("wallet", "format", "must be a 0x-prefixed 40-hex address"));
    if (s.chainId !== SEPOLIA)
        issues.push(at("chainId", "enum", `must be Sepolia (${SEPOLIA})`));
    if (s.sourceProtocol !== "uniswap-v3")
        issues.push(at("sourceProtocol", "enum", 'must be "uniswap-v3"'));
    const ep = s.evidencePeriod;
    if (!ep || !isNum(ep.fromBlock) || !isNum(ep.toBlock) || ep.fromBlock > ep.toBlock)
        issues.push(at("evidencePeriod", "range", "fromBlock/toBlock must be numbers with fromBlock ≤ toBlock"));
    if (!FAMILIES.includes(String(s.family)))
        issues.push(at("family", "enum", `must be one of ${FAMILIES.join(", ")}`));
    if (!isNum(s.confidence) || s.confidence < 0 || s.confidence > 1)
        issues.push(at("confidence", "range", "must be a finite number in [0,1]"));
    if (!isStr(s.confidenceNote) || s.confidenceNote.trim() === "")
        issues.push(at("confidenceNote", "minLength", "must state what the confidence means (not a probability of correctness)"));
    const inconclusive = s.family === "inconclusive";
    if (!Array.isArray(s.rules)) {
        issues.push(at("rules", "type", "rules must be an array"));
    }
    else {
        if (!inconclusive && s.rules.length === 0)
            issues.push(at("rules", "minItems", "a non-inconclusive strategy needs at least one rule"));
        s.rules.forEach((r, i) => {
            const o = r;
            if (!CATEGORIES.includes(String(o.category)))
                issues.push(at(`rules[${i}].category`, "enum", `one of ${CATEGORIES.join(", ")}`));
            if (!isStr(o.rule) || o.rule.trim() === "")
                issues.push(at(`rules[${i}].rule`, "minLength", "rule text required"));
            if (!isStr(o.evidence) || o.evidence.trim() === "")
                issues.push(at(`rules[${i}].evidence`, "minLength", "evidence is mandatory — a rule with no evidence is a guess"));
            if (!Array.isArray(o.evidenceRefs) || o.evidenceRefs.length === 0 || !o.evidenceRefs.every(isTx))
                issues.push(at(`rules[${i}].evidenceRefs`, "minItems", "every rule must cite ≥1 transaction hash"));
            if (!isNum(o.confidence) || o.confidence < 0 || o.confidence > 1)
                issues.push(at(`rules[${i}].confidence`, "range", "must be in [0,1]"));
        });
    }
    if (!Array.isArray(s.evidenceRefs) || (!inconclusive && s.evidenceRefs.length === 0))
        issues.push(at("evidenceRefs", "minItems", "every strategy must cite at least one transaction"));
    if (Array.isArray(s.evidenceRefs) && !s.evidenceRefs.every(isTx))
        issues.push(at("evidenceRefs", "format", "evidence refs must be 0x-prefixed 32-byte tx hashes"));
    if (!Array.isArray(s.limitations))
        issues.push(at("limitations", "type", "must be an array"));
    if (!Array.isArray(s.alternatives))
        issues.push(at("alternatives", "type", "must be an array"));
    const src = s.source;
    if (!src || typeof src !== "object")
        issues.push(at("source", "type", "provenance block required"));
    else {
        if (src.provider !== "0G_ROUTER" && src.provider !== "DETERMINISTIC_ONLY")
            issues.push(at("source.provider", "enum", 'must be "0G_ROUTER" or "DETERMINISTIC_ONLY"'));
        if (src.provider === "0G_ROUTER" && !isStr(src.requestRef))
            issues.push(at("source.requestRef", "minLength", "a 0G result must carry the real router request id"));
        if (src.schemaValid !== true)
            issues.push(at("source.schemaValid", "boolean", "an IR that failed schema validation cannot be a StrategyIR"));
        if (!isNum(src.ts) || src.ts <= 0)
            issues.push(at("source.ts", "range", "unix seconds required"));
    }
    return result(issues);
}
export function validateCompatibility(c) {
    const issues = [];
    if (typeof c !== "object" || c === null)
        return result([at("", "type", "CompatibilityAssessment must be an object")]);
    const x = c;
    if (!["FULL", "PARTIAL", "INCOMPATIBLE"].includes(String(x.verdict)))
        issues.push(at("verdict", "enum", "FULL | PARTIAL | INCOMPATIBLE"));
    if (!Array.isArray(x.rules))
        issues.push(at("rules", "type", "a per-rule compatibility list is required"));
    if (!Array.isArray(x.checks))
        issues.push(at("checks", "type", "the checks performed must be listed"));
    return result(issues);
}
export function validateBacktest(b) {
    const issues = [];
    if (typeof b !== "object" || b === null)
        return result([at("", "type", "BacktestResult must be an object")]);
    const x = b;
    const split = x.split;
    if (!split || typeof split !== "object")
        issues.push(at("split", "type", "train/test split is mandatory"));
    else if (!isNum(split.testStartBlock) || !isNum(split.trainEndBlock)) {
        issues.push(at("split", "type", "trainEndBlock and testStartBlock must be numbers"));
    }
    else {
        if (split.lookaheadGuard === "enforced" && split.testStartBlock <= split.trainEndBlock)
            issues.push(at("split", "invariant", "look-ahead violation: test window must start strictly after the train window"));
        if (split.lookaheadGuard === "waived" && !isStr(split.waiveReason))
            issues.push(at("split.waiveReason", "minLength", "waiving the guard requires an explicit reason"));
    }
    if (x.status === "completed" && (!Array.isArray(x.runs) || x.runs.length === 0))
        issues.push(at("runs", "minItems", "a completed backtest needs ≥1 run"));
    if (x.status === "insufficient_data" && !isStr(x.reason))
        issues.push(at("reason", "minLength", "an incomplete backtest must say why"));
    const a = x.assumptions;
    if (!a || typeof a !== "object")
        issues.push(at("assumptions", "type", "fee/gas/slippage assumptions must be stated"));
    return result(issues);
}
export function validatePlan(p) {
    const issues = [];
    if (typeof p !== "object" || p === null)
        return result([at("", "type", "ExecutionPlan must be an object")]);
    const x = p;
    if (x.format !== "aqua_swapvm_order_v1")
        issues.push(at("format", "enum", 'must be "aqua_swapvm_order_v1"'));
    if (x.chainId !== SEPOLIA)
        issues.push(at("chainId", "enum", `must be Sepolia (${SEPOLIA})`));
    if (!isStr(x.planHash) || x.planHash.length < 16)
        issues.push(at("planHash", "minLength", "plan hash must be computed"));
    if (!isStr(x.order) || !/^0x[0-9a-fA-F]+$/.test(x.order))
        issues.push(at("order", "format", "order must be hex bytes from the SDK"));
    if (!Array.isArray(x.steps) || x.steps.length === 0)
        issues.push(at("steps", "minItems", "a plan needs at least one step"));
    else
        x.steps.forEach((s, i) => {
            if (!["approve", "ship", "dock", "swap"].includes(String(s.op)))
                issues.push(at(`steps[${i}].op`, "enum", "unknown operation"));
            const ap = s.approval;
            if (ap) {
                let amt = null;
                try {
                    amt = BigInt(String(ap.amount));
                }
                catch {
                    amt = null;
                }
                if (amt == null || amt <= 0n)
                    issues.push(at(`steps[${i}].approval.amount`, "range", "approval amount must be a positive integer"));
                else if (amt >= 2n ** 255n)
                    issues.push(at(`steps[${i}].approval.amount`, "policy", "unlimited approvals are never produced; scope by amount"));
            }
        });
    return result(issues);
}
