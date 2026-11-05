/**
 * TRACE API + worker entrypoint.
 *
 *   DATABASE_URL  postgres connection string
 *   REDIS_URL     bullmq/ioredis connection (host:port form via URL)
 *   PORT          default 4000
 *
 * The same process runs the Queue, the Worker, and the Express API —
 * a single deployable for the hackathon; split into api/ and worker/
 * containers later by exporting the two factories.
 *
 * Queue backend selection:
 *   - Redis reachable  → BullMQ (durable, default)
 *   - Redis unreachable → in-memory queue in this process, clearly labelled
 *     (`queue: "in-memory"` in /health + startup log). No durability: a
 *     restart loses queued jobs. The capability is declared, not implied.
 */

import net from "node:net";
import { createApi } from "./api.js";
import { Db } from "./db.js";
import {
  createPipelineQueue,
  startPipelineWorker,
  createInMemoryPipelineQueue,
} from "./worker.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const port = Number(process.env.PORT ?? 4000);

const redisConn = new URL(redisUrl);
const connection = {
  host: redisConn.hostname || "localhost",
  port: redisConn.port ? Number(redisConn.port) : 6379,
};

/** Probe the Redis port; resolve(true) only if the TCP connect succeeds. */
function redisReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: connection.host, port: connection.port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(1500, () => done(false));
  });
}

async function main() {
  const db = new Db({ connectionString: databaseUrl ?? "postgres://postgres:postgres@localhost:5432/trace" });

  // Verify the schema is loaded before accepting traffic.
  try {
    await db.query<{ ok: boolean }>(`select 1 as ok`);
  } catch (err) {
    console.error("[trace] database unavailable — starting API with persistence disabled is not supported. Run db/schema.sql first.", (err as Error).message);
    process.exit(1);
  }

  const pipelineCfg = {
    // 0G / storage / world credentials come from env; without them the
    // pipeline runs the deterministic + labelled-demo paths (by design).
    zeroG: process.env.ZERO_G_ENDPOINT
      ? { endpoint: process.env.ZERO_G_ENDPOINT, apiKey: process.env.ZERO_G_API_KEY }
      : undefined,
    zeroGStorage: process.env.ZERO_G_STORAGE_ENDPOINT
      ? { endpoint: process.env.ZERO_G_STORAGE_ENDPOINT, apiKey: process.env.ZERO_G_STORAGE_KEY }
      : undefined,
    world: {
      worldId: process.env.WORLD_DEMO_ID ?? "0x…demo",
      demoKey: process.env.WORLD_DEMO_KEY ?? "trace-demo-key",
    },
  };

  // Choose the queue backend; report the choice explicitly.
  let queue: ReturnType<typeof createPipelineQueue> | ReturnType<typeof createInMemoryPipelineQueue>;
  let queueBackend: "bullmq" | "in-memory";
  if (await redisReachable()) {
    queue = createPipelineQueue(connection);
    startPipelineWorker(connection, db, pipelineCfg);
    queueBackend = "bullmq";
    console.log(`[trace] queue backend: BullMQ @ ${connection.host}:${connection.port}`);
  } else {
    queue = createInMemoryPipelineQueue(db, pipelineCfg);
    queueBackend = "in-memory";
    console.warn(`[trace] Redis unreachable at ${connection.host}:${connection.port} — queue backend: in-memory (same process, no durability; /health reports this). Start Redis for the durable BullMQ path.`);
  }

  const app = createApi({
    db,
    queue,
    queueBackend,
    worldCfg: {
      worldId: process.env.WORLD_DEMO_ID ?? "0x…demo",
      demoKey: process.env.WORLD_DEMO_KEY,
    },
    demoKey: process.env.WORLD_DEMO_KEY,
  });

  app.listen(port, () => {
    console.log(`[trace] api+worker listening on :${port} (queue: ${queueBackend})`);
    if (process.env.TRACE_RPC_URL) {
      console.log(`[trace] RPC configured: ${maskUrl(process.env.TRACE_RPC_URL)} — live chain reads enabled`);
    } else {
      console.warn("[trace] TRACE_RPC_URL not set — live chain reads unavailable; investigations fail with RPC_UNREACHABLE unless the request passes rpcUrl");
    }
  });
}

/** Log an RPC URL without leaking the API key (host/path only). */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "<rpc>";
  }
}

main().catch((err) => {
  console.error("[trace] fatal:", err);
  process.exit(1);
});
