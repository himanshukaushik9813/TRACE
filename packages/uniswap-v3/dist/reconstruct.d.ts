/**
 * Deterministic Uniswap V3 position reconstruction.
 *
 * Input: raw lifecycle events (as decoded from NonfungiblePositionManager logs —
 * see @trace/chain-data for the viem side). Output: a ReconstructionSummary in
 * the shared IR.
 *
 * Invariants this module guarantees:
 *  - Events are replayed in strict (block, logIndex) order — out-of-order
 *    input is sorted, so the result is order-independent.
 *  - Principal withdrawals (MINT/INCREASE/DECREASE token amounts) are kept
 *    strictly distinct from fees (COLLECT amounts) in accounting.
 *  - feesUncollected is reported as 0 in the pure event reconstruction:
 *    accrued-but-uncollected fees require a price/fee model, which the
 *    backtester owns. This keeps the two engines from double-counting.
 */
import type { ReconstructionSummary, V3Event } from "@trace/strategy-ir";
/**
 * Boundary helper: the chain-data layer decodes raw quantities as bigint (the
 * on-chain truth). The reconstruction engine works in `number` (safe for
 * uint128 liquidity, which fits well under Number.MAX_SAFE_INTEGER, and for
 * display-grade amounts). Convert once, at the edge.
 */
export type NumV3Event = Omit<V3Event, "liquidityDelta" | "amount0" | "amount1" | "fee0" | "fee1"> & {
    liquidityDelta: number;
    amount0: number;
    amount1: number;
    fee0: number;
    fee1: number;
};
export declare function toNumberEvents(events: V3Event[]): NumV3Event[];
export type TokenLedger = {
    tokenId: number;
    pool?: string;
    token0?: string;
    token1?: string;
    feeTier?: number;
    tickLower: number;
    tickUpper: number;
    liquidity: number;
    status: "active" | "closed";
    openedBlock?: number;
    closedBlock?: number;
    lastActivityBlock?: number;
    deposited: {
        t0: number;
        t1: number;
    };
    withdrawn: {
        t0: number;
        t1: number;
    };
    feesCollected: {
        t0: number;
        t1: number;
    };
    /** Each distinct range the position was observed at, in order. */
    rangeHistory: {
        tickLower: number;
        tickUpper: number;
        atBlock: number;
    }[];
};
/** Replay events into per-token position state. Pure function. */
export declare function reconstructPositions(events: V3Event[]): Map<number, TokenLedger>;
export type ReconstructOptions = {
    wallet: string;
    chainId: number;
    network: string;
};
/**
 * poolMeta is keyed by tokenId (string form), typically filled from the NPM
 * tokenURI JSON. Unknown tokens simply keep `pool: "unknown"`.
 */
export declare function reconstructSummary(events: V3Event[], poolMeta: Record<string, {
    token0: string;
    token1: string;
    feeTier: number;
}> | undefined, opts: ReconstructOptions): ReconstructionSummary;
/**
 * Number of range re-sets: distinct ranges in rangeHistory minus the first.
 * Feeds the inference engine's "range adjustment frequency" fingerprint.
 */
export declare function rangeResets(ledger: Map<number, TokenLedger>): number;
