/**
 * Live Uniswap V3 data via viem + an Ethereum RPC endpoint.
 *
 * Produces IR V3Event shapes (see @trace/strategy-ir) so the reconstruction
 * engine never learns where the data came from.
 *
 * WALLET-SCOPED QUERIES. The NPM's lifecycle events carry indexed
 * `sender`/`owner`/`from`/`to` topics, so we never scan the whole
 * contract's log history (impossible over a year on any RPC). Instead:
 *   1) discover this wallet's activity in small block chunks (getLogs with
 *      address + wallet topics — selective, cheap, capped),
 *   2) decode,
 *   3) track NFT ownership across Transfer/TransferSingle,
 *   4) resolve pool metadata (token0/token1/fee) from PositionInitialized
 *      + bounded per-pool `tokens()`/`fee()` reads,
 *   5) enrich with block timestamps.
 *
 * Error strategy: every failure throws a typed TraceChainError with a stable
 * `code`; the caller labels the result — never silently degrades to demo.
 */
import type { PublicClient } from "viem";
import type { V3Event } from "@trace/strategy-ir";
export type ChainDataConfig = {
    rpcUrl: string;
    chainId?: number;
};
export type TraceChainError = Error & {
    code: "RPC_UNREACHABLE" | "NPM_NOT_FOUND" | "NO_EVENTS" | "DECODE_FAILED" | "INVALID_RANGE" | "RPC_ERROR";
};
export declare function makeChainError(code: TraceChainError["code"], message: string): TraceChainError;
/** Pool/position metadata resolved for a tokenId (real reads, never guessed). */
export type PoolMeta = {
    pool: string;
    token0: string;
    token1: string;
    feeTier: number;
};
export type WalletQuery = {
    /** Observation window in days back from the latest block. Default 7. */
    days?: number;
    fromBlock?: number;
    toBlock?: number;
    /** getLogs chunk size; providers cap the range per call. Default 9000 (~35h). */
    chunkBlocks?: number;
};
export declare function createTraceClient(cfg: ChainDataConfig): {
    client: PublicClient;
    npm: string;
    fetchV3Events: (wallet: string, opts?: WalletQuery) => Promise<{
        events: V3Event[];
        poolMeta: Record<string, PoolMeta>;
    }>;
    fetchBlockTimestamps: (events: V3Event[], step?: number) => Promise<Record<number, number>>;
};
/** Block → unix-seconds, sampling every `step` blocks (bounded reads). */
export declare function fetchBlockTimestamps(client: PublicClient, events: V3Event[], step?: number): Promise<Record<number, number>>;
export type { V3Event };
