// Response to price movement (Strategy DNA): how often the real pool price left a
// position's range, and whether the wallet changed liquidity before it came back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFingerprints, computePriceResponse } from "@trace/strategy-inference";
import { walletHistory, wethUsdcSeries } from "./helpers.mjs";

const h = walletHistory();
const series = wethUsdcSeries(); // REAL Sepolia USDC/WETH swaps (27 points)
const pool = series.pool;
const at = (block) => series.points.find((p) => p.block === block);

test("no price series for the wallet's pools → response metrics are null, never estimated", () => {
  const f = computeFingerprints(h.events, h.positions, {}, h.window);
  assert.equal(f.priceRangeExits, null);
  assert.equal(f.exitsAnsweredByAction, null);
  assert.equal(f.medianResponseHours, null);
});

// The cases below put a TEST-ONLY position range over the REAL captured prices,
// so the exit/answer logic is checked against real tick movement.
test("an exit answered by a liquidity change before the price returns is counted, with its delay", () => {
  // Range [173800, 174200): real ticks 173882 → 174134 → 174184 (inside) → 174231 at block 12061884 (exit; never returns).
  const exit = at(12061884);
  const ledgers = [{ tokenId: 1, openedBlock: 12060000, closedBlock: null }];
  const meta = { 1: { pool, tickLower: 173800, tickUpper: 174200 } };
  const act = { kind: "DECREASE", tokenId: 1, pool, block: 12062000, timestamp: exit.timestamp + 7200 };
  const r = computePriceResponse(ledgers, [act], meta, { [pool]: series });
  assert.equal(r.exits, 1);
  assert.equal(r.answered, 1);
  assert.deepEqual(r.delays, [2]);
});

test("an exit the price recovers from on its own is not counted as answered", () => {
  // Range [174285, 174300): inside from 174289; 174281 at block 12066385 leaves; 174286 at 12067220 is back inside.
  const ledgers = [{ tokenId: 2, openedBlock: 12063800, closedBlock: null }];
  const meta = { 2: { pool, tickLower: 174285, tickUpper: 174300 } };
  // A wallet action AFTER the price came back must not be credited to that exit.
  const late = { kind: "INCREASE", tokenId: 2, pool, block: 12067300, timestamp: at(12067230).timestamp + 60 };
  const r = computePriceResponse(ledgers, [late], meta, { [pool]: series });
  assert.ok(r.exits >= 1, "the real ticks leave this range at least once");
  const first = computePriceResponse(ledgers, [], meta, { [pool]: series });
  assert.equal(first.answered, 0, "no action → nothing answered");
  // The late action may only answer a LATER exit (if any), never the one that recovered by itself.
  assert.ok(r.answered <= r.exits - 1, "the self-recovered exit is not credited");
});

test("actions in another pool do not answer an exit", () => {
  const ledgers = [{ tokenId: 1, openedBlock: 12060000, closedBlock: null }];
  const meta = { 1: { pool, tickLower: 173800, tickUpper: 174200 } };
  const elsewhere = { kind: "DECREASE", tokenId: 9, pool: "0x0000000000000000000000000000000000000001", block: 12062000, timestamp: at(12061884).timestamp + 60 };
  const r = computePriceResponse(ledgers, [elsewhere], meta, { [pool]: series });
  assert.equal(r.exits, 1);
  assert.equal(r.answered, 0);
});
