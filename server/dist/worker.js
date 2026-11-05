/**
 * BullMQ worker: runs the deterministic pipeline as a background job.
 *
 * Job shape:
 *   {
 *     wallet,
 *     events?: V3Event[],      // supplied when already fetched
 *     rpcUrl?,
 *     priceSeries?,
 *     observedRange?,
 *     db: investigationId      // the investigations row to update
 *   }
 *
 * The worker is the *only* place a job failure turns into a `failed`
 * investigation row; API requests return the investigation id immediately
 * and the client polls it (GET /investigations/:id).
 *
 * Two queue backends exist:
 *   - BullMQ (Redis) — the default, durable path.
 *   - createInMemoryPipelineQueue — a same-process fallback used when Redis
 *     is unreachable (index.ts probes on boot). It runs the identical
 *     runPipelineJob body so behaviour never depends on the backend; the
 *     trade-off (no durability, no cross-process workers) is labelled in
 *     /health and the startup log — never implied away.
 */
import { Queue, Worker, QueueEvents } from "bullmq";
import { createTraceClient, makeChainError } from "@trace/chain-data";
import { runPipeline } from "./pipeline.js";
export const QUEUE_NAME = "trace-pipeline";
/**
 * The pipeline job body, shared by the BullMQ worker and the in-memory
 * queue. Keeping it in one place guarantees both backends run identical
 * reconstruction + persistence semantics.
 */
export async function runPipelineJob(data, db, cfg) {
    const { wallet, investigationId } = data;
    await db.setInvestigationStatus(investigationId, "reconstructing");
    // 1) Events: supplied, or fetched live. A live fetch failure falls
    //    back to the caller-supplied events (the labelled fixture) and the
    //    investigation's source is recorded as demo_fixture.
    let events;
    let source = "live";
    if (data.events) {
        events = data.events;
        source = "demo_fixture"; // caller-supplied = labelled fixture
    }
    else {
        try {
            if (!data.rpcUrl)
                throw makeChainError("RPC_UNREACHABLE", "no RPC endpoint configured");
            const client = createTraceClient({ rpcUrl: data.rpcUrl });
            events = await client.fetchV3Events(wallet, { fromBlock: data.fromBlock, toBlock: data.toBlock });
        }
        catch (err) {
            if (!data.events) {
                await db.setInvestigationStatus(investigationId, "failed", `no live events and no fallback: ${err.message}`);
                throw err;
            }
            events = data.events;
            source = "demo_fixture";
        }
    }
    // 2) Deterministic pipeline.
    const result = await runPipeline({
        events,
        wallet,
        cfg: {
            ...cfg,
            priceSeries: data.priceSeries,
            observedRange: data.observedRange,
        },
    });
    // 3) Persist under the investigation row the API created. Postgres is
    //    the source of record the UI reads back; if it's down the job
    //    still resolves with the in-memory result and the API surfaces the
    //    outage honestly (no silent degradation of the UI).
    try {
        await db.updateInvestigationResult(investigationId, {
            source,
            eventsFingerprint: result.reconstruction.eventsFingerprint,
            summary: result.reconstruction,
            periodFromTs: result.reconstruction.period.fromTs,
            periodToTs: result.reconstruction.period.toTs,
        });
        await db.insertEvents(investigationId, events);
        const strategyId = await db.insertStrategy(investigationId, result.strategy, result.strategy.id, result.strategyVersionHash, result.strategy.family, result.strategy.confidence, result.strategy.source.provider);
        if (result.backtest)
            await db.insertBacktest(strategyId, result.backtest);
        if (result.program && result.compatibility) {
            await db.insertProgram(strategyId, result.program, result.compatibility);
        }
        await db.insertArchives(investigationId, result.archives);
        await db.setInvestigationStatus(investigationId, "done");
    }
    catch (dbErr) {
        console.error("[worker] persistence unavailable, resolving with result only:", dbErr.message);
    }
    return {
        investigationId,
        source,
        degraded: result.degraded,
        degradedSteps: result.degradedSteps,
        result,
    };
}
/** Default backend: durable jobs on Redis via BullMQ. */
export function startPipelineWorker(connection, db, cfg) {
    const worker = new Worker(QUEUE_NAME, async (job) => runPipelineJob(job.data, db, cfg), { connection: { host: connection.host, port: connection.port } });
    worker.on("failed", async (job, err) => {
        if (job?.data.investigationId) {
            await db.setInvestigationStatus(job.data.investigationId, "failed", err.message).catch(() => { });
        }
    });
    return worker;
}
export function createPipelineQueue(connection) {
    return new Queue(QUEUE_NAME, {
        connection: { host: connection.host, port: connection.port },
        defaultJobOptions: {
            attempts: 2,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: 200,
            removeOnFail: 500,
        },
    });
}
/**
 * Fallback backend: an in-process FIFO queue running the same
 * runPipelineJob body. No durability — a process restart loses queued
 * jobs, and there is no cross-process scaling. index.ts reports
 * `queue: "in-memory"` in /health so the degraded capability is visible,
 * not implied.
 */
export function createInMemoryPipelineQueue(db, cfg) {
    const pending = [];
    let draining = false;
    async function drain() {
        if (draining)
            return;
        draining = true;
        try {
            for (;;) {
                const entry = pending.shift();
                if (!entry)
                    break;
                try {
                    await runPipelineJob(entry.data, db, cfg);
                }
                catch (err) {
                    if (entry.retries < 1 && entry.data.investigationId) {
                        // one retry, mirroring BullMQ's defaultJobOptions.attempts: 2
                        entry.retries += 1;
                        pending.push(entry);
                    }
                    else {
                        if (entry.data.investigationId) {
                            await db.setInvestigationStatus(entry.data.investigationId, "failed", err.message).catch(() => { });
                        }
                    }
                }
            }
        }
        finally {
            draining = false;
            if (pending.length > 0)
                void drain(); // work arrived mid-drain
        }
    }
    return {
        add: async (_jobId, data) => {
            pending.push({ data, retries: 0 });
            void drain();
        },
        backend: "in-memory",
    };
}
export function investigationEvents(connection) {
    return new QueueEvents(QUEUE_NAME, { connection: { host: connection.host, port: connection.port } });
}
