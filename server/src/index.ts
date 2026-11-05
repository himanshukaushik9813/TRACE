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
  if (fatal.length) process.exit(1);

  const db = new Db({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
  try {
    const p = await db.ping();
    console.log(`[trace] database ok (migrations: ${p.migrations.join(", ") || "none"})`);
    // The API and worker are one process: anything still mid-pipeline at startup was cut off by the
    // previous process (restart/crash) and can never finish — say so instead of "running" forever.
    const stale = await db.query<{ id: string }>(
      `update investigations set status = 'failed', progress = progress || '{"errorCode":"INTERRUPTED"}'::jsonb,
              error = 'INTERRUPTED: the server restarted while this investigation was running — run it again', updated_at = now()
        where status not in ('done','no_positions','failed')
        returning id`,
    );
    if (stale.length) console.log(`[trace] marked ${stale.length} interrupted investigation(s) as failed`);
  } catch (err) {
    console.error("[trace] database unavailable or not migrated — run `npm run db:migrate`:", (err as Error).message);
    process.exit(1);
  }

  const redisUp = await redisReachable(config.redisUrl);
  const queue = redisUp ? createBullQueue(config, db) : createInMemoryQueue(config, db);
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
  app.listen(config.port, () => {
    console.log(`[trace] API listening on :${config.port} — Ethereum Sepolia (${config.chainId})`);
    // Warm the live "suggested LP wallets" scan so the first visitor doesn't wait on it.
    fetch(`http://127.0.0.1:${config.port}/wallets/suggested`)
      .then((r) => console.log(`[trace] suggested LP wallets ${r.ok ? "cached" : `scan failed (${r.status})`}`))
      .catch(() => console.warn("[trace] suggested LP wallets warm-up failed"));
    integrationSnapshot(config, db, queue.backend, true)
      .then((s) => {
        for (const i of s.integrations) console.log(`[trace]   ${i.status.padEnd(30)} ${i.label}`);
      })
      .catch((err) => console.error("[trace] integration probe failed:", err.message));
  });
}

main().catch((err) => {
  console.error("[trace] fatal:", err?.message ?? err);
  process.exit(1);
});
