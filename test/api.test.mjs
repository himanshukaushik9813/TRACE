// The complete wallet-investigation workflow THROUGH the Express API layer:
//   POST /investigations → (worker step) → GET /investigations/:id →
//   GET /strategies/:id/compatibility → POST /authorizations → GET /archives/:id
//
// The offline monorepo has no Postgres, Redis, or express installed, so:
//   - `express` resolves to a test stub (test/express-stub.mjs) that records
//     the routes createApi registers and dispatches them in-process — the
//     REAL route handlers run, including their SQL-shaped db calls.
//   - `db` and `queue` are in-memory stand-ins (documented below) implementing
//     exactly the methods the API + worker invoke; the three SQL reads the
//     API issues are answered from the in-memory tables.
// Everything the routes wrap (runPipeline, world-auth sign/verify, IR
// validation) is real. This is the highest-fidelity end-to-end workflow test
// the offline environment allows; with real Postgres/Redis/express the same
// handlers run against them unchanged.
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register(new URL("./resolve-hooks.mjs", import.meta.url));

const api = await import("../server/src/api.ts");
const pipeline = await import("../server/src/pipeline.ts");
const { createApi, runPipeline } = { ...api, ...pipeline };

const wallet = "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C";
const events = [
  { kind: "MINT", tokenId: 12841, owner: wallet, tx: "0x" + "1".repeat(40), block: 21_834_102, logIndex: 0, timestamp: 1_718_124_240, liquidityDelta: 4218, amount0: 312, amount1: 1_048_200, fee0: 0, fee1: 0, tickLower: -128, tickUpper: 154 },
  { kind: "COLLECT", tokenId: 12841, owner: wallet, tx: "0x" + "2".repeat(40), block: 21_890_551, logIndex: 1, timestamp: 1_720_035_060, liquidityDelta: 0, amount0: 0, amount1: 214, fee0: 0, fee1: 214, tickLower: -128, tickUpper: 154 },
  { kind: "DECREASE", tokenId: 12841, owner: wallet, tx: "0x" + "3".repeat(40), block: 21_955_410, logIndex: 0, timestamp: 1_722_559_620, liquidityDelta: 1180, amount0: 91, amount1: 301_500, fee0: 0, fee1: 0, tickLower: -128, tickUpper: 154 },
  { kind: "INCREASE", tokenId: 12841, owner: wallet, tx: "0x" + "4".repeat(40), block: 22_004_990, logIndex: 0, timestamp: 1_724_764_740, liquidityDelta: 980, amount0: 76, amount1: 258_900, fee0: 0, fee1: 0, tickLower: -128, tickUpper: 154 },
  { kind: "COLLECT", tokenId: 12841, owner: wallet, tx: "0x" + "5".repeat(40), block: 22_118_333, logIndex: 2, timestamp: 1_731_422_580, liquidityDelta: 0, amount0: 0, amount1: 331, fee0: 0, fee1: 331, tickLower: -128, tickUpper: 154 },
];

/** In-memory stand-in for the pg-backed Db (methods the API + worker call). */
function makeDb() {
  const db = {
    investigations: new Map(),
    events: new Map(),
    strategies: new Map(),
    programs: new Map(),
    challenges: new Map(), // challenge → { strategy_id, consumed }
    authorizations: [],
    archives: [],
    _seq: 1,
    uid: (t) => `${t}_${db._seq++}`,

    async insertInvestigation(row) {
      const id = this.uid("inv");
      this.investigations.set(id, { id, wallet: row.wallet, status: "queued", source: row.source, events_fingerprint: row.eventsFingerprint, summary_json: JSON.stringify(row.summary) });
      return id;
    },
    async setInvestigationStatus(id, status, error) {
      const r = this.investigations.get(id);
      if (r) { r.status = status; r.error = error ?? null; }
    },
    async updateInvestigationResult(id, patch) {
      const r = this.investigations.get(id);
      if (!r) return;
      r.source = patch.source;
      r.events_fingerprint = patch.eventsFingerprint;
      r.summary_json = JSON.stringify(patch.summary);
    },
    async getInvestigation(id) {
      const r = this.investigations.get(id);
      return r ? { id: r.id, wallet: r.wallet, status: r.status, source: r.source, summary: JSON.parse(r.summary_json) } : null;
    },
    async insertEvents(investigation, evs) {
      this.events.set(investigation, evs);
    },
    async insertStrategy(investigation, strategy, irId, versionHash, family, confidence, source) {
      const id = this.uid("strat");
      this.strategies.set(id, { id, investigation, ir_id: irId, strategy_version_hash: versionHash, family, confidence, source, program: null });
      return id;
    },
    async insertBacktest() {},
    async insertProgram(strategyId, program, compatibility) {
      this.programs.set(strategyId, { program, compatibility });
    },
    async issueChallenge(strategyId, challenge) {
      this.challenges.set(challenge, { strategy_id: strategyId, consumed: false });
    },
    async markChallengeConsumed(challenge) {
      const c = this.challenges.get(challenge);
      if (c) c.consumed = true;
    },
    async consumedChallenges(strategyId) {
      return [...this.challenges.entries()].filter(([, c]) => c.strategy_id === strategyId && c.consumed).map(([ch]) => ch);
    },
    async insertAuthorization(strategyId, claims, signature, validated, verification) {
      this.authorizations.push({ strategyId, worldId: claims.worldId, signature, validated, status: validated ? "authorized" : "rejected" });
    },
    async insertArchives(investigation, refs) {
      for (const a of refs) this.archives.push({ ref: a.ref, kind: a.kind, contentHash: a.contentHash, sizeBytes: a.sizeBytes, source: a.demo ? "0G_DEMO" : "0G_LIVE", investigation });
    },
    /** The three SQL reads the API issues, answered from the in-memory tables. */
    async query(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes("ir_json as strategy")) {
        const row = this.strategies.get(params[0]);
        const prog = this.programs.get(params[0]);
        return row ? [{ strategy: row, compatibility: prog?.compatibility ?? null }] : [];
      }
      if (s.includes("strategy_version_hash") && s.includes("program_hash")) {
        const row = this.strategies.get(params[0]);
        const prog = this.programs.get(params[0]);
        return row ? [{ strategy_version_hash: row.strategy_version_hash, program_hash: prog?.program.programHash ?? null }] : [];
      }
      if (s.includes("from archives")) {
        return this.archives.filter((a) => a.investigation === params[0]).map((a) => ({ ref: a.ref, kind: a.kind, contentHash: a.contentHash, sizeBytes: a.sizeBytes, source: a.source, ts: Date.now() }));
      }
      return [];
    },
  };
  return db;
}

/** In-memory queue: add() runs the real pipeline + the worker's persistence steps. */
function makeQueue(db) {
  return {
    async add(_name, job) {
      const { wallet, investigationId, events: evs, priceSeries, observedRange } = job;
      await db.setInvestigationStatus(investigationId, "reconstructing");
      if (!evs) {
        await db.setInvestigationStatus(investigationId, "failed", "no live events and no fallback");
        return;
      }
      const result = await runPipeline({ events: evs, wallet, cfg: { priceSeries, observedRange } });
      await db.updateInvestigationResult(investigationId, {
        source: "demo_fixture",
        eventsFingerprint: result.reconstruction.eventsFingerprint,
        summary: result.reconstruction,
      });
      await db.insertEvents(investigationId, evs);
      const strategyId = await db.insertStrategy(investigationId, result.strategy, result.strategy.id, result.strategyVersionHash, result.strategy.family, result.strategy.confidence, result.strategy.source.provider);
      if (result.backtest) await db.insertBacktest(strategyId, result.backtest);
      if (result.program && result.compatibility) await db.insertProgram(strategyId, result.program, result.compatibility);
      await db.insertArchives(investigationId, result.archives);
      await db.setInvestigationStatus(investigationId, "done");
      return { investigationId, source: "demo_fixture" };
    },
  };
}

function start() {
  const db = makeDb();
  const app = createApi({ db, queue: makeQueue(db), worldCfg: { worldId: "0x…demo" }, demoKey: "trace-demo-key" });
  return { db, app };
}

test("complete investigation workflow: queue → done → authorize → archive", async () => {
  const { db, app } = start();

  // 0) health
  let r = await app.dispatch("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // 1) queue the investigation with the labelled fixture events (the demo path)
  r = await app.dispatch("POST", "/investigations", {
    wallet,
    events,
    priceSeries: Array.from({ length: 40 }, (_, i) => ({ block: 21_800_030 + i * 20_000, price: 3400 * (1 + 0.05 * Math.sin(i / 4)) })),
    observedRange: { tickLower: -128, tickUpper: 154 },
  });
  assert.equal(r.status, 202);
  const investigationId = r.body.investigationId;
  assert.ok(investigationId);

  // 2) poll the result (the in-memory worker finished synchronously)
  r = await app.dispatch("GET", `/investigations/${investigationId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "done");
  assert.equal(r.body.source, "demo_fixture");
  assert.equal(r.body.summary.counts.positions, 1);
  assert.ok(r.body.summary.eventsFingerprint.startsWith("fnv1a:"));

  // 3) strategy compatibility (the strategy row was persisted by the worker)
  const strategyId = [...db.strategies.keys()][0];
  r = await app.dispatch("GET", `/strategies/${strategyId}/compatibility`);
  assert.equal(r.status, 200);
  assert.ok(["FULL", "PARTIAL", "INCOMPATIBLE"].includes(r.body.verdict));
  assert.equal(r.body.strategyId, strategyId);

  // 4) World Agent Pass authorization — real sign/verify through the route
  r = await app.dispatch("POST", "/authorizations", { strategyId, action: "compile+ship+2 swaps" });
  assert.equal(r.status, 200);
  assert.equal(r.body.validated, true);
  assert.match(r.body.note, /Mock proof flow/);
  assert.equal(r.body.validation.programHashMatches, true);
  assert.equal(r.body.validation.signatureOk, true);
  // the challenge was recorded and consumed (replay protection persisted)
  assert.equal(db.challenges.get(r.body.challenge)?.consumed, true);

  // 5) 0G archives — all labelled demo
  r = await app.dispatch("GET", `/archives/${investigationId}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.archives.length >= 3);
  assert.equal(r.body.allDemo, true);
});

test("POST /investigations rejects a malformed wallet", async () => {
  const { app } = start();
  const r = await app.dispatch("POST", "/investigations", { wallet: "not-an-address" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /wallet/);
});

test("GET an unknown investigation 404s", async () => {
  const { app } = start();
  const r = await app.dispatch("GET", "/investigations/does-not-exist");
  assert.equal(r.status, 404);
});

test("authorizing a strategy with no compiled program 404s", async () => {
  const { db, app } = start();
  // A strategy row with no program: the API must refuse to authorize it.
  await db.insertStrategy("inv_x", { id: "ir_orphan" }, "ir_orphan", "svh_orphan", "unknown", 0.5, "DETERMINISTIC_ONLY");
  const orphanId = [...db.strategies.keys()][0];
  const r = await app.dispatch("POST", "/authorizations", { strategyId: orphanId, action: "compile+ship+2 swaps" });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no compiled program/);
});

test("a worker with no events and no RPC marks the investigation failed", async () => {
  const { db, app } = start();
  const r = await app.dispatch("POST", "/investigations", { wallet, events: undefined, rpcUrl: undefined });
  assert.equal(r.status, 202);
  const id = r.body.investigationId;
  const after = await app.dispatch("GET", `/investigations/${id}`);
  assert.equal(after.body.status, "failed");
  assert.match(db.investigations.get(id).error, /no live events/);
});
