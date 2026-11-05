// Live integration tests against Ethereum Sepolia (real RPC, real contracts).
//   npm run test:live
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import assert from "node:assert/strict";
import { PROBED_CONTRACTS } from "@trace/chain-config";
import { createTraceClient } from "@trace/chain-data";
import { reconstructSummary } from "@trace/uniswap-v3";

const live = process.env.TRACE_LIVE_TESTS === "1" && process.env.SEPOLIA_RPC_URL;
const c = live ? createTraceClient({ rpcUrl: process.env.SEPOLIA_RPC_URL }) : null;

test("RPC is Ethereum Sepolia (11155111)", { skip: !live }, async () => {
  await c.assertChain();
  assert.ok((await c.latestBlock()) > 3_518_286);
});

test("every configured contract has bytecode on Sepolia", { skip: !live }, async () => {
  for (const k of PROBED_CONTRACTS) {
    const p = await c.probeCode(k.ref.address);
    assert.ok(p.hasCode, `${k.label} ${k.ref.address} has no code`);
  }
});

test("finds real active LP wallets and reconstructs one end-to-end", { skip: !live, timeout: 600_000 }, async () => {
  const lps = await c.findActiveLpWallets(3);
  assert.ok(lps.length > 0, "no active LPs found in the lookback window");
  let done = false;
  for (const lp of lps) {
    try {
      const h = await c.fetchWalletHistory(lp.wallet, { days: 7 });
      const s = reconstructSummary(h.events, h.positions, { wallet: h.wallet, chainId: 11155111, network: "Ethereum Sepolia", window: h.window });
      assert.ok(s.counts.events > 0);
      assert.ok(h.events.every((e) => /^0x[0-9a-f]{64}$/i.test(e.tx)));
      done = true;
      break;
    } catch (err) {
      if (err.code !== "NO_EVENTS") throw err;
    }
  }
  assert.ok(done, "no LP wallet had activity in the last 7 days");
});

test("a wallet without positions yields NO_EVENTS (genuine empty state, not sample data)", { skip: !live, timeout: 300_000 }, async () => {
  await assert.rejects(() => c.fetchWalletHistory(privateKeyToAddress(generatePrivateKey()), { days: 3 }), (e) => e.code === "NO_EVENTS");
});
