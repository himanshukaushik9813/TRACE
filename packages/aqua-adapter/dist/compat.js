/**
 * Compatibility: a historical Uniswap V3 NFT is NOT a 1inch Aqua strategy.
 * This module produces an explicit, rule-by-rule assessment of how much of a
 * StrategyIR Aqua can actually express — and what the gaps are.
 */
/**
 * The capability model the assessment assumes about Aqua. Each entry states
 * what Aqua supports *structurally* (schedule-driven execution of structured
 * trading actions), and what it does not (unrestricted price-triggered
 * monitoring or directional allocation). A production build verifies these
 * against Aqua's live capabilities; the gaps stay the same shape either way.
 */
const CAPABILITY_MODEL = {
    on_schedule: { usable: true, note: "Aqua schedules run structured programs on a cadence." },
    on_price_trigger: { usable: false, note: "No arbitrary on-chain price-trigger watch; Aqua runs on schedule, not on continuous trigger." },
    range_adjust: { usable: true, note: "Range adjustment expressible as a structured action inside a scheduled run." },
    collect_fees: { usable: true, note: "Fee collection is a first-class action." },
    redeploy: { usable: true, note: "Re-allocation across pools expressible via TPO swap legs." },
    stop_loss: { usable: false, note: "Stop conditions must be checked on the schedule interval, not continuously." },
    tpo_swap: { usable: true, note: "TWO-POINT-OUTCOME swaps are native." },
    limit_orders: { usable: false, note: "Limit-order-style pending intents not exposed." },
    unlimited_token_approval: { usable: false, note: "Unlimited approvals are never requested; all approvals are scoped by amount." },
};
/** Which of the six strategy-rule mapping targets Aqua can express. */
const RULE_MAP = {
    schedule: { status: "supported" },
    allocation: { status: "supported" },
    action: { status: "supported" },
    limit: { status: "partial", gap: "Evaluated on the schedule interval, not continuously." },
    trigger: { status: "partial", gap: "Price-exit trigger becomes a scheduled check on an interval; between checks the trigger is not observed." },
};
export function assessCompatibility(ir) {
    const rules = ir.rules.map((r) => {
        const key = r.mapsTo ?? "action";
        const m = RULE_MAP[key] ?? { status: "unsupported", gap: `no capability for "${key}"` };
        return { rule: r.rule, status: m.status, gap: m.gap };
    });
    const verdict = rules.every((r) => r.status === "supported")
        ? "FULL"
        : rules.some((r) => r.status === "supported")
            ? "PARTIAL"
            : "INCOMPATIBLE";
    const capabilities = Object.keys(CAPABILITY_MODEL).map((name) => ({
        name,
        ...CAPABILITY_MODEL[name],
    }));
    // Approvals are always scoped: enough to cover the program's own steps,
    // never unlimited.
    const approvals = scopingApprovals(ir, rules);
    const unsupportedNotes = rules
        .filter((r) => r.status !== "supported")
        .map((r) => `${r.rule} — ${r.status === "partial" ? r.gap : "no Aqua equivalent"}`);
    return {
        strategyId: ir.id,
        verdict,
        rules,
        capabilities,
        approvals,
        unsupportedNotes,
    };
}
function scopingApprovals(ir, _rules) {
    return [
        {
            token: "WETH",
            amount: "enough for scheduled runs × 1.5",
            unlimited: false,
            reason: "Scope covers expected program activity, not an open-ended trust.",
        },
        {
            token: "USDC",
            amount: "enough for scheduled runs × 1.5",
            unlimited: false,
            reason: "Fees + rebalance legs.",
        },
    ];
}
