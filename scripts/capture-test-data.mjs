#!/usr/bin/env node
/**
 * Capture REAL Sepolia data once into test/data/ so unit tests are
 * deterministic and offline. Test-only — never read by the application.
 *
 *   node --env-file=.env.local scripts/capture-test-data.mjs [wallet]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createTraceClient } from "@trace/chain-data";

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL required");
const c = createTraceClient({ rpcUrl });
const wallet = process.argv[2] ?? "0x4A2268D5047E9A03c4C6A279d833337D9DD1909e";
const big = (_k, v) => (typeof v === "bigint" ? `${v}n` : v);
mkdirSync(new URL("../test/data/", import.meta.url), { recursive: true });

const h = await c.fetchWalletHistory(wallet, { days: 14 });
writeFileSync(
  new URL("../test/data/sepolia-wallet-history.json", import.meta.url),
  JSON.stringify({ capturedAt: new Date().toISOString(), source: "Ethereum Sepolia via TRACE chain-data", ...h }, big, 2),
);
console.log(`wallet ${wallet}: ${h.events.length} events, ${Object.keys(h.positions).length} positions`);

// A real, actively traded pool: WETH/USDC 1% (USDC is token0 by address order).
const pool = "0x6418EEC70f50913ff0d756B48d32Ce7C02b47C47";
const latest = await c.latestBlock();
const s = await c.fetchPoolPriceSeries(pool, latest - 12_000, latest, { decimals0: 6, decimals1: 18, symbol0: "USDC", symbol1: "WETH", feeTier: 10_000, maxSwaps: 600 });
writeFileSync(new URL("../test/data/sepolia-weth-usdc-swaps.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), ...s }, null, 2));
console.log(`pool ${pool}: ${s.points.length} swaps`);
