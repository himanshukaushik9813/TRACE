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
import { InvestigationCancelled, runInvestigation } from "./pipeline.js";
export const QUEUE_NAME = "trace-investigations";
export function redisConnection(url) {
    return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });
}
export async function redisReachable(url) {
    if (!url)
        return false;
    const r = redisConnection(url);
    try {
        await r.connect();
        return (await r.ping()) === "PONG";
    }
    catch {
        return false;
    }
    finally {
        r.disconnect();
    }
}
async function guarded(job, db, cfg) {
    try {
        await runInvestigation(job, db, cfg);
    }
    catch (err) {
        if (err instanceof InvestigationCancelled) {
            console.log(`[worker] investigation ${job.investigationId} cancelled; stopped at a stage boundary`);
            return;
        }
        const msg = String(err?.message ?? err).slice(0, 500);
        console.error(`[worker] investigation ${job.investigationId} failed:`, msg);
        await db.setStatus(job.investigationId, "failed", { errorCode: "PIPELINE_ERROR" }, `PIPELINE_ERROR: ${msg}`).catch(() => { });
    }
}
export function createBullQueue(cfg, db) {
    const queue = new Queue(QUEUE_NAME, {
        connection: redisConnection(cfg.redisUrl),
        defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    });
    const worker = new Worker(QUEUE_NAME, async (job) => guarded(job.data, db, cfg), {
        connection: redisConnection(cfg.redisUrl),
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
            // Idempotent: a job already in the queue (durable across restarts) is kept, not re-added.
            const existing = await queue.getJob(job.investigationId);
            if (existing)
                return;
            await queue.add("investigate", job, { jobId: job.investigationId });
        },
        cancel: async (id) => {
            const j = await queue.getJob(id);
            if (!j)
                return "absent";
            if ((await j.isWaiting()) || (await j.isDelayed())) {
                await j.remove();
                return "removed";
            }
            return (await j.isActive()) ? "running" : "absent";
        },
    };
}
export function createInMemoryQueue(cfg, db) {
    const pending = [];
    const active = new Set();
    let running = 0;
    const pump = () => {
        while (running < 2 && pending.length) {
            const job = pending.shift();
            running++;
            active.add(job.investigationId);
            void guarded(job, db, cfg).finally(() => {
                running--;
                active.delete(job.investigationId);
                pump();
            });
        }
    };
    return {
        backend: "in-memory",
        add: async (job) => {
            if (active.has(job.investigationId) || pending.some((p) => p.investigationId === job.investigationId))
                return;
            pending.push(job);
            pump();
        },
        cancel: async (id) => {
            const i = pending.findIndex((p) => p.investigationId === id);
            if (i >= 0) {
                pending.splice(i, 1);
                return "removed";
            }
            return active.has(id) ? "running" : "absent";
        },
    };
}
