/**
 * TRACE Express API (Sepolia only).
 *
 *   GET  /health                               liveness + config summary
 *   GET  /integrations                         live integration probes (honest labels)
 *   GET  /wallets/suggested                    real active Sepolia LP wallets (found live)
 *   POST /investigations                       queue an investigation {wallet, days}
 *   GET  /investigations/recent
 *   GET  /investigations/:id                   status + progress
 *   GET  /investigations/:id/full              everything the screens render
 *   GET  /investigations/:id/events            raw lifecycle evidence (?tokenId=)
 *   GET  /investigations/:id/positions/:tokenId
 *   POST /investigations/:id/archive           retry 0G Storage archiving
 *   GET  /strategies/by-wallet/:wallet         immutable strategy versions
 *   POST /strategies/:id/compatibility         on-chain Aqua compatibility {maker?}
 *   POST /strategies/:id/plan                  compile an execution plan {maker, amount0, amount1}
 *   GET  /plans/:id                            plan + authorizations + transactions
 *   POST /plans/:id/challenge                  single-use challenge + EIP-712 payload {wallet, action}
 *   POST /authorizations                       verify a signed authorization {planId, claims, signature, world?}
 *   POST /transactions                         record a submitted tx {authorizationId, op, txHash}
 *   GET  /transactions/:hash                   re-verify a tx from its receipt
 *   GET  /activity/:wallet                     investigations + transactions
 */
import express from "express";
import { AQUA, SEPOLIA_CHAIN_ID, isAddress } from "@trace/chain-config";
import { createTraceClient, scrubSecrets } from "@trace/chain-data";
import { assessCompatibility, aquaClient, compilePlan } from "@trace/aqua-adapter";
import { buildTypedData, newChallenge, verifyAuthorization, verifyWorldProof, worldConfigured, worldRpRequest, worldSignal } from "@trace/world-auth";
import { archive } from "@trace/zero-g-storage";
import { integrationSnapshot } from "./integrations.js";
/** Actions a signed authorization can cover, and the plan steps each allows. */
export const ACTIONS = {
    "aqua:ship": ["approve", "ship"],
    "aqua:dock": ["dock"],
};
const AUTH_TTL_SECONDS = 600;
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const P = (req, k) => String(req.params[k] ?? "");
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const h = (fn) => (req, res, next) => fn(req, res).catch(next);
/** Very small fixed-window limiter for expensive routes. */
function limiter(max, windowMs) {
    const hits = new Map();
    return (req, res, next) => {
        const k = req.ip ?? "unknown";
        const now = Date.now();
        const e = hits.get(k);
        if (!e || e.reset < now)
            hits.set(k, { n: 1, reset: now + windowMs });
        else if (++e.n > max)
            return res.status(429).json({ error: "rate limit exceeded — try again shortly" });
        next();
    };
}
/** Rebuild PositionMeta rows for an investigation (basis selection for compile). */
async function positionMetas(db, investigation) {
    const rows = await db.query(`select token_id, pool, token0, token1, symbol0, symbol1, decimals0, decimals1, fee_tier, tick_lower, tick_upper, liquidity, status, history_complete
       from positions where investigation = $1 order by token_id desc`, [investigation]);
    return rows.map((r) => ({
        tokenId: Number(r.token_id),
        pool: r.pool && r.pool !== "unresolved" ? r.pool : null,
        token0: r.token0,
        token1: r.token1,
        symbol0: r.symbol0,
        symbol1: r.symbol1,
        decimals0: r.decimals0,
        decimals1: r.decimals1,
        feeTier: r.fee_tier,
        tickLower: r.tick_lower,
        tickUpper: r.tick_upper,
        currentLiquidity: String(r.liquidity ?? "0"),
        burned: r.status === "closed",
        historyComplete: r.history_complete,
    }));
}
function pickBasis(metas, tokenId) {
    const usable = metas.filter((m) => m.pool && m.token0 && m.decimals0 != null && m.decimals1 != null);
    if (tokenId != null)
        return usable.find((m) => m.tokenId === tokenId) ?? null;
    return usable.find((m) => !m.burned) ?? usable[0] ?? null;
}
export function createApi(deps) {
    const { db, queue, cfg } = deps;
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && cfg.corsOrigins.includes(origin)) {
            res.header("Access-Control-Allow-Origin", origin);
            res.header("Vary", "Origin");
        }
        res.header("Access-Control-Allow-Headers", "content-type");
        res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        if (req.method === "OPTIONS")
            return void res.status(204).end();
        next();
    });
    /* ---------------- health / integrations ---------------- */
    app.get("/health", h(async (_req, res) => {
        let database = "ok";
        try {
            await db.ping();
        }
        catch (err) {
            database = `error: ${err.message}`;
        }
        res.json({ ok: database === "ok", chainId: SEPOLIA_CHAIN_ID, network: "Ethereum Sepolia", database, queue: queue.backend });
    }));
    app.get("/integrations", h(async (req, res) => {
        res.json(await integrationSnapshot(cfg, db, queue.backend, req.query.refresh === "1"));
    }));
    let suggested = null;
    app.get("/wallets/suggested", h(async (_req, res) => {
        if (!suggested || Date.now() - suggested.at > 10 * 60_000) {
            const chain = createTraceClient({ rpcUrl: cfg.sepoliaRpcUrl, fallbackRpcUrls: cfg.sepoliaFallbackRpcUrls });
            const wallets = await chain.findActiveLpWallets(5, 50_000);
            suggested = { at: Date.now(), data: { wallets, source: "Live scan of Uniswap V3 position mints on Sepolia (last ~50,000 blocks), ranked by real swaps in each wallet's pool (last ~10,000 blocks)", computedAt: new Date().toISOString() } };
        }
        res.json(suggested.data);
    }));
    /* ---------------- investigations ---------------- */
    app.post("/investigations", limiter(10, 60_000), h(async (req, res) => {
        const { wallet, days } = req.body ?? {};
        if (!isAddress(wallet))
            return bad(res, "wallet must be a 0x-prefixed 40-hex address");
        const d = days == null ? 30 : Number(days);
        if (!Number.isInteger(d) || d < 1 || d > 365)
            return bad(res, "days must be an integer between 1 and 365");
        // Same wallet + window already running → attach to it instead of reading the chain twice
        // (double clicks and multiple tabs otherwise split the RPC budget between identical jobs).
        const running = await db.query(`select id, status from investigations
        where lower(wallet) = lower($1) and window_days = $2
          and status not in ('done','no_positions','failed') and created_at > now() - interval '30 minutes'
        order by created_at desc limit 1`, [wallet, d]);
        if (running.length)
            return res.status(202).json({ investigationId: running[0].id, status: running[0].status, reused: true });
        const id = await db.insertInvestigation(wallet, d);
        await queue.add({ investigationId: id, wallet, days: d });
        res.status(202).json({ investigationId: id, status: "queued" });
    }));
    app.get("/investigations/recent", h(async (req, res) => {
        const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
        const wallet = typeof req.query.wallet === "string" && isAddress(req.query.wallet) ? req.query.wallet : null;
        const rows = await db.query(`select id, wallet, status, progress, error, period_from_ts as "fromTs", period_to_ts as "toTs", created_at as "createdAt", updated_at as "updatedAt",
              (summary_json->'counts') as counts
         from investigations ${wallet ? "where lower(wallet) = lower($2)" : ""} order by created_at desc limit $1`, wallet ? [limit, wallet] : [limit]);
        res.json({ investigations: rows });
    }));
    app.get("/investigations/:id", h(async (req, res) => {
        const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
        if (!inv)
            return bad(res, "investigation not found", 404);
        res.json(inv);
    }));
    app.get("/investigations/:id/full", h(async (req, res) => {
        const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
        if (!inv)
            return bad(res, "investigation not found", 404);
        const [strategies, runs, dna, positions, storage] = await Promise.all([
            db.query(`select id, ir_id as "irId", parent_ir_id as "parentIrId", ir_json as ir, version_hash as "versionHash", family, confidence, provider, role, created_at as "createdAt"
           from strategies where investigation = $1 order by created_at`, [inv.id]),
            db.query(`select id, status, request_id as "requestId", model, provider_address as "providerAddress", tee_verified as "teeVerified", trust_mode as "trustMode",
                http_status as "httpStatus", error_code as "errorCode", error, usage, latency_ms as "latencyMs", rules_rejected as "rulesRejected", created_at as "createdAt"
           from inference_runs where investigation = $1 order by created_at desc`, [inv.id]),
            db.query(`select data, computed_at as "computedAt" from strategy_dna where investigation = $1`, [inv.id]),
            db.query(`select * from positions where investigation = $1 order by token_id desc`, [inv.id]),
            db.listStorage(inv.id),
        ]);
        const primary = strategies.find((s) => s.role === "ai_hypothesis") ?? strategies.find((s) => s.role === "evidence_baseline") ?? null;
        const backtest = primary
            ? (await db.query(`select result_json as result, status, created_at as "createdAt" from backtest_runs where strategy_id = $1 order by created_at desc limit 1`, [primary.id]))[0] ?? null
            : null;
        const compatibility = primary
            ? (await db.query(`select id, maker, verdict, report_json as report, created_at as "createdAt" from compatibility_reports where strategy_id = $1 order by created_at desc limit 1`, [primary.id]))[0] ?? null
            : null;
        const plans = primary
            ? await db.query(`select id, maker, plan_hash as "planHash", plan_json as plan, created_at as "createdAt" from execution_plans where strategy_id = $1 order by created_at desc limit 5`, [primary.id])
            : [];
        res.json(json({ investigation: inv, strategies, primaryStrategyId: primary?.id ?? null, inferenceRuns: runs, dna: dna[0] ?? null, positions, backtest, compatibility, plans, storage }));
    }));
    app.get("/investigations/:id/events", h(async (req, res) => {
        const tokenId = typeof req.query.tokenId === "string" && /^\d+$/.test(req.query.tokenId) ? req.query.tokenId : undefined;
        res.json({ events: await db.getEvents(P(req, "id"), tokenId) });
    }));
    app.get("/investigations/:id/positions/:tokenId", h(async (req, res) => {
        if (!/^\d+$/.test(P(req, "tokenId")))
            return bad(res, "tokenId must be numeric");
        const [pos] = await db.query(`select * from positions where investigation = $1 and token_id = $2`, [P(req, "id"), P(req, "tokenId")]);
        if (!pos)
            return bad(res, "position not found in this investigation", 404);
        const events = await db.getEvents(P(req, "id"), P(req, "tokenId"));
        const [dna] = await db.query(`select data from strategy_dna where investigation = $1`, [P(req, "id")]);
        const series = pos.pool ? (dna?.data?.priceSeries?.[pos.pool] ?? null) : null;
        res.json({ position: pos, events, priceSeries: series });
    }));
    app.post("/investigations/:id/archive", limiter(5, 60_000), h(async (req, res) => {
        const inv = await db.getInvestigation(P(req, "id")).catch(() => null);
        if (!inv || inv.status !== "done")
            return bad(res, "investigation not found or not finished", 404);
        const [strategy] = await db.query(`select id, ir_json as ir from strategies where investigation = $1 order by (role = 'ai_hypothesis') desc, created_at desc limit 1`, [inv.id]);
        const [dna] = await db.query(`select data from strategy_dna where investigation = $1`, [inv.id]);
        const outcome = await archive({
            cfg: cfg.storage,
            artifacts: [
                { kind: "investigation-summary", content: { investigation: inv.id, summary: inv.summary } },
                { kind: "strategy-dna", content: { investigation: inv.id, fingerprints: dna?.data?.fingerprints ?? null } },
                ...(strategy ? [{ kind: `strategy-ir:${strategy.ir.id}`, content: strategy.ir }] : []),
            ],
        });
        await db.insertStorage(inv.id, strategy?.id ?? null, outcome.refs);
        await db.setIntegrations(inv.id, { storage: { status: outcome.status, errors: outcome.errors.slice(0, 4), uploaded: outcome.refs.length } });
        res.json(outcome);
    }));
    /* ---------------- strategies ---------------- */
    app.get("/strategies/by-wallet/:wallet", h(async (req, res) => {
        if (!isAddress(P(req, "wallet")))
            return bad(res, "invalid wallet");
        const rows = await db.query(`select s.id, s.ir_id as "irId", s.parent_ir_id as "parentIrId", s.version_hash as "versionHash", s.family, s.confidence, s.provider, s.role,
              s.created_at as "createdAt", s.investigation
         from strategies s join investigations i on i.id = s.investigation
        where lower(i.wallet) = lower($1) order by s.created_at desc limit 50`, [P(req, "wallet")]);
        res.json({ strategies: rows });
    }));
    const loadForCompile = async (strategyId, tokenId) => {
        const st = await db.getStrategy(strategyId).catch(() => null);
        if (!st)
            return null;
        const metas = await positionMetas(db, st.investigation);
        return { st, ir: st.ir, basis: pickBasis(metas, tokenId) };
    };
    app.post("/strategies/:id/compatibility", limiter(20, 60_000), h(async (req, res) => {
        const maker = req.body?.maker;
        if (maker != null && !isAddress(maker))
            return bad(res, "maker must be an address");
        const ctx = await loadForCompile(P(req, "id"), req.body?.tokenId != null ? Number(req.body.tokenId) : undefined);
        if (!ctx)
            return bad(res, "strategy not found", 404);
        const aq = aquaClient(cfg.sepoliaRpcUrl);
        const checks = ctx.basis
            ? await aq.makerChecks(maker ?? null, [
                { address: ctx.basis.token0, symbol: ctx.basis.symbol0 },
                { address: ctx.basis.token1, symbol: ctx.basis.symbol1 },
            ])
            : [];
        const compat = assessCompatibility(ctx.ir, ctx.basis, checks);
        const reportId = await db.insertCompatibility(P(req, "id"), maker ?? null, compat);
        res.json({ reportId, compatibility: compat });
    }));
    app.post("/strategies/:id/plan", limiter(20, 60_000), h(async (req, res) => {
        const { maker, amount0, amount1, tokenId } = req.body ?? {};
        if (!isAddress(maker))
            return bad(res, "maker must be the connected wallet address");
        if (!/^\d+$/.test(String(amount0 ?? "")) || !/^\d+$/.test(String(amount1 ?? "")))
            return bad(res, "amount0/amount1 must be non-negative integer strings (token base units)");
        const ctx = await loadForCompile(P(req, "id"), tokenId != null ? Number(tokenId) : undefined);
        if (!ctx)
            return bad(res, "strategy not found", 404);
        if (!ctx.basis)
            return bad(res, "no position with a resolvable pool and token decimals to base an Aqua strategy on", 422);
        const aq = aquaClient(cfg.sepoliaRpcUrl);
        const checks = await aq.makerChecks(maker, [
            { address: ctx.basis.token0, symbol: ctx.basis.symbol0, amount: BigInt(amount0) },
            { address: ctx.basis.token1, symbol: ctx.basis.symbol1, amount: BigInt(amount1) },
        ]);
        const compat = assessCompatibility(ctx.ir, ctx.basis, checks);
        await db.insertCompatibility(P(req, "id"), maker, compat);
        let plan;
        try {
            plan = compilePlan({ ir: ctx.ir, compat, basis: ctx.basis, maker, amount0: String(amount0), amount1: String(amount1), registry: AQUA.registry.address, app: AQUA.swapVmRouter.address, chainId: SEPOLIA_CHAIN_ID });
        }
        catch (err) {
            return res.status(422).json({ error: err.message, compatibility: compat });
        }
        // Simulate every pre-ship step from the maker before anyone is asked to sign.
        const simulation = {};
        for (const s of plan.steps.filter((x) => x.op !== "dock"))
            simulation[`${s.op}:${s.to}`] = await aq.simulateStep(maker, s);
        const planId = await db.insertPlan(P(req, "id"), plan);
        res.json({ planId, plan, compatibility: compat, simulation });
    }));
    /* ---------------- plans, challenges, authorizations ---------------- */
    app.get("/plans/:id", h(async (req, res) => {
        const p = await db.getPlan(P(req, "id")).catch(() => null);
        if (!p)
            return bad(res, "plan not found", 404);
        const auths = await db.query(`select id, wallet, action, validated, verification_json as verification, world_status as "worldStatus", expires_at as "expiresAt", created_at as "createdAt"
         from authorizations where plan_id = $1 order by created_at desc limit 10`, [p.id]);
        res.json({ ...p, authorizations: auths, transactions: await db.listTransactions({ planId: p.id }) });
    }));
    app.post("/plans/:id/challenge", limiter(30, 60_000), h(async (req, res) => {
        const { wallet, action } = req.body ?? {};
        if (!isAddress(wallet))
            return bad(res, "wallet must be an address");
        if (!ACTIONS[action])
            return bad(res, `action must be one of ${Object.keys(ACTIONS).join(", ")}`);
        const p = await db.getPlan(P(req, "id")).catch(() => null);
        if (!p)
            return bad(res, "plan not found", 404);
        if (p.maker.toLowerCase() !== wallet.toLowerCase())
            return bad(res, "this plan was compiled for a different wallet", 403);
        const challenge = newChallenge();
        await db.issueChallenge(p.id, wallet, action, challenge, AUTH_TTL_SECONDS);
        const claims = {
            wallet,
            chainId: SEPOLIA_CHAIN_ID,
            strategyId: p.irId,
            strategyVersionHash: p.strategyVersionHash,
            planHash: p.planHash,
            action,
            challenge,
            expiresAt: Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS,
        };
        const world = worldConfigured(cfg.world) ? { ...(await worldRpRequest(cfg.world)), signal: worldSignal(claims) } : null;
        res.json(json({ claims, typedData: buildTypedData(claims), world, worldStatus: world ? "required" : "not_configured" }));
    }));
    app.post("/authorizations", limiter(30, 60_000), h(async (req, res) => {
        const { planId, claims, signature, world } = req.body ?? {};
        if (typeof planId !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature))
            return bad(res, "planId and a hex signature are required");
        const c = claims;
        if (!c || !isAddress(c.wallet) || typeof c.challenge !== "string" || !ACTIONS[c.action])
            return bad(res, "malformed claims");
        const p = await db.getPlan(planId).catch(() => null);
        if (!p)
            return bad(res, "plan not found", 404);
        const expected = { wallet: p.maker, strategyVersionHash: p.strategyVersionHash, planHash: p.planHash, action: c.action, chainId: SEPOLIA_CHAIN_ID };
        // 1) Check signature + bindings first (no state change), 2) then consume the challenge atomically.
        const pre = await verifyAuthorization({ claims: c, signature: signature, expected, challengeFresh: true });
        const fresh = pre.validated ? await db.consumeChallenge(c.challenge, p.id, c.wallet, c.action) : false;
        const result = pre.validated ? await verifyAuthorization({ claims: c, signature: signature, expected, challengeFresh: fresh }) : pre;
        let worldStatus = worldConfigured(cfg.world) ? "failed" : "not_configured";
        let nullifier = null;
        if (worldConfigured(cfg.world) && result.validated) {
            if (!world) {
                result.validated = false;
                result.verification.notes.push("World ID proof required by server configuration but not provided");
            }
            else {
                const w = await verifyWorldProof(cfg.world, world, worldSignal(c));
                nullifier = w.nullifier;
                if (w.ok && nullifier && (await db.recordNullifier(nullifier, cfg.world.action)))
                    worldStatus = "verified";
                else {
                    result.validated = false;
                    result.verification.notes.push(w.ok ? "World ID nullifier already used for this action" : w.detail);
                }
            }
        }
        result.verification.worldId = worldStatus;
        const authorizationId = await db.insertAuthorization({
            planId: p.id,
            wallet: c.wallet,
            action: c.action,
            claims: c,
            signature,
            validated: result.validated,
            verification: result.verification,
            worldStatus,
            worldNullifier: nullifier,
        });
        if (result.validated)
            await db.touchWallet(c.wallet, true);
        res.status(result.validated ? 200 : 403).json({ authorizationId, validated: result.validated, signer: result.signer, verification: result.verification });
    }));
    /* ---------------- transactions ---------------- */
    const verifyAndStore = async (planRow, authorizationId, op, txHash, wallet) => {
        const aq = aquaClient(cfg.sepoliaRpcUrl);
        try {
            const v = await aq.verifyTx(txHash, planRow.plan, op);
            const fromOk = v.from.toLowerCase() === wallet.toLowerCase();
            await db.upsertTransaction({
                planId: planRow.id,
                authorizationId,
                op,
                txHash,
                status: v.status === "success" ? "success" : "reverted",
                from: v.from,
                to: v.to,
                block: v.blockNumber,
                confirmations: v.confirmations,
                gasUsed: v.gasUsed,
                effectiveGasPrice: v.effectiveGasPrice,
                matchesPlan: v.matchesPlan && fromOk,
                outcome: fromOk ? v.outcome : `${v.outcome}; WARNING: sent by ${v.from}, not the authorized wallet`,
            });
            return { ...v, fromMatchesAuthorization: fromOk };
        }
        catch (err) {
            const msg = scrubSecrets(err.message);
            if (/could not be found|not found|TransactionReceiptNotFound/i.test(msg))
                return { status: "pending" };
            throw err;
        }
    };
    app.post("/transactions", limiter(60, 60_000), h(async (req, res) => {
        const { authorizationId, op, txHash } = req.body ?? {};
        if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
            return bad(res, "txHash must be a 32-byte hex hash");
        if (!["approve", "ship", "dock", "swap"].includes(op))
            return bad(res, "unknown op");
        const auth = await db.getAuthorization(authorizationId).catch(() => null);
        if (!auth || !auth.validated)
            return bad(res, "a validated authorization is required before any execution step", 403);
        if (!ACTIONS[auth.action]?.includes(op))
            return bad(res, `authorization for "${auth.action}" does not cover "${op}"`, 403);
        const p = await db.getPlan(auth.planId);
        if (!p.plan.steps.some((s) => s.op === op))
            return bad(res, `plan has no "${op}" step`, 422);
        if (!auth.live && op === "ship")
            return bad(res, "authorization expired — sign a new one", 403);
        await db.upsertTransaction({ planId: p.id, authorizationId, op, txHash });
        const result = await verifyAndStore({ id: p.id, plan: p.plan }, authorizationId, op, txHash, auth.wallet);
        res.status(202).json(json({ txHash, ...result }));
    }));
    app.get("/transactions/:hash", h(async (req, res) => {
        const [t] = await db.query(`select t.*, a.wallet from transactions t left join authorizations a on a.id = t.authorization_id where t.tx_hash = $1`, [P(req, "hash")]);
        if (!t)
            return bad(res, "transaction not recorded", 404);
        if (t.status === "submitted" || (t.confirmations ?? 0) < 3) {
            const p = await db.getPlan(t.plan_id);
            await verifyAndStore({ id: p.id, plan: p.plan }, t.authorization_id, t.op, t.tx_hash, t.wallet).catch(() => null);
        }
        const [fresh] = await db.query(`select * from transactions where tx_hash = $1`, [P(req, "hash")]);
        res.json(fresh);
    }));
    app.get("/activity/:wallet", h(async (req, res) => {
        if (!isAddress(P(req, "wallet")))
            return bad(res, "invalid wallet");
        const [investigations, transactions] = await Promise.all([
            db.query(`select id, wallet, status, error, created_at as "createdAt", updated_at as "updatedAt", (summary_json->'counts') as counts
           from investigations where lower(wallet) = lower($1) order by created_at desc limit 50`, [P(req, "wallet")]),
            db.listTransactions({ wallet: P(req, "wallet") }),
        ]);
        res.json({ investigations, transactions });
    }));
    // Error handler: scrubbed message, no stack traces to clients.
    app.use((err, _req, res, _next) => {
        const msg = scrubSecrets(err?.message ?? String(err));
        console.error("[api] error:", msg);
        res.status(500).json({ error: msg.slice(0, 300) });
    });
    return app;
}
