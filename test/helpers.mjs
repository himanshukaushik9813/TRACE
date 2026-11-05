// Shared test helpers. Test data in test/data/ is REAL Sepolia data captured
// by scripts/capture-test-data.mjs — tests never invent chain data.
import { readFileSync } from "node:fs";

const revive = (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);

export function walletHistory() {
  return JSON.parse(readFileSync(new URL("./data/sepolia-wallet-history.json", import.meta.url), "utf8"), revive);
}

export function wethUsdcSeries() {
  return JSON.parse(readFileSync(new URL("./data/sepolia-weth-usdc-swaps.json", import.meta.url), "utf8"));
}
