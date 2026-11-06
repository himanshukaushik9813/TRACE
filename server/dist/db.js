/**
 * Postgres persistence (pg Pool, plain SQL; db/migrations is the source of
 * truth for the schema). Every chain-dependent row is Sepolia; raw events are
 * immutable and ingested idempotently.
 */
import pg from "pg";
const s = (v) => (v == null ? null : typeof v === "bigint" ? v.toString() : String(v));
export class Db {
    pool;
    constructor(cfg) {
        this.pool = new pg.Pool({
            connectionString: cfg.connectionString,
            ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
            max: 8,
            idleTimeoutMillis: 30_000,
        });
        this.pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    }
    async query(text, params) {
        const r = await this.pool.query(text, params);
        return r.rows;
    }
    async ping() {
        const rows = await this.query(`select name from schema_migrations order by name`);
        return { ok: true, migrations: rows.map((r) => r.name) };
    }
    /* ---------------- wallets ---------------- */
    async touchWallet(address, connected = false) {
        await this.query(`insert into wallets (address, last_connected_at) values ($1, case when $2 then now() else null end)
       on conflict (address) do update set last_seen_at = now(),
         last_connected_at = case when $2 then now() else wallets.last_connected_at end`, [address, connected]);
    }
    /* ---------------- investigations ---------------- */
    async insertInvestigation(wallet, days) {
        await this.touchWallet(wallet);
        const r = await this.query(`insert into investigations (wallet, window_days) values ($1, $2) returning id`, [wallet, days]);
        return r[0].id;
    }
    /**
     * Move an investigation to a new status. Returns false when the run was
     * cancelled (restart / new investigation): a cancelled row is never
     * overwritten, so a superseded worker can't revive or update it.
     */
    async setStatus(id, status, progress = {}, error) {
        const r = await this.query(`update investigations set status = $2, progress = progress || $3::jsonb, error = coalesce($4, error), updated_at = now()
        where id = $1 and status <> 'cancelled' returning id`, [id, status, JSON.stringify({ ...progress, [`${status}At`]: Math.floor(Date.now() / 1000) }), error ?? null]);
        return r.length === 1;
    }
    /** Cancel a run that hasn't finished. Returns true if it was still running. */
    async cancelInvestigation(id, reason) {
        const r = await this.query(`update investigations set status = 'cancelled', error = $2,
              progress = progress || jsonb_build_object('stage', 'Cancelled', 'cancelledAt', extract(epoch from now())::int), updated_at = now()
        where id = $1 and status not in ('done','no_positions','failed','cancelled') returning id`, [id, reason]);
        return r.length === 1;
    }
    /** Every unfinished run for a wallet (any window), oldest first. */
    async runningForWallet(wallet) {
        const r = await this.query(`select id from investigations where lower(wallet) = lower($1) and status not in ('done','no_positions','failed','cancelled') order by created_at`, [wallet]);
        return r.map((x) => x.id);
    }
    /**
     * Investigations that never reached a terminal state when the process died.
     * With the in-memory queue (no Redis) the in-flight work is truly lost, so the
     * caller re-queues them to finish; with BullMQ they may still be in Redis, in
     * which case the caller must NOT re-add or they run twice.
     */
    /** True once the run was cancelled (restart / superseded / user). */
    async isCancelled(id) {
        const [r] = await this.query(`select status from investigations where id = $1`, [id]);
        return r?.status === "cancelled";
    }
    async requeueInterrupted() {
        const rows = await this.query(`select id, wallet, window_days from investigations where status not in ('done','no_positions','failed','cancelled') order by created_at`);
        if (rows.length)
            await this.query(`update investigations set status = 'queued', progress = progress || '{"errorCode":"REQUEUED"}'::jsonb,
                error = 'Re-running: the previous run was cut off by a server restart — retrying automatically', updated_at = now()
          where id = any($1::uuid[])`, [rows.map((r) => r.id)]);
        return rows.map((r) => ({ id: r.id, wallet: r.wallet, days: r.window_days }));
    }
    async saveReconstruction(id, r) {
        await this.query(`update investigations set summary_json = $2, events_fingerprint = $3, window_from_block = $4, window_to_block = $5,
              period_from_ts = $6, period_to_ts = $7, notes = $8, updated_at = now() where id = $1`, [id, JSON.stringify(r.summary), r.summary.eventsFingerprint, r.window.fromBlock, r.window.toBlock, r.window.fromTs, r.window.toTs, JSON.stringify(r.notes)]);
    }
    async setIntegrations(id, patch) {
        await this.query(`update investigations set integrations_json = integrations_json || $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify(patch)]);
    }
    async getInvestigation(id) {
        const r = await this.query(`select id, wallet, chain_id as "chainId", status, progress, window_days as "windowDays",
              window_from_block as "fromBlock", window_to_block as "toBlock", period_from_ts as "fromTs", period_to_ts as "toTs",
              events_fingerprint as "eventsFingerprint", summary_json as summary, notes, integrations_json as integrations,
              error, created_at as "createdAt", updated_at as "updatedAt"
         from investigations where id = $1`, [id]);
        return r[0] ?? null;
    }
    /** Idempotent ingestion of immutable raw events, linked to the investigation. */
    async insertEvents(investigation, events) {
        for (let i = 0; i < events.length; i += 200) {
            const batch = events.slice(i, i + 200);
            const values = [];
            const rows = batch.map((e, j) => {
                const b = j * 19;
                values.push(e.tx, e.logIndex, e.block, e.timestamp, e.kind, s(e.tokenId), e.pool ?? null, e.owner ?? null, e.from ?? null, e.to ?? null, s(e.liquidityDelta), s(e.amount0), s(e.amount1), s(e.fee0), s(e.fee1), e.tickLower, e.tickUpper, e.gasUsed ?? null, e.effectiveGasPrice ?? null);
                return `(${Array.from({ length: 19 }, (_, k) => `$${b + k + 1}`).join(",")})`;
            });
            await this.query(`insert into raw_events (tx_hash, log_index, block, ts, kind, token_id, pool, owner, from_addr, to_addr,
                                 liquidity_delta, amount0, amount1, fee0, fee1, tick_lower, tick_upper, gas_used, effective_gas_price)
         values ${rows.join(",")}
         on conflict (chain_id, tx_hash, log_index, token_id) do nothing`, values);
            await this.query(`insert into investigation_events (investigation, raw_event_id)
         select $1, r.id from raw_events r
           join unnest($2::text[], $3::int[], $4::numeric[]) as k(tx, li, tid)
             on r.chain_id = 11155111 and r.tx_hash = k.tx and r.log_index = k.li and r.token_id = k.tid
         on conflict do nothing`, [investigation, batch.map((e) => e.tx), batch.map((e) => e.logIndex), batch.map((e) => s(e.tokenId))]);
        }
    }
    async getEvents(investigation, tokenId) {
        return this.query(`select r.tx_hash as tx, r.log_index as "logIndex", r.block, r.ts as timestamp, r.kind, r.token_id as "tokenId", r.pool, r.owner,
              r.from_addr as "from", r.to_addr as "to", r.liquidity_delta as "liquidityDelta", r.amount0, r.amount1, r.fee0, r.fee1,
              r.tick_lower as "tickLower", r.tick_upper as "tickUpper", r.gas_used as "gasUsed", r.effective_gas_price as "effectiveGasPrice"
         from investigation_events ie join raw_events r on r.id = ie.raw_event_id
        where ie.investigation = $1 ${tokenId ? "and r.token_id = $2" : ""}
        order by r.block, r.log_index`, tokenId ? [investigation, tokenId] : [investigation]);
    }
    async insertPositions(investigation, summary, meta) {
        const acct = new Map(summary.accounting.map((a) => [a.tokenId, a]));
        for (const p of summary.positions) {
            const a = acct.get(p.tokenId);
            const m = meta[String(p.tokenId)];
            await this.query(`insert into positions (investigation, token_id, pool, token0, token1, symbol0, symbol1, decimals0, decimals1, fee_tier, tick_lower, tick_upper,
                                liquidity, status, opened_block, closed_block, history_complete, deposited0, deposited1, withdrawn0, withdrawn1, fees0, fees1)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         on conflict (investigation, token_id) do nothing`, [
                investigation, p.tokenId, p.pool, m?.token0 ?? null, m?.token1 ?? null, p.token0, p.token1, p.decimals0 ?? null, p.decimals1 ?? null,
                p.feeTier, p.tickLower, p.tickUpper, p.liquidity, p.status, p.openedBlock ?? null, p.closedBlock ?? null, p.historyComplete ?? false,
                a?.deposited.token0 ?? 0, a?.deposited.token1 ?? 0, a?.withdrawn.token0 ?? 0, a?.withdrawn.token1 ?? 0, a?.feesCollected.token0 ?? 0, a?.feesCollected.token1 ?? 0,
            ]);
        }
    }
    async saveDna(investigation, data) {
        await this.query(`insert into strategy_dna (investigation, data) values ($1, $2) on conflict (investigation) do update set data = excluded.data, computed_at = now()`, [investigation, JSON.stringify(data)]);
    }
    /* ---------------- inference + strategies ---------------- */
    async insertInferenceRun(investigation, run) {
        const r = await this.query(`insert into inference_runs (investigation, status, request_id, model, provider_address, tee_verified, trust_mode, http_status, error_code, error, usage, response_hash, latency_ms, rules_rejected)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`, [investigation, run.status, run.requestId, run.model, run.providerAddress, run.teeVerified, run.trustMode, run.httpStatus, run.errorCode, run.error, run.usage ? JSON.stringify(run.usage) : null, run.responseHash, run.latencyMs, run.rulesRejected]);
        return r[0].id;
    }
    async insertStrategy(investigation, ir, versionHash, role, inferenceRun) {
        const r = await this.query(`insert into strategies (investigation, ir_id, parent_ir_id, ir_json, version_hash, family, confidence, provider, role, inference_run)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (ir_id) do nothing returning id`, [investigation, ir.id, ir.parentId ?? null, JSON.stringify(ir), versionHash, ir.family, ir.confidence, ir.source.provider, role, inferenceRun]);
        if (r[0])
            return r[0].id;
        const existing = await this.query(`select id from strategies where ir_id = $1`, [ir.id]);
        return existing[0].id; // identical content = identical immutable version
    }
    async getStrategy(id) {
        const r = await this.query(`select s.id, s.investigation, s.ir_id as "irId", s.ir_json as ir, s.version_hash as "versionHash", s.family, s.confidence, s.provider, s.role,
              s.created_at as "createdAt", i.wallet
         from strategies s join investigations i on i.id = s.investigation where s.id = $1`, [id]);
        return r[0] ?? null;
    }
    async insertBacktest(strategyId, b) {
        await this.query(`insert into backtest_runs (strategy_id, status, reason, pool, result_json, train_end_block, test_start_block, gap_blocks, lookahead_guard, waive_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [strategyId, b.status, b.reason ?? null, b.pool, JSON.stringify(b), b.split.trainEndBlock, b.split.testStartBlock, b.split.gapBlocks, b.split.lookaheadGuard, b.split.waiveReason ?? null]);
    }
    /* ---------------- compatibility, plans, authorizations ---------------- */
    async insertCompatibility(strategyId, maker, c) {
        const r = await this.query(`insert into compatibility_reports (strategy_id, maker, verdict, report_json) values ($1,$2,$3,$4) returning id`, [strategyId, maker, c.verdict, JSON.stringify(c)]);
        return r[0].id;
    }
    async insertPlan(strategyId, plan) {
        const r = await this.query(`insert into execution_plans (strategy_id, maker, plan_hash, strategy_hash, plan_json) values ($1,$2,$3,$4,$5)
       on conflict (plan_hash) do nothing returning id`, [strategyId, plan.maker, plan.planHash, plan.strategyHash, JSON.stringify(plan)]);
        if (r[0])
            return r[0].id;
        return (await this.query(`select id from execution_plans where plan_hash = $1`, [plan.planHash]))[0].id;
    }
    async getPlan(id) {
        const r = await this.query(`select p.id, p.strategy_id as "strategyId", p.maker, p.plan_hash as "planHash", p.plan_json as plan, p.created_at as "createdAt",
              s.version_hash as "strategyVersionHash", s.ir_id as "irId"
         from execution_plans p join strategies s on s.id = p.strategy_id where p.id = $1`, [id]);
        return r[0] ?? null;
    }
    async issueChallenge(planId, wallet, action, challenge, ttlSeconds) {
        await this.query(`insert into challenges (challenge, plan_id, wallet, action, expires_at) values ($1,$2,$3,$4, now() + make_interval(secs => $5))`, [challenge, planId, wallet, action, ttlSeconds]);
    }
    /** Atomically consume a challenge; true only if it existed, matched, was unexpired and unused. */
    async consumeChallenge(challenge, planId, wallet, action) {
        const r = await this.query(`update challenges set consumed_at = now()
        where challenge = $1 and plan_id = $2 and lower(wallet) = lower($3) and action = $4
          and consumed_at is null and expires_at > now()
        returning challenge`, [challenge, planId, wallet, action]);
        return r.length === 1;
    }
    async insertAuthorization(a) {
        const r = await this.query(`insert into authorizations (plan_id, wallet, action, claims_json, signature, validated, verification_json, world_status, world_nullifier, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10)) returning id`, [a.planId, a.wallet, a.action, JSON.stringify(a.claims), a.signature, a.validated, JSON.stringify(a.verification), a.worldStatus, a.worldNullifier, a.claims.expiresAt]);
        return r[0].id;
    }
    async getAuthorization(id) {
        const r = await this.query(`select id, plan_id as "planId", wallet, action, validated, verification_json as verification, world_status as "worldStatus",
              expires_at as "expiresAt", created_at as "createdAt", (expires_at > now()) as live
         from authorizations where id = $1`, [id]);
        return r[0] ?? null;
    }
    async recordNullifier(nullifier, action) {
        const r = await this.query(`insert into world_nullifiers (nullifier, action) values ($1,$2) on conflict do nothing returning nullifier`, [nullifier, action]);
        return r.length === 1;
    }
    /* ---------------- transactions ---------------- */
    async upsertTransaction(t) {
        await this.query(`insert into transactions (plan_id, authorization_id, op, tx_hash, status, from_addr, to_addr, block, confirmations, gas_used, effective_gas_price, matches_plan, outcome)
       values ($1,$2,$3,$4,coalesce($5,'submitted'),$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (tx_hash) do update set status = coalesce($5, transactions.status), from_addr = coalesce($6, transactions.from_addr),
         to_addr = coalesce($7, transactions.to_addr), block = coalesce($8, transactions.block), confirmations = coalesce($9, transactions.confirmations),
         gas_used = coalesce($10, transactions.gas_used), effective_gas_price = coalesce($11, transactions.effective_gas_price),
         matches_plan = coalesce($12, transactions.matches_plan), outcome = coalesce($13, transactions.outcome), updated_at = now()`, [t.planId, t.authorizationId, t.op, t.txHash, t.status ?? null, t.from ?? null, t.to ?? null, t.block ?? null, t.confirmations ?? null, t.gasUsed ?? null, t.effectiveGasPrice ?? null, t.matchesPlan ?? null, t.outcome ?? null]);
    }
    async listTransactions(where) {
        if (where.planId)
            return this.query(`select * from transactions where plan_id = $1 order by created_at`, [where.planId]);
        return this.query(`select t.* from transactions t join execution_plans p on p.id = t.plan_id where lower(p.maker) = lower($1) order by t.created_at desc limit 100`, [where.wallet]);
    }
    /* ---------------- storage ---------------- */
    async insertStorage(investigation, strategyId, refs) {
        for (const r of refs) {
            await this.query(`insert into storage_artifacts (investigation, strategy_id, kind, root_hash, tx_hash, content_hash, size_bytes, network, retrievable)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (root_hash, kind) do nothing`, [investigation, strategyId, r.kind, r.rootHash, r.txHash, r.contentHash, r.sizeBytes, r.network, r.retrievable]);
        }
    }
    async listStorage(investigation) {
        return this.query(`select kind, root_hash as "rootHash", tx_hash as "txHash", content_hash as "contentHash", size_bytes as "sizeBytes", network, retrievable, created_at as "createdAt"
         from storage_artifacts where investigation = $1 order by created_at`, [investigation]);
    }
    close() {
        return this.pool.end();
    }
}
