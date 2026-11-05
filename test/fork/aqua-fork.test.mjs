// Contract test against the REAL 1inch Aqua contracts, on a local Anvil fork of
// Ethereum Sepolia (test infrastructure only — nothing here is shown in the app).
//
//   npm run test:fork        (needs SEPOLIA_RPC_URL and Foundry's anvil)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createTestClient, createPublicClient, http, parseEther, publicActions, walletActions } from "viem";
import { sepolia } from "viem/chains";
import { AQUA } from "@trace/chain-config";
import { assessCompatibility, compilePlan, aquaClient } from "@trace/aqua-adapter";
import { inferFromEvidence } from "@trace/strategy-inference";
import { walletHistory } from "../helpers.mjs";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const MAKER = process.env.TRACE_OWNER_WALLET ?? "0x000000000000000000000000000000000000dEaD";
let anvil;

before(async () => {
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL required for fork tests");
  anvil = spawn("anvil", ["--fork-url", process.env.SEPOLIA_RPC_URL, "--port", String(PORT), "--silent", "--no-rate-limit"], { stdio: "ignore" });
  const pc = createPublicClient({ chain: sepolia, transport: http(RPC) });
  for (let i = 0; i < 60; i++) {
    try {
      await pc.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil did not start");
});
after(() => anvil?.kill());

test("compiled plan executes on the real Aqua registry: approve → ship → dock, verified from receipts", async () => {
  const client = createTestClient({ chain: sepolia, mode: "anvil", transport: http(RPC) }).extend(publicActions).extend(walletActions);
  assert.equal(await client.getChainId(), 11155111);
  assert.ok((await client.getCode({ address: AQUA.registry.address }))?.length > 2, "Aqua registry present on the fork");

  const h = walletHistory();
  const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });
  const basis = Object.values(h.positions).find((p) => p.pool && p.decimals0 != null && p.tickUpper - p.tickLower < 1_700_000);
  const plan = compilePlan({
    ir,
    compat: assessCompatibility(ir, basis),
    basis,
    maker: MAKER,
    amount0: "1000000000000000",
    amount1: "1000000000000000",
    registry: AQUA.registry.address,
    app: AQUA.swapVmRouter.address,
    chainId: 11155111,
  });

  await client.impersonateAccount({ address: MAKER });
  await client.setBalance({ address: MAKER, value: parseEther("1") });
  const aq = aquaClient(RPC);
  const run = async (op) => {
    const step = plan.steps.find((s) => s.op === op);
    const hash = await client.sendTransaction({ account: MAKER, to: step.to, data: step.data, value: BigInt(step.value), chain: sepolia });
    await client.waitForTransactionReceipt({ hash });
    return aq.verifyTx(hash, plan, op);
  };

  for (const s of plan.steps.filter((x) => x.op === "approve")) {
    const hash = await client.sendTransaction({ account: MAKER, to: s.to, data: s.data, chain: sepolia });
    const r = await client.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
  }

  const shipped = await run("ship");
  assert.equal(shipped.status, "success");
  assert.equal(shipped.matchesPlan, true);
  assert.match(shipped.outcome, /Shipped event emitted/);
  assert.ok(plan.tokens.every((t) => shipped.outcome.includes(`${t.symbol}=${t.amount}`)), `virtual balances set: ${shipped.outcome}`);

  const docked = await run("dock");
  assert.equal(docked.status, "success");
  assert.match(docked.outcome, /Docked event emitted/);
  assert.ok(plan.tokens.every((t) => docked.outcome.includes(`${t.symbol}=0`)), `virtual balances zeroed: ${docked.outcome}`);
});
