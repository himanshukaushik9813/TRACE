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
import { createRequire } from "node:module";
import { humanPriceFromSqrt1e18, sqrtPrice1e18FromX96, sqrtPriceFromTick } from "./price.js";

const require = createRequire(import.meta.url);
const { instructions } = require("@1inch/swap-vm-sdk") as typeof import("@1inch/swap-vm-sdk");

export const VERDICT_LABEL = {
  FULL: "Fully compatible within supported scope",
  PARTIAL: "Partially compatible",
  INCOMPATIBLE: "Incompatible",
} as const;

/** Keys whose failure informs but does not block compilation (wallet state, taker gate, notes). */
export const NON_BLOCKING = (key: string) => key.startsWith("maker.") || key.startsWith("taker.") || key.startsWith("info.");

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

/**
 * Structural checks that need no network: token identity and ordering, decimals,
 * price bounds (built and validated with the SDK), what the strategy's rules need
 * versus what Aqua can do, and — when the pool's real spot price is known — which
 * tokens the range needs right now.
 */
export function structuralChecks(ir: StrategyIR, basis: PositionMeta | null, spot?: { sqrtPriceX96: string; tick: number; block: number } | null): CompatibilityCheck[] {
  const out: CompatibilityCheck[] = [];
  if (!basis || !basis.pool) return out;
  const t0 = basis.token0.toLowerCase();
  const t1 = basis.token1.toLowerCase();
  out.push({ key: "tokens.distinct", label: "Two distinct tokens", ok: t0 !== t1, detail: `${basis.symbol0} ${basis.token0} / ${basis.symbol1} ${basis.token1}`, source: "chain" });
  out.push({
    key: "tokens.order",
    label: "Token ordering matches SwapVM",
    ok: BigInt(basis.token0) < BigInt(basis.token1),
    detail: "Uniswap token0 has the lower address, which SwapVM calls tokenLt, so price = token1/token0 = tokenGt/tokenLt in both",
    source: "chain",
  });
  const decOk = basis.decimals0 != null && basis.decimals1 != null && basis.decimals0 >= 0 && basis.decimals0 <= 36 && basis.decimals1 >= 0 && basis.decimals1 <= 36;
  out.push({ key: "tokens.decimals", label: "Decimals usable for exact amounts", ok: decOk, detail: `${basis.symbol0}: ${basis.decimals0 ?? "?"}, ${basis.symbol1}: ${basis.decimals1 ?? "?"} (read from the token contracts)`, source: "chain" });

  const fullRange = basis.tickUpper - basis.tickLower >= 1_700_000;
  let bounds: { min: bigint; max: bigint } | null = null;
  if (fullRange) {
    out.push({ key: "price.bounds", label: "Price boundaries representable", ok: true, detail: "full-range position → plain constant-product (XYC) curve, no bounds", source: "ir" });
  } else {
    try {
      const min = sqrtPriceFromTick(basis.tickLower);
      const max = sqrtPriceFromTick(basis.tickUpper);
      instructions.concentrate.ConcentrateGrowLiquidity2DArgs.fromSqrtPrices(min, max);
      bounds = { min, max };
      const d0 = basis.decimals0 ?? 0;
      const d1 = basis.decimals1 ?? 0;
      out.push({
        key: "price.bounds",
        label: "Price boundaries representable",
        ok: min < max,
        detail: `ticks [${basis.tickLower}, ${basis.tickUpper}] → ${humanPriceFromSqrt1e18(min, d0, d1).toPrecision(6)}–${humanPriceFromSqrt1e18(max, d0, d1).toPrecision(6)} ${basis.symbol1} per ${basis.symbol0} (exact sqrt bounds, accepted by the SDK)`,
        source: "ir",
      });
    } catch (err) {
      out.push({ key: "price.bounds", label: "Price boundaries representable", ok: false, detail: (err as Error).message, source: "ir" });
    }
  }

  const needsTrigger = ir.rules.filter((r) => r.category === "adjustment" || r.category === "risk" || r.category === "exit");
  out.push({
    key: "info.conditions",
    label: "Strategy conditions Aqua can enforce",
    ok: needsTrigger.length === 0,
    detail: needsTrigger.length
      ? `${needsTrigger.length} rule(s) depend on conditions Aqua does not evaluate (price triggers, re-sets, exits, risk limits); they stay manual: ${needsTrigger.map((r) => r.rule).join("; ")}`
      : "every rule is a static range + fee, which a shipped strategy expresses directly",
    source: "ir",
  });
  out.push({
    key: "info.operations",
    label: "Operations used",
    ok: true,
    detail: "approve (exact amounts), ship, dock: maker side, permissionless. Swaps (taker side) need the 1inch KycNFT and are not part of this flow",
    source: "docs",
  });

  if (spot) {
    const s = sqrtPrice1e18FromX96(BigInt(spot.sqrtPriceX96));
    const where = !bounds ? "full_range" : s <= bounds.min ? "below" : s >= bounds.max ? "above" : "inside";
    out.push({
      key: "liquidity.requirement",
      label: "Tokens the range needs at today's price",
      ok: true,
      detail:
        where === "inside"
          ? `pool price (block ${spot.block}, tick ${spot.tick}) is inside the range: both ${basis.symbol0} and ${basis.symbol1}, in the ratio the price sets`
          : where === "below"
            ? `pool price (block ${spot.block}, tick ${spot.tick}) is below the range: only ${basis.symbol0}`
            : where === "above"
              ? `pool price (block ${spot.block}, tick ${spot.tick}) is above the range: only ${basis.symbol1}`
              : `full range: both tokens in the ratio of the pool price (block ${spot.block})`,
      source: "chain",
    });
    out.push({
      key: "capital.requirement",
      label: "Capital requirement",
      ok: true,
      detail: "any non-zero amount; TRACE sizes it to the pool price and never commits more than you enter. Tokens stay in your wallet until a swap fills",
      source: "docs",
    });
  } else {
    out.push({ key: "info.spot", label: "Pool price for sizing", ok: false, detail: "the pool's current price could not be read, so amounts cannot be sized yet", source: "chain" });
  }
  return out;
}

export function assessCompatibility(
  ir: StrategyIR,
  basis: PositionMeta | null,
  checks: CompatibilityCheck[] = [],
  spot?: { sqrtPriceX96: string; tick: number; block: number } | null,
): CompatibilityAssessment {
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
    ...structuralChecks(ir, basis, spot),
    ...checks,
  ];

  const blocking = allChecks.filter((c) => !c.ok && !NON_BLOCKING(c.key));
  const verdict: CompatibilityAssessment["verdict"] =
    blocking.length > 0 || rules.length === 0 || !rules.some((r) => r.status === "supported")
      ? "INCOMPATIBLE"
      : rules.every((r) => r.status === "supported")
        ? "FULL"
        : "PARTIAL";

  return {
    strategyId: ir.id,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
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
