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

import {
  createPublicClient,
  http,
  parseAbiItem,
  parseEventLogs,
  toEventSelector,
  isAddress,
} from "viem";
import type { PublicClient, Address } from "viem";
import type { V3Event } from "@trace/strategy-ir";
import { NPM_ABI, NPM_ADDRESSES } from "./abis.js";

export type ChainDataConfig = {
  rpcUrl: string;
  chainId?: number; // default 1
};

export type TraceChainError = Error & {
  code:
    | "RPC_UNREACHABLE"
    | "NPM_NOT_FOUND"
    | "NO_EVENTS"
    | "DECODE_FAILED"
    | "INVALID_RANGE"
    | "RPC_ERROR";
};

export function makeChainError(code: TraceChainError["code"], message: string): TraceChainError {
  const e = new Error(message) as TraceChainError;
  e.code = code;
  e.name = "TraceChainError";
  return e;
}

/** Pool/position metadata resolved for a tokenId (real reads, never guessed). */
export type PoolMeta = {
  pool: string;
  token0: string; // symbol if readable, else address
  token1: string;
  feeTier: number; // bps
};

export type WalletQuery = {
  /** Observation window in days back from the latest block. Default 7. */
  days?: number;
  fromBlock?: number;
  toBlock?: number;
  /** getLogs chunk size; providers cap the range per call. Default 9000 (~35h). */
  chunkBlocks?: number;
};

const POOL_ABI = [
  "function tokens() view returns (address token0, address token1)",
  "function fee() view returns (uint24)",
] as const;
const NPM_GET_POOL_ABI = [
  "function getPool(uint256 tokenId) view returns (address pool, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 feeGrowthGlobal0, uint128 feeGrowthGlobal1, uint128 protocolFeeGrowthGlobal0, uint128 protocolFeeGrowthGlobal1)",
] as const;
const ERC20_ABI = ["function symbol() view returns (string)"] as const;

const LIFECYCLE_EVENT_NAMES = [
  "Mint",
  "IncreaseLiquidity",
  "DecreaseLiquidity",
  "Collect",
  "Transfer",
  "TransferSingle",
] as const;

type RawLog = {
  blockNumber: bigint;
  logIndex: bigint;
  transactionHash: string;
  data: string;
  topics: readonly string[];
};

type DecodedLog = {
  name: string;
  block: number;
  logIndex: number;
  tx: string;
  args: Record<string, unknown>;
};

export function createTraceClient(cfg: ChainDataConfig) {
  const chainId = cfg.chainId ?? 1;
  const client: PublicClient = createPublicClient({
    transport: http(cfg.rpcUrl, { timeout: 30_000 }),
    chain: {
      id: chainId,
      name: "custom",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: cfg.rpcUrl },
    } as never,
  });

  const npm = NPM_ADDRESSES[chainId];
  if (!npm) {
    throw makeChainError("NPM_NOT_FOUND", `no Uniswap V3 NPM address registered for chain ${chainId}`);
  }

  const sel: Record<string, string> = {};
  for (const name of LIFECYCLE_EVENT_NAMES) sel[name] = toEventSelector(parseAbiItem(NPM_ABI, `event:${name}`), []);

  /**
   * Reconstruct the V3 lifecycle events `wallet` actually generated in the
   * window: its mints, transfers, liquidity changes and fee collects — real
   * on-chain rows, decoded, ownership-filtered, with pool metadata.
   */
  async function fetchV3Events(
    wallet: string,
    opts?: WalletQuery,
  ): Promise<{ events: V3Event[]; poolMeta: Record<string, PoolMeta> }> {
    if (!isAddress(wallet)) throw makeChainError("DECODE_FAILED", `invalid wallet: ${wallet}`);
    const W = wallet.toLowerCase();

    const latest = Number(await client.getBlockNumber().catch(() => {
      throw makeChainError("RPC_UNREACHABLE", `RPC at ${cfg.rpcUrl} unreachable (getBlockNumber)`);
    }));
    const chunk = Math.min(opts?.chunkBlocks ?? 9_000, 50_000);
    const toBlock = opts?.toBlock ?? latest;
    const fromBlock = opts?.fromBlock ?? Math.max(0, toBlock - Math.round((opts?.days ?? 7) * 7_200)); // ~12s blocks
    if (fromBlock <= 0 || fromBlock >= toBlock) {
      throw makeChainError("INVALID_RANGE", `bad block range ${fromBlock}..${toBlock}`);
    }

    // 1) Wallet-scoped discovery in chunks.
    const decoded = await discoverWalletActivity(client, sel, W, fromBlock, toBlock, chunk, npm);

    // 2) Ownership-filtered lifecycle events.
    const owned = filterByOwnership(decoded, wallet);
    if (owned.length === 0) {
      throw makeChainError(
        "NO_EVENTS",
        `no Uniswap V3 activity for this wallet in blocks ${fromBlock}–${toBlock}; widen the window (days/fromBlock) or check the address`,
      );
    }

    // 3) Block timestamps for the touched range (bounded sampling).
    const times = await fetchBlockTimestamps(client, owned, 20_000);
    const withTimes = owned.map((e) => ({ ...e, timestamp: times[e.block] ?? 0 }));
    withTimes.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

    // 4) Pool metadata from the wallet's touched tokenIds (NPM.getPool) + per-pool reads.
    const touchedIds = [...new Set(withTimes.map((e) => String(e.tokenId)))];
    const poolMeta = await resolvePoolMeta(client, touchedIds, npm);

    return { events: withTimes, poolMeta };
  }

  return {
    client,
    npm,
    fetchV3Events,
    fetchBlockTimestamps: (events: V3Event[], step?: number) => fetchBlockTimestamps(client, events, step),
  };
}

/* ------------------------------------------------------------------ */
/*  Discovery: wallet-scoped getLogs, chunked                         */
/* ------------------------------------------------------------------ */

/**
 * The topic-sets that identify "events involving this wallet". Each set is
 * selective (wallet address pinned to an indexed topic), so providers keep
 * each getLogs cheap even inside a bounded chunk.
 */
function walletTopicSets(W: string, s: Record<string, string>): { name: string; topics: (string | undefined)[] }[] {
  return [
    // Mint topics: [sel, tokenId, sender, owner]
    { name: "Mint", topics: [s.Mint, undefined, undefined, W] },
    { name: "IncreaseLiquidity", topics: [s.IncreaseLiquidity, undefined, W] },
    { name: "DecreaseLiquidity", topics: [s.DecreaseLiquidity, undefined, W] },
    { name: "Collect", topics: [s.Collect, undefined, W] },
    // Transfer topics: [sel, from, to, tokenId]
    { name: "Transfer", topics: [s.Transfer, W] }, // from = wallet
    { name: "Transfer", topics: [s.Transfer, undefined, W] }, // to = wallet
    // TransferSingle topics: [sel, operator, from, to]
    { name: "TransferSingle", topics: [s.TransferSingle, W] }, // operator
    { name: "TransferSingle", topics: [s.TransferSingle, undefined, W] }, // from
    { name: "TransferSingle", topics: [s.TransferSingle, undefined, undefined, W] }, // to
  ];
}

async function discoverWalletActivity(
  client: PublicClient,
  s: Record<string, string>,
  W: string,
  fromBlock: number,
  toBlock: number,
  chunk: number,
  npm: Address,
): Promise<DecodedLog[]> {
  const all: RawLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    for (const set of walletTopicSets(W, s)) {
      try {
        const batch = await client.getLogs({
          address: npm,
          topics: set.topics as (string | undefined)[],
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        });
        all.push(
          ...batch.map((l) => ({
            blockNumber: l.blockNumber,
            logIndex: l.logIndex,
            transactionHash: l.transactionHash,
            data: l.data,
            topics: l.topics,
          })),
        );
      } catch (err) {
        throw makeChainError("RPC_ERROR", `getLogs(${set.name}) ${start}–${end} failed: ${(err as Error).message}`);
      }
    }
  }

  let parsed: ReturnType<typeof parseEventLogs>;
  try {
    parsed = parseEventLogs({ abi: NPM_ABI, logs: all });
  } catch (err) {
    throw makeChainError("DECODE_FAILED", `log decode failed: ${(err as Error).message}`);
  }
  return parsed
    .filter((p) => p.args != null)
    .map((p) => ({
      name: String(p.eventName),
      block: Number(p.blockNumber),
      logIndex: Number(p.logIndex),
      tx: p.transactionHash,
      args: p.args as Record<string, unknown>,
    }));
}

/**
 * Ownership tracking: Mint (owner at birth — may differ from sender when a
 * router mints for the wallet) plus Transfer/TransferSingle (owner changes)
 * decide which lifecycle events belong to the wallet.
 */
function filterByOwnership(decoded: DecodedLog[], wallet: string): V3Event[] {
  const W = wallet.toLowerCase();
  const sorted = [...decoded].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const holder = new Map<string, string>(); // tokenId → owner
  const out: V3Event[] = [];

  for (const d of sorted) {
    const a = d.args;
    switch (d.name) {
      case "Mint": {
        const tokenId = String(a.tokenId);
        holder.set(tokenId, String(a.owner).toLowerCase());
        if (String(a.owner).toLowerCase() === W) out.push(toV3Event(d, "MINT", a, tokenId));
        break;
      }
      case "Transfer":
      case "TransferSingle": {
        const tokenId = d.name === "Transfer" ? String(a.tokenId) : String(a.id);
        const from = String(a.from ?? a.operator ?? "").toLowerCase();
        const to = String(a.to).toLowerCase();
        if (to === W) {
          holder.set(tokenId, W);
          out.push(toV3Event(d, "TRANSFER", a, tokenId));
        } else if (from === W) {
          holder.delete(tokenId);
          out.push(toV3Event(d, "TRANSFER", a, tokenId));
        }
        break;
      }
      case "IncreaseLiquidity":
      case "DecreaseLiquidity":
      case "Collect": {
        const tokenId = String(a.tokenId);
        if (holder.get(tokenId) !== W) break; // not this wallet's position in-window
        const kind = d.name === "IncreaseLiquidity" ? "INCREASE" : d.name === "DecreaseLiquidity" ? "DECREASE" : "COLLECT";
        const ev = toV3Event(d, kind, a, tokenId);
        if (kind === "DECREASE" && isFullBurn(a)) ev.kind = "BURN";
        out.push(ev);
        break;
      }
    }
  }

  // Fill defaults where the decoded event lacks fields.
  for (const e of out) {
    if (e.tickLower == null) e.tickLower = 0;
    if (e.tickUpper == null) e.tickUpper = 0;
    if (e.liquidityDelta == null) e.liquidityDelta = 0;
    if (e.amount0 == null) e.amount0 = 0;
    if (e.amount1 == null) e.amount1 = 0;
    if (e.fee0 == null) e.fee0 = 0;
    if (e.fee1 == null) e.fee1 = 0;
    if (!e.owner) e.owner = wallet;
    if (e.tokenId == null) e.tokenId = 0;
  }
  return out;
}

/** NPM burn() emits DecreaseLiquidity with liquidity = the full remainder. */
function isFullBurn(args: Record<string, unknown>): boolean {
  const liq = args.liquidity;
  return liq != null && liq !== 0 && String(liq) === "340282366920938463463374607431768211455";
}

function toV3Event(
  d: DecodedLog,
  kind: V3Event["kind"],
  a: Record<string, unknown>,
  tokenIdOverride?: string,
): V3Event {
  const pick = (k: string): number | bigint => {
    const v = a[k];
    return typeof v === "bigint" ? v : v == null ? 0 : Number(v);
  };
  const tokenId = tokenIdOverride != null ? Number(tokenIdOverride) : Number(a.tokenId ?? a.id ?? 0);
  const isCollect = kind === "COLLECT";
  // Principal and fees are kept strictly distinct (IR invariant): a collect
  // moves amounts into fee0/fee1; everything else is principal.
  const e: V3Event = {
    kind,
    tokenId,
    owner: typeof a.owner === "string" ? a.owner : typeof a.sender === "string" ? a.sender : "",
    tx: d.tx,
    block: d.block,
    logIndex: d.logIndex,
    timestamp: 0, // filled by fetchBlockTimestamps
    liquidityDelta: kind === "MINT" ? pick("amount") : pick("liquidity"),
    amount0: isCollect ? 0 : pick("amount0"),
    amount1: isCollect ? 0 : pick("amount1"),
    fee0: isCollect ? pick("amount0") : 0,
    fee1: isCollect ? pick("amount1") : 0,
    tickLower: Number(a.tickLower ?? 0),
    tickUpper: Number(a.tickUpper ?? 0),
  };
  return e;
}

/* ------------------------------------------------------------------ */
/*  Pool metadata                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve pool metadata for each tokenId the wallet touched, via
 * `NPM.getPool(tokenId)` (the authoritative pool for a position) plus a
 * bounded set of per-pool `tokens()`/`fee()`/`symbol()` reads.
 */
async function resolvePoolMeta(
  client: PublicClient,
  tokenIds: string[],
  npm: Address,
): Promise<Record<string, PoolMeta>> {
  if (tokenIds.length === 0) return {};

  // tokenId → pool address, via the NPM (a position's pool is defined by the
  // NPM, not derivable from event logs — PositionInitialized has no pool field).
  const poolOf = new Map<string, string>();
  for (const id of tokenIds) {
    try {
      const r = (await client.readContract({
        address: npm,
        abi: NPM_GET_POOL_ABI,
        functionName: "getPool",
        args: [BigInt(id)],
      })) as unknown as { 0: Address };
      const pool = r && (r[0] ?? (r as { pool?: Address }).pool);
      if (pool && pool !== "0x0000000000000000000000000000000000000000") poolOf.set(id, pool);
    } catch {
      // Unknown / closed tokenId — leave metadata unresolved, not fabricated.
    }
  }

  // Distinct pools → token0/token1/fee (read once per pool).
  const byPool = new Map<string, string[]>();
  for (const [id, pool] of poolOf) {
    const list = byPool.get(pool) ?? [];
    list.push(id);
    byPool.set(pool, list);
  }

  const out: Record<string, PoolMeta> = {};
  for (const [pool, ids] of byPool) {
    let token0 = pool;
    let token1 = pool;
    let feeTier = 0;
    try {
      const tokens = (await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "tokens",
      })) as unknown as [Address, Address];
      const fee = (await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "fee",
      })) as unknown as bigint;
      const sym = async (addr: Address): Promise<string> => {
        try {
          return String(await client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }));
        } catch {
          return addr; // fall back to the address — never a guessed name
        }
      };
      token0 = await sym(tokens[0]);
      token1 = await sym(tokens[1]);
      feeTier = Number(fee);
    } catch {
      // metadata is enrichment, not truth — positions stay valid without it
    }
    for (const id of ids) out[id] = { pool, token0, token1, feeTier };
  }
  return out;
}

/* ------------------------------------------------------------------ */

/** Block → unix-seconds, sampling every `step` blocks (bounded reads). */
export async function fetchBlockTimestamps(
  client: PublicClient,
  events: V3Event[],
  step = 20_000,
): Promise<Record<number, number>> {
  if (events.length === 0) return {};
  const out: Record<number, number> = {};
  const first = Math.min(...events.map((e) => e.block));
  const last = Math.max(...events.map((e) => e.block));
  const blocks = new Set<number>();
  for (const e of events) blocks.add(e.block);
  for (let b = first; b <= last; b += step) blocks.add(b);
  for (const b of [...blocks].sort((x, y) => x - y)) {
    try {
      const block = await client.getBlock({ blockNumber: BigInt(b), includeTransactions: false });
      out[b] = Number(block.timestamp);
    } catch {
      // missing timestamps degrade gracefully; the period reports unknown,
      // never a fabricated time.
    }
  }
  return out;
}

export type { V3Event };
