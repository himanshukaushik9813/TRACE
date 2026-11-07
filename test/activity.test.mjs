// GET /activity/:wallet paging: the real Express app (server/dist) with an
// in-memory database stand-in that records the SQL it receives (a controlled
// test double, never used by the application).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApi, activityPage } from "../server/dist/api.js";

const WALLET = "0x4797a94741b2512c3236d61ca0195638c44deb4c";
const row = (i) => ({ id: `inv-${i}`, wallet: WALLET, status: "done", error: null, createdAt: new Date(Date.UTC(2026, 10, 7, 0, 0, 0) - i * 60_000).toISOString(), counts: null });

const calls = [];
let rowsToReturn = [];
const db = {
  ping: async () => ({ ok: true }),
  query: async (sql, params) => {
    calls.push({ sql, params });
    return rowsToReturn.slice(0, params[1]);
  },
  listTransactions: async () => [{ tx_hash: "0x01" }],
};
const cfg = { chainId: 11155111, sepoliaRpcUrl: "http://127.0.0.1:1", sepoliaFallbackRpcUrls: [], zeroG: {}, storage: {}, corsOrigins: [] };

let server;
let base;
before(async () => {
  const app = createApi({ db, queue: { backend: "in-memory", add: async () => {} }, cfg });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const get = (q = "") => fetch(`${base}/activity/${WALLET}${q}`);

test("no paging parameters: same query and response as before (newest 50), plus hasMore", async () => {
  rowsToReturn = Array.from({ length: 32 }, (_, i) => row(i));
  calls.length = 0;
  const r = await get();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.investigations.length, 32);
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.transactions, [{ tx_hash: "0x01" }]);
  assert.equal(calls[0].params[1], 51, "asks for one extra row only to know whether more exist");
  assert.ok(!/created_at </.test(calls[0].sql), "no cursor clause without `before`");
  assert.match(calls[0].sql, /order by created_at desc/);
});

test("more than the limit: returns exactly `limit` rows and hasMore = true", async () => {
  rowsToReturn = Array.from({ length: 80 }, (_, i) => row(i));
  const body = await (await get("?limit=10")).json();
  assert.equal(body.investigations.length, 10);
  assert.equal(body.hasMore, true);
  assert.equal(body.investigations[0].id, "inv-0");
});

test("`before` adds a created_at cursor with a normalised ISO timestamp", async () => {
  rowsToReturn = [row(5)];
  calls.length = 0;
  const r = await get(`?limit=10&before=${encodeURIComponent("2026-11-06T23:55:00Z")}`);
  assert.equal(r.status, 200);
  assert.match(calls[0].sql, /created_at < \$3/);
  assert.equal(calls[0].params[2], "2026-11-06T23:55:00.000Z");
});

test("invalid paging parameters are rejected with 400, not ignored", async () => {
  assert.equal((await get("?limit=0")).status, 400);
  assert.equal((await get("?limit=101")).status, 400);
  assert.equal((await get("?limit=abc")).status, 400);
  assert.equal((await get("?before=not-a-date")).status, 400);
});

test("activityPage defaults match the original behaviour", () => {
  assert.deepEqual(activityPage({}), { limit: 50, before: null });
});
