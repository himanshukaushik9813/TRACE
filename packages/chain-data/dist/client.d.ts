/**
 * Live Uniswap V3 data on Ethereum Sepolia via viem.
 *
 * DISCOVERY (the only correct way, given the real NPM ABI):
 *   In IncreaseLiquidity / DecreaseLiquidity / Collect only `tokenId` is
 *   indexed. The wallet can only be found through ERC-721 `Transfer`
 *   (from/to/tokenId all indexed). So:
 *     1. the wallet's current holdings via ERC721Enumerable
 *        (balanceOf + tokenOfOwnerByIndex),
 *     2. Transfer(from=wallet) and Transfer(to=wallet) in the window
 *        (mints = from 0x0, burns = to 0x0, plus real transfers),
 *     3. lifecycle logs for ALL discovered tokenIds in one topic-OR query per
 *        chunk: topics [[Increase,Decrease,Collect], [id1,id2,…]],
 *     4. positions(tokenId) for tokens/fee/ticks (at burnBlock-1 for burned NFTs),
 *        factory.getPool for the pool, ERC-20 symbol/decimals,
 *     5. block timestamps and tx receipts (real gas).
 *
 * Infura caps eth_getLogs at 10,000 blocks per request on Sepolia, so every
 * scan is chunked (adaptive: halves on range/too-many-results errors, retries
 * with backoff on rate limits/timeouts).
 *
 * Errors: every failure is a typed TraceChainError whose message has the RPC
 * URL (which embeds the provider key) scrubbed out.
 */
import type { PositionMeta, PriceSeries, V3Event } from "@trace/strategy-ir";
export type ChainDataConfig = {
    rpcUrl: string;
    /**
     * Optional secondary Sepolia RPCs. When the primary throttles or fails, the
     * request transparently fails over (viem fallback transport). They read the
     * same chain — never a different data source.
     */
    fallbackRpcUrls?: string[];
    /** Must be Sepolia. Any other value throws UNSUPPORTED_CHAIN. */
    chainId?: number;
    /** eth_getLogs block-range cap of the provider (Infura Sepolia: 10,000). */
    maxLogRange?: number;
    /** Parallel RPC requests. */
    concurrency?: number;
    /** Minimum spacing between RPC requests in ms (default 0; pacing is credit-based, see creditsPerSecond). */
    minIntervalMs?: number;
    /**
     * Provider throughput budget in credits/second (Infura free tier;
     * eth_getLogs costs 255, most other reads 80). Requests are paced to stay
     * under it instead of tripping 429s and sleeping in exponential back-off.
     * Default 240 (measured on the free Infura Sepolia key: ~1 eth_getLogs/s is
     * the sustained ceiling; faster pacing only buys 429s), or TRACE_RPC_CREDITS_PER_SEC.
     */
    creditsPerSecond?: number;
};
/**
 * Optional persistent store (e.g. Redis) for finalized log chunks, so cached
 * chain reads survive restarts. Only data at or below a finalized block is
 * ever stored: it can no longer change, so serving it from cache is exactly
 * what the RPC would return.
 */
export type ChainCacheStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
};
export declare function setPersistentChainCache(store: ChainCacheStore | null): void;
export type TraceChainErrorCode = "UNSUPPORTED_CHAIN" | "WRONG_CHAIN" | "RPC_UNREACHABLE" | "RPC_ERROR" | "RATE_LIMITED" | "NO_EVENTS" | "DECODE_FAILED" | "INVALID_ADDRESS" | "INVALID_RANGE";
export type TraceChainError = Error & {
    code: TraceChainErrorCode;
};
export declare function makeChainError(code: TraceChainErrorCode, message: string): TraceChainError;
/** Remove provider keys from any text (viem errors embed the full RPC URL). */
export declare function scrubSecrets(text: string): string;
export type WalletQuery = {
    /** Observation window in days back from the latest block (default 30, max 365). */
    days?: number;
    fromBlock?: number;
    toBlock?: number;
};
export type WalletHistory = {
    wallet: string;
    chainId: number;
    window: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    };
    events: V3Event[];
    positions: Record<string, PositionMeta>;
    /** Honest notes about anything partial or unresolved. */
    notes: string[];
    rpcCalls: number;
};
export declare function createTraceClient(cfg: ChainDataConfig): {
    chainId: 11155111;
    npm: "0x1238536071E1c677A632429e3655c799b22cDA52";
    assertChain: () => Promise<void>;
    latestBlock: () => Promise<number>;
    fetchWalletHistory: (walletIn: string, q?: WalletQuery) => Promise<WalletHistory>;
    fetchPoolPriceSeries: (poolAddr: string, fromBlock: number, toBlock: number, opts: {
        decimals0: number | null;
        decimals1: number | null;
        symbol0: string;
        symbol1: string;
        feeTier?: number;
        maxSwaps?: number;
    }) => Promise<PriceSeries>;
    findActiveLpWallets: (n?: number, lookbackBlocks?: number) => Promise<{
        wallet: string;
        mints: number;
        lastBlock: number;
        pool: string | null;
        pair: string | null;
        feeTier: number | null;
        poolSwaps: number;
    }[]>;
    probeCode: (address: string) => Promise<{
        hasCode: boolean;
        bytes: number;
    }>;
    poolState: (poolAddr: string) => Promise<{
        sqrtPriceX96: string;
        tick: number;
        liquidity: string;
    }>;
    tokenInfo: (addr: string) => Promise<{
        symbol: string;
        decimals: number;
    } | null>;
    blockTimestamps: (blocks: number[]) => Promise<Map<number, number>>;
    rpcCallCount: () => number;
};
export type TraceClient = ReturnType<typeof createTraceClient>;
export type { V3Event, PositionMeta, PriceSeries };
