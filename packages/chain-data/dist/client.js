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
import { createPublicClient, fallback, http, getAddress, isAddress, toEventSelector, numberToHex, pad } from "viem";
import { sepolia } from "viem/chains";
import { NPM_DEPLOY_BLOCK, SEPOLIA_CHAIN, SEPOLIA_CHAIN_ID, UNISWAP_V3 } from "@trace/chain-config";
import { ERC20_ABI, FACTORY_ABI, NPM_ABI, POOL_ABI, ZERO_ADDRESS } from "./abis.js";
export function makeChainError(code, message) {
    const e = new Error(scrubSecrets(message));
    e.code = code;
    e.name = "TraceChainError";
    return e;
}
/** Remove provider keys from any text (viem errors embed the full RPC URL). */
export function scrubSecrets(text) {
    return String(text)
        .replace(/(https?:\/\/[^\s"']*?\/v[0-9]+\/)[A-Za-z0-9_-]{8,}/g, "$1***")
        .replace(/(https?:\/\/)[^\s"'@/]+@/g, "$1***@")
        .replace(/([?&](?:apikey|api_key|key|token)=)[^&\s"']+/gi, "$1***");
}
function classify(err) {
    const msg = scrubSecrets(err?.details
        ?? err?.shortMessage
        ?? err?.message ?? String(err));
    if (/429|rate limit|too many requests|exceeded.*capacity/i.test(msg))
        return makeChainError("RATE_LIMITED", msg);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|timed? ?out|timeout|network/i.test(msg))
        return makeChainError("RPC_UNREACHABLE", msg);
    return makeChainError("RPC_ERROR", msg);
}
/* ------------------------------------------------------------------ */
/*  Small async utilities                                              */
/* ------------------------------------------------------------------ */
async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length)
                return;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Client-side rate limiter (free-tier RPC providers throttle bursts): every
 * request reserves the next slot `minIntervalMs` after the previous one.
 */
const limiters = new Map();
function sharedLimiter(rpcUrl, minIntervalMs) {
    let l = limiters.get(rpcUrl);
    if (!l) {
        l = createLimiter(minIntervalMs);
        limiters.set(rpcUrl, l);
    }
    return l;
}
function createLimiter(minIntervalMs) {
    let nextSlot = 0;
    return async function acquire() {
        const now = Date.now();
        const slot = Math.max(now, nextSlot);
        nextSlot = slot + minIntervalMs;
        if (slot > now)
            await sleep(slot - now);
    };
}
const isTransient = (e) => e.code === "RATE_LIMITED" ||
    e.code === "RPC_UNREACHABLE" ||
    /internal error|header not found|-32603|temporarily unavailable|bad gateway|gateway time|50[234]/i.test(e.message);
async function withRetry(fn, attempts = 9) {
    let lastErr = null;
    for (let a = 0; a < attempts; a++) {
        try {
            return await fn();
        }
        catch (err) {
            const e = classify(err);
            lastErr = e;
            if (!isTransient(e) || a === attempts - 1)
                throw e;
            // Rate limits get a longer, jittered back-off (free-tier quotas are per second).
            const baseMs = e.code === "RATE_LIMITED" ? 2_000 : 1_000;
            await sleep(Math.min(baseMs * 2 ** a, 20_000) + Math.floor(Math.random() * 500));
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
const topicAddr = (a) => pad(getAddress(a), { size: 32 }).toLowerCase();
const topicUint = (n) => pad(numberToHex(BigInt(n)), { size: 32 });
const topicToAddr = (t) => getAddress(`0x${t.slice(26)}`);
const NPM = UNISWAP_V3.nonfungiblePositionManager.address;
export function createTraceClient(cfg) {
    const chainId = cfg.chainId ?? SEPOLIA_CHAIN_ID;
    if (chainId !== SEPOLIA_CHAIN_ID) {
        throw makeChainError("UNSUPPORTED_CHAIN", `chain ${chainId} is not supported — TRACE only reads Ethereum Sepolia (${SEPOLIA_CHAIN_ID})`);
    }
    if (!cfg.rpcUrl)
        throw makeChainError("RPC_UNREACHABLE", "no Sepolia RPC URL configured (SEPOLIA_RPC_URL)");
    const maxRange = cfg.maxLogRange ?? 10_000;
    const conc = cfg.concurrency ?? 3;
    // One limiter per RPC endpoint, shared by every client in the process, so
    // concurrent jobs and API reads cannot multiply the request rate.
    const acquire = sharedLimiter(cfg.rpcUrl, cfg.minIntervalMs ?? 120);
    let rpcCalls = 0;
    const client = createPublicClient({
        chain: sepolia,
        transport: cfg.fallbackRpcUrls?.length
            ? fallback([http(cfg.rpcUrl, { timeout: 30_000, retryCount: 0 }), ...cfg.fallbackRpcUrls.map((u) => http(u, { timeout: 30_000, retryCount: 0 }))], { retryCount: 0 })
            : http(cfg.rpcUrl, { timeout: 30_000, retryCount: 0 }),
    });
    const call = (fn) => {
        return withRetry(async () => {
            await acquire();
            rpcCalls++;
            return fn();
        });
    };
    let chainChecked = false;
    async function assertChain() {
        if (chainChecked)
            return;
        const id = await call(() => client.getChainId());
        if (id !== SEPOLIA_CHAIN_ID) {
            throw makeChainError("WRONG_CHAIN", `RPC reports chain ${id}, expected Sepolia ${SEPOLIA_CHAIN_ID}; refusing to read`);
        }
        chainChecked = true;
    }
    async function latestBlock() {
        return Number(await call(() => client.getBlockNumber()));
    }
    /** eth_getLogs over [from,to] in provider-sized chunks, adaptive on range errors. */
    async function getLogsChunked(params, from, to) {
        const ranges = [];
        for (let s = from; s <= to; s += maxRange)
            ranges.push([s, Math.min(s + maxRange - 1, to)]);
        const fetchRange = async ([a, b]) => {
            try {
                return (await call(() => client.request({
                    method: "eth_getLogs",
                    params: [{ address: params.address, topics: params.topics, fromBlock: numberToHex(a), toBlock: numberToHex(b) }],
                })));
            }
            catch (err) {
                const e = err;
                if (b > a && /range|too many|limit|10000 results|query returned more/i.test(e.message)) {
                    const mid = Math.floor((a + b) / 2);
                    return [...(await fetchRange([a, mid])), ...(await fetchRange([mid + 1, b]))];
                }
                throw e;
            }
        };
        const parts = await pool(ranges, conc, fetchRange);
        return parts.flat().map((l) => ({
            ...l,
            blockNumber: l.blockNumber == null ? null : BigInt(l.blockNumber),
            logIndex: l.logIndex == null ? null : Number(l.logIndex),
        }));
    }
    const tsCache = new Map();
    async function blockTimestamps(blocks) {
        const need = [...new Set(blocks)].filter((b) => !tsCache.has(b));
        await pool(need, conc + 2, async (b) => {
            const blk = await call(() => client.getBlock({ blockNumber: BigInt(b) }));
            tsCache.set(b, Number(blk.timestamp));
        });
        return tsCache;
    }
    /* ---------------- positions + tokens ---------------- */
    const tokenCache = new Map();
    async function tokenInfo(addr) {
        const k = addr.toLowerCase();
        if (tokenCache.has(k))
            return tokenCache.get(k);
        try {
            const [symbol, decimals] = await Promise.all([
                call(() => client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" })),
                call(() => client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" })),
            ]);
            const v = { symbol: String(symbol), decimals: Number(decimals) };
            tokenCache.set(k, v);
            return v;
        }
        catch {
            return null; // non-standard token: reported as unresolved, never guessed
        }
    }
    /**
     * Multicall3 with per-item failure for genuine reverts, but a THROW for
     * transport failures: viem reports an RPC error (429, timeout…) as a
     * per-item "failure" when allowFailure is set, which would silently look
     * like a revert. Re-throwing makes withRetry back off and try again.
     */
    async function multicall(contracts) {
        return call(async () => {
            const res = await client.multicall({ allowFailure: true, contracts: contracts });
            const transport = res.find((r) => r.status === "failure" && r.error && !/revert|execution reverted|returned no data|ContractFunctionZeroData|out of gas|invalid token/i.test(`${r.error.name} ${r.error.shortMessage ?? ""} ${r.error.message}`));
            if (transport?.error)
                throw transport.error;
            return res;
        });
    }
    /**
     * Batched position metadata via Multicall3 (one eth_call per batch instead
     * of one per field): positions(), ERC-20 symbol/decimals, factory.getPool.
     * Burned NFTs revert at latest; their pre-burn state is read at burnBlock-1.
     */
    async function resolvePositions(ids, burnBlockOf, mintedInWindow, notes) {
        const raw = new Map();
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const res = await multicall(batch.map((id) => ({ address: NPM, abi: NPM_ABI, functionName: "positions", args: [BigInt(id)] })));
            res.forEach((r, j) => {
                if (r.status === "success")
                    raw.set(batch[j], r.result);
            });
        }
        // Burned (reverting) positions: archive read just before the burn.
        for (const id of ids) {
            if (raw.has(id))
                continue;
            const bb = burnBlockOf.get(id);
            if (bb == null)
                continue;
            try {
                const r = await call(() => client.readContract({ address: NPM, abi: NPM_ABI, functionName: "positions", args: [BigInt(id)], blockNumber: BigInt(bb - 1) }));
                raw.set(id, r);
            }
            catch {
                /* reported below */
            }
        }
        const tokens = [...new Set([...raw.values()].flatMap((p) => [p[2].toLowerCase(), p[3].toLowerCase()]))].filter((t) => !tokenCache.has(t));
        for (let i = 0; i < tokens.length; i += 100) {
            const batch = tokens.slice(i, i + 100);
            const res = await multicall(batch.flatMap((t) => [
                { address: t, abi: ERC20_ABI, functionName: "symbol" },
                { address: t, abi: ERC20_ABI, functionName: "decimals" },
            ]));
            batch.forEach((t, j) => {
                const sym = res[2 * j];
                const dec = res[2 * j + 1];
                if (sym.status === "success" && dec.status === "success")
                    tokenCache.set(t, { symbol: String(sym.result), decimals: Number(dec.result) });
            });
        }
        const triples = [...new Map([...raw.values()].map((p) => [`${p[2]}:${p[3]}:${p[4]}`, p])).values()];
        const poolOf = new Map();
        for (let i = 0; i < triples.length; i += 100) {
            const batch = triples.slice(i, i + 100);
            const res = await multicall(batch.map((p) => ({
                address: UNISWAP_V3.factory.address,
                abi: FACTORY_ABI,
                functionName: "getPool",
                args: [p[2], p[3], Number(p[4])],
            })));
            batch.forEach((p, j) => {
                const r = res[j];
                poolOf.set(`${p[2]}:${p[3]}:${p[4]}`, r.status === "success" && r.result !== ZERO_ADDRESS ? getAddress(r.result) : null);
            });
        }
        const out = {};
        for (const id of ids) {
            const p = raw.get(id);
            if (!p) {
                notes.push(`position #${id}: positions() not readable (burned and pre-burn archive state unavailable) — range/tokens unresolved`);
                continue;
            }
            const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
            const t0 = tokenCache.get(token0.toLowerCase());
            const t1 = tokenCache.get(token1.toLowerCase());
            if (!t0 || !t1)
                notes.push(`position #${id}: ERC-20 metadata not readable for ${!t0 ? token0 : token1} — amounts shown in base units`);
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
    async function fetchWalletHistory(walletIn, q = {}) {
        if (!isAddress(walletIn))
            throw makeChainError("INVALID_ADDRESS", `invalid wallet address: ${walletIn}`);
        await assertChain();
        const wallet = getAddress(walletIn);
        const notes = [];
        const latest = await latestBlock();
        const days = Math.min(Math.max(q.days ?? 30, 1), 365);
        const toBlock = Math.min(q.toBlock ?? latest, latest);
        const fromBlock = Math.max(NPM_DEPLOY_BLOCK, q.fromBlock ?? toBlock - Math.round((days * 86_400) / SEPOLIA_CHAIN.blockTimeSeconds));
        if (fromBlock >= toBlock)
            throw makeChainError("INVALID_RANGE", `bad block range ${fromBlock}–${toBlock}`);
        // 1) Current holdings (ERC721Enumerable).
        const held = new Set();
        const bal = Number(await call(() => client.readContract({ address: NPM, abi: NPM_ABI, functionName: "balanceOf", args: [wallet] })));
        const MAX_HELD = 200;
        if (bal > MAX_HELD)
            notes.push(`wallet holds ${bal} position NFTs; only the first ${MAX_HELD} are analysed`);
        const heldIds = await pool(Array.from({ length: Math.min(bal, MAX_HELD) }, (_, i) => i), conc, (i) => call(() => client.readContract({ address: NPM, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [wallet, BigInt(i)] })));
        heldIds.forEach((id) => held.add(Number(id)));
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
            tx: l.transactionHash,
            from: topicToAddr(l.topics[1]),
            to: topicToAddr(l.topics[2]),
            tokenId: Number(BigInt(l.topics[3])),
        }))
            .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
        const ids = new Set([...held, ...transfers.map((t) => t.tokenId)]);
        if (ids.size === 0) {
            throw makeChainError("NO_EVENTS", `no Uniswap V3 positions found for ${wallet} on Sepolia in blocks ${fromBlock}–${toBlock} (wallet holds no position NFTs and none were transferred in the window)`);
        }
        // Ownership intervals per token (owned by wallet between [start, end)).
        const intervals = new Map();
        const firstSeen = new Map();
        for (const id of ids) {
            const ts = transfers.filter((t) => t.tokenId === id);
            const iv = [];
            // Owned at window start iff the first in-window transfer is FROM the wallet,
            // or there are no transfers and the wallet holds it now.
            let ownedFrom = (ts.length && ts[0].from === wallet) || (!ts.length && held.has(id)) ? fromBlock : null;
            for (const t of ts) {
                if (t.to === wallet)
                    ownedFrom = t.block;
                if (t.from === wallet && ownedFrom != null) {
                    iv.push({ start: ownedFrom, end: t.block });
                    ownedFrom = null;
                }
            }
            if (ownedFrom != null)
                iv.push({ start: ownedFrom, end: toBlock + 1 });
            intervals.set(id, iv);
            const mint = ts.find((t) => t.from === ZERO_ADDRESS);
            firstSeen.set(id, mint ? mint.block : fromBlock);
        }
        // 3) Lifecycle logs for every discovered tokenId (topic-OR, batched ids).
        const idList = [...ids];
        const lifecycle = [];
        for (let i = 0; i < idList.length; i += 50) {
            const batch = idList.slice(i, i + 50).map(topicUint);
            const start = Math.min(...idList.slice(i, i + 50).map((id) => firstSeen.get(id) ?? fromBlock));
            lifecycle.push(...(await getLogsChunked({ address: NPM, topics: [[SEL.IncreaseLiquidity, SEL.DecreaseLiquidity, SEL.Collect], batch] }, Math.max(start, fromBlock), toBlock)));
        }
        // 4) Position metadata (batched).
        const burnBlockOf = new Map();
        for (const t of transfers)
            if (t.to === ZERO_ADDRESS)
                burnBlockOf.set(t.tokenId, t.block);
        const minted = new Set(transfers.filter((t) => t.from === ZERO_ADDRESS).map((t) => t.tokenId));
        const positions = await resolvePositions(idList, burnBlockOf, minted, notes);
        const metas = Object.values(positions);
        const partial = metas.filter((m) => m && !m.historyComplete).length;
        if (partial)
            notes.push(`${partial} position(s) were opened before the window — their earlier history is outside the observed range`);
        // 5) Build IR events (ownership-filtered, MINT merged with its IncreaseLiquidity).
        const owned = (id, block) => (intervals.get(id) ?? []).some((iv) => block >= iv.start && block < iv.end);
        const mintTx = new Map(); // `${tx}:${tokenId}` → mint transfer block
        const events = [];
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
            }
            else if (t.to === ZERO_ADDRESS) {
                events.push({ ...base, kind: "BURN" });
            }
            else {
                events.push({ ...base, kind: "TRANSFER" });
            }
        }
        const decoded = lifecycle
            .filter((l) => l.blockNumber != null && l.topics.length >= 2)
            .map((l) => {
            const data = l.data.slice(2);
            const word = (i) => BigInt(`0x${data.slice(i * 64, i * 64 + 64)}`);
            const sel = l.topics[0];
            const tokenId = Number(BigInt(l.topics[1]));
            const block = Number(l.blockNumber);
            if (sel === SEL.Collect) {
                return { kind: "COLLECT", tokenId, block, logIndex: Number(l.logIndex), tx: l.transactionHash, liquidity: 0n, a0: word(1), a1: word(2), recipient: getAddress(`0x${data.slice(24, 64)}`) };
            }
            return {
                kind: sel === SEL.IncreaseLiquidity ? "INCREASE" : "DECREASE",
                tokenId,
                block,
                logIndex: Number(l.logIndex),
                tx: l.transactionHash,
                liquidity: word(0),
                a0: word(1),
                a1: word(2),
                recipient: undefined,
            };
        })
            .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
        // Principal owed from decreases (V3 credits tokensOwed; Collect transfers principal + fees).
        const owed = new Map();
        for (const d of decoded) {
            if (!owned(d.tokenId, d.block))
                continue;
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
            }
            else if (d.kind === "DECREASE") {
                const o = owed.get(d.tokenId) ?? { t0: 0n, t1: 0n };
                owed.set(d.tokenId, { t0: o.t0 + d.a0, t1: o.t1 + d.a1 });
                events.push({ ...common, kind: "DECREASE", liquidityDelta: d.liquidity, amount0: d.a0, amount1: d.a1, fee0: 0n, fee1: 0n });
            }
            else {
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
        for (const e of events)
            e.timestamp = tsMap.get(e.block) ?? 0;
        const txs = [...new Set(events.map((e) => e.tx))];
        const MAX_RECEIPTS = 300;
        if (txs.length > MAX_RECEIPTS)
            notes.push(`gas read for the first ${MAX_RECEIPTS} of ${txs.length} transactions`);
        const receipts = new Map();
        await pool(txs.slice(0, MAX_RECEIPTS), conc, async (h) => {
            try {
                const r = await call(() => client.getTransactionReceipt({ hash: h }));
                receipts.set(h, { gasUsed: r.gasUsed.toString(), effectiveGasPrice: (r.effectiveGasPrice ?? 0n).toString() });
            }
            catch {
                /* gas left undefined — never estimated */
            }
        });
        for (const e of events) {
            const r = receipts.get(e.tx);
            if (r)
                Object.assign(e, r);
        }
        if (events.length === 0) {
            throw makeChainError("NO_EVENTS", `wallet ${wallet} holds ${held.size} position NFT(s) but had no position activity in blocks ${fromBlock}–${toBlock}; widen the window`);
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
    async function fetchPoolPriceSeries(poolAddr, fromBlock, toBlock, opts) {
        if (!isAddress(poolAddr))
            throw makeChainError("INVALID_ADDRESS", `invalid pool address: ${poolAddr}`);
        await assertChain();
        const maxSwaps = opts.maxSwaps ?? 5_000;
        const logs = await getLogsChunked({ address: getAddress(poolAddr), topics: [SEL.Swap] }, fromBlock, toBlock);
        const sorted = logs
            .filter((l) => l.blockNumber != null)
            .sort((a, b) => Number(a.blockNumber - b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
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
        // Timestamps: exact for up to 24 anchor blocks, linear interpolation between them.
        const anchorsWanted = new Set([fromBlock, toBlock]);
        if (raw.length) {
            const step = Math.max(1, Math.floor(raw.length / 22));
            for (let i = 0; i < raw.length; i += step)
                anchorsWanted.add(raw[i].block);
            anchorsWanted.add(raw[raw.length - 1].block);
        }
        const ts = await blockTimestamps([...anchorsWanted]);
        const anchors = [...anchorsWanted].sort((a, b) => a - b).map((b) => [b, ts.get(b)]);
        const interp = (b) => {
            const exact = ts.get(b);
            if (exact != null)
                return exact;
            let lo = anchors[0];
            let hi = anchors[anchors.length - 1];
            for (const a of anchors) {
                if (a[0] <= b)
                    lo = a;
                if (a[0] >= b) {
                    hi = a;
                    break;
                }
            }
            if (hi[0] === lo[0])
                return lo[1];
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
    /** Recently active EOA liquidity providers (by mint count), found live from NPM logs. */
    async function findActiveLpWallets(n = 5, lookbackBlocks = 50_000) {
        await assertChain();
        const latest = await latestBlock();
        const logs = await getLogsChunked({ address: NPM, topics: [SEL.Transfer, topicAddr(ZERO_ADDRESS), null, null] }, latest - lookbackBlocks, latest);
        const agg = new Map();
        for (const l of logs) {
            if (l.topics.length !== 4)
                continue;
            const to = topicToAddr(l.topics[2]);
            const a = agg.get(to) ?? { mints: 0, lastBlock: 0 };
            a.mints++;
            a.lastBlock = Math.max(a.lastBlock, Number(l.blockNumber));
            agg.set(to, a);
        }
        const ranked = [...agg.entries()].sort((a, b) => b[1].mints - a[1].mints).slice(0, n * 3);
        const out = [];
        for (const [w, a] of ranked) {
            const code = await call(() => client.getCode({ address: w }));
            if (!code || code === "0x")
                out.push({ wallet: w, ...a }); // EOAs only (people, not router contracts)
            if (out.length >= n)
                break;
        }
        return out;
    }
    /* ---------------- probes + misc reads ---------------- */
    async function probeCode(address) {
        const code = await call(() => client.getCode({ address: address }));
        const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
        return { hasCode: bytes > 0, bytes };
    }
    async function poolState(poolAddr) {
        const [slot0, liquidity] = await Promise.all([
            call(() => client.readContract({ address: poolAddr, abi: POOL_ABI, functionName: "slot0" })),
            call(() => client.readContract({ address: poolAddr, abi: POOL_ABI, functionName: "liquidity" })),
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
