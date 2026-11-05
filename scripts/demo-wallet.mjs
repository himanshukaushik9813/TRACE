#!/usr/bin/env node
/**
 * scripts/demo-wallet.mjs — a dedicated Sepolia DEMO wallet with REAL
 * Uniswap V3 history, so TRACE can be demoed end to end from one MetaMask
 * account (investigate itself → DNA → backtest → ship to Aqua).
 *
 * Nothing is faked: every step is a real Sepolia transaction on the official
 * Uniswap V3 contracts, against the actively traded WETH/USDC 1% pool.
 *
 *   node --env-file=.env.local scripts/demo-wallet.mjs create    # new key → .demo-wallet.local.json (gitignored)
 *   node --env-file=.env.local scripts/demo-wallet.mjs status    # ETH / WETH / USDC / V3 positions
 *   node --env-file=.env.local scripts/demo-wallet.mjs seed      # wrap, swap, mint a WETH/USDC range position
 *   node --env-file=.env.local scripts/demo-wallet.mjs collect   # collect fees on every open position
 *   node --env-file=.env.local scripts/demo-wallet.mjs rerange   # withdraw + collect, re-mint around the current price
 *
 * TESTNET ONLY. The key is stored in plain text: never send mainnet funds to it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, maxUint128, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const FILE = new URL("../.demo-wallet.local.json", import.meta.url);
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // token0 (lower address)
const POOL = "0x6418EEC70f50913ff0d756B48d32Ce7C02b47C47"; // WETH/USDC 1%
const NPM = "0x1238536071E1c677A632429e3655c799b22cDA52";
const ROUTER = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E"; // SwapRouter02
const FEE = 10000;
const SPACING = 200;

const WETH_ABI = parseAbi(["function deposit() payable"]);
const POOL_ABI = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)", "function liquidity() view returns (uint128)"]);
const ROUTER_ABI = parseAbi([
  "struct P { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(P params) payable returns (uint256 amountOut)",
]);
const NPM_ABI = parseAbi([
  "struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }",
  "struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
  "function positions(uint256) view returns (uint96, address, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128, uint128)",
]);

const rpc = process.env.SEPOLIA_RPC_URL;
if (!rpc) throw new Error("SEPOLIA_RPC_URL missing — run with: node --env-file=.env.local scripts/demo-wallet.mjs <cmd>");
const pub = createPublicClient({ chain: sepolia, transport: http(rpc, { retryCount: 6, retryDelay: 1500 }) });
const scrub = (e) => String(e?.shortMessage ?? e?.message ?? e).replace(/https?:\/\/\S+/g, "<rpc>");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  if (!existsSync(FILE)) throw new Error("No demo wallet yet. Run: node --env-file=.env.local scripts/demo-wallet.mjs create");
  const { privateKey } = JSON.parse(readFileSync(FILE, "utf8"));
  const account = privateKeyToAccount(privateKey);
  return { account, wallet: createWalletClient({ account, chain: sepolia, transport: http(rpc, { retryCount: 6, retryDelay: 1500 }) }) };
}

async function send(wallet, label, req) {
  const hash = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${r.status === "success" ? "✓" : "✗"} ${label}  https://sepolia.etherscan.io/tx/${hash}`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
  await sleep(400);
  return r;
}

const bal = (token, who) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

async function approveExact(wallet, token, spender, amount, label) {
  const cur = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet.account.address, spender] });
  if (cur >= amount) return;
  await send(wallet, `approve ${label} (exact ${amount})`, { address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

async function positionsOf(owner) {
  const n = await pub.readContract({ address: NPM, abi: NPM_ABI, functionName: "balanceOf", args: [owner] });
  const out = [];
  for (let i = 0n; i < n; i++) {
    const id = await pub.readContract({ address: NPM, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [owner, i] });
    const p = await pub.readContract({ address: NPM, abi: NPM_ABI, functionName: "positions", args: [id] });
    out.push({ id, token0: p[2], token1: p[3], fee: p[4], tickLower: p[5], tickUpper: p[6], liquidity: p[7] });
  }
  return out;
}

async function currentTick() {
  const [, tick] = await pub.readContract({ address: POOL, abi: POOL_ABI, functionName: "slot0" });
  return Number(tick);
}

/** Mint a WETH/USDC 1% position spanning `below`/`above` tick-spacings around the current tick, using what the wallet holds. */
async function mintAround(wallet, below, above, wethBudget) {
  const me = wallet.account.address;
  const tick = await currentTick();
  const base = Math.floor(tick / SPACING) * SPACING;
  const tickLower = base - below * SPACING;
  const tickUpper = base + above * SPACING;
  const amount0 = await bal(USDC, me);
  const wethBal = await bal(WETH, me);
  const amount1 = wethBudget != null && wethBudget < wethBal ? wethBudget : wethBal;
  console.log(`  pool tick ${tick} → range [${tickLower}, ${tickUpper}], offering ${formatUnits(amount0, 6)} USDC + ${formatEther(amount1)} WETH`);
  await approveExact(wallet, USDC, NPM, amount0, "USDC → NPM");
  await approveExact(wallet, WETH, NPM, amount1, "WETH → NPM");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  await send(wallet, `mint WETH/USDC 1% [${tickLower}, ${tickUpper}]`, {
    address: NPM,
    abi: NPM_ABI,
    functionName: "mint",
    args: [{ token0: USDC, token1: WETH, fee: FEE, tickLower, tickUpper, amount0Desired: amount0, amount1Desired: amount1, amount0Min: 0n, amount1Min: 0n, recipient: me, deadline }],
  });
}

const cmd = process.argv[2] ?? "status";
try {
  if (cmd === "create") {
    if (existsSync(FILE)) throw new Error(".demo-wallet.local.json already exists — refusing to overwrite a wallet that may hold funds.");
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    writeFileSync(FILE, JSON.stringify({ address, privateKey, network: "sepolia", createdAt: new Date().toISOString(), note: "TRACE demo wallet — TESTNET ONLY" }, null, 2) + "\n", { mode: 0o600 });
    console.log(`Created demo wallet ${address}\nKey saved to .demo-wallet.local.json (gitignored). Fund it with ~0.05 Sepolia ETH, then run: seed`);
  } else if (cmd === "status") {
    const { account } = load();
    const me = account.address;
    const [eth, weth, usdc, tick] = await Promise.all([pub.getBalance({ address: me }), bal(WETH, me), bal(USDC, me), currentTick()]);
    console.log(`demo wallet ${me}\n  ETH ${formatEther(eth)} · WETH ${formatEther(weth)} · USDC ${formatUnits(usdc, 6)} · WETH/USDC 1% pool tick ${tick}`);
    for (const p of await positionsOf(me)) console.log(`  position #${p.id} fee ${p.fee} ticks [${p.tickLower}, ${p.tickUpper}] liquidity ${p.liquidity}`);
  } else if (cmd === "seed") {
    const { account, wallet } = load();
    const me = account.address;
    const eth = await pub.getBalance({ address: me });
    const wrapAmt = parseEther(process.env.WRAP ?? "0.02");
    if (eth < wrapAmt + parseEther("0.008")) throw new Error(`demo wallet has ${formatEther(eth)} ETH; needs at least ${formatEther(wrapAmt + parseEther("0.008"))} (wrap + gas). Send Sepolia ETH to ${me}.`);
    console.log(`Seeding ${me}`);
    await send(wallet, `wrap ${formatEther(wrapAmt)} ETH → WETH`, { address: WETH, abi: WETH_ABI, functionName: "deposit", value: wrapAmt });
    const swapIn = wrapAmt / 2n;
    await approveExact(wallet, WETH, ROUTER, swapIn, "WETH → SwapRouter02");
    await send(wallet, `swap ${formatEther(swapIn)} WETH → USDC (WETH/USDC 1%)`, {
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WETH, tokenOut: USDC, fee: FEE, recipient: me, amountIn: swapIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
    });
    // First range: wide-ish around the current price, with half of each token, so later re-ranges have funds.
    const usdcHalf = (await bal(USDC, me)) / 2n;
    const wethHalf = (await bal(WETH, me)) / 2n;
    const tick = await currentTick();
    const base = Math.floor(tick / SPACING) * SPACING;
    const tickLower = base - 5 * SPACING, tickUpper = base + 6 * SPACING;
    await approveExact(wallet, USDC, NPM, usdcHalf, "USDC → NPM");
    await approveExact(wallet, WETH, NPM, wethHalf, "WETH → NPM");
    await send(wallet, `mint WETH/USDC 1% [${tickLower}, ${tickUpper}]`, {
      address: NPM,
      abi: NPM_ABI,
      functionName: "mint",
      args: [{ token0: USDC, token1: WETH, fee: FEE, tickLower, tickUpper, amount0Desired: usdcHalf, amount1Desired: wethHalf, amount0Min: 0n, amount1Min: 0n, recipient: me, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200) }],
    });
    console.log("Done. Run `collect` and `rerange` later (minutes apart) to build up real lifecycle history.");
  } else if (cmd === "collect") {
    const { account, wallet } = load();
    for (const p of await positionsOf(account.address)) {
      await send(wallet, `collect #${p.id}`, { address: NPM, abi: NPM_ABI, functionName: "collect", args: [{ tokenId: p.id, recipient: account.address, amount0Max: maxUint128, amount1Max: maxUint128 }] });
    }
  } else if (cmd === "rerange") {
    const { account, wallet } = load();
    const open = (await positionsOf(account.address)).filter((p) => p.liquidity > 0n && p.fee === FEE && p.token0.toLowerCase() === USDC.toLowerCase());
    if (open.length === 0) throw new Error("no open WETH/USDC 1% position to re-range — run seed first");
    const p = open[open.length - 1];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    await send(wallet, `withdraw all liquidity from #${p.id}`, { address: NPM, abi: NPM_ABI, functionName: "decreaseLiquidity", args: [{ tokenId: p.id, liquidity: p.liquidity, amount0Min: 0n, amount1Min: 0n, deadline }] });
    await send(wallet, `collect principal + fees from #${p.id}`, { address: NPM, abi: NPM_ABI, functionName: "collect", args: [{ tokenId: p.id, recipient: account.address, amount0Max: maxUint128, amount1Max: maxUint128 }] });
    await mintAround(wallet, 3, 4);
  } else {
    throw new Error(`unknown command "${cmd}" (create | status | seed | collect | rerange)`);
  }
} catch (e) {
  console.error(`✗ ${scrub(e)}`);
  process.exit(1);
}
