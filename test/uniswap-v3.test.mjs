// @trace/uniswap-v3 — deterministic V3 position reconstruction: order
// independence, principal-vs-fees separation, range reset counting.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconstructPositions,
  reconstructSummary,
  rangeResets,
  toNumberEvents,
} from "@trace/uniswap-v3";

function ev(p) {
  return {
    kind: "MINT",
    tokenId: 1,
    owner: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C",
    tx: "0x" + "1".repeat(40),
    block: 100,
    logIndex: 0,
    timestamp: 1_700_000_000,
    liquidityDelta: 0,
    amount0: 0,
    amount1: 0,
    fee0: 0,
    fee1: 0,
    tickLower: -128,
    tickUpper: 154,
    ...p,
  };
}

test("reconstructPositions is order-independent (out-of-order input is sorted)", () => {
  const e1 = ev({ kind: "MINT", block: 100, liquidityDelta: 1000 });
  const e2 = ev({ kind: "INCREASE", block: 200, liquidityDelta: 500, logIndex: 1 });
  const ledgerA = reconstructPositions([e1, e2]);
  const ledgerB = reconstructPositions([e2, e1]);
  assert.equal(ledgerA.get(1).liquidity, 1500);
  assert.equal(ledgerB.get(1).liquidity, 1500);
  assert.equal(ledgerA.get(1).liquidity, ledgerB.get(1).liquidity);
});

test("principal withdrawals are kept strictly distinct from fees", () => {
  const events = [
    ev({ kind: "MINT", liquidityDelta: 1000, amount0: 10, amount1: 2000 }),
    ev({ kind: "COLLECT", block: 150, fee0: 3, fee1: 500 }),
    ev({ kind: "DECREASE", block: 180, liquidityDelta: 300, amount0: 4, amount1: 500 }),
  ];
  const s = reconstructSummary(events, {}, { wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C", chainId: 1, network: "Ethereum Mainnet" });
  const acct = s.accounting[0];
  // deposited = MINT principal only
  assert.equal(acct.deposited.token0, 10);
  assert.equal(acct.deposited.token1, 2000);
  // withdrawn = DECREASE principal only
  assert.equal(acct.withdrawn.token0, 4);
  assert.equal(acct.withdrawn.token1, 500);
  // fees collected separately — never mixed into principal
  assert.equal(acct.feesCollected.token0, 3);
  assert.equal(acct.feesCollected.token1, 500);
  assert.equal(acct.feesUncollected.token0, 0); // engine never estimates
  // net principal position
  assert.equal(acct.netPosition.token0, 10 - 4);
  assert.equal(acct.netPosition.token1, 2000 - 500);
});

test("a full DECREASE is classified as a BURN and closes the position", () => {
  const events = [
    ev({ kind: "MINT", liquidityDelta: 1000 }),
    ev({ kind: "BURN", block: 300, liquidityDelta: 1000 }),
  ];
  const s = reconstructSummary(events, {}, { wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C", chainId: 1, network: "Ethereum Mainnet" });
  assert.equal(s.counts.closed, 1);
  assert.equal(s.positions[0].status, "closed");
  assert.equal(s.positions[0].closedBlock, 300);
});

test("rangeResets counts distinct range re-sets across positions", () => {
  const events = [
    ev({ kind: "MINT", block: 100, tickLower: -128, tickUpper: 154, liquidityDelta: 1000 }),
    ev({ kind: "INCREASE", block: 200, tickLower: -64, tickUpper: 80, liquidityDelta: 100 }),
    ev({ kind: "INCREASE", block: 300, tickLower: -64, tickUpper: 80, liquidityDelta: 100 }), // same range: not a reset
    ev({ kind: "INCREASE", block: 400, tickLower: -32, tickUpper: 128, liquidityDelta: 100 }),
  ];
  const ledger = reconstructPositions(events);
  assert.equal(rangeResets(ledger), 2); // 154→80 (new), 80→128 (new); the middle one is a repeat
});

test("toNumberEvents converts bigint quantities to numbers", () => {
  const out = toNumberEvents([ev({ liquidityDelta: 10n, amount0: 5n })]);
  assert.equal(out[0].liquidityDelta, 10);
  assert.equal(typeof out[0].liquidityDelta, "number");
  assert.equal(out[0].amount0, 5);
});

test("an empty event set yields an empty, well-formed summary", () => {
  const s = reconstructSummary([], {}, { wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C", chainId: 1, network: "Ethereum Mainnet" });
  assert.equal(s.counts.events, 0);
  assert.equal(s.counts.positions, 0);
  assert.equal(s.period.fromTs, 0);
  assert.equal(s.period.toTs, 0);
});
