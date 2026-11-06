/**
 * Runtime integration status — computed from live probes, never from build
 * constants. Each entry uses the honest labels from @trace/chain-config.
 */
import { PROBED_CONTRACTS, SEPOLIA_CHAIN_ID } from "@trace/chain-config";
import { createTraceClient } from "@trace/chain-data";
import { storageAccount, storageConfigured } from "@trace/zero-g-storage";
import { worldConfigured } from "@trace/world-auth";
let cache = null;
export async function integrationSnapshot(cfg, db, queueBackend, force = false) {
    if (!force && cache && Date.now() - cache.at < 120_000)
        return cache.snap;
    const now = new Date().toISOString();
    const r = (key, label, status, detail) => ({ key, label, status, detail, checkedAt: now });
    const out = [];
    // Chain + contracts.
    const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
    let chainOk = false;
    let latest = null;
    let chainErr;
    try {
        await chain.assertChain();
        latest = await chain.latestBlock();
        chainOk = true;
    }
    catch (err) {
        chainErr = err.message;
    }
    const contracts = await Promise.all(PROBED_CONTRACTS.map(async (c) => {
        if (!chainOk)
            return { key: c.key, label: c.label, address: c.ref.address, source: c.ref.source, hasCode: null, bytes: 0 };
        try {
            const p = await chain.probeCode(c.ref.address);
            return { key: c.key, label: c.label, address: c.ref.address, source: c.ref.source, hasCode: p.hasCode, bytes: p.bytes };
        }
        catch {
            return { key: c.key, label: c.label, address: c.ref.address, source: c.ref.source, hasCode: null, bytes: 0 };
        }
    }));
    const uni = contracts.filter((c) => c.key.startsWith("uniswap."));
    const aqua = contracts.filter((c) => c.key.startsWith("aqua."));
    out.push(r("sepolia", "Ethereum Sepolia RPC", chainOk ? "VERIFIED TESTNET" : "BLOCKED BY EXTERNAL DEPENDENCY", chainOk ? `chainId ${SEPOLIA_CHAIN_ID}, block ${latest}` : `RPC check failed: ${chainErr}`));
    out.push(r("uniswap", "Uniswap V3 (Sepolia) data", uni.every((c) => c.hasCode) ? "VERIFIED TESTNET" : "BLOCKED BY EXTERNAL DEPENDENCY", uni.map((c) => `${c.label}: ${c.hasCode ? "code present" : "NO CODE"}`).join("; ")));
    out.push(r("aqua", "1inch Aqua / SwapVM (Sepolia test deployment)", aqua.filter((c) => c.key !== "aqua.kycNft").every((c) => c.hasCode) ? "IMPLEMENTED BUT NOT VERIFIED" : "BLOCKED BY EXTERNAL DEPENDENCY", "Registry + AquaSwapVMRouter code present; ship/dock are signed by the user's wallet and verified from receipts. Status becomes VERIFIED TESTNET once a ship receipt is recorded. Swap (taker) requires the 1inch KycNFT."));
    const shipped = await db
        .query(`select count(*)::int n from transactions where op = 'ship' and status = 'success'`)
        .then((x) => x[0]?.n ?? 0)
        .catch(() => 0);
    if (shipped > 0)
        out[out.length - 1] = r("aqua", "1inch Aqua / SwapVM (Sepolia test deployment)", "VERIFIED TESTNET", `${shipped} successful ship transaction(s) recorded and verified on Sepolia`);
    // 0G inference.
    const zgRuns = await db
        .query(`select status, error_code, error from inference_runs order by created_at desc limit 1`)
        .catch(() => []);
    const lastRun = zgRuns[0];
    out.push(r("zerog_inference", "0G Private Computer (Router) inference", !cfg.zeroG.apiKey
        ? "BLOCKED BY EXTERNAL DEPENDENCY"
        : lastRun?.status === "succeeded"
            ? "VERIFIED LIVE"
            : lastRun
                ? "BLOCKED BY EXTERNAL DEPENDENCY"
                : "IMPLEMENTED BUT NOT VERIFIED", !cfg.zeroG.apiKey
        ? "ZERO_G_API_KEY not configured"
        : lastRun
            ? `last run: ${lastRun.status}${lastRun.error_code ? ` (${lastRun.error_code}: ${lastRun.error})` : ""}`
            : `configured (${cfg.zeroG.routerUrl}, model ${cfg.zeroG.model}); no run yet`));
    // 0G Storage.
    let storageDetail = "OG_STORAGE_PRIVATE_KEY not configured";
    let storageStatus = "BLOCKED BY EXTERNAL DEPENDENCY";
    if (storageConfigured(cfg.storage)) {
        try {
            const acct = await storageAccount(cfg.storage);
            const funded = acct && BigInt(acct.balanceWei) > 0n;
            const ok = await db.query(`select count(*)::int n from storage_artifacts where retrievable`).then((x) => x[0]?.n ?? 0).catch(() => 0);
            storageStatus = ok > 0 ? "VERIFIED TESTNET" : funded ? "IMPLEMENTED BUT NOT VERIFIED" : "BLOCKED BY EXTERNAL DEPENDENCY";
            storageDetail = `uploader ${acct?.address} on 0G Galileo, balance ${acct ? (Number(acct.balanceWei) / 1e18).toFixed(4) : "?"} 0G${funded ? "" : " — fund it at https://faucet.0g.ai"}; ${ok} verified upload(s)`;
        }
        catch (err) {
            storageDetail = `0G Galileo RPC check failed: ${err.message}`;
        }
    }
    out.push(r("zerog_storage", "0G Storage (Galileo testnet)", storageStatus, storageDetail));
    // Authorization.
    // VERIFIED TESTNET only once a real wallet signature has passed server verification
    // (same evidence rule as Aqua: a stored, validated authorization).
    const signed = await db
        .query(`select count(*)::int n from authorizations where validated`)
        .then((x) => x[0]?.n ?? 0)
        .catch(() => 0);
    out.push(signed > 0
        ? r("eip712", "Wallet authorization (EIP-712, server-verified)", "VERIFIED TESTNET", `${signed} wallet signature(s) verified by the server: signer, chain, expiry, single-use challenge, strategy version + plan hash.`)
        : r("eip712", "Wallet authorization (EIP-712, server-verified)", "IMPLEMENTED BUT NOT VERIFIED", "Verified per request: signature, signer, chain, expiry, single-use challenge, strategy version + plan hash. No wallet has signed yet."));
    {
        const verified = await db
            .query(`select count(*)::int n from authorizations where validated and world_status = 'verified'`)
            .then((x) => x[0]?.n ?? 0)
            .catch(() => 0);
        const configured = worldConfigured(cfg.world);
        out.push(r("world_id", `World ID 4.0 human authorization (${cfg.world.environment})`, !configured ? "BLOCKED BY EXTERNAL DEPENDENCY" : verified > 0 ? "VERIFIED TESTNET" : "IMPLEMENTED BUT NOT VERIFIED", !configured
            ? cfg.world.enforce
                ? `Not registered: protected execution (aqua:ship) is disabled until WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY are set (developer.world.org, World ID 4.0).`
                : "Not registered, and WORLD_ID_ENFORCE=false: ship is allowed WITHOUT a verified human."
            : verified > 0
                ? `${verified} authorization(s) verified by World's API (${cfg.world.environment}${cfg.world.environment === "staging" ? ", World ID simulator, not a real person" : ""}).`
                : `Configured (${cfg.world.environment}); no proof verified yet.`));
    }
    // Persistence.
    let dbDetail = "unreachable";
    let dbOk = false;
    try {
        const p = await db.ping();
        dbOk = true;
        dbDetail = `migrations: ${p.migrations.join(", ")}`;
    }
    catch (err) {
        dbDetail = err.message;
    }
    out.push(r("database", "Postgres (Supabase)", dbOk ? "VERIFIED LIVE" : "BLOCKED BY EXTERNAL DEPENDENCY", dbDetail));
    out.push(r("queue", "Job queue", queueBackend === "bullmq" ? "VERIFIED LIVE" : "IMPLEMENTED BUT NOT VERIFIED", queueBackend === "bullmq" ? "BullMQ on Redis (TLS)" : "in-process queue (Redis unavailable) — no durability"));
    const snap = { computedAt: now, chain: { chainId: SEPOLIA_CHAIN_ID, ok: chainOk, latestBlock: latest, error: chainErr }, contracts, integrations: out };
    cache = { at: Date.now(), snap };
    return snap;
}
