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

import { createPublicClient, fallback, http, type Address, type Hex, type PublicClient, getAddress, isAddress, toEventSelector, numberToHex, pad } from "viem";
import { sepolia } from "viem/chains";
import { NPM_DEPLOY_BLOCK, SEPOLIA_CHAIN, SEPOLIA_CHAIN_ID, UNISWAP_V3 } from "@trace/chain-config";
import type { PositionMeta, PriceSeries, V3Event } from "@trace/strategy-ir";
import { ERC20_ABI, FACTORY_ABI, NPM_ABI, POOL_ABI, ZERO_ADDRESS } from "./abis.js";

/* ------------------------------------------------------------------ */
/*  Config + errors                                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Process-wide caches of IMMUTABLE chain data                         */
/* ------------------------------------------------------------------ */

/**
 * Optional persistent store (e.g. Redis) for finalized log chunks, so cached
 * chain reads survive restarts. Only data at or below a finalized block is
 * ever stored: it can no longer change, so serving it from cache is exactly
 * what the RPC would return.
 */
export type ChainCacheStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
let persistent: ChainCacheStore | null = null;
export function setPersistentChainCache(store: ChainCacheStore | null): void {
  persistent = store;
}

const FINALITY_MARGIN = 64; // blocks behind head treated as final (Sepolia finalizes in ~2 epochs)
const LOG_CACHE_MAX = 4_000;
const logChunkCache = new Map<string, unknown[]>();
function memSet(k: string, v: unknown[]) {
  if (logChunkCache.size >= LOG_CACHE_MAX) logChunkCache.delete(logChunkCache.keys().next().value as string);
  logChunkCache.set(k, v);
}
const tsCacheGlobal = new Map<number, number>();
const tokenCacheGlobal = new Map<string, { symbol: string; decimals: number }>();
const receiptCache = new Map<string, { gasUsed: string; effectiveGasPrice: string }>();
let knownHead = 0;

export type TraceChainErrorCode =
  | "UNSUPPORTED_CHAIN"
  | "WRONG_CHAIN"
  | "RPC_UNREACHABLE"
  | "RPC_ERROR"
  | "RATE_LIMITED"
  | "NO_EVENTS"
  | "DECODE_FAILED"
  | "INVALID_ADDRESS"
  | "INVALID_RANGE";

export type TraceChainError = Error & { code: TraceChainErrorCode };

export function makeChainError(code: TraceChainErrorCode, message: string): TraceChainError {
  const e = new Error(scrubSecrets(message)) as TraceChainError;
  e.code = code;
  e.name = "TraceChainError";
  return e;
}

/** Remove provider keys from any text (viem errors embed the full RPC URL). */
export function scrubSecrets(text: string): string {
  return String(text)
    .replace(/(https?:\/\/[^\s"']*?\/v[0-9]+\/)[A-Za-z0-9_-]{8,}/g, "$1***")
    .replace(/(https?:\/\/)[^\s"'@/]+@/g, "$1***@")
    .replace(/([?&](?:apikey|api_key|key|token)=)[^&\s"']+/gi, "$1***");
}

function classify(err: unknown): TraceChainError {
  const msg = scrubSecrets((err as { shortMessage?: string; details?: string; message?: string })?.details
    ?? (err as { shortMessage?: string })?.shortMessage
    ?? (err as Error)?.message ?? String(err));
  if (/429|rate limit|too many requests|exceeded.*capacity/i.test(msg)) return makeChainError("RATE_LIMITED", msg);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|timed? ?out|timeout|network/i.test(msg)) return makeChainError("RPC_UNREACHABLE", msg);
  return makeChainError("RPC_ERROR", msg);
}

/* ------------------------------------------------------------------ */
/*  Small async utilities                                              */
/* ------------------------------------------------------------------ */

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client-side rate limiter (free-tier RPC providers throttle bursts): every
 * request reserves the next slot `minIntervalMs` after the previous one.
 */
type Limiter = { acquire(cost: number): Promise<void>; drain(): void };
const limiters = new Map<string, Limiter>();
function sharedLimiter(rpcUrl: string, minIntervalMs: number, creditsPerSecond: number): Limiter {
  let l = limiters.get(rpcUrl);
  if (!l) {
    l = createCreditLimiter(creditsPerSecond, minIntervalMs);
    limiters.set(rpcUrl, l);
  }
  return l;
}

/**
 * Token bucket in provider credits, FIFO-serialized so a burst of parallel
 * callers is spread over time instead of hitting the provider at once.
 */
function createCreditLimiter(perSec: number, minIntervalMs: number): Limiter {
  let available = perSec;
  let last = Date.now();
  let queue: Promise<void> = Promise.resolve();
  const spacing = createLimiter(minIntervalMs);
  return {
    acquire(cost: number) {
      const c = Math.min(cost, perSec);
      const p = queue.then(async () => {
        for (;;) {
          const now = Date.now();
          available = Math.min(perSec, available + ((now - last) * perSec) / 1000);
          last = now;
          if (available >= c) {
            available -= c;
            break;
          }
          await sleep(Math.ceil(((c - available) * 1000) / perSec));
        }
        await spacing();
      });
      queue = p.catch(() => undefined);
      return p;
    },
    drain() {
      available = 0;
      last = Date.now();
    },
  };
}

function createLimiter(minIntervalMs: number) {
  let nextSlot = 0;
  return async function acquire() {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minIntervalMs;
    if (slot > now) await sleep(slot - now);
  };
}

const isTransient = (e: TraceChainError) =>
  e.code === "RATE_LIMITED" ||
  e.code === "RPC_UNREACHABLE" ||
  /internal error|header not found|-32603|temporarily unavailable|bad gateway|gateway time|50[234]/i.test(e.message);

async function withRetry<T>(fn: () => Promise<T>, attempts = 9, onRateLimited?: () => void): Promise<T> {
  let lastErr: TraceChainError | null = null;
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn();
    } catch (err) {
      const e = classify(err);
      lastErr = e;
      if (!isTransient(e) || a === attempts - 1) throw e;
      // Credit quotas refill every second: empty the shared bucket so every
      // caller waits for the refill, then retry after a short linear back-off.
      if (e.code === "RATE_LIMITED") {
        onRateLimited?.();
        await sleep(Math.min(600 * (a + 1), 6_000) + Math.floor(Math.random() * 300));
      } else {
        await sleep(Math.min(1_000 * 2 ** a, 20_000) + Math.floor(Math.random() * 500));
      }
    }
  }
  throw lastErr ?? makeChainError("RPC_ERROR", "retry exhausted");
}

/* ------------------------------------------------------------------ */
/*  Event selectors                                                    */
/* ------------------------------------------------------------------ */

const SEL = {
  Transfer: toEventSelector("Transfer(address,address,uint256)"),
  IncreaseLiquidity: toEventSelector("IncreaseLiquidity(uint256,uint128,uint256,uint256)"),
  DecreaseLiquidity: toEventSelector("DecreaseLiquidity(uint256,uint128,uint256,uint256)"),
  Collect: toEventSelector("Collect(uint256,address,uint256,uint256)"),
  Swap: toEventSelector("Swap(address,address,int256,int256,uint160,uint128,int24)"),
};

const topicAddr = (a: string): Hex => pad(getAddress(a) as Hex, { size: 32 }).toLowerCase() as Hex;
const topicUint = (n: bigint | number): Hex => pad(numberToHex(BigInt(n)), { size: 32 });
const topicToAddr = (t: string): string => getAddress(`0x${t.slice(26)}`);

type RawLog = {
  address: string;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
  topics: readonly Hex[];
  data: Hex;
};

const NPM = UNISWAP_V3.nonfungiblePositionManager.address;

/* ------------------------------------------------------------------ */
/*  Client                                                              */
/* ------------------------------------------------------------------ */

export type WalletQuery = {
  /** Observation window in days back from the latest block (default 30, max 365). */
  days?: number;
  fromBlock?: number;
  toBlock?: number;
};

export type WalletHistory = {
  wallet: string;
  chainId: number;
  window: { fromBlock: number; toBlock: number; fromTs: number; toTs: number };
  events: V3Event[];
  positions: Record<string, PositionMeta>;
  /** Honest notes about anything partial or unresolved. */
  notes: string[];
  rpcCalls: number;
};

export function createTraceClient(cfg: ChainDataConfig) {
  const chainId = cfg.chainId ?? SEPOLIA_CHAIN_ID;
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw makeChainError("UNSUPPORTED_CHAIN", `chain ${chainId} is not supported — TRACE only reads Ethereum Sepolia (${SEPOLIA_CHAIN_ID})`);
  }
  if (!cfg.rpcUrl) throw makeChainError("RPC_UNREACHABLE", "no Sepolia RPC URL configured (SEPOLIA_RPC_URL)");

  const maxRange = cfg.maxLogRange ?? 10_000;
  const conc = cfg.concurrency ?? 3;
  // One limiter per RPC endpoint, shared by every client in the process, so
  // concurrent jobs and API reads cannot multiply the request rate.
  const credits = cfg.creditsPerSecond ?? (Number(process.env.TRACE_RPC_CREDITS_PER_SEC) || 240);
  const limiter = sharedLimiter(cfg.rpcUrl, cfg.minIntervalMs ?? 0, credits);
  let rpcCalls = 0;

  const client: PublicClient = createPublicClient({
    chain: sepolia,
    transport: cfg.fallbackRpcUrls?.length
      ? fallback([http(cfg.rpcUrl, { timeout: 30_000, retryCount: 0 }), ...cfg.fallbackRpcUrls.map((u) => http(u, { timeout: 30_000, retryCount: 0 }))], { retryCount: 0 })
      : http(cfg.rpcUrl, { timeout: 30_000, retryCount: 0 }),
  }) as PublicClient;

  /** Every RPC request goes through here: credit-paced, counted, retried. `cost` is the provider credit price (eth_getLogs 255, reads 80). */
  const call = <T>(fn: () => Promise<T>, cost = 80) => {
    return withRetry(
      async () => {
        await limiter.acquire(cost);
        rpcCalls++;
        return fn();
      },
      9,
      () => limiter.drain(),
    );
  };

  let chainChecked = false;
  async function assertChain(): Promise<void> {
    if (chainChecked) return;
    const id = await call(() => client.getChainId());
    if (id !== SEPOLIA_CHAIN_ID) {
      throw makeChainError("WRONG_CHAIN", `RPC reports chain ${id}, expected Sepolia ${SEPOLIA_CHAIN_ID}; refusing to read`);
    }
    chainChecked = true;
  }

  async function latestBlock(): Promise<number> {
    const b = Number(await call(() => client.getBlockNumber()));
    knownHead = Math.max(knownHead, b);
    return b;
  }

  /**
   * eth_getLogs over [from,to] in provider-sized chunks, adaptive on range errors.
   * Chunks are ALIGNED to multiples of maxRange so different queries over
   * overlapping windows hit the same chunks; chunks entirely at or below the
   * finalized head are cached (memory + optional persistent store) and then
   * filtered to [from,to]. Same logs as a direct query, far fewer RPC calls.
   */
  async function getLogsChunked(params: { address: Address | Address[]; topics: (Hex | Hex[] | null)[] }, from: number, to: number): Promise<RawLog[]> {
    const ranges: [number, number][] = [];
    for (let s = Math.floor(from / maxRange) * maxRange; s <= to; s += maxRange) ranges.push([s, s + maxRange - 1]);
    const addrKey = (Array.isArray(params.address) ? [...params.address].map((a) => a.toLowerCase()).sort().join(",") : params.address.toLowerCase());
    const topicKey = JSON.stringify(params.topics);
    const fetchRange = async ([a, b]: [number, number]): Promise<RawLog[]> => {
      try {
        return (await call(
          () =>
            client.request({
              method: "eth_getLogs",
              params: [{ address: params.address, topics: params.topics as never, fromBlock: numberToHex(a), toBlock: numberToHex(b) }],
            }),
          255,
        )) as unknown as RawLog[];
      } catch (err) {
        const e = err as TraceChainError;
        if (b > a && /range|too many|limit|10000 results|query returned more/i.test(e.message)) {
          const mid = Math.floor((a + b) / 2);
          return [...(await fetchRange([a, mid])), ...(await fetchRange([mid + 1, b]))];
        }
        throw e;
      }
    };
    const fetchChunk = async ([a, b]: [number, number]): Promise<RawLog[]> => {
      const finalized = knownHead > 0 && b <= knownHead - FINALITY_MARGIN;
      if (!finalized) return fetchRange([a, Math.min(b, to)]);
      const key = `trace:logs:v1:${chainId}:${addrKey}:${topicKey}:${a}-${b}`;
      const mem = logChunkCache.get(key);
      if (mem) return mem as RawLog[];
      if (persistent) {
        try {
          const hit = await persistent.get(key);
          if (hit != null) {
            const v = JSON.parse(hit) as RawLog[];
            memSet(key, v);
            return v;
          }
        } catch {
          /* cache unavailable — read the chain */
        }
      }
      const logs = await fetchRange([a, b]);
      memSet(key, logs);
      if (persistent) {
        const json = JSON.stringify(logs);
        if (json.length < 900_000) persistent.set(key, json).catch(() => undefined);
      }
      return logs;
    };
    const parts = await pool(ranges, conc, fetchChunk);
    return parts
      .flat()
      .filter((l) => {
        const bn = l.blockNumber == null ? null : Number(l.blockNumber);
        return bn == null || (bn >= from && bn <= to);
      })
      .map((l) => ({
        ...l,
        blockNumber: l.blockNumber == null ? null : BigInt(l.blockNumber),
        logIndex: l.logIndex == null ? null : Number(l.logIndex),
      }));
  }

  const tsCache = tsCacheGlobal;
  async function blockTimestamps(blocks: number[]): Promise<Map<number, number>> {
    const need = [...new Set(blocks)].filter((b) => !tsCache.has(b));
    await pool(need, conc + 2, async (b) => {
      const final = knownHead > 0 && b <= knownHead - FINALITY_MARGIN;
      const key = `trace:ts:v1:${chainId}:${b}`;
      if (final && persistent) {
        try {
          const hit = await persistent.get(key);
          if (hit != null) return void tsCache.set(b, Number(hit));
        } catch {
          /* cache unavailable — read the chain */
        }
      }
      const blk = await call(() => client.getBlock({ blockNumber: BigInt(b) }));
      tsCache.set(b, Number(blk.timestamp));
      if (final && persistent) persistent.set(key, String(blk.timestamp)).catch(() => undefined);
    });
    return tsCache;
  }

  /* ---------------- positions + tokens ---------------- */

  const tokenCache = tokenCacheGlobal;
  async function tokenInfo(addr: string): Promise<{ symbol: string; decimals: number } | null> {
    const k = addr.toLowerCase();
    if (tokenCache.has(k)) return tokenCache.get(k)!;
    try {
      const [symbol, decimals] = await Promise.all([
        call(() => client.readContract({ address: addr as Address, abi: ERC20_ABI, functionName: "symbol" })),
        call(() => client.readContract({ address: addr as Address, abi: ERC20_ABI, functionName: "decimals" })),
      ]);
      const v = { symbol: String(symbol), decimals: Number(decimals) };
      tokenCache.set(k, v);
      return v;
    } catch {
      return null; // non-standard token: reported as unresolved, never guessed
    }
  }

  /**
   * Multicall3 with per-item failure for genuine reverts, but a THROW for
   * transport failures: viem reports an RPC error (429, timeout…) as a
   * per-item "failure" when allowFailure is set, which would silently look
   * like a revert. Re-throwing makes withRetry back off and try again.
   */
  async function multicall<T extends readonly unknown[]>(contracts: T) {
    return call(async () => {
      const res = await client.multicall({ allowFailure: true, contracts: contracts as never });
      const transport = (res as { status: string; error?: Error }[]).find(
        (r) => r.status === "failure" && r.error && !/revert|execution reverted|returned no data|ContractFunctionZeroData|out of gas|invalid token/i.test(`${r.error.name} ${(r.error as { shortMessage?: string }).shortMessage ?? ""} ${r.error.message}`),
      );
      if (transport?.error) throw transport.error;
      return res as { status: "success" | "failure"; result?: unknown; error?: Error }[];
    });
  }

  /**
   * Batched position metadata via Multicall3 (one eth_call per batch instead
   * of one per field): positions(), ERC-20 symbol/decimals, factory.getPool.
   * Burned NFTs revert at latest; their pre-burn state is read at burnBlock-1.
   */
  async function resolvePositions(
    ids: number[],
    burnBlockOf: Map<number, number>,
    mintedInWindow: Set<number>,
    notes: string[],
  ): Promise<Record<string, PositionMeta>> {
    type PosTuple = readonly [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint];
    const raw = new Map<number, PosTuple>();
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const res = await multicall(batch.map((id) => ({ address: NPM, abi: NPM_ABI, functionName: "positions" as const, args: [BigInt(id)] as const })));
      res.forEach((r, j) => {
        if (r.status === "success") raw.set(batch[j], r.result as unknown as PosTuple);
      });
    }
    // Burned (reverting) positions: archive read just before the burn.
    for (const id of ids) {
      if (raw.has(id)) continue;
      const bb = burnBlockOf.get(id);
      if (bb == null) continue;
      try {
        const r = await call(() =>
          client.readContract({ address: NPM, abi: NPM_ABI, functionName: "positions", args: [BigInt(id)], blockNumber: BigInt(bb - 1) }),
        );
        raw.set(id, r as unknown as PosTuple);
      } catch {
        /* reported below */
      }
    }

    const tokens = [...new Set([...raw.values()].flatMap((p) => [p[2].toLowerCase(), p[3].toLowerCase()]))].filter((t) => !tokenCache.has(t));
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const res = await multicall(
        batch.flatMap((t) => [
          { address: t as Address, abi: ERC20_ABI, functionName: "symbol" as const },
          { address: t as Address, abi: ERC20_ABI, functionName: "decimals" as const },
        ]),
      );
      batch.forEach((t, j) => {
        const sym = res[2 * j];
        const dec = res[2 * j + 1];
        if (sym.status === "success" && dec.status === "success") tokenCache.set(t, { symbol: String(sym.result), decimals: Number(dec.result) });
      });
    }

    const triples = [...new Map([...raw.values()].map((p) => [`${p[2]}:${p[3]}:${p[4]}`, p] as const)).values()];
    const poolOf = new Map<string, string | null>();
    for (let i = 0; i < triples.length; i += 100) {
      const batch = triples.slice(i, i + 100);
      const res = await multicall(
        batch.map((p) => ({
          address: UNISWAP_V3.factory.address,
          abi: FACTORY_ABI,
          functionName: "getPool" as const,
          args: [p[2] as Address, p[3] as Address, Number(p[4])] as const,
        })),
      );
      batch.forEach((p, j) => {
        const r = res[j];
        poolOf.set(`${p[2]}:${p[3]}:${p[4]}`, r.status === "success" && r.result !== ZERO_ADDRESS ? getAddress(r.result as string) : null);
      });
    }

    const out: Record<string, PositionMeta> = {};
    for (const id of ids) {
      const p = raw.get(id);
      if (!p) {
        notes.push(`position #${id}: positions() not readable (burned and pre-burn archive state unavailable) — range/tokens unresolved`);
        continue;
      }
      const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
      const t0 = tokenCache.get(token0.toLowerCase());
      const t1 = tokenCache.get(token1.toLowerCase());
      if (!t0 || !t1) notes.push(`position #${id}: ERC-20 metadata not readable for ${!t0 ? token0 : token1} — amounts shown in base units`);
      out[String(id)] = {
        tokenId: id,
        pool: poolOf.get(`${token0}:${token1}:${fee}`) ?? null,
        token0: getAddress(token0),
        token1: getAddress(token1),
        symbol0: t0?.symbol ?? token0,
        symbol1: t1?.symbol ?? token1,
        decimals0: t0?.decimals ?? null,
        decimals1: t1?.decimals ?? null,
        feeTier: Number(fee),
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        currentLiquidity: burnBlockOf.has(id) ? "0" : liquidity.toString(),
        burned: burnBlockOf.has(id),
        historyComplete: mintedInWindow.has(id),
      };
    }
    return out;
  }

  /* ---------------- wallet history ---------------- */

  async function fetchWalletHistory(walletIn: string, q: WalletQuery = {}): Promise<WalletHistory> {
    if (!isAddress(walletIn)) throw makeChainError("INVALID_ADDRESS", `invalid wallet address: ${walletIn}`);
    await assertChain();
    const wallet = getAddress(walletIn);
    const notes: string[] = [];

    const latest = await latestBlock();
    const days = Math.min(Math.max(q.days ?? 30, 1), 365);
    const toBlock = Math.min(q.toBlock ?? latest, latest);
    const fromBlock = Math.max(NPM_DEPLOY_BLOCK, q.fromBlock ?? toBlock - Math.round((days * 86_400) / SEPOLIA_CHAIN.blockTimeSeconds));
    if (fromBlock >= toBlock) throw makeChainError("INVALID_RANGE", `bad block range ${fromBlock}–${toBlock}`);

    // 1) Current holdings (ERC721Enumerable).
    const held = new Set<number>();
    const bal = Number(await call(() => client.readContract({ address: NPM, abi: NPM_ABI, functionName: "balanceOf", args: [wallet] })));
    const MAX_HELD = 200;
    if (bal > MAX_HELD) notes.push(`wallet holds ${bal} position NFTs; only the first ${MAX_HELD} are analysed`);
    // One Multicall3 request per 100 NFTs instead of one RPC call per NFT.
    const idx = Array.from({ length: Math.min(bal, MAX_HELD) }, (_, i) => i);
    for (let i = 0; i < idx.length; i += 100) {
      const batch = idx.slice(i, i + 100);
      const res = await multicall(batch.map((k) => ({ address: NPM, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex" as const, args: [wallet, BigInt(k)] as const })));
      for (let j = 0; j < res.length; j++) {
        const r = res[j];
        if (r.status === "success") held.add(Number(r.result as bigint));
        else held.add(Number(await call(() => client.readContract({ address: NPM, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [wallet, BigInt(batch[j])] }))));
      }
    }

    // 2) NFT transfers in the window (both directions).
    const W = topicAddr(wallet);
    const [outLogs, inLogs] = await Promise.all([
      getLogsChunked({ address: NPM, topics: [SEL.Transfer, W, null, null] }, fromBlock, toBlock),
      getLogsChunked({ address: NPM, topics: [SEL.Transfer, null, W, null] }, fromBlock, toBlock),
    ]);
    const transfers = [...outLogs, ...inLogs]
      .filter((l) => l.topics.length === 4 && l.blockNumber != null)
      .map((l) => ({
        block: Number(l.blockNumber),
        logIndex: Number(l.logIndex),
        tx: l.transactionHash as string,
        from: topicToAddr(l.topics[1]),
        to: topicToAddr(l.topics[2]),
        tokenId: Number(BigInt(l.topics[3])),
      }))
      .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

    const ids = new Set<number>([...held, ...transfers.map((t) => t.tokenId)]);
    if (ids.size === 0) {
      throw makeChainError(
        "NO_EVENTS",
        `no Uniswap V3 positions found for ${wallet} on Sepolia in blocks ${fromBlock}–${toBlock} (wallet holds no position NFTs and none were transferred in the window)`,
      );
    }

    // Ownership intervals per token (owned by wallet between [start, end)).
    const intervals = new Map<number, { start: number; end: number }[]>();
    const firstSeen = new Map<number, number>();
    for (const id of ids) {
      const ts = transfers.filter((t) => t.tokenId === id);
      const iv: { start: number; end: number }[] = [];
      // Owned at window start iff the first in-window transfer is FROM the wallet,
      // or there are no transfers and the wallet holds it now.
      let ownedFrom: number | null =
        (ts.length && ts[0].from === wallet) || (!ts.length && held.has(id)) ? fromBlock : null;
      for (const t of ts) {
        if (t.to === wallet) ownedFrom = t.block;
        if (t.from === wallet && ownedFrom != null) {
          iv.push({ start: ownedFrom, end: t.block });
          ownedFrom = null;
        }
      }
      if (ownedFrom != null) iv.push({ start: ownedFrom, end: toBlock + 1 });
      intervals.set(id, iv);
      const mint = ts.find((t) => t.from === ZERO_ADDRESS);
      firstSeen.set(id, mint ? mint.block : fromBlock);
    }

    // 3) Lifecycle logs for every discovered tokenId (topic-OR, batched ids).
    const idList = [...ids];
    const lifecycle: RawLog[] = [];
    for (let i = 0; i < idList.length; i += 50) {
      const batch = idList.slice(i, i + 50).map(topicUint);
      const start = Math.min(...idList.slice(i, i + 50).map((id) => firstSeen.get(id) ?? fromBlock));
      lifecycle.push(
        ...(await getLogsChunked(
          { address: NPM, topics: [[SEL.IncreaseLiquidity, SEL.DecreaseLiquidity, SEL.Collect], batch] },
          Math.max(start, fromBlock),
          toBlock,
        )),
      );
    }

    // 4) Position metadata (batched).
    const burnBlockOf = new Map<number, number>();
    for (const t of transfers) if (t.to === ZERO_ADDRESS) burnBlockOf.set(t.tokenId, t.block);
    const minted = new Set(transfers.filter((t) => t.from === ZERO_ADDRESS).map((t) => t.tokenId));
    const positions = await resolvePositions(idList, burnBlockOf, minted, notes);
    const metas = Object.values(positions);
    const partial = metas.filter((m) => m && !m.historyComplete).length;
    if (partial) notes.push(`${partial} position(s) were opened before the window — their earlier history is outside the observed range`);

    // 5) Build IR events (ownership-filtered, MINT merged with its IncreaseLiquidity).
    const owned = (id: number, block: number) => (intervals.get(id) ?? []).some((iv) => block >= iv.start && block < iv.end);
    const mintTx = new Map<string, number>(); // `${tx}:${tokenId}` → mint transfer block
    const events: V3Event[] = [];
    for (const t of transfers) {
      const meta = positions[String(t.tokenId)];
      const base = {
        tokenId: t.tokenId,
        owner: wallet,
        tx: t.tx,
        block: t.block,
        logIndex: t.logIndex,
        timestamp: 0,
        liquidityDelta: 0n,
        amount0: 0n,
        amount1: 0n,
        fee0: 0n,
        fee1: 0n,
        tickLower: meta?.tickLower ?? 0,
        tickUpper: meta?.tickUpper ?? 0,
        pool: meta?.pool ?? undefined,
        from: t.from,
        to: t.to,
      };
      if (t.from === ZERO_ADDRESS) {
        mintTx.set(`${t.tx}:${t.tokenId}`, events.length);
        events.push({ ...base, kind: "MINT" });
      } else if (t.to === ZERO_ADDRESS) {
        events.push({ ...base, kind: "BURN" });
      } else {
        events.push({ ...base, kind: "TRANSFER" });
      }
    }

    const decoded = lifecycle
      .filter((l) => l.blockNumber != null && l.topics.length >= 2)
      .map((l) => {
        const data = l.data.slice(2);
        const word = (i: number) => BigInt(`0x${data.slice(i * 64, i * 64 + 64)}`);
        const sel = l.topics[0];
        const tokenId = Number(BigInt(l.topics[1]));
        const block = Number(l.blockNumber);
        if (sel === SEL.Collect) {
          return { kind: "COLLECT" as const, tokenId, block, logIndex: Number(l.logIndex), tx: l.transactionHash as string, liquidity: 0n, a0: word(1), a1: word(2), recipient: getAddress(`0x${data.slice(24, 64)}`) };
        }
        return {
          kind: sel === SEL.IncreaseLiquidity ? ("INCREASE" as const) : ("DECREASE" as const),
          tokenId,
          block,
          logIndex: Number(l.logIndex),
          tx: l.transactionHash as string,
          liquidity: word(0),
          a0: word(1),
          a1: word(2),
          recipient: undefined as string | undefined,
        };
      })
      .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

    // Principal owed from decreases (V3 credits tokensOwed; Collect transfers principal + fees).
    const owed = new Map<number, { t0: bigint; t1: bigint }>();
    for (const d of decoded) {
      if (!owned(d.tokenId, d.block)) continue;
      const meta = positions[String(d.tokenId)];
      const common = {
        tokenId: d.tokenId,
        owner: wallet,
        tx: d.tx,
        block: d.block,
        logIndex: d.logIndex,
        timestamp: 0,
        tickLower: meta?.tickLower ?? 0,
        tickUpper: meta?.tickUpper ?? 0,
        pool: meta?.pool ?? undefined,
      };
      if (d.kind === "INCREASE") {
        const mintIdx = mintTx.get(`${d.tx}:${d.tokenId}`);
        if (mintIdx != null && events[mintIdx].liquidityDelta === 0n) {
          // The IncreaseLiquidity emitted by mint() — merge amounts into MINT.
          Object.assign(events[mintIdx], { liquidityDelta: d.liquidity, amount0: d.a0, amount1: d.a1, logIndex: Math.min(events[mintIdx].logIndex, d.logIndex) });
          continue;
        }
        events.push({ ...common, kind: "INCREASE", liquidityDelta: d.liquidity, amount0: d.a0, amount1: d.a1, fee0: 0n, fee1: 0n });
      } else if (d.kind === "DECREASE") {
        const o = owed.get(d.tokenId) ?? { t0: 0n, t1: 0n };
        owed.set(d.tokenId, { t0: o.t0 + d.a0, t1: o.t1 + d.a1 });
        events.push({ ...common, kind: "DECREASE", liquidityDelta: d.liquidity, amount0: d.a0, amount1: d.a1, fee0: 0n, fee1: 0n });
      } else {
        const o = owed.get(d.tokenId) ?? { t0: 0n, t1: 0n };
        const p0 = d.a0 < o.t0 ? d.a0 : o.t0;
        const p1 = d.a1 < o.t1 ? d.a1 : o.t1;
        owed.set(d.tokenId, { t0: o.t0 - p0, t1: o.t1 - p1 });
        events.push({
          ...common,
          kind: "COLLECT",
          liquidityDelta: 0n,
          amount0: p0, // principal portion (already counted as withdrawn at DECREASE)
          amount1: p1,
          fee0: d.a0 - p0, // fee portion
          fee1: d.a1 - p1,
          to: d.recipient,
        });
      }
    }
    events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

    // 6) Timestamps + receipts (real gas).
    const tsMap = await blockTimestamps([...events.map((e) => e.block), fromBlock, toBlock]);
    for (const e of events) e.timestamp = tsMap.get(e.block) ?? 0;
    const txs = [...new Set(events.map((e) => e.tx))];
    const MAX_RECEIPTS = 300;
    if (txs.length > MAX_RECEIPTS) notes.push(`gas read for the first ${MAX_RECEIPTS} of ${txs.length} transactions`);
    const receipts = new Map<string, { gasUsed: string; effectiveGasPrice: string }>();
    await pool(txs.slice(0, MAX_RECEIPTS), conc, async (h) => {
      const hit = receiptCache.get(h.toLowerCase());
      if (hit) return void receipts.set(h, hit);
      try {
        const r = await call(() => client.getTransactionReceipt({ hash: h as Hex }));
        const v = { gasUsed: r.gasUsed.toString(), effectiveGasPrice: (r.effectiveGasPrice ?? 0n).toString() };
        receipts.set(h, v);
        if (Number(r.blockNumber) <= knownHead - FINALITY_MARGIN) receiptCache.set(h.toLowerCase(), v);
      } catch {
        /* gas left undefined — never estimated */
      }
    });
    for (const e of events) {
      const r = receipts.get(e.tx);
      if (r) Object.assign(e, r);
    }

    if (events.length === 0) {
      throw makeChainError(
        "NO_EVENTS",
        `wallet ${wallet} holds ${held.size} position NFT(s) but had no position activity in blocks ${fromBlock}–${toBlock}; widen the window`,
      );
    }

    return {
      wallet,
      chainId: SEPOLIA_CHAIN_ID,
      window: { fromBlock, toBlock, fromTs: tsMap.get(fromBlock) ?? 0, toTs: tsMap.get(toBlock) ?? 0 },
      events,
      positions,
      notes,
      rpcCalls,
    };
  }

  /* ---------------- pool price history ---------------- */

  async function fetchPoolPriceSeries(
    poolAddr: string,
    fromBlock: number,
    toBlock: number,
    opts: { decimals0: number | null; decimals1: number | null; symbol0: string; symbol1: string; feeTier?: number; maxSwaps?: number },
  ): Promise<PriceSeries> {
    if (!isAddress(poolAddr)) throw makeChainError("INVALID_ADDRESS", `invalid pool address: ${poolAddr}`);
    await assertChain();
    const maxSwaps = opts.maxSwaps ?? 5_000;
    const logs = await getLogsChunked({ address: getAddress(poolAddr), topics: [SEL.Swap] }, fromBlock, toBlock);
    const sorted = logs
      .filter((l) => l.blockNumber != null)
      .sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || Number(a.logIndex) - Number(b.logIndex));
    const truncated = sorted.length > maxSwaps;
    const use = truncated ? sorted.filter((_, i) => i % Math.ceil(sorted.length / maxSwaps) === 0) : sorted;

    const scale = opts.decimals0 != null && opts.decimals1 != null ? 10 ** (opts.decimals0 - opts.decimals1) : 1;
    const raw = use.map((l) => {
      const d = l.data.slice(2);
      const amount0 = BigInt.asIntN(256, BigInt(`0x${d.slice(0, 64)}`));
      const amount1 = BigInt.asIntN(256, BigInt(`0x${d.slice(64, 128)}`));
      const sqrtP = BigInt(`0x${d.slice(128, 192)}`);
      const liquidity = BigInt(`0x${d.slice(192, 256)}`);
      const tickWord = BigInt(`0x${d.slice(256, 320)}`);
      const tick = Number(BigInt.asIntN(24, tickWord));
      const ratio = Number(sqrtP) / 2 ** 96;
      return {
        block: Number(l.blockNumber),
        price: ratio * ratio * scale,
        tick,
        sqrtPriceX96: sqrtP.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        liquidity: liquidity.toString(),
      };
    });

    // Timestamps: exact at fixed anchors (the window ends + every aligned
    // maxRange boundary inside it), linear interpolation in between. Fixed
    // anchors are shared by every pool and every run, so they are read once
    // and then served from the timestamp cache.
    const anchorsWanted = new Set<number>([fromBlock, toBlock]);
    for (let b = Math.ceil(fromBlock / maxRange) * maxRange; b < toBlock; b += maxRange) anchorsWanted.add(b);
    const ts = await blockTimestamps([...anchorsWanted]);
    const anchors = [...anchorsWanted].sort((a, b) => a - b).map((b) => [b, ts.get(b)!] as const);
    const interp = (b: number) => {
      const exact = ts.get(b);
      if (exact != null) return exact;
      let lo = anchors[0];
      let hi = anchors[anchors.length - 1];
      for (const a of anchors) {
        if (a[0] <= b) lo = a;
        if (a[0] >= b) {
          hi = a;
          break;
        }
      }
      if (hi[0] === lo[0]) return lo[1];
      return Math.round(lo[1] + ((b - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
    };

    return {
      pool: getAddress(poolAddr),
      symbol0: opts.symbol0,
      symbol1: opts.symbol1,
      fromBlock,
      toBlock,
      points: raw.map((p) => ({ ...p, timestamp: interp(p.block) })),
      feeTier: opts.feeTier,
      decimals0: opts.decimals0,
      decimals1: opts.decimals1,
      timestampsInterpolated: true,
      truncated,
    };
  }

  /* ---------------- discovery of real active LPs ---------------- */

  /**
   * Recently active EOA liquidity providers, found live from NPM mint logs and
   * ranked so wallets whose latest position sits in an ACTIVELY TRADED pool come
   * first (those are the ones a backtest can actually replay). Swap activity is
   * counted from real pool Swap logs over the last ~10k blocks.
   */
  async function findActiveLpWallets(
    n = 5,
    lookbackBlocks = 50_000,
  ): Promise<{ wallet: string; mints: number; lastBlock: number; pool: string | null; pair: string | null; feeTier: number | null; poolSwaps: number }[]> {
    await assertChain();
    const latest = await latestBlock();
    const logs = await getLogsChunked({ address: NPM, topics: [SEL.Transfer, topicAddr(ZERO_ADDRESS), null, null] }, latest - lookbackBlocks, latest);
    const agg = new Map<string, { mints: number; lastBlock: number; lastTokenId: number }>();
    for (const l of logs) {
      if (l.topics.length !== 4) continue;
      const to = topicToAddr(l.topics[2]);
      const a = agg.get(to) ?? { mints: 0, lastBlock: 0, lastTokenId: 0 };
      a.mints++;
      const b = Number(l.blockNumber);
      if (b >= a.lastBlock) {
        a.lastBlock = b;
        a.lastTokenId = Number(BigInt(l.topics[3]));
      }
      agg.set(to, a);
    }

    // Latest position of every minter → its pool (positions() + factory.getPool, batched).
    const entries = [...agg.entries()];
    type PosTuple = readonly [bigint, string, string, string, number, number, number, bigint];
    const posOf = new Map<string, PosTuple>();
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const res = await multicall(batch.map(([, a]) => ({ address: NPM, abi: NPM_ABI, functionName: "positions" as const, args: [BigInt(a.lastTokenId)] as const })));
      res.forEach((r, j) => {
        if (r.status === "success") posOf.set(batch[j][0], r.result as unknown as PosTuple);
      });
    }
    const triples = [...new Set([...posOf.values()].map((p) => `${p[2]}:${p[3]}:${p[4]}`))];
    const poolOf = new Map<string, string>();
    for (let i = 0; i < triples.length; i += 100) {
      const batch = triples.slice(i, i + 100);
      const res = await multicall(
        batch.map((t) => {
          const [a, b, f] = t.split(":");
          return { address: UNISWAP_V3.factory.address, abi: FACTORY_ABI, functionName: "getPool" as const, args: [a as Address, b as Address, Number(f)] as const };
        }),
      );
      batch.forEach((t, j) => {
        const r = res[j];
        if (r.status === "success" && r.result !== ZERO_ADDRESS) poolOf.set(t, getAddress(r.result as string));
      });
    }

    // Real swap activity per pool (one address-array getLogs per chunk).
    const pools = [...new Set(poolOf.values())] as Address[];
    const swaps = new Map<string, number>();
    for (let i = 0; i < pools.length; i += 50) {
      const sw = await getLogsChunked({ address: pools.slice(i, i + 50), topics: [SEL.Swap] }, latest - 9_999, latest);
      for (const l of sw) swaps.set(getAddress(l.address), (swaps.get(getAddress(l.address)) ?? 0) + 1);
    }

    const rows = entries.map(([wallet, a]) => {
      const p = posOf.get(wallet);
      const key = p ? `${p[2]}:${p[3]}:${p[4]}` : null;
      const poolAddr = key ? poolOf.get(key) ?? null : null;
      return { wallet, mints: a.mints, lastBlock: a.lastBlock, p, pool: poolAddr, feeTier: p ? Number(p[4]) : null, poolSwaps: poolAddr ? swaps.get(poolAddr) ?? 0 : 0 };
    });
    rows.sort((x, y) => Number(y.poolSwaps >= 15) - Number(x.poolSwaps >= 15) || y.poolSwaps - x.poolSwaps || y.mints - x.mints);

    const out: { wallet: string; mints: number; lastBlock: number; pool: string | null; pair: string | null; feeTier: number | null; poolSwaps: number }[] = [];
    for (const r of rows.slice(0, n * 4)) {
      const code = await call(() => client.getCode({ address: r.wallet as Address }));
      if (code && code !== "0x") continue; // EOAs only (people, not router contracts)
      let pair: string | null = null;
      if (r.p) {
        const [t0, t1] = await Promise.all([tokenInfo(r.p[2]), tokenInfo(r.p[3])]);
        pair = `${t0?.symbol ?? r.p[2].slice(0, 8)}/${t1?.symbol ?? r.p[3].slice(0, 8)}`;
      }
      out.push({ wallet: r.wallet, mints: r.mints, lastBlock: r.lastBlock, pool: r.pool, pair, feeTier: r.feeTier, poolSwaps: r.poolSwaps });
      if (out.length >= n) break;
    }
    return out;
  }

  /* ---------------- probes + misc reads ---------------- */

  async function probeCode(address: string): Promise<{ hasCode: boolean; bytes: number }> {
    const code = await call(() => client.getCode({ address: address as Address }));
    const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    return { hasCode: bytes > 0, bytes };
  }

  async function poolState(poolAddr: string) {
    const [slot0, liquidity] = await Promise.all([
      call(() => client.readContract({ address: poolAddr as Address, abi: POOL_ABI, functionName: "slot0" })),
      call(() => client.readContract({ address: poolAddr as Address, abi: POOL_ABI, functionName: "liquidity" })),
    ]);
    return { sqrtPriceX96: slot0[0].toString(), tick: Number(slot0[1]), liquidity: liquidity.toString() };
  }

  return {
    // (the raw viem client is intentionally not exported — keeps the type portable and the RPC URL private)
    chainId: SEPOLIA_CHAIN_ID,
    npm: NPM,
    assertChain,
    latestBlock,
    fetchWalletHistory,
    fetchPoolPriceSeries,
    findActiveLpWallets,
    probeCode,
    poolState,
    tokenInfo,
    blockTimestamps,
    rpcCallCount: () => rpcCalls,
  };
}

export type TraceClient = ReturnType<typeof createTraceClient>;
export type { V3Event, PositionMeta, PriceSeries };
