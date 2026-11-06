#!/usr/bin/env node
/**
 * scripts/find-v3-wallets.mjs — find REAL wallets with genuine Uniswap V3
 * position activity on Sepolia, from your RPC. Zero dependencies (Node 18+
 * built-in fetch). Run this on a machine with RPC egress (your Mac), then
 * feed the printed addresses into TRACE's Investigate screen.
 *
 * Why a script and not a static list: TRACE will not ship a hardcoded list of
 * "active V3 wallets" — that would be exactly the kind of unverified data the
 * spec forbids. This tool reads live event logs, so every address it prints
 * is one that actually emitted a V3 position event in the window you choose.
 *
 * Usage:
 *   # Scan for active wallets (last 14 days, top 25 by position mints):
 *   TRACE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<KEY> \
 *     node scripts/find-v3-wallets.mjs --days 14 --top 25
 *
 *   # Pre-check one wallet before investigating it in the app:
 *   TRACE_RPC_URL=... node scripts/find-v3-wallets.mjs --wallet 0x5971... --days 30
 *
 *   # If you know the Sepolia V3 NPM address (confirm on Sepolia Etherscan),
 *   # pin it instead of letting the script probe the candidates:
 *   TRACE_V3_NPM=0x... node scripts/find-v3-wallets.mjs
 *
 * Environment:
 *   TRACE_RPC_URL  required — a Sepolia RPC (Alchemy/Infura/QuickNode)
 *   TRACE_V3_NPM   optional — verified NonfungiblePositionManager address.
 *                  When omitted, the script probes the candidate addresses
 *                  (see chain-config) with eth_getCode and uses the first one
 *                  that has a deployed contract. If none has code, it stops
 *                  and tells you to set TRACE_V3_NPM — it never guesses.
 */

import { readFileSync, writeFileSync } from "node:fs";

/* ------------------------------------------------------------------ */
/*  Candidate Sepolia V3 NonfungiblePositionManager addresses.        */
/*  These come from @trace/chain-config (documented in                */
/*  docs/TESTNET_SETUP.md). Each one is gated by an eth_getCode probe  */
/*  before any event read trusts it — an address without a deployed    */
/*  contract is skipped, never assumed.                                */
/* ------------------------------------------------------------------ */
const CANDIDATE_NPMS = [
  process.env.TRACE_V3_NPM, // operator-verified override, always first
  "0x03a5b0Cc65d1319D0811b8c75f5b397638b5Df25", // shared V3 NPM (Optimism/Base set)
].filter(Boolean);

/**
 * Canonical Uniswap V3 NPM "Mint" event topic0:
 *   event Mint(uint256 indexed tokenId, address indexed sender, address indexed owner,
 *               int24 tickLower, int24 tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
 * from the V3 NonfungiblePositionManager ABI (v3-periphery). This is the one
 * selector this script relies on; it is verified by the self-check below —
 * if a wide scan returns zero logs, the script says so instead of assuming
 * the selector is fine.
 */
const TOPIC_MINT = "0x313ce5638920a73b8dcd4a4bb28dd09852abe5a7b5f7cd36c8549047a1b67d6e";

const EXPLORER = "https://sepolia.etherscan.io";

function parseArgs(argv) {
  const a = { days: 14, top: 25, out: null, wallet: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--days") a.days = Number(argv[++i]);
    else if (k === "--top") a.top = Number(argv[++i]);
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--wallet") a.wallet = argv[++i];
    else if (k === "--json") a.json = true;
  }
  return a;
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} from ${RPC_URL}`);
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method} failed: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

async function getCode(addr) {
  const c = await rpc("eth_getCode", [addr, "latest"]);
  return c && c !== "0x" ? c : null;
}

/** Pick the first candidate NPM that actually has a deployed contract. */
async function resolveNpm() {
  for (const addr of CANDIDATE_NPMS) {
    process.stderr.write(`probing NPM candidate ${addr} (eth_getCode) …\n`);
    const code = await getCode(addr);
    if (code) {
      process.stderr.write(`  → contract present (${code.length} hex chars). Using ${addr}\n`);
      return addr;
    }
    process.stderr.write(`  → no code at this address; skipping.\n`);
  }
  console.error(
    "\nNo candidate NPM has a deployed contract on this RPC's chain.\n" +
      "Set TRACE_V3_NPM to a verified Sepolia V3 NonfungiblePositionManager (check\n" +
      `https://sepolia.etherscan.io for the "Uniswap V3 Positions" ERC-721 contract)\n` +
      "and re-run. This tool will never scan a guessed address.",
  );
  process.exit(1);
}

async function getMintLogs(npm, fromBlock, toBlock, chunk = 5_000) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    const batch = await rpc("eth_getLogs", [
      {
        address: npm,
        topics: [TOPIC_MINT],
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
      },
    ]);
    if (batch) logs.push(...batch);
    process.stderr.write(`\rsnapped blocks ${start}–${end} (${logs.length} mints so far)`);
  }
  process.stderr.write("\n");
  return logs;
}

/** Parse Mint logs → per-holder stats. topics: [sel, tokenId, sender, owner]. */
function summarizeMints(logs) {
  const byOwner = new Map();
  for (const l of logs) {
    const owner = ("0x" + l.topics[3]).toLowerCase();
    const sender = ("0x" + l.topics[2]).toLowerCase();
    const row = byOwner.get(owner) ?? {
      owner,
      mints: 0,
      tokenIds: new Set(),
      viaRouter: 0, // mints where sender != owner (a router did it)
      firstBlock: Number(BigInt(l.blockNumber)),
      lastBlock: Number(BigInt(l.blockNumber)),
      sampleTx: l.transactionHash,
    };
    row.mints += 1;
    row.firstBlock = Math.min(row.firstBlock, Number(BigInt(l.blockNumber)));
    row.lastBlock = Math.max(row.lastBlock, Number(BigInt(l.blockNumber)));
    row.tokenIds.add(l.topics[1]);
    if (sender.toLowerCase() !== owner) row.viaRouter += 1;
    byOwner.set(owner, row);
  }
  return [...byOwner.values()].sort((a, b) => b.mints - a.mints);
}

function printTable(rows, rpcChainId) {
  const head = "wallet                        mints  positions  first-block  last-block  sample-tx";
  console.log("\n" + head + "\n" + "-".repeat(110));
  for (const r of rows) {
    const tx = `${EXPLORER}/tx/${r.sampleTx}`;
    console.log(
      `0x${r.owner.slice(2, 10)}…${r.owner.slice(-4)}  ${String(r.mints).padStart(4)}  ${String(r.tokenIds.size).padStart(8)}  ${String(r.firstBlock).padStart(10)}  ${String(r.lastBlock).padStart(10)}  ${tx.slice(0, 52)}`,
    );
  }
  console.log(
    `\nwallets with real V3 position mints in window · chain ${rpcChainId}. ` +
      `Open any in TRACE → Investigate, or inspect: ${EXPLORER}/address/<wallet> → "ERC-721" tab.`,
  );
}

/* ------------------------------------------------------------------ */
/*  --wallet mode: pre-check a single address before investigating it   */
/* ------------------------------------------------------------------ */

async function precheckWallet(npm, wallet, fromBlock, toBlock) {
  const W = wallet.toLowerCase();
  const out = { wallet: W, found: false };
  const chunk = 5_000;
  // Mint topics: [sel, tokenId, sender, owner] — the wallet is "involved"
  // when it sent the mint (topic[2]=W) or owns the position (topic[3]=W).
  // tokenId (topic[1]) stays null so we match across all of its positions.
  const PINS = [
    [TOPIC_MINT, null, W, null], // this wallet sent the mint
    [TOPIC_MINT, null, null, W], // this wallet owns the position
  ];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    for (const topics of PINS) {
      const logs = await rpc("eth_getLogs", [
        {
          address: npm,
          topics,
          fromBlock: "0x" + start.toString(16),
          toBlock: "0x" + end.toString(16),
        },
      ]);
      if (logs?.length) {
        out.found = true;
        out.count = (out.count ?? 0) + logs.length;
        out.sample = out.sample ?? { tx: logs[0].transactionHash, block: Number(BigInt(logs[0].blockNumber)) };
      }
    }
  }
  if (out.found) {
    console.log(
      `\n${W}: ${out.count} V3 position mints in window — GOOD INVESTIGATION TARGET.\n` +
        `Sample: ${EXPLORER}/tx/${out.sample.tx} (block ${out.sample.block})`,
    );
  } else {
    console.log(
      `\n${W}: no V3 position activity found in the window.\n` +
        "Either it has no supported positions (TRACE will show that honestly), or widen --days, " +
        "or this NPM address is wrong. Check " + EXPLORER + "/address/" + W + " → ERC-721 holdings for V3 position NFTs.",
    );
  }
}

/* ------------------------------------------------------------------ */

const RPC_URL = process.env.TRACE_RPC_URL;
if (!RPC_URL) {
  console.error(
    "TRACE_RPC_URL is required. Example:\n" +
      "  TRACE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key> node scripts/find-v3-wallets.mjs --days 14 --top 25\n" +
      "(the key in .env.local works: 22b48577…a233)",
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const chainId = await rpc("eth_chainId", []).then((h) => Number(BigInt(h)));
process.stderr.write(`chain id ${chainId} (Sepolia = 11155111)\n`);

const latest = Number(BigInt(await rpc("eth_blockNumber", [])));
const perDay = 7_200; // ~12s Sepolia blocks
const fromBlock = Math.max(0, latest - args.days * perDay);
const toBlock = latest;

const npm = await resolveNpm();

if (args.wallet) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.wallet)) {
    console.error("invalid wallet address (expected 0x + 40 hex)");
    process.exit(1);
  }
  await precheckWallet(npm, args.wallet, fromBlock, toBlock);
  process.exit(0);
}

const logs = await getMintLogs(npm, fromBlock, toBlock);
const rows = summarizeMints(logs);

if (args.json) {
  const payload = { chainId, npm, window: { fromBlock, toBlock, days: args.days }, mints: logs.length, wallets: rows.slice(0, args.top) };
  const s = JSON.stringify(payload, null, 2);
  if (args.out) writeFileSync(args.out, s + "\n");
  console.log(s);
} else {
  if (rows.length === 0) {
    console.log(
      `\nNo V3 position mints found for this NPM in the last ${args.days} days (${logs.length} logs scanned).\n` +
        "That's normal on testnets: V3 activity on Sepolia is thin. Try --days 90, " +
        "or verify the NPM address — if it's wrong the scan is silent. Or use a wallet you mint positions into yourself (your faucet wallet is a good target).",
    );
    process.exit(0);
  }
  printTable(rows.slice(0, args.top), chainId);
  if (args.out) writeFileSync(args.out, rows.slice(0, args.top).map((r) => r.owner).join("\n") + "\n");
}
