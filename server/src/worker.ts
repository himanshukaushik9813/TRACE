/**
 * Job queue for investigations.
 *
 *   - BullMQ on Redis (default, durable). The Upstash URL is `rediss://` (TLS +
 *     password), so the connection is an ioredis client built from the FULL
 *     URL — never a host/port pair that silently drops TLS and auth.
 *   - In-process FIFO fallback when Redis is unreachable, reported as
 *     "in-memory" in /health and /integrations.
 */

import { Queue, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { runInvestigation, type InvestigationJob } from "./pipeline.js";
import type { Db } from "./db.js";
import type { TraceConfig } from "./config.js";

export const QUEUE_NAME = "trace-investigations";

export type InvestigationQueue = { add: (job: InvestigationJob) => Promise<void>; backend: "bullmq" | "in-memory" };

export function redisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });
}

export async function redisReachable(url: string | null): Promise<boolean> {
  if (!url) return false;
  const r = redisConnection(url);
  try {
    await r.connect();
    return (await r.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    r.disconnect();
  }
}

async function guarded(job: InvestigationJob, db: Db, cfg: TraceConfig) {
  try {
    await runInvestigation(job, db, cfg);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    console.error(`[worker] investigation ${job.investigationId} failed:`, msg);
    await db.setStatus(job.investigationId, "failed", { errorCode: "PIPELINE_ERROR" }, `PIPELINE_ERROR: ${msg}`).catch(() => {});
  }
}

export function createBullQueue(cfg: TraceConfig, db: Db): InvestigationQueue {
  const queue = new Queue<InvestigationJob>(QUEUE_NAME, {
    connection: redisConnection(cfg.redisUrl!),
    defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
  });
  const worker = new Worker<InvestigationJob>(QUEUE_NAME, async (job) => guarded(job.data, db, cfg), {
    connection: redisConnection(cfg.redisUrl!),
    concurrency: 2,
    // Investigations spend minutes in rate-limited RPC reads. A short lock lets
    // BullMQ mark the job "stalled" and run it twice; never re-run a job — a
    // crashed run is marked failed by guarded()/the stale check instead.
    lockDuration: 15 * 60_000,
    stalledInterval: 5 * 60_000,
    maxStalledCount: 0,
    // Upstash bills per command: poll an empty queue slowly.
    drainDelay: 30,
  });
  worker.on("error", (err) => console.error("[worker] bullmq error:", err.message));
  return {
    backend: "bullmq",
    add: async (job) => {
      await queue.add("investigate", job, { jobId: job.investigationId });
    },
  };
}

export function createInMemoryQueue(cfg: TraceConfig, db: Db): InvestigationQueue {
  const pending: InvestigationJob[] = [];
  let running = 0;
  const pump = () => {
    while (running < 2 && pending.length) {
      const job = pending.shift()!;
      running++;
      void guarded(job, db, cfg).finally(() => {
        running--;
        pump();
      });
    }
  };
  return {
    backend: "in-memory",
    add: async (job) => {
      pending.push(job);
      pump();
    },
  };
}
