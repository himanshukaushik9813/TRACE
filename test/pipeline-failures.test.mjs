// Investigation pipeline failure paths (Phase 2): RPC failure and an empty wallet end
// honestly: a failed or no-positions status with the real error code, and nothing
// partial written. The chain client is a controlled stand-in that throws the same
// errors the real one does (makeChainError), so this runs without network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChainError } from "@trace/chain-data";
import { runStages } from "../server/dist/pipeline.js";

function recorder() {
  const statuses = [];
  const writes = [];
  const db = {
    setStatus: async (id, status, progress, error) => (statuses.push({ id, status, progress, error }), true),
    isCancelled: async () => false,
    query: async () => [],
  };
  // Any persistence call during a failed run would be a bug: record it.
  for (const m of ["saveReconstruction", "insertEvents", "insertPositions", "saveDna", "insertStrategy", "insertInferenceRun", "insertBacktest", "insertStorage", "setIntegrations"])
    db[m] = async () => writes.push(m);
  return { db, statuses, writes };
}
const cfg = { zeroG: {}, storage: {} };
const job = { investigationId: "00000000-0000-4000-8000-0000000000aa", wallet: "0x4A2268D5047E9A03c4C6A279d833337D9DD1909e", days: 30 };

test("RPC failure: the investigation fails with the real error code, scrubbed, and stores nothing", async () => {
  const { db, statuses, writes } = recorder();
  const secretUrl = "https://sepolia.infura.io/v3/0123456789abcdef0123456789abcdef";
  const chain = { fetchWalletHistory: async () => { throw makeChainError("RPC_UNREACHABLE", `fetch failed: ${secretUrl}`); } };
  await runStages(job, db, cfg, chain);
  const last = statuses.at(-1);
  assert.equal(last.status, "failed");
  assert.equal(last.progress.errorCode, "RPC_UNREACHABLE");
  assert.match(last.error, /^RPC_UNREACHABLE: /);
  assert.ok(!last.error.includes("0123456789abcdef0123456789abcdef"), "the RPC key never reaches the stored error");
  assert.deepEqual(writes, [], "no partial reconstruction, DNA, strategy or backtest is written");
});

test("rate limiting that never clears is reported as such, not as an empty wallet", async () => {
  const { db, statuses, writes } = recorder();
  const chain = { fetchWalletHistory: async () => { throw makeChainError("RATE_LIMITED", "429 Too Many Requests"); } };
  await runStages(job, db, cfg, chain);
  assert.equal(statuses.at(-1).status, "failed");
  assert.equal(statuses.at(-1).progress.errorCode, "RATE_LIMITED");
  assert.deepEqual(writes, []);
});

test("empty wallet: NO_EVENTS completes as no_positions (a genuine answer), with nothing invented", async () => {
  const { db, statuses, writes } = recorder();
  const chain = { fetchWalletHistory: async () => { throw makeChainError("NO_EVENTS", "no Uniswap V3 position events for this wallet in the window"); } };
  await runStages(job, db, cfg, chain);
  assert.equal(statuses.at(-1).status, "no_positions");
  assert.deepEqual(writes, []);
});
