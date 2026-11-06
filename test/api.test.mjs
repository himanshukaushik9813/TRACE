// API security tests: the real Express app (server/dist) with an in-memory
// database stand-in (controlled test double — never used by the application).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { createApi } from "../server/dist/api.js";

const account = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

/*
 * World ID in these tests: the server is given TEST-ONLY credentials (a locally
 * generated RP signing key) and a TEST DOUBLE in place of World's verify API
 * (developer.world.org). The double accepts a proof only if it is marked valid
 * and has not been seen before — like the real API — so the tests exercise TRACE's
 * own checks around it. Nothing here is a real World ID verification.
 */
const WORLD_TEST = { appId: "app_test_trace", rpId: "rp_test_trace", signingKey: generatePrivateKey(), action: "trace-authorize-execution", environment: "staging", enforce: true };
const worldApiCalls = [];
const worldFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  worldApiCalls.push({ url, body });
  const r = body.responses?.[0] ?? {};
  if (r.proof !== "test-double-valid-proof") return new Response(JSON.stringify({ success: false, code: "invalid_proof", detail: "proof verification failed" }), { status: 400 });
  return new Response(JSON.stringify({ success: true, nullifier: r.nullifier, environment: body.environment }), { status: 200 });
};
/** Build an IDKit-shaped result answering the server's World request (test double, not a real proof). */
export const idkitResultFor = (world, over = {}) => ({
  protocol_version: "4.0",
  nonce: world.rp_context.nonce,
  action: world.action,
  environment: world.environment,
  responses: [{ identifier: "proof_of_human", signal_hash: hashSignal(world.signal), proof: "test-double-valid-proof", nullifier: `0x${"ab".repeat(31)}${Math.floor(Math.random() * 256).toString(16).padStart(2, "0")}`, issuer_schema_id: 1 }],
  ...over,
});
const submissionFor = (world, over) => ({ result: idkitResultFor(world, over), request: { nonce: world.rp_context.nonce, expires_at: world.rp_context.expires_at, token: world.token } });

function fakeDb() {
  const db = {};
  const challenges = new Map();
  const auths = new Map();
  const plan = {
    id: "plan-1",
    strategyId: "s-1",
    maker: account.address,
    planHash: "planhash0123456789",
    strategyVersionHash: "fnv1a:abcd…ef",
    irId: "ir_test",
    plan: { steps: [{ op: "approve" }, { op: "ship" }, { op: "dock" }] },
  };
  return Object.assign(db, {
    queries: [],
    ping: async () => ({ ok: true, migrations: ["0001_init.sql"] }),
    query: async () => [],
    insertInvestigation: async () => "inv-1",
    investigations: {},
    getInvestigation: async (id) => db.investigations[id] ?? null,
    getEvents: async () => [],
    getPlan: async (id) => (id === plan.id ? plan : null),
    issueChallenge: async (planId, wallet, action, challenge, ttl) => challenges.set(challenge, { planId, wallet, action, exp: Date.now() + ttl * 1000, used: false }),
    consumeChallenge: async (challenge, planId, wallet, action) => {
      const c = challenges.get(challenge);
      if (!c || c.used || c.planId !== planId || c.wallet.toLowerCase() !== wallet.toLowerCase() || c.action !== action || c.exp < Date.now()) return false;
      c.used = true;
      return true;
    },
    insertAuthorization: async (a) => {
      const id = `auth-${auths.size + 1}`;
      auths.set(id, { id, planId: a.planId, wallet: a.wallet, action: a.action, validated: a.validated, worldStatus: a.worldStatus, worldNullifier: a.worldNullifier, live: true });
      return id;
    },
    getAuthorization: async (id) => auths.get(id) ?? null,
    nullifiers: new Set(),
    recordNullifier: async (n, action) => {
      const k = `${n}|${action}`;
      if (db.nullifiers.has(k)) return false;
      db.nullifiers.add(k);
      return true;
    },
    touchWallet: async () => {},
    upsertTransaction: async () => {
      // Simulates the second of two concurrent ship posts hitting migration 0003's index.
      if (db.failUpsertWith) throw db.failUpsertWith;
    },
  });
}

const cfg = {
  chainId: 11155111,
  sepoliaRpcUrl: "http://127.0.0.1:1", // unreachable on purpose: these tests must not touch the chain
  sepoliaFallbackRpcUrls: [],
  zeroG: {},
  storage: {},
  world: WORLD_TEST,
  corsOrigins: ["http://localhost:3000"],
};

let server;
let base;
let db;
const queue = { backend: "in-memory", add: async () => {} };
before(async () => {
  db = fakeDb();
  const app = createApi({ db, queue, cfg, worldFetch });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("rejects invalid wallet addresses and windows", async () => {
  assert.equal((await post("/investigations", { wallet: "0x123" })).status, 400);
  assert.equal((await post("/investigations", { wallet: account.address, days: 9999 })).status, 400);
  assert.equal((await post("/investigations", { wallet: account.address, days: 7 })).status, 202);
});

test("CORS only allows configured origins", async () => {
  const ok = await fetch(base + "/health", { headers: { origin: "http://localhost:3000" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const bad = await fetch(base + "/health", { headers: { origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("a challenge cannot be issued to a wallet other than the plan's maker", async () => {
  const r = await post("/plans/plan-1/challenge", { wallet: stranger.address, action: "aqua:ship" });
  assert.equal(r.status, 403);
});

const signTd = (acct, td) => acct.signTypedData({ domain: td.domain, types: td.types, primaryType: "Authorization", message: { ...td.message, chainId: BigInt(td.message.chainId), expiresAt: BigInt(td.message.expiresAt) } });

test("full authorization flow: World ID verified + wallet signed → validated; replay → rejected; execution gated by scope", async () => {
  const ch = await (await post("/plans/plan-1/challenge", { wallet: account.address, action: "aqua:ship" })).json();
  assert.equal(ch.worldStatus, "required");
  const signature = await signTd(account, ch.typedData);
  const ok = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature, world: submissionFor(ch.world) });
  const okBody = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(okBody));
  assert.equal(okBody.validated, true);

  assert.equal(okBody.verification.worldId, "verified");
  assert.match(okBody.verification.worldNullifier, /^0x[0-9a-f]+$/);

  const replay = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature, world: submissionFor(ch.world) });
  assert.equal(replay.status, 403);
  assert.equal((await replay.json()).verification.challengeFresh, false);

  // A ship authorization does not cover dock.
  const dock = await post("/transactions", { authorizationId: okBody.authorizationId, op: "dock", txHash: `0x${"11".repeat(32)}` });
  assert.equal(dock.status, 403);
});

test("a signature by another wallet is rejected", async () => {
  const ch = await (await post("/plans/plan-1/challenge", { wallet: account.address, action: "aqua:ship" })).json();
  const td = ch.typedData;
  const signature = await stranger.signTypedData({ domain: td.domain, types: td.types, primaryType: "Authorization", message: { ...td.message, chainId: BigInt(td.message.chainId), expiresAt: BigInt(td.message.expiresAt) } });
  const r = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature });
  assert.equal(r.status, 403);
});

test("no execution step is accepted without a validated authorization", async () => {
  const r = await post("/transactions", { authorizationId: "does-not-exist", op: "ship", txHash: `0x${"22".repeat(32)}` });
  assert.equal(r.status, 403);
});

const signAuthorization = async () => {
  const ch = await (await post("/plans/plan-1/challenge", { wallet: account.address, action: "aqua:ship" })).json();
  const signature = await signTd(account, ch.typedData);
  return (await (await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature, world: submissionFor(ch.world) })).json()).authorizationId;
};

test("a concurrent duplicate ship hitting the one-live-ship index is a 409, not a 500", async () => {
  const authorizationId = await signAuthorization();
  db.failUpsertWith = Object.assign(new Error('duplicate key value violates unique constraint "transactions_one_live_ship"'), { code: "23505", constraint: "transactions_one_live_ship" });
  try {
    const r = await post("/transactions", { authorizationId, op: "ship", txHash: `0x${"33".repeat(32)}` });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /not recording a duplicate/);
  } finally {
    db.failUpsertWith = null;
  }
});

test("malformed investigation ids are a 404, not a server error", async () => {
  assert.equal((await fetch(`${base}/investigations/not-a-uuid/events`)).status, 404);
  assert.equal((await fetch(`${base}/investigations/not-a-uuid/positions/1`)).status, 404);
});

test("GET /strategies/:id validates the id and returns the stored version read-only", async () => {
  assert.equal((await fetch(`${base}/strategies/not-a-uuid`)).status, 404);
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal((await fetch(`${base}/strategies/${id}`)).status, 404); // no row
  const row = { id, irId: "ir_0123456789abcdef", ir: { family: "passive_concentrated", rules: [] }, versionHash: "fnv1a:0123456789abcdef" };
  const q = db.query;
  db.query = async (sql, params) => (/from strategies s join investigations/.test(sql) && params[0] === id ? [row] : []);
  try {
    const r = await fetch(`${base}/strategies/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).strategy, row);
  } finally {
    db.query = q;
  }
});

test("What If validates its inputs and never runs for an unknown or unfinished investigation", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal((await post("/investigations/not-a-uuid/whatif", {})).status, 404);
  for (const body of [{ widthMultiplier: 0.1 }, { widthMultiplier: 9 }, { slippagePct: 0.5 }, { startCapital: -1 }, { recentre: "yes" }]) {
    const r = await post(`/investigations/${id}/whatif`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  db.getInvestigation = async () => null;
  assert.equal((await post(`/investigations/${id}/whatif`, { widthMultiplier: 2 })).status, 404);
});

test("case study: invalid or unknown ids are a 404, an unfinished run is a 409, an empty wallet is an honest empty report", async () => {
  db.getInvestigation = async (id) => db.investigations[id] ?? null; // an earlier test stubs this to null
  assert.equal((await fetch(`${base}/investigations/not-a-uuid/case-study`)).status, 404);
  assert.equal((await fetch(`${base}/investigations/00000000-0000-4000-8000-000000000999/case-study`)).status, 404);
  const running = "00000000-0000-4000-8000-000000000001";
  const empty = "00000000-0000-4000-8000-000000000002";
  db.investigations[running] = { id: running, wallet: account.address, chainId: 11155111, status: "fetching" };
  db.investigations[empty] = { id: empty, wallet: account.address, chainId: 11155111, status: "no_positions", fromBlock: "100", toBlock: "200", fromTs: "1", toTs: "2" };
  const r1 = await fetch(`${base}/investigations/${running}/case-study`);
  assert.equal(r1.status, 409);
  assert.match((await r1.json()).error, /fetching/);
  const r2 = await fetch(`${base}/investigations/${empty}/case-study`);
  assert.equal(r2.status, 200);
  const s = await r2.json();
  assert.equal(s.overview.positions, 0);
  assert.equal(s.observations.length, 0);
  assert.deepEqual(s.window, { fromBlock: 100, toBlock: 200, fromTs: 1, toTs: 2 });
  assert.match(s.limitations[0], /^No Uniswap V3 position events/);
});

test("duplicate submission: a second ship for a plan that already has a live ship is refused with the existing hash", async () => {
  const authorizationId = await signAuthorization();
  const existing = `0x${"44".repeat(32)}`;
  const realQuery = db.query;
  db.query = async (sql) => (/from transactions where plan_id/.test(sql) ? [{ tx_hash: existing, op: "ship", status: "success" }] : []);
  try {
    const r = await post("/transactions", { authorizationId, op: "ship", txHash: `0x${"55".repeat(32)}` });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.deepEqual(body.existing, [existing]);
    assert.match(body.error, /not recording a duplicate/);
  } finally {
    db.query = realQuery;
  }
});

test("plan state and reconcile only read: unknown plans are 404, malformed reconcile input is 400", async () => {
  assert.equal((await fetch(`${base}/plans/nope/state`)).status, 404);
  assert.equal((await post("/plans/plan-1/reconcile", { op: "ship", fromBlock: "x", nonce: 1 })).status, 400);
  assert.equal((await post("/plans/plan-1/reconcile", { op: "swap", fromBlock: 1, nonce: 1 })).status, 400);
  assert.equal((await post("/plans/nope/reconcile", { op: "ship", fromBlock: 1, nonce: 1 })).status, 404);
});


/* ------------------------- Phase 5: World ID ------------------------- */

const challenge = async (action = "aqua:ship", wallet = account.address) => (await post("/plans/plan-1/challenge", { wallet, action })).json();

test("World ID: the challenge binds the proof request to the exact claims (signal) and to this challenge (signed RP request)", async () => {
  const ch = await challenge();
  assert.equal(ch.worldStatus, "required");
  assert.equal(ch.world.app_id, WORLD_TEST.appId);
  assert.equal(ch.world.rp_context.rp_id, WORLD_TEST.rpId);
  assert.match(ch.world.rp_context.signature, /^0x[0-9a-f]+$/i);
  assert.ok(ch.world.rp_context.expires_at > ch.world.rp_context.created_at);
  for (const k of ["wallet", "strategyVersionHash", "planHash", "action", "challenge", "expiresAt"]) assert.ok(ch.claims[k] != null, k);
  assert.equal(ch.claims.strategyVersionHash, "fnv1a:abcd…ef");
  assert.equal(ch.claims.planHash, "planhash0123456789");
  const other = await challenge();
  assert.notEqual(other.world.signal, ch.world.signal, "each challenge gets its own signal");
  assert.notEqual(other.world.rp_context.nonce, ch.world.rp_context.nonce);
});

test("World ID: an invalid proof is rejected and nothing is authorized", async () => {
  const ch = await challenge();
  const r = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData), world: submissionFor(ch.world, { responses: [{ ...idkitResultFor(ch.world).responses[0], proof: "forged" }] }) });
  const b = await r.json();
  assert.equal(r.status, 403);
  assert.equal(b.validated, false);
  assert.equal(b.verification.worldId, "rejected");
  assert.ok(b.verification.notes.some((n) => /World verify API rejected/.test(n)));
});

test("World ID: a cancelled verification (no proof) leaves the protected action unauthorized", async () => {
  const ch = await challenge();
  const r = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData) });
  const b = await r.json();
  assert.equal(r.status, 403);
  assert.equal(b.verification.worldId, "required");
});

test("World ID: a proof generated for another authorization (other plan/challenge) is rejected", async () => {
  const a = await challenge();
  const b = await challenge();
  // Proof answers request A, submitted with authorization B.
  const r = await post("/authorizations", { planId: "plan-1", claims: b.claims, signature: await signTd(account, b.typedData), world: submissionFor(a.world) });
  const body = await r.json();
  assert.equal(r.status, 403);
  assert.equal(body.verification.worldId, "rejected");
});

test("World ID: a changed plan hash or strategy version is rejected even with a valid human proof", async () => {
  for (const field of ["planHash", "strategyVersionHash"]) {
    const ch = await challenge();
    const claims = { ...ch.claims, [field]: `${ch.claims[field]}-changed` };
    const td = { ...ch.typedData, message: { ...ch.typedData.message, [field]: claims[field] } };
    const r = await post("/authorizations", { planId: "plan-1", claims, signature: await signTd(account, td), world: submissionFor(ch.world) });
    const b = await r.json();
    assert.equal(r.status, 403, field);
    assert.equal(field === "planHash" ? b.verification.planHashMatches : b.verification.strategyVersionMatches, false);
    assert.notEqual(b.verification.worldId, "verified");
  }
});

test("World ID: a replayed proof is rejected", async () => {
  const ch = await challenge();
  const sub = submissionFor(ch.world);
  const signature = await signTd(account, ch.typedData);
  assert.equal((await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature, world: sub })).status, 200);
  const again = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature, world: sub });
  const b = await again.json();
  assert.equal(again.status, 403);
  assert.equal(b.verification.worldId, "replayed");
});

test("World ID: the wallet signature alone never counts as human verification, and the ship gate checks it again", async () => {
  // Unverified (no proof) → no validated authorization → /transactions refuses the ship.
  const ch = await challenge();
  const r = await (await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData) })).json();
  const ship = await post("/transactions", { authorizationId: r.authorizationId, op: "ship", txHash: `0x${"66".repeat(32)}` });
  assert.equal(ship.status, 403);
  // Even a validated row without a World-verified human is refused at the ship gate.
  db.forceAuth = { id: "auth-forged", planId: "plan-1", wallet: account.address, action: "aqua:ship", validated: true, worldStatus: "not_required", live: true };
  const realGet = db.getAuthorization;
  db.getAuthorization = async (id) => (id === "auth-forged" ? db.forceAuth : realGet(id));
  try {
    const g = await post("/transactions", { authorizationId: "auth-forged", op: "ship", txHash: `0x${"67".repeat(32)}` });
    assert.equal(g.status, 403);
    assert.match((await g.json()).error, /protected action/);
  } finally {
    db.getAuthorization = realGet;
  }
});

test("World ID: dock (removing a strategy) is not a protected action and needs only the wallet signature", async () => {
  const ch = await challenge("aqua:dock");
  assert.equal(ch.worldStatus, "optional");
  const r = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData) });
  const b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b));
  assert.equal(b.verification.worldId, "not_required");
});

test("World ID not registered: protected execution is disabled and the exact requirements are reported", async () => {
  const app2 = createApi({ db: fakeDb(), queue, cfg: { ...cfg, world: { action: "trace-authorize-execution", environment: "staging", enforce: true } } });
  const srv = await new Promise((res) => { const s2 = app2.listen(0, () => res(s2)); });
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ch = await (await fetch(`${b2}/plans/plan-1/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: account.address, action: "aqua:ship" }) })).json();
    assert.equal(ch.worldStatus, "unavailable");
    assert.equal(ch.world, null);
    assert.match(ch.worldRequirements, /WORLD_APP_ID.*WORLD_RP_ID.*WORLD_RP_SIGNING_KEY/);
    const r = await fetch(`${b2}/authorizations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData) }) });
    const b = await r.json();
    assert.equal(r.status, 403);
    assert.equal(b.verification.worldId, "unavailable");
  } finally {
    srv.close();
  }
});

test("World verify API receives the IDKit result unchanged", async () => {
  const ch = await challenge();
  const sub = submissionFor(ch.world);
  const before = worldApiCalls.length;
  await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature: await signTd(account, ch.typedData), world: sub });
  const call = worldApiCalls[before];
  assert.equal(call.url, `https://developer.world.org/api/v4/verify/${WORLD_TEST.rpId}`);
  assert.deepEqual(call.body, sub.result);
});
