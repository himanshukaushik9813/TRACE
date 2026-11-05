import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructSummary, reconstructPositions } from "@trace/uniswap-v3";
import { scrubSecrets } from "@trace/chain-data";
import { walletHistory } from "./helpers.mjs";

const h = walletHistory();

test("real Sepolia capture: reconstruction is order-independent", () => {
  const opts = { wallet: h.wallet, chainId: 11155111, network: "Ethereum Sepolia", window: h.window };
  const a = reconstructSummary(h.events, h.positions, opts);
  const b = reconstructSummary([...h.events].reverse(), h.positions, opts);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.accounting, b.accounting);
  assert.equal(a.counts.positions, Object.keys(h.positions).length);
  assert.equal(a.chainId, 11155111);
});

test("every reconstructed event carries real tx evidence", () => {
  for (const e of h.events) {
    assert.match(e.tx, /^0x[0-9a-f]{64}$/i);
    assert.ok(e.block >= 3_518_286, "event before the NPM deployment block");
  }
});

test("collect accounting counts ONLY the fee portion (principal counted once, at DECREASE)", () => {
  const ledger = reconstructPositions(h.events);
  for (const t of ledger.values()) {
    const evs = h.events.filter((e) => e.tokenId === t.tokenId);
    const fees0 = evs.filter((e) => e.kind === "COLLECT").reduce((s, e) => s + Number(e.fee0), 0);
    const withdrawn0 = evs.filter((e) => e.kind === "DECREASE").reduce((s, e) => s + Number(e.amount0), 0);
    assert.equal(t.feesCollected.t0, fees0);
    assert.equal(t.withdrawn.t0, withdrawn0);
  }
});

test("amounts are normalised with the token's real decimals", () => {
  const s = reconstructSummary(h.events, h.positions, { wallet: h.wallet, chainId: 11155111, network: "Ethereum Sepolia" });
  const p = s.positions.find((x) => x.decimals0 != null);
  const acct = s.accounting.find((a) => a.tokenId === p.tokenId);
  const raw = h.events.filter((e) => e.tokenId === p.tokenId && (e.kind === "MINT" || e.kind === "INCREASE")).reduce((x, e) => x + Number(e.amount0), 0);
  assert.equal(acct.deposited.token0, raw / 10 ** p.decimals0);
});

test("RPC provider keys are scrubbed from error text", () => {
  const msg = "request failed URL: https://sepolia.infura.io/v3/0123456789abcdef0123456789abcdef and https://user:pw@db.example.com";
  const out = scrubSecrets(msg);
  assert.ok(!out.includes("0123456789abcdef0123456789abcdef"));
  assert.ok(!out.includes("user:pw"));
});
