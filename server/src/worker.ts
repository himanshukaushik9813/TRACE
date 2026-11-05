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
import type { V3Event } from "@trace/strategy-ir";
import { runPipeline, type PipelineConfig, type PipelineResult } from "./pipeline.js";
import type { Db } from "./db.js";

export const QUEUE_NAME = "trace-pipeline";

export type PipelineJob = {
  wallet: string;
  investigationId: string;
  events?: V3Event[];
  rpcUrl?: string;
  /** Observation window for the live fetch (days back from latest block). */
  days?: number;
  fromBlock?: number;
  toBlock?: number;
  priceSeries?: PipelineConfig["priceSeries"];
  observedRange?: PipelineConfig["observedRange"];
};

/**
 * The minimal queue surface the API needs. Both the BullMQ queue and the
 * in-memory fallback satisfy it (and the test stub does too) — keep it
 * narrow so a new backend never ripples into api.ts.
 */
export type PipelineQueue = {
  add: (name: string, data: PipelineJob, opts?: { jobId?: string }) => Promise<unknown>;
};

export type PipelineJobOutcome = {
  investigationId: string;
  source: "live" | "demo_fixture";
  degraded: boolean;
  degradedSteps: string[];
  result: PipelineResult;
};

/**
 * The pipeline job body, shared by the BullMQ worker and the in-memory
 * queue. Keeping it in one place guarantees both backends run identical
 * reconstruction + persistence semantics.
 */
export async function runPipelineJob(
  data: PipelineJob,
  db: Db,
  cfg?: PipelineConfig,
): Promise<PipelineJobOutcome> {
  const { wallet, investigationId } = data;
  await db.setInvestigationStatus(investigationId, "reconstructing");

  // 1) Events: supplied by the caller, or fetched live from an RPC. Live
  //    reads prefer the per-request rpcUrl, else the server's TRACE_RPC_URL;
  //    with neither, the job fails — there is no silent fixture fallback.
  let events: V3Event[];
  let poolMeta: Record<string, { token0: string; token1: string; feeTier: number }> = {};
  let source: "live" | "demo_fixture" = "live";
  if (data.events) {
    events = data.events;
    source = "demo_fixture"; // explicit caller-supplied events (test/dev only)
  } else {
    const rpcUrl = data.rpcUrl || process.env.TRACE_RPC_URL;
    try {
      if (!rpcUrl) throw makeChainError("RPC_UNREACHABLE", "no RPC endpoint configured (set TRACE_RPC_URL on the server or pass rpcUrl per request)");
      const client = createTraceClient({ rpcUrl });
      const fetched = await client.fetchV3Events(wallet, {
        days: data.days,
        fromBlock: data.fromBlock,
        toBlock: data.toBlock,
      });
      events = fetched.events;
      poolMeta = fetched.poolMeta;
    } catch (err) {
      await db.setInvestigationStatus(investigationId, "failed", `live chain fetch failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // 2) Deterministic pipeline (real pool metadata feeds position reconstruction).
  const result = await runPipeline({
    events,
    wallet,
    poolMeta,
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
    const strategyId = await db.insertStrategy(
      investigationId,
      result.strategy,
      result.strategy.id,
      result.strategyVersionHash,
      result.strategy.family,
      result.strategy.confidence,
      result.strategy.source.provider,
    );
    if (result.backtest) await db.insertBacktest(strategyId, result.backtest);
    if (result.program && result.compatibility) {
      await db.insertProgram(strategyId, result.program, result.compatibility);
    }
    await db.insertArchives(investigationId, result.archives);
    await db.setInvestigationStatus(investigationId, "done");
  } catch (dbErr) {
    console.error("[worker] persistence unavailable, resolving with result only:", (dbErr as Error).message);
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
export function startPipelineWorker(
  connection: { host: string; port: number },
  db: Db,
  cfg?: PipelineConfig,
): Worker {
  const worker = new Worker<PipelineJob>(
    QUEUE_NAME,
    async (job) => runPipelineJob(job.data, db, cfg),
    { connection: { host: connection.host, port: connection.port } },
  );

  worker.on("failed", async (job, err) => {
    if (job?.data.investigationId) {
      await db.setInvestigationStatus(job.data.investigationId, "failed", err.message).catch(() => {});
    }
  });

  return worker;
}

export function createPipelineQueue(connection: { host: string; port: number }): Queue {
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
export function createInMemoryPipelineQueue(
  db: Db,
  cfg?: PipelineConfig,
): {
  add: (jobId: string, data: PipelineJob) => Promise<void>;
  backend: "in-memory";
} {
  type Entry = { data: PipelineJob; retries: number };
  const pending: Entry[] = [];
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const entry = pending.shift();
        if (!entry) break;
        try {
          await runPipelineJob(entry.data, db, cfg);
        } catch (err) {
          if (entry.retries < 1 && entry.data.investigationId) {
            // one retry, mirroring BullMQ's defaultJobOptions.attempts: 2
            entry.retries += 1;
            pending.push(entry);
          } else {
            if (entry.data.investigationId) {
              await db.setInvestigationStatus(entry.data.investigationId, "failed", (err as Error).message).catch(() => {});
            }
          }
        }
      }
    } finally {
      draining = false;
      if (pending.length > 0) void drain(); // work arrived mid-drain
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

export function investigationEvents(connection: { host: string; port: number }): QueueEvents {
  return new QueueEvents(QUEUE_NAME, { connection: { host: connection.host, port: connection.port } });
}
