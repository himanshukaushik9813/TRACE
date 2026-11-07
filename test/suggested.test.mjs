// GET /wallets/suggested resilience (server/src/suggested.ts): cache, single
// flight, and honest degradation when the Sepolia RPC rate-limits the scan.
// The scan here is a scripted test double; it is never used by the application.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuggestedWallets } from "../server/dist/suggested.js";

const chainError = (code, message = code) => Object.assign(new Error(message), { code });
const LIST = { wallets: [{ wallet: "0xabc" }], source: "test", computedAt: "2026-11-07T00:00:00.000Z" };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("a successful scan is cached for the TTL, then refreshed", async () => {
  const c = clock();
  let scans = 0;
  const get = createSuggestedWallets(async () => (scans++, LIST), { now: c.now, ttlMs: 1000 });
  assert.deepEqual(await get(), { status: 200, body: LIST });
  await get();
  assert.equal(scans, 1);
  c.advance(1001);
  await get();
  assert.equal(scans, 2);
});

test("concurrent requests share one in-flight scan", async () => {
  let scans = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const get = createSuggestedWallets(async () => (scans++, await gate, LIST));
  const all = Promise.all([get(), get(), get()]);
  release();
  const results = await all;
  assert.equal(scans, 1);
  for (const r of results) assert.equal(r.status, 200);
});

test("rate-limited with no good result yet: 503 with a reason and Retry-After, and no rescans during the back-off", async () => {
  const c = clock();
  let scans = 0;
  const get = createSuggestedWallets(async () => (scans++, Promise.reject(chainError("RATE_LIMITED", "Too Many Requests"))), { now: c.now, backoffMs: 60_000 });
  const r = await get();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "RATE_LIMITED");
  assert.match(r.body.error, /rate-limiting/);
  assert.equal(r.retryAfterSec, 60);
  c.advance(30_000);
  const again = await get();
  assert.equal(again.status, 503);
  assert.equal(again.retryAfterSec, 30);
  assert.equal(scans, 1, "no new scan while backing off");
  c.advance(30_001);
  await get();
  assert.equal(scans, 2, "scans again once the back-off has passed");
});

test("an unclassified provider error saying 'Too Many Requests' is treated as a rate limit", async () => {
  const get = createSuggestedWallets(async () => Promise.reject(new Error("Too Many Requests")));
  assert.equal((await get()).status, 503);
});

test("rate-limited after a good result: the last good list is served, marked stale", async () => {
  const c = clock();
  let fail = false;
  const get = createSuggestedWallets(async () => (fail ? Promise.reject(chainError("RATE_LIMITED")) : LIST), { now: c.now, ttlMs: 1000 });
  await get();
  fail = true;
  c.advance(2000);
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.body.stale, true);
  assert.deepEqual(r.body.wallets, LIST.wallets);
});

test("an unreachable RPC degrades the same way, with its own reason", async () => {
  const get = createSuggestedWallets(async () => Promise.reject(chainError("RPC_UNREACHABLE")));
  const r = await get();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "RPC_UNREACHABLE");
  assert.match(r.body.error, /could not be reached/);
});

test("any other error is not masked: it propagates (and stays a 500)", async () => {
  const get = createSuggestedWallets(async () => Promise.reject(chainError("RPC_ERROR", "boom")));
  await assert.rejects(get(), /boom/);
});
