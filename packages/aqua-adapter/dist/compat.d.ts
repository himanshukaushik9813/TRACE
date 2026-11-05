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
export declare const CAPABILITY_MODEL: Record<AquaCapability, {
    usable: boolean;
    note: string;
}>;
export declare function assessCompatibility(ir: StrategyIR, basis: PositionMeta | null, checks?: CompatibilityCheck[]): CompatibilityAssessment;
