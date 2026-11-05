/**
 * Offline ambient declarations for viem (used by @trace/chain-data).
 *
 * Stubbed deliberately so the monorepo type-checks without node_modules.
 * The shapes here mirror the slice of viem's public API that @trace/chain-data
 * actually calls; a real build installs viem and these stubs are unused.
 */
declare module "viem" {
  export type Address = string;
  export type Hash = `0x${string}`;

  export type GetLogsParameter = {
    address: Address;
    topics?: readonly (string | null | readonly string[] | undefined)[];
    fromBlock?: bigint;
    toBlock?: bigint;
  };

  export type LogResult = {
    blockNumber: bigint;
    logIndex: bigint;
    transactionHash: Hash;
    data: string;
    topics: readonly string[];
  };

  export type Block = {
    number: bigint;
    timestamp: bigint;
    [k: string]: unknown;
  };

  export interface PublicClient {
    getLogs(params: GetLogsParameter): Promise<LogResult[]>;
    getBlock(params: { blockNumber?: bigint; blockTag?: string; includeTransactions?: boolean }): Promise<Block>;
    getBlockNumber(): Promise<bigint>;
    /** Contract read. The return type is caller-declared via generics in real
     *  viem; the offline stub returns unknown so callers narrow with a cast. */
    readContract(params: {
      address: Address;
      abi: unknown;
      functionName: string;
      args?: readonly unknown[];
      [k: string]: unknown;
    }): Promise<unknown>;
  }

  export function createPublicClient(cfg: Record<string, unknown>): PublicClient;
  export function http(url: string, opts?: Record<string, unknown>): unknown;
  export function parseAbiItem(abi: unknown, name: string): unknown;
  export function parseEventLogs(opts: unknown):
    | Array<{
        eventName: string;
        blockNumber: bigint;
        logIndex: bigint;
        transactionHash: Hash;
        args: Record<string, unknown>;
      }>;
  export function toEventSelector(item: unknown, args?: unknown): string;
  export function isAddress(addr: string): boolean;
}

declare module "viem/chains" {
  export const mainnet: unknown;
}
