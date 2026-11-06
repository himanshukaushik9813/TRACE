/**
 * Case study: one wallet's Uniswap V3 history as an evidence-backed report.
 *
 * Pure function over what the investigation stored: the reconstructed on-chain
 * events (NonfungiblePositionManager logs + ERC-721 transfers), positions()
 * metadata, the Strategy DNA and the strategy hypothesis. Every observation it
 * returns carries the exact events behind it (tx, block, log index, timestamp,
 * event kind, NFT id). Nothing is estimated or invented: what the data cannot
 * show is reported as a limitation instead.
 */
import type { PositionMeta, StrategyIR, V3Event, V3EventKind } from "@trace/strategy-ir";
import type { Fingerprints } from "./fingerprints.js";
/** One source event, as shown in the Evidence Explorer. Amounts are base-unit decimal strings. */
export type CaseEvent = {
    tx: string;
    block: number;
    logIndex: number;
    timestamp: number;
    kind: V3EventKind;
    tokenId: number;
    pool: string | null;
    liquidityDelta: string;
    /** Position liquidity right after this event (replayed in order). */
    liquidityAfter: string;
    amount0: string;
    amount1: string;
    fee0: string;
    fee1: string;
    from: string | null;
    to: string | null;
    tickLower: number;
    tickUpper: number;
};
export type CasePosition = {
    tokenId: number;
    pool: string | null;
    symbol0: string | null;
    symbol1: string | null;
    decimals0: number | null;
    decimals1: number | null;
    feeTier: number | null;
    tickLower: number;
    tickUpper: number;
    status: "active" | "closed";
    /** False when the NFT was minted before the window: its earlier history is not included. */
    historyComplete: boolean;
    opened: CaseEvent | null;
    closed: CaseEvent | null;
    events: CaseEvent[];
    ownership: {
        from: string | null;
        to: string | null;
        event: CaseEvent;
    }[];
    feeCollections: CaseEvent[];
    totals: {
        deposited0: string;
        deposited1: string;
        withdrawn0: string;
        withdrawn1: string;
        fees0: string;
        fees1: string;
    };
    peakLiquidity: string;
};
export type RangeChange = {
    pool: string;
    from: {
        tokenId: number;
        tickLower: number;
        tickUpper: number;
    };
    to: {
        tokenId: number;
        tickLower: number;
        tickUpper: number;
    };
    /** The removal on the old NFT and the mint of the new one. */
    evidence: CaseEvent[];
};
export type Observation = {
    id: string;
    title: string;
    /** Plain-English explanation of what the events show (never a claim about intent). */
    explanation: string;
    source: "measured" | "strategy_rule";
    evidence: CaseEvent[];
    /** Tx hashes cited (by a strategy rule) that are not among this investigation's events. */
    missingRefs: string[];
};
export type CaseStudy = {
    wallet: string;
    chainId: number;
    window: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    } | null;
    overview: {
        positions: number;
        active: number;
        closed: number;
        pools: number;
        events: number;
        byKind: Record<V3EventKind, number>;
        firstEvent: CaseEvent | null;
        lastEvent: CaseEvent | null;
    };
    positions: CasePosition[];
    rangeChanges: RangeChange[];
    /** Every liquidity change across all positions, in chain order. */
    liquidityTimeline: CaseEvent[];
    observations: Observation[];
    coverage: {
        events: number;
        eventsWithTimestamp: number;
        eventsWithReceipt: number;
        positions: number;
        positionsWithFullHistory: number;
        positionsWithMetadata: number;
        observations: number;
        observationsWithEvidence: number;
        ruleRefs: number;
        ruleRefsFound: number;
    };
    limitations: string[];
};
export type CaseStudyInput = {
    wallet: string;
    chainId: number;
    events: V3Event[];
    meta: PositionMeta[];
    window?: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    } | null;
    fingerprints?: Fingerprints | null;
    strategy?: StrategyIR | null;
};
export declare function buildCaseStudy(input: CaseStudyInput): CaseStudy;
