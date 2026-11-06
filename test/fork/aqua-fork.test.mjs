// Contract test against the REAL 1inch Aqua contracts, on a LOCAL Anvil fork of
// Ethereum Sepolia (test infrastructure only — results are labelled "local fork",
// never shown in the app as live transactions).
//
//   npm run test:fork        (needs SEPOLIA_RPC_URL and Foundry's anvil)
//
// What it proves on the real registry + AquaSwapVMRouter bytecode:
//   compile → exact approvals → ship → Shipped event + virtual balances
//   → router quote of THIS order (same order hash) priced inside the range at the
//     pool's real spot → dock → balances zeroed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createTestClient, createPublicClient, http, parseEther, publicActions, walletActions } from "viem";
import { sepolia } from "viem/chains";
import { AQUA } from "@trace/chain-config";
import { assessCompatibility, compilePlan, aquaClient } from "@trace/aqua-adapter";
import { inferFromEvidence } from "@trace/strategy-inference";
import { walletHistory, wethUsdcSeries } from "../helpers.mjs";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const MAKER = process.env.TRACE_OWNER_WALLET ?? "0x000000000000000000000000000000000000dEaD";
let anvil;

before(async () => {
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL required for fork tests");
  // Pace fork state reads to the free Infura key's measured budget (~250 credits/s).
  anvil = spawn("anvil", ["--fork-url", process.env.SEPOLIA_RPC_URL, "--port", String(PORT), "--silent", "--compute-units-per-second", "240", "--fork-retry-backoff", "1000", "--retries", "10"], { stdio: "ignore" });
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

const h = walletHistory();
const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });

async function runPlan(basis, amount0, amount1) {
  const client = createTestClient({ chain: sepolia, mode: "anvil", transport: http(RPC, { timeout: 180_000 }) }).extend(publicActions).extend(walletActions);
  assert.equal(await client.getChainId(), 11155111);
  assert.ok((await client.getCode({ address: AQUA.registry.address }))?.length > 2, "Aqua registry present on the fork");
  const aq = aquaClient(RPC);
  const checks = await aq.makerChecks(MAKER, [
    { address: basis.token0, symbol: basis.symbol0 },
    { address: basis.token1, symbol: basis.symbol1 },
  ]);
  assert.equal(checks.find((c) => c.key === "aqua.router.registry")?.ok, true, "router reads this registry");
  const spot = await aq.poolSpot(basis.pool); // the pool's REAL price at the fork block
  const compat = assessCompatibility(ir, basis, checks, spot);
  const plan = compilePlan({ ir, compat, basis, maker: MAKER, amount0, amount1, spot, registry: AQUA.registry.address, app: AQUA.swapVmRouter.address, chainId: 11155111 });

  await client.impersonateAccount({ address: MAKER });
  await client.setBalance({ address: MAKER, value: parseEther("1") });
  const send = async (step) => {
    const hash = await client.sendTransaction({ account: MAKER, to: step.to, data: step.data, value: BigInt(step.value), chain: sepolia });
    await client.waitForTransactionReceipt({ hash });
    return hash;
  };
  for (const s of plan.steps.filter((x) => x.op === "approve")) assert.equal((await aq.verifyTx(await send(s), plan, "approve")).status, "success");
  const shipped = await aq.verifyTx(await send(plan.steps.find((s) => s.op === "ship")), plan, "ship");
  return { aq, plan, shipped, send };
}

test("local fork: compiled concentrated plan ships on the real registry and the real router quotes it inside its range", async () => {
  // TEST-ONLY position ±2000 ticks around the real USDC/WETH 1% pool's price at the fork block.
  const series = wethUsdcSeries();
  const pc = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 180_000 }) });
  const live = await aquaClient(RPC).poolSpot(series.pool);
  const basis = {
    tokenId: 0, pool: series.pool, token0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", token1: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    symbol0: "USDC", symbol1: "WETH", decimals0: 6, decimals1: 18, feeTier: 10000,
    tickLower: Math.floor((live.tick - 2000) / 200) * 200, tickUpper: Math.ceil((live.tick + 2000) / 200) * 200,
    currentLiquidity: "0", burned: false, historyComplete: true,
  };
  assert.ok(await pc.getBlockNumber());
  const { aq, plan, shipped, send } = await runPlan(basis, "5000000", "1000000000000000");
  assert.equal(shipped.status, "success");
  assert.equal(shipped.matchesPlan, true);
  assert.match(shipped.outcome, /Shipped event emitted/);

  const state = await aq.strategyState(plan);
  assert.equal(state.status, "active", JSON.stringify(state.checks));
  assert.ok(state.tokens.every((t) => t.registered));
  assert.ok(state.quotes.length >= 1, "at least one direction quotable");
  for (const q of state.quotes) {
    assert.ok(!q.error, `quote ${q.direction} reverted: ${q.error}`);
    assert.equal(q.orderHashMatches, true, "router priced this exact order");
    assert.equal(q.insideRange, true, `quote ${q.direction} priced at ${q.price}, range ${plan.params.priceLow}–${plan.params.priceHigh}`);
  }

  const docked = await aq.verifyTx(await send(plan.steps.find((s) => s.op === "dock")), plan, "dock");
  assert.equal(docked.status, "success");
  assert.match(docked.outcome, /Docked event emitted/);
  assert.equal((await aq.strategyState(plan)).status, "docked");
});

test("local fork: fixture position (real wallet history) → approve → ship → dock, verified from receipts", async () => {
  const basis = Object.values(h.positions).find((p) => p.pool && p.decimals0 != null && p.tickUpper - p.tickLower < 1_700_000);
  const { plan, shipped, send, aq } = await runPlan(basis, "1000000000000000", "1000000000000000");
  assert.equal(shipped.status, "success");
  assert.equal(shipped.matchesPlan, true);
  assert.ok(plan.tokens.every((t) => shipped.outcome.includes(`${t.symbol}=${t.amount}`)), `virtual balances set: ${shipped.outcome}`);
  const docked = await aq.verifyTx(await send(plan.steps.find((s) => s.op === "dock")), plan, "dock");
  assert.equal(docked.status, "success");
  assert.ok(plan.tokens.every((t) => docked.outcome.includes(`${t.symbol}=0`)), `virtual balances zeroed: ${docked.outcome}`);
});
