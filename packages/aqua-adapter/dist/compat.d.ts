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
export declare const VERDICT_LABEL: {
    readonly FULL: "Fully compatible within supported scope";
    readonly PARTIAL: "Partially compatible";
    readonly INCOMPATIBLE: "Incompatible";
};
/** Keys whose failure informs but does not block compilation (wallet state, taker gate, notes). */
export declare const NON_BLOCKING: (key: string) => boolean;
export declare const CAPABILITY_MODEL: Record<AquaCapability, {
    usable: boolean;
    note: string;
}>;
/**
 * Structural checks that need no network: token identity and ordering, decimals,
 * price bounds (built and validated with the SDK), what the strategy's rules need
 * versus what Aqua can do, and — when the pool's real spot price is known — which
 * tokens the range needs right now.
 */
export declare function structuralChecks(ir: StrategyIR, basis: PositionMeta | null, spot?: {
    sqrtPriceX96: string;
    tick: number;
    block: number;
} | null): CompatibilityCheck[];
export declare function assessCompatibility(ir: StrategyIR, basis: PositionMeta | null, checks?: CompatibilityCheck[], spot?: {
    sqrtPriceX96: string;
    tick: number;
    block: number;
} | null): CompatibilityAssessment;
