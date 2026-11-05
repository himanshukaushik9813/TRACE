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
import express from "express";
import { issueAgentPassClaims, signProof, verifyProof } from "@trace/world-auth";
export function createApi(deps) {
    const app = express();
    app.use(express.json({ limit: "8mb" }));
    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            source: "trace",
            queue: deps.queueBackend ?? "bullmq",
            note: deps.queueBackend === "in-memory" ? "queue is in-process (no Redis); no job durability" : undefined,
        });
    });
    // ------------------------------------------------------------------
    app.post("/investigations", async (req, res) => {
        const { wallet, rpcUrl, fromBlock, toBlock, events, priceSeries, observedRange } = req.body ?? {};
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
        await deps.queue.add("pipeline", {
            wallet: String(wallet),
            investigationId,
            events: events,
            rpcUrl,
            fromBlock,
            toBlock,
            priceSeries,
            observedRange,
        }, { jobId: investigationId });
        res.status(202).json({ investigationId, status: "queued" });
    });
    app.get("/investigations/:id", async (req, res) => {
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
            summary: row.summary,
        });
    });
    // ------------------------------------------------------------------
    app.get("/strategies/:id/compatibility", async (req, res) => {
        const r = await deps.db.query(`select s.ir_json as strategy, p.compatibility_json as compatibility
         from strategies s
         left join aqua_programs p on p.strategy_id = s.id
        where s.id = $1`, [req.params.id]);
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
    app.post("/authorizations", async (req, res) => {
        const { strategyId, action } = req.body ?? {};
        if (!strategyId || !action) {
            res.status(400).json({ error: "strategyId and action are required" });
            return;
        }
        const sr = await deps.db.query(`select s.strategy_version_hash, p.program_hash
         from strategies s
         left join aqua_programs p on p.strategy_id = s.id
        where s.id = $1`, [strategyId]);
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
        await deps.db.insertAuthorization(String(strategyId), verified.claims, verified.signature, verified.validated, verified.validation);
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
    app.get("/archives/:id", async (req, res) => {
        const rows = await deps.db.query(`select ref, kind, content_hash as "contentHash", size_bytes as "sizeBytes", source, created_at as "ts"
         from archives where investigation = $1 order by created_at`, [req.params.id]);
        const demo = rows.some((r) => r.source === "0G_DEMO");
        res.json({
            archives: rows.map((r) => ({
                ref: r.ref,
                kind: r.kind,
                contentHash: r.contentHash,
                sizeBytes: r.sizeBytes,
                demo: r.source === "0G_DEMO",
                ts: r.ts,
            })),
            // The UI must show the demo label when any ref is a demo archive.
            allDemo: demo && rows.length > 0,
        });
    });
    return app;
}
