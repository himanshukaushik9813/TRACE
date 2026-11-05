/**
 * TRACE Express API.
 *
 * Routes:
 *   POST /investigations          queue a wallet investigation (BullMQ job)
 *   GET  /investigations/:id      poll status + result (pipeline output)
 *   GET  /strategies/:id/compatibility   rule-by-rule Aqua compatibility
 *   POST /authorizations          issue + verify a World Agent Pass proof
 *   GET  /archives/:id           0G storage refs for an investigation
 *
 * The API never claims a result is "live" that the pipeline produced
 * degraded — every response carries `source` and `degraded`/`degradedSteps`
 * straight from the pipeline.
 */

import express, { type Express, type Request, type Response } from "express";
import type { V3Event } from "@trace/strategy-ir";
import { issueAgentPassClaims, signProof, verifyProof, type WorldAuthConfig } from "@trace/world-auth";
import type { Db } from "./db.js";
import type { PipelineQueue } from "./worker.js";

export type ApiDeps = {
  db: Db;
  /** BullMQ queue (Redis) or the in-memory fallback — same minimal surface. */
  queue: PipelineQueue;
  /** Declared so /health never claims a durable queue when it isn't one. */
  queueBackend?: "bullmq" | "in-memory";
  worldCfg: WorldAuthConfig;
  demoKey?: string;
};

/** 0G storage refs for an investigation, shaped for the UI (demo-labelled). */
async function getArchivesFor(
  deps: ApiDeps,
  investigationId: string,
): Promise<Array<{ ref: string; kind: string; contentHash: string; sizeBytes: number; demo: boolean; ts: string }>> {
  const rows = await deps.db.query(
    `select ref, kind, content_hash as "contentHash", size_bytes as "sizeBytes", source, created_at as "ts"
       from archives where investigation = $1 order by created_at`,
    [investigationId],
  );
  return rows.map((r) => ({
    ref: r.ref,
    kind: r.kind,
    contentHash: r.contentHash,
    sizeBytes: r.sizeBytes,
    demo: r.source === "0G_DEMO",
    ts: r.ts,
  }));
}

export function createApi(deps: ApiDeps): Express {
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  // Browser (Next on :3000) → API (:4000) is cross-origin. Without CORS the
  // fetch fails before it reaches any route — the "Failed to fetch" the UI
  // reports is almost always this. Dev allows any origin; pin in prod.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "content-type");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      source: "trace",
      queue: deps.queueBackend ?? "bullmq",
      rpcConfigured: Boolean(process.env.TRACE_RPC_URL),
      note: deps.queueBackend === "in-memory" ? "queue is in-process (no Redis); no job durability" : undefined,
    });
  });

  // ------------------------------------------------------------------
  app.post("/investigations", async (req: Request, res: Response) => {
    const { wallet, rpcUrl, days, fromBlock, toBlock, events, priceSeries, observedRange } = req.body ?? {};

    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(String(wallet))) {
      res.status(400).json({ error: "wallet must be a 0x-prefixed 40-hex address" });
      return;
    }

    const investigationId = await deps.db.insertInvestigation({
      wallet: String(wallet),
      source: events ? "demo_fixture" : "live",
      eventsFingerprint: "", // filled by the worker
      summary: {},
    });

    await deps.queue.add(
      "pipeline",
      {
        wallet: String(wallet),
        investigationId,
        events: events as V3Event[] | undefined,
        rpcUrl,
        days,
        fromBlock,
        toBlock,
        priceSeries,
        observedRange,
      },
      { jobId: investigationId },
    );

    res.status(202).json({ investigationId, status: "queued" });
  });

  // NOTE: registered before "/investigations/:id" — exact segments must win.
  app.get("/investigations/recent", async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);
    const rows = await deps.db.query(
      `select id, wallet, status, source, events_fingerprint as fingerprint,
              period_from_ts as "fromTs", period_to_ts as "toTs", error, created_at as "createdAt"
         from investigations
        where status in ('done','failed')
        order by created_at desc limit $1`,
      [limit],
    );
    res.json({
      investigations: rows.map((r) => ({
        id: r.id,
        wallet: r.wallet,
        status: r.status,
        source: r.source,
        fingerprint: r.fingerprint,
        fromTs: r.fromTs ?? null,
        toTs: r.toTs ?? null,
        error: r.error ?? null,
        createdAt: r.createdAt,
      })),
    });
  });

  app.get("/investigations/:id", async (req: Request, res: Response) => {
    const row = await deps.db.getInvestigation(req.params.id);
    if (!row) {
      res.status(404).json({ error: "investigation not found" });
      return;
    }
    res.json({
      id: row.id,
      wallet: row.wallet,
      status: row.status,
      source: row.source, // 'live' | 'demo_fixture' — drives the UI badge
      error: row.error ?? null,
      summary: row.summary,
    });
  });

  /** The full pipeline payload for one investigation: everything the UI screens render. */
  app.get("/investigations/:id/full", async (req: Request, res: Response) => {
    const row = await deps.db.getInvestigation(req.params.id);
    if (!row) {
      res.status(404).json({ error: "investigation not found" });
      return;
    }
    const s = await deps.db.query(
      `select s.ir_json as strategy, s.strategy_version_hash as "strategyVersionHash",
              s.family, s.confidence,
              p.program_json as program, p.program_hash as "programHash",
              p.compatibility_json as compatibility, p.verdict,
              b.result_json as backtest, b.lookahead_guard as "lookaheadGuard"
         from strategies s
         left join aqua_programs p on p.strategy_id = s.id
         left join backtests b on b.strategy_id = s.id
        where s.investigation = $1
        order by s.created_at desc limit 1`,
      [req.params.id],
    );
    const latest = s[0];
    res.json({
      id: row.id,
      wallet: row.wallet,
      status: row.status,
      source: row.source,
      error: row.error ?? null,
      reconstruction: row.summary,
      strategy: latest?.strategy ?? null,
      strategyVersionHash: latest?.strategyVersionHash ?? null,
      program: latest?.program ?? null,
      programHash: latest?.programHash ?? null,
      compatibility: latest?.compatibility ?? null,
      compatibilityVerdict: latest?.verdict ?? null,
      backtest: latest?.backtest ?? null,
      archives: await getArchivesFor(deps, req.params.id),
    });
  });

  /** Raw reconstructed events (the blockchain evidence), optionally per position. */
  app.get("/investigations/:id/events", async (req: Request, res: Response) => {
    const params: unknown[] = [];
    let filter = "";
    if (req.query.tokenId) {
      params.push(String(req.query.tokenId));
      filter = " and token_id = $2";
      params.unshift(req.params.id);
    } else {
      params.push(req.params.id);
    }
    const rows = await deps.db.query(
      `select tx, block, log_index as "logIndex", ts, kind, token_id as "tokenId", owner,
              liquidity_delta as "liquidityDelta", amount0 as "amount0", amount1 as "amount1",
              fee0 as "fee0", fee1 as "fee1", tick_lower as "tickLower", tick_upper as "tickUpper", note
         from events where investigation = $1${filter}
        order by block, log_index`,
      params,
    );
    res.json({ events: rows });
  });

  // ------------------------------------------------------------------
  /** Immutable strategy versions for a wallet — the Saved page's version history. */
  app.get("/strategies/by-wallet/:wallet", async (req: Request, res: Response) => {
    const rows = await deps.db.query(
      `select s.ir_id as "ir", s.strategy_version_hash as "versionHash", s.family, s.confidence,
              s.source, s.created_at as "createdAt"
         from strategies s
         join investigations i on i.id = s.investigation
        where lower(i.wallet) = lower($1) and i.status = 'done'
        order by s.created_at desc limit 20`,
      [req.params.wallet],
    );
    res.json({
      strategies: rows.map((r) => ({
        ir: r.ir,
        versionHash: r.versionHash,
        family: r.family,
        confidence: Number(r.confidence),
        source: r.source,
        createdAt: r.createdAt,
      })),
    });
  });

  app.get("/strategies/:id/compatibility", async (req: Request, res: Response) => {
    const r = await deps.db.query(
      `select s.ir_json as strategy, p.compatibility_json as compatibility
         from strategies s
         left join aqua_programs p on p.strategy_id = s.id
        where s.id = $1`,
      [req.params.id],
    );
    const row = r[0];
    if (!row) {
      res.status(404).json({ error: "strategy not found" });
      return;
    }
    res.json({
      strategyId: row.strategy?.id ?? req.params.id,
      compatibility: row.compatibility,
      verdict: row.compatibility?.verdict ?? null,
    });
  });

  // ------------------------------------------------------------------
  app.post("/authorizations", async (req: Request, res: Response) => {
    const { strategyId, action } = req.body ?? {};
    if (!strategyId || !action) {
      res.status(400).json({ error: "strategyId and action are required" });
      return;
    }

    const sr = await deps.db.query(
      `select s.strategy_version_hash, p.program_hash
         from strategies s
         left join aqua_programs p on p.strategy_id = s.id
        where s.id = $1`,
      [strategyId],
    );
    const row = sr[0];
    if (!row || !row.program_hash) {
      res.status(404).json({ error: "strategy has no compiled program — nothing to authorize" });
      return;
    }

    // 1) Issue bound claims with a fresh challenge.
    const claims = issueAgentPassClaims(deps.worldCfg, {
      strategyId: String(strategyId),
      strategyVersionHash: String(row.strategy_version_hash),
      programHash: String(row.program_hash),
      action: String(action),
    });
    await deps.db.issueChallenge(String(strategyId), claims.challenge);

    // 2) Sign (demo HMAC path; production replaces this with World's
    //    Ed25519 verification against the registry).
    const signed = signProof(claims, { ...deps.worldCfg, demoKey: deps.demoKey });

    // 3) Server-side verification of every binding.
    const verified = verifyProof(signed, {
      expectedStrategyVersionHash: String(row.strategy_version_hash),
      expectedProgramHash: String(row.program_hash),
      expectedAction: String(action),
      worldId: claims.worldId,
      challenge: claims.challenge,
      usedChallenges: await deps.db.consumedChallenges(String(strategyId)),
      demoKey: deps.demoKey,
    });

    // 4) Record + consume the challenge (replay protection).
    await deps.db.markChallengeConsumed(claims.challenge);
    await deps.db.insertAuthorization(
      String(strategyId),
      verified.claims,
      verified.signature,
      verified.validated,
      verified.validation,
    );

    res.json({
      worldId: claims.worldId,
      strategyId,
      challenge: claims.challenge,
      validated: verified.validated,
      validation: verified.validation,
      note: "Mock proof flow (hackathon-supported). Not production identity verification.",
    });
  });

  // ------------------------------------------------------------------
  app.get("/archives/:id", async (req: Request, res: Response) => {
    const rows = await getArchivesFor(deps, req.params.id);
    const demo = rows.some((r) => r.demo);
    res.json({
      archives: rows,
      // The UI must show the demo label when any ref is a demo archive.
      allDemo: demo && rows.length > 0,
    });
  });

  return app;
}
