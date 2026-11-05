/**
 * Compatibility: a historical Uniswap V3 NFT is NOT a 1inch Aqua strategy.
 *
 * Aqua (shared liquidity layer) + SwapVM (programmable swap engine) can
 * express a *concentrated constant-product range with an input fee* — the
 * closest genuine analogue of a V3 range position — via the official
 * AquaXYCAmmStrategy. It cannot express continuous price triggers, schedules
 * or stop-losses: Aqua strategies are immutable once shipped, so any
 * adjustment means the maker docks and ships a new strategy.
 *
 * The assessment is rule-by-rule and includes the on-chain checks the server
 * performed (contracts deployed, token metadata, balances, allowances, the
 * KycNFT taker gate). Nothing here is assumed.
 */

import type { AquaCapability, CompatibilityAssessment, CompatibilityCheck, PositionMeta, StrategyIR } from "@trace/strategy-ir";

const AQUA_DOCS = "https://business.1inch.com/portal/documentation/aqua/";

export const CAPABILITY_MODEL: Record<AquaCapability, { usable: boolean; note: string }> = {
  concentrated_range: { usable: true, note: "AquaXYCAmmStrategy.newConcentrate: constant-product liquidity concentrated between two prices." },
  fee_on_input: { usable: true, note: "Flat fee on the input token (withFeeTokenIn), mapped from the Uniswap fee tier." },
  fee_collection: { usable: true, note: "No collect step: fees accrue to the maker's Aqua virtual balance on every swap." },
  on_price_trigger: { usable: false, note: "Aqua does not watch prices; a shipped strategy is immutable." },
  scheduled_rebalance: { usable: false, note: "No scheduler in Aqua; re-ranging is a manual dock + ship by the maker." },
  redeploy_after_exit: { usable: false, note: "Possible only manually (dock, then ship a new strategy hash)." },
  stop_loss: { usable: false, note: "No on-chain stop conditions in the Aqua instruction set." },
  unlimited_token_approval: { usable: false, note: "TRACE never requests unlimited approvals; every approval is the exact shipped amount." },
};

const RULE_MAP: Record<string, { status: "supported" | "partial" | "unsupported"; gap?: string }> = {
  entry: { status: "supported" },
  fee: { status: "supported", gap: "Fees accrue automatically — the observed collect cadence has no Aqua equivalent and is not needed." },
  adjustment: { status: "partial", gap: "Re-setting the range requires the maker to dock and ship a new strategy; Aqua cannot trigger it." },
  exit: { status: "partial", gap: "Exit is a manual dock transaction; no conditional exit." },
  risk: { status: "unsupported", gap: "No on-chain risk limits / stop conditions in Aqua." },
};

export function assessCompatibility(ir: StrategyIR, basis: PositionMeta | null, checks: CompatibilityCheck[] = []): CompatibilityAssessment {
  const rules = ir.rules.map((r) => {
    const m = RULE_MAP[r.category] ?? { status: "unsupported" as const, gap: `no Aqua equivalent for "${r.category}"` };
    return { rule: r.rule, category: r.category, status: m.status, gap: m.gap };
  });

  const allChecks: CompatibilityCheck[] = [
    {
      key: "ir.conclusive",
      label: "Strategy hypothesis is conclusive",
      ok: ir.family !== "inconclusive",
      detail: ir.family === "inconclusive" ? "Inconclusive evidence — nothing to compile" : `family: ${ir.family}`,
      source: "ir",
    },
    {
      key: "basis.position",
      label: "A real Uniswap V3 position defines the range",
      ok: Boolean(basis && basis.pool),
      detail: basis ? `#${basis.tokenId} ${basis.symbol0}/${basis.symbol1} ticks [${basis.tickLower}, ${basis.tickUpper}]` : "no resolved position with a pool",
      source: "chain",
    },
    {
      key: "basis.decimals",
      label: "Token decimals readable",
      ok: Boolean(basis && basis.decimals0 != null && basis.decimals1 != null),
      detail: basis ? `${basis.symbol0}: ${basis.decimals0 ?? "?"}, ${basis.symbol1}: ${basis.decimals1 ?? "?"}` : "—",
      source: "chain",
    },
    ...checks,
  ];

  const blocking = allChecks.filter((c) => !c.ok && !c.key.startsWith("maker.") && !c.key.startsWith("taker."));
  const verdict: CompatibilityAssessment["verdict"] =
    blocking.length > 0 || rules.length === 0 || !rules.some((r) => r.status === "supported")
      ? "INCOMPATIBLE"
      : rules.every((r) => r.status === "supported")
        ? "FULL"
        : "PARTIAL";

  return {
    strategyId: ir.id,
    verdict,
    rules,
    capabilities: (Object.keys(CAPABILITY_MODEL) as AquaCapability[]).map((name) => ({ name, ...CAPABILITY_MODEL[name] })),
    checks: allChecks,
    basis: basis && basis.pool
      ? { tokenId: basis.tokenId, pool: basis.pool, token0: basis.token0, token1: basis.token1, tickLower: basis.tickLower, tickUpper: basis.tickUpper, feeTier: basis.feeTier }
      : undefined,
    unsupportedNotes: [
      ...rules.filter((r) => r.status !== "supported").map((r) => `${r.rule} — ${r.gap}`),
      `An Aqua strategy is a compatible implementation of the supported rules, not a migration of the Uniswap NFT (${AQUA_DOCS}).`,
    ],
    assessedAt: Math.floor(Date.now() / 1000),
  };
}
