/**
 * Postgres persistence layer (pg Pool, plain SQL — no ORM, so the schema in
 * db/schema.sql is the single source of truth).
 *
 * Every write records the data's `source` (live | demo_fixture |
 * deterministic), which is what the UI's demo badge ultimately derives from.
 */

import { Pool, type PoolClient } from "pg";

export type DbConfig = {
  connectionString: string;
};

export class Db {
  private pool: Pool;

  constructor(cfg: DbConfig) {
    this.pool = new Pool({ connectionString: cfg.connectionString });
  }

  async withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Run a parameterised query and return its rows. `T` is the *row* shape
   * (what `select ... as x` projects to); the default `any` keeps ad-hoc
   * callers (the API routes) ergonomic while typed callers can narrow.
   */
  async query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
    const r = await this.pool.query(text, params as any[]);
    return r.rows as T[];
  }

  /* ---------------- investigations ---------------- */

  async insertInvestigation(row: {
    wallet: string;
    chainId?: number;
    source: "live" | "demo_fixture" | "deterministic";
    eventsFingerprint: string;
    summary: unknown;
    periodFromTs?: number;
    periodToTs?: number;
  }): Promise<string> {
    const r = await this.pool.query(
      `insert into investigations (wallet, chain_id, source, events_fingerprint, summary_json, period_from_ts, period_to_ts)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        row.wallet,
        row.chainId ?? 1,
        row.source,
        row.eventsFingerprint,
        JSON.stringify(row.summary),
        row.periodFromTs ?? null,
        row.periodToTs ?? null,
      ],
    );
    return String(r.rows[0].id);
  }

  async setInvestigationStatus(id: string, status: "reconstructing" | "done" | "failed", error?: string) {
    await this.pool.query(
      `update investigations set status = $2, error = $3, updated_at = now() where id = $1`,
      [id, status, error ?? null],
    );
  }

  /**
   * Fill in the investigation row the API created when it queued the job.
   * The row already exists; this updates its result-bearing columns and the
   * source label (live vs demo_fixture) so the badge is data-driven.
   */
  async updateInvestigationResult(
    id: string,
    patch: {
      source: "live" | "demo_fixture" | "deterministic";
      eventsFingerprint: string;
      summary: unknown;
      periodFromTs?: number;
      periodToTs?: number;
    },
  ) {
    await this.pool.query(
      `update investigations
         set source = $2, events_fingerprint = $3, summary_json = $4,
             period_from_ts = coalesce($5, period_from_ts),
             period_to_ts   = coalesce($6, period_to_ts),
             updated_at = now()
       where id = $1`,
      [id, patch.source, patch.eventsFingerprint, JSON.stringify(patch.summary), patch.periodFromTs ?? null, patch.periodToTs ?? null],
    );
  }

  async getInvestigation(id: string): Promise<{ id: string; wallet: string; status: string; source: string; error: string | null; summary: unknown } | null> {
    const r = await this.pool.query(
      `select id, wallet, status, source, error, summary_json as summary from investigations where id = $1`,
      [id],
    );
    return r.rows.length ? r.rows[0] : null;
  }

  async insertEvents(investigation: string, events: unknown[]) {
    // Bulk-insert via a values list; enough for the hackathon scale.
    for (const e of events) {
      const ev = e as Record<string, unknown>;
      await this.pool.query(
        `insert into events (investigation, tx, block, log_index, ts, kind, token_id, owner,
                             liquidity_delta, amount0, amount1, fee0, fee1, tick_lower, tick_upper, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          investigation,
          ev.tx,
          ev.block,
          ev.logIndex,
          ev.timestamp ?? 0,
          ev.kind,
          ev.tokenId,
          ev.owner ?? null,
          ev.liquidityDelta ?? 0,
          ev.amount0 ?? 0,
          ev.amount1 ?? 0,
          ev.fee0 ?? 0,
          ev.fee1 ?? 0,
          ev.tickLower ?? 0,
          ev.tickUpper ?? 0,
          ev.note ?? null,
        ],
      );
    }
  }

  /* ---------------- strategies ---------------- */

  async insertStrategy(investigation: string, strategy: unknown, irId: string, versionHash: string, family: string, confidence: number, source: string): Promise<string> {
    const r = await this.pool.query(
      `insert into strategies (investigation, ir_json, ir_id, strategy_version_hash, family, confidence, source)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [investigation, JSON.stringify(strategy), irId, versionHash, family, confidence, source],
    );
    return String(r.rows[0].id);
  }

  /* ---------------- backtests / programs / archives ---------------- */

  async insertBacktest(strategyId: string, result: unknown): Promise<void> {
    const r = result as {
      split: { trainEndBlock: number; testStartBlock: number; gapBlocks: number; lookaheadGuard: string; waiveReason?: string };
    };
    await this.pool.query(
      `insert into backtests (strategy_id, result_json, train_end_block, test_start_block, gap_blocks, lookahead_guard, waive_reason)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        strategyId,
        JSON.stringify(result),
        r.split.trainEndBlock,
        r.split.testStartBlock,
        r.split.gapBlocks,
        r.split.lookaheadGuard,
        r.split.waiveReason ?? null,
      ],
    );
  }

  async insertProgram(strategyId: string, program: unknown, compatibility: unknown): Promise<void> {
    const p = program as { programHash: string };
    const c = compatibility as { verdict: string };
    await this.pool.query(
      `insert into aqua_programs (strategy_id, program_json, program_hash, compatibility_json, verdict)
       values ($1,$2,$3,$4,$5)`,
      [strategyId, JSON.stringify(program), p.programHash, JSON.stringify(compatibility), c.verdict],
    );
  }

  async issueChallenge(strategyId: string, challenge: string): Promise<void> {
    await this.pool.query(`insert into challenges (challenge, strategy_id) values ($1,$2) on conflict do nothing`, [
      challenge,
      strategyId,
    ]);
  }

  async markChallengeConsumed(challenge: string): Promise<void> {
    await this.pool.query(`update challenges set consumed_at = now() where challenge = $1`, [challenge]);
  }

  async consumedChallenges(strategyId: string): Promise<string[]> {
    const r = await this.pool.query(
      `select challenge from challenges where strategy_id = $1 and consumed_at is not null`,
      [strategyId],
    );
    return r.rows.map((x: { challenge: string }) => x.challenge);
  }

  async insertAuthorization(strategyId: string, claims: unknown, signature: string, validated: boolean, verification: unknown): Promise<void> {
    await this.pool.query(
      `insert into authorizations (strategy_id, world_id, claims_json, signature, validated, validation_json, status)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        strategyId,
        (claims as { worldId: string }).worldId,
        JSON.stringify(claims),
        signature,
        validated,
        JSON.stringify(verification),
        validated ? "authorized" : "rejected",
      ],
    );
  }

  async insertArchives(investigation: string | null, refs: unknown[]) {
    for (const a of refs as Array<{ ref: string; kind: string; contentHash: string; sizeBytes: number; demo: boolean }>) {
      await this.pool.query(
        `insert into archives (ref, kind, content_hash, size_bytes, source, investigation)
         values ($1,$2,$3,$4,$5,$6)`,
        [a.ref, a.kind, a.contentHash, a.sizeBytes, a.demo ? "0G_DEMO" : "0G_LIVE", investigation],
      );
    }
  }

  close() {
    return this.pool.end();
  }
}
