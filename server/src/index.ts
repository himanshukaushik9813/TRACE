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

async function main() {
  const { config, checks, fatal } = loadConfig();
  printConfigReport(checks, fatal);
  if (fatal.length) process.exit(1);

  const db = new Db({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
  try {
    const p = await db.ping();
    console.log(`[trace] database ok (migrations: ${p.migrations.join(", ") || "none"})`);
  } catch (err) {
    console.error("[trace] database unavailable or not migrated — run `npm run db:migrate`:", (err as Error).message);
    process.exit(1);
  }

  const queue = (await redisReachable(config.redisUrl)) ? createBullQueue(config, db) : createInMemoryQueue(config, db);
  console.log(`[trace] queue backend: ${queue.backend}${queue.backend === "in-memory" ? " (Redis unreachable — no job durability)" : ""}`);

  const app = createApi({ db, queue, cfg: config });
  app.listen(config.port, () => {
    console.log(`[trace] API listening on :${config.port} — Ethereum Sepolia (${config.chainId})`);
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
