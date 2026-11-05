// API security tests: the real Express app (server/dist) with an in-memory
// database stand-in (controlled test double — never used by the application).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApi } from "../server/dist/api.js";

const account = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

function fakeDb() {
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
  return {
    queries: [],
    ping: async () => ({ ok: true, migrations: ["0001_init.sql"] }),
    query: async () => [],
    insertInvestigation: async () => "inv-1",
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
      auths.set(id, { id, planId: a.planId, wallet: a.wallet, action: a.action, validated: a.validated, live: true });
      return id;
    },
    getAuthorization: async (id) => auths.get(id) ?? null,
    touchWallet: async () => {},
    upsertTransaction: async () => {},
  };
}

const cfg = {
  chainId: 11155111,
  sepoliaRpcUrl: "http://127.0.0.1:1", // unreachable on purpose: these tests must not touch the chain
  sepoliaFallbackRpcUrls: [],
  zeroG: {},
  storage: {},
  world: { action: "trace-authorize-execution", environment: "staging" },
  corsOrigins: ["http://localhost:3000"],
};

let server;
let base;
const queue = { backend: "in-memory", add: async () => {} };
before(async () => {
  const app = createApi({ db: fakeDb(), queue, cfg });
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

test("full authorization flow: sign → verified; replay → rejected; execution gated by scope", async () => {
  const ch = await (await post("/plans/plan-1/challenge", { wallet: account.address, action: "aqua:ship" })).json();
  const td = ch.typedData;
  const signature = await account.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: "Authorization",
    message: { ...td.message, chainId: BigInt(td.message.chainId), expiresAt: BigInt(td.message.expiresAt) },
  });
  const ok = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature });
  const okBody = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(okBody));
  assert.equal(okBody.validated, true);

  const replay = await post("/authorizations", { planId: "plan-1", claims: ch.claims, signature });
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
