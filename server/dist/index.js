/**
 * TRACE API + worker entrypoint (single deployable).
 *
 *   node --env-file=.env.local server/dist/index.js
 *
 * Startup: validate config (refuses non-Sepolia), check the database schema,
 * pick the queue backend (BullMQ over TLS Redis, else in-process), warm the
 * integration probes, then listen.
 */
import { createApi } from "./api.js";
import { Db } from "./db.js";
import { loadConfig, printConfigReport } from "./config.js";
import { createBullQueue, createInMemoryQueue, redisReachable } from "./worker.js";
import { integrationSnapshot } from "./integrations.js";
import { Redis as IORedis } from "ioredis";
import { setPersistentChainCache } from "@trace/chain-data";
async function main() {
    const { config, checks, fatal } = loadConfig();
    printConfigReport(checks, fatal);
    if (fatal.length)
        process.exit(1);
    // Reach the database: try the pooler (DATABASE_URL) then the direct host
    // (DATABASE_URL_DIRECT), each with a few retries and backoff — Supabase
    // resolves intermittently (EAI_AGAIN) and one failed ping at boot must not
    // take the whole API down.
    const candidates = [config.databaseUrl, ...(config.databaseUrlFallback ? [config.databaseUrlFallback] : [])];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let db = null;
    outer: for (const url of candidates) {
        for (let attempt = 1; attempt <= 5; attempt++) {
            const candidate = new Db({ connectionString: url, ssl: config.databaseSsl });
            try {
                const p = await candidate.ping();
                db = candidate;
                console.log(`[trace] database ok (${url === config.databaseUrl ? "pooler" : "direct host"}; migrations: ${p.migrations.join(", ") || "none"})`);
                break outer;
            }
            catch (err) {
                const msg = err.message;
                console.error(`[trace] database ${url === config.databaseUrl ? "pooler" : "direct"} ping ${attempt}/5 failed:`, msg);
                await candidate.close().catch(() => { });
                if (/schema_migrations|relation .* does not exist/i.test(msg))
                    break outer; // not migrated — retrying is pointless
                if (attempt < 5)
                    await sleep(3_000 * attempt);
            }
        }
    }
    if (!db) {
        console.error("[trace] database unavailable on all configured URLs — check your internet/VPN and restart, or run `npm run db:migrate` if not migrated yet");
        process.exit(1);
    }
    const redisUp = await redisReachable(config.redisUrl);
    const queue = redisUp ? createBullQueue(config, db) : createInMemoryQueue(config, db);
    // Recovery: a run still mid-pipeline when the previous process stopped was cut off
    // mid-way, but everything is idempotent (raw_events keyed by tx/log, strategies by
    // ir_id, etc.), so the job finishes cleanly when re-run.
    //   - in-memory queue: the in-flight work is genuinely gone — re-queue it now.
    //   - BullMQ queue: a job still waiting in Redis is kept; one left "active" by the dead
    //     process (or already failed) is replaced by a fresh job (see requeueDecision).
    const interrupted = await db.requeueInterrupted();
    if (interrupted.length) {
        for (const inv of interrupted)
            await queue
                .add({ investigationId: inv.id, wallet: inv.wallet, days: inv.days ?? 30 }, { recover: true })
                .catch((err) => console.error(`[trace] failed to re-queue interrupted ${inv.id}:`, err.message));
        console.log(`[trace] re-queued ${interrupted.length} interrupted investigation(s)`);
    }
    if (redisUp && config.redisUrl) {
        // Finalized Sepolia log chunks are immutable: keep them in Redis so repeat
        // investigations (and shared pool swap history) skip the RPC entirely.
        const cache = new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, commandTimeout: 2_000, enableOfflineQueue: false });
        cache.on("error", () => undefined);
        setPersistentChainCache({
            get: (k) => cache.get(k),
            set: async (k, v) => {
                await cache.set(k, v, "EX", 30 * 86_400);
            },
        });
        console.log("[trace] chain log cache: memory + Redis (finalized chunks only)");
    }
    console.log(`[trace] queue backend: ${queue.backend}${queue.backend === "in-memory" ? " (Redis unreachable — no job durability)" : ""}`);
    const app = createApi({ db, queue, cfg: config });
    const server = app.listen(config.port, () => {
        console.log(`[trace] API listening on :${config.port} — Ethereum Sepolia (${config.chainId})`);
        // Warm the live "suggested LP wallets" scan so the first visitor doesn't wait on it.
        fetch(`http://127.0.0.1:${config.port}/wallets/suggested`)
            .then((r) => console.log(`[trace] suggested LP wallets ${r.ok ? "cached" : `scan failed (${r.status})`}`))
            .catch(() => console.warn("[trace] suggested LP wallets warm-up failed"));
        integrationSnapshot(config, db, queue.backend, true)
            .then((s) => {
            for (const i of s.integrations)
                console.log(`[trace]   ${i.status.padEnd(30)} ${i.label}`);
        })
            .catch((err) => console.error("[trace] integration probe failed:", err.message));
    });
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`[trace] port ${config.port} is already in use — a previous TRACE server is still running.`);
            console.error(`[trace] stop it: lsof -ti :${config.port} | xargs kill  (or Ctrl+C that other terminal), then re-run: npm run start:server`);
        }
        else {
            console.error("[trace] server error:", err.message);
        }
        process.exit(1);
    });
}
main().catch((err) => {
    console.error("[trace] fatal:", err?.message ?? err);
    process.exit(1);
});
