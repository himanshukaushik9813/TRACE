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
/** Default queue name (local dev). Deployments set TRACE_QUEUE_NAME so they never share jobs with a dev machine on the same Redis. */
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
/**
 * What to do when an investigation is (re-)queued and BullMQ already holds a job
 * with its id. Jobs waiting to run are kept (idempotent add). A finished
 * (completed/failed) job will never run again, so a fresh job is needed. With
 * `recover` (boot), an "active" job belongs to the process that died: its lock
 * runs out and the stall check marks it failed without re-running it
 * (maxStalledCount 0), so a fresh job is needed too.
 */
export function requeueDecision(state, recover) {
    if (!state || state === "unknown")
        return "add";
    if (["waiting", "delayed", "prioritized", "waiting-children"].includes(state))
        return "keep";
    if (state === "active")
        return recover ? "add-new-id" : "keep";
    return "add-new-id";
}
async function guarded(job, db, cfg) {
    try {
        await runInvestigation(job, db, cfg);
        console.log(`[worker] investigation ${job.investigationId} finished (queue ${cfg.queueName})`);
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
    const queue = new Queue(cfg.queueName, {
        connection: redisConnection(cfg.redisUrl),
        defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    });
    const worker = new Worker(cfg.queueName, async (job) => guarded(job.data, db, cfg), {
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
    /** investigation id → its current BullMQ job id (differs after a recovery re-queue). */
    const jobIds = new Map();
    return {
        backend: "bullmq",
        add: async (job, opts) => {
            const id = job.investigationId;
            const existing = await queue.getJob(jobIds.get(id) ?? id);
            const decision = requeueDecision(existing ? await existing.getState() : null, Boolean(opts?.recover));
            if (decision === "keep")
                return;
            const jobId = decision === "add" ? id : `${id}-r${Date.now()}`;
            jobIds.set(id, jobId);
            await queue.add("investigate", job, { jobId });
        },
        cancel: async (id) => {
            const j = await queue.getJob(jobIds.get(id) ?? id);
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
