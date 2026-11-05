/**
 * Deterministic Uniswap V3 position reconstruction.
 *
 * Input: lifecycle events decoded from the real NonfungiblePositionManager
 * (see @trace/chain-data) + per-position metadata read from positions().
 * Output: a ReconstructionSummary in the shared IR.
 *
 * Invariants:
 *  - Events are replayed in strict (block, logIndex) order — the result is
 *    independent of input order.
 *  - Principal and fees are strictly separate. V3 credits principal to
 *    tokensOwed at DECREASE and transfers principal + fees at COLLECT; the
 *    chain-data layer splits each COLLECT into its principal portion
 *    (amount0/1, already counted as withdrawn at DECREASE) and its fee portion
 *    (fee0/1). Here COLLECT only ever adds fee0/1 to feesCollected.
 *  - Uncollected fees are reported as 0: estimating them needs a fee-growth
 *    model, which is never invented here.
 *  - Amounts are normalised with the token's real decimals; when decimals are
 *    unknown they stay in base units and the position is flagged.
 */
import type { PositionMeta, ReconstructionSummary, V3Event } from "@trace/strategy-ir";
export type NumV3Event = Omit<V3Event, "liquidityDelta" | "amount0" | "amount1" | "fee0" | "fee1"> & {
    liquidityDelta: number;
    amount0: number;
    amount1: number;
    fee0: number;
    fee1: number;
};
/** Convert bigint/string on-chain quantities to numbers once, at the boundary. */
export declare function toNumberEvents(events: V3Event[]): NumV3Event[];
export type TokenLedger = {
    tokenId: number;
    pool?: string;
    tickLower: number;
    tickUpper: number;
    liquidity: number;
    status: "active" | "closed";
    openedBlock?: number;
    openedTs?: number;
    closedBlock?: number;
    closedTs?: number;
    lastActivityBlock?: number;
    lastActivityTs?: number;
    /** Base units. */
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
    /** Every distinct range observed for this NFT (constant in V3; kept for safety). */
    rangeHistory: {
        tickLower: number;
        tickUpper: number;
        atBlock: number;
    }[];
    /** Liquidity after each event, for capital-deployment metrics. */
    liquidityPath: {
        block: number;
        ts: number;
        liquidity: number;
    }[];
};
/** Replay events into per-token position state. Pure function. */
export declare function reconstructPositions(events: (V3Event | NumV3Event)[]): Map<number, TokenLedger>;
export type ReconstructOptions = {
    wallet: string;
    chainId: number;
    network: string;
    /** The observed block/time window (from the chain reader). */
    window?: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    };
};
/** Build the IR reconstruction summary with real decimals and pool identity. */
export declare function reconstructSummary(events: (V3Event | NumV3Event)[], meta: Record<string, PositionMeta> | undefined, opts: ReconstructOptions): ReconstructionSummary;
/**
 * Repositioning count: in V3 a range is fixed per NFT, so "moving the range"
 * means opening a new NFT in the same pool with a different range after
 * reducing/closing an earlier one. Counted per pool, in open order.
 */
export declare function rangeResets(ledger: Map<number, TokenLedger>): number;
