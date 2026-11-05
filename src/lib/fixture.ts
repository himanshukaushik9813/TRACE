/**
 * TRACE — labelled demo fixture (known-good investigation dataset).
 *
 * Per the spec: "Prepare a known-good wallet investigation dataset as a
 * fallback. Never fake successful execution or sponsor integration."
 *
 * Everything here is clearly sample data. It is used when live chain / 0G /
 * Aqua / World endpoints are unavailable, and every screen that renders it
 * carries an explicit "DEMO DATA" label so it is never mistaken for a live
 * on-chain result.
 */

export const DEMO = {
  labelled: true,
  source: "known-good fixture · not a live chain read",
  wallet: {
    address: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C",
    display: "0x2C…E37C",
    network: "Ethereum Mainnet",
    chainId: 1,
    identityNote: "Public Uniswap V3 LP — reconstructed from public events",
    firstObserved: "2024-06-11T09:24:00Z",
    mostRecentObserved: "2025-10-30T18:02:00Z",
  },
  stats: {
    lpPositions: 12,
    pools: 5,
    reconstructedEvents: 342,
    candidateStrategies: 5,
    observedPeriod: "16 months",
  },
};

/* ------------------------------------------------------------------ */
/*  Uniswap V3 positions (blockchain evidence)                        */
/* ------------------------------------------------------------------ */
export type Position = {
  id: string;
  tokenPair: string; // "ETH / USDC"
  tokens: [string, string];
  tokenColors: [string, string];
  nftId: number;
  feeTier: string;
  pool: string;
  status: "Active" | "Closed";
  liquidity: number; // human units (log-normal)
  tickLower: number;
  tickUpper: number;
  rangeLo: number; // price, base token units of quote
  rangeHi: number;
  lastActivity: string;
  inRange: boolean;
  lastPrice: number; // quote price of base
  spark: number[]; // price sparkline
};

export const POSITIONS: Position[] = [
  {
    id: "pos-eth-usdc",
    tokenPair: "ETH / USDC",
    tokens: ["ETH", "USDC"],
    tokenColors: ["#C6A66B", "#78866B"],
    nftId: 12841,
    feeTier: "0.05%",
    pool: "0xE5e2…b8a1",
    status: "Active",
    liquidity: 4218.5,
    tickLower: -128,
    tickUpper: 154,
    rangeLo: 3080,
    rangeHi: 3920,
    lastActivity: "2025-10-28 · range re-set",
    inRange: true,
    lastPrice: 3412.7,
    spark: [3010, 3088, 3145, 3200, 3180, 3260, 3315, 3290, 3372, 3412],
  },
  {
    id: "pos-wbtc-eth",
    tokenPair: "WBTC / ETH",
    tokens: ["WBTC", "ETH"],
    tokenColors: ["#C6A66B", "#9AA88C"],
    nftId: 9927,
    feeTier: "0.30%",
    pool: "0x8d4c…f210",
    status: "Active",
    liquidity: 8.42,
    tickLower: -86,
    tickUpper: 121,
    rangeLo: 18.4,
    rangeHi: 21.9,
    lastActivity: "2025-10-21 · +liquidity",
    inRange: true,
    lastPrice: 20.14,
    spark: [21.7, 21.1, 20.9, 20.4, 20.6, 20.1, 20.2, 19.8, 20.0, 20.14],
  },
  {
    id: "pos-eth-dai",
    tokenPair: "ETH / DAI",
    tokens: ["ETH", "DAI"],
    tokenColors: ["#C6A66B", "#B7B0A2"],
    nftId: 11205,
    feeTier: "0.05%",
    pool: "0x4fA2…c07d",
    status: "Closed",
    liquidity: 0,
    tickLower: -140,
    tickUpper: 180,
    rangeLo: 3050,
    rangeHi: 4010,
    lastActivity: "2025-09-02 · burned",
    inRange: false,
    lastPrice: 3408.1,
    spark: [3400, 3350, 3300, 3280, 3310, 3360, 3390, 3408, 3405, 3408],
  },
];

/* ------------------------------------------------------------------ */
/*  Position lifecycle events (evidence timeline)                     */
/* ------------------------------------------------------------------ */
export type LifecycleEvent = {
  tx: string;
  block: number;
  ts: string;
  type: "MINT" | "INCREASE" | "DECREASE" | "COLLECT" | "TRANSFER" | "BURN";
  liquidityDelta: number;
  note: string;
  tokens?: string;
};

export const LIFECYCLE: LifecycleEvent[] = [
  { tx: "0x9f3a…b21c", block: 21_834_102, ts: "2024-06-11 09:24", type: "MINT", liquidityDelta: 4218, note: "Range set · 3,080 → 3,920", tokens: "Deposited 312 ETH + 1,048,200 USDC" },
  { tx: "0x7c1d…40aa", block: 21_890_551, ts: "2024-07-03 14:11", type: "COLLECT", liquidityDelta: 0, note: "Fee sweep · $412", tokens: "214 USDC fees collected" },
  { tx: "0x12b8…9e01", block: 21_955_410, ts: "2024-08-01 20:47", type: "DECREASE", liquidityDelta: -1180, note: "Trim on upside", tokens: "Withdrew 91 ETH + 301,500 USDC" },
  { tx: "0xa4f0…c3d7", block: 22_004_990, ts: "2024-08-27 02:19", type: "INCREASE", liquidityDelta: 980, note: "Re-entry on pullback", tokens: "Deployed 76 ETH + 258,900 USDC" },
  { tx: "0x5e90…7f2b", block: 22_118_333, ts: "2024-11-12 08:03", type: "COLLECT", liquidityDelta: 0, note: "Fee sweep · $638", tokens: "331 USDC fees collected" },
  { tx: "0xd0c2…1a8e", block: 22_201_777, ts: "2025-02-19 16:40", type: "INCREASE", liquidityDelta: 1420, note: "Widen on new low", tokens: "Deployed 111 ETH + 373,600 USDC" },
];

/* ------------------------------------------------------------------ */
/*  Position accounting                                               */
/* ------------------------------------------------------------------ */
export const ACCOUNTING = {
  deposited: 1_048_200, // USDC-eq
  withdrawn: 555_400,
  collectedFees: 1_418,
  estimatedUnrealised: 286,
  remainingLiquidity: 4218.5,
};

/* ------------------------------------------------------------------ */
/*  Strategy DNA — behavioural fingerprints (calculated metrics)      */
/* ------------------------------------------------------------------ */
export type DnaDim = {
  key: string;
  label: string;
  value: number; // 0..100
  derived: string; // how it was derived
};

export const DNA: DnaDim[] = [
  { key: "rangeFreq", label: "Range adjustment frequency", value: 82, derived: "4 range re-sets / 120d → high" },
  { key: "reallocation", label: "Capital reallocation", value: 68, derived: "±34% liquidity swings on pullbacks" },
  { key: "feeActivity", label: "Fee collection activity", value: 54, derived: "Bi-monthly sweeps, 2.1/wk" },
  { key: "priceResp", label: "Price responsiveness", value: 77, derived: "Median 26h re-entry lag after range exit" },
  { key: "persistence", label: "Position persistence", value: 91, derived: "16-month continuous exposure, no gap" },
  { key: "reentry", label: "Re-entry behaviour", value: 73, derived: "Re-deployed after 3 of 5 exit events" },
  { key: "concentration", label: "Liquidity concentration", value: 41, derived: "Wide 24% range → moderate density" },
  { key: "holding", label: "Holding duration", value: 88, derived: "86% of time position open" },
];

/* ------------------------------------------------------------------ */
/*  Inferred strategy rules + hypothesis                              */
/* ------------------------------------------------------------------ */
export const STRATEGY = {
  family: "ACTIVE RANGE MANAGEMENT",
  confidence: 78,
  supportingPositions: 12,
  relevantEvents: 61,
  period: "2024-06 → 2025-10",
  model: "TraceInfer v0.4 · deterministic fingerprints + 0G hypothesis",
  evidenceCompleteness: 86,
};

export type InferredRule = {
  rule: string;
  evidence: string;
  confidence: number;
  alternative: string;
  uncertainty: string;
};

export const RULES: InferredRule[] = [
  {
    rule: "Re-sets the liquidity range after sustained price movement",
    evidence: "4 re-sets; each 18–40h after price left the prior band",
    confidence: 0.82,
    alternative: "Could be reaction to external price targets, not a trigger rule",
    uncertainty: "Range trigger threshold not observable on-chain; inferred from timing",
  },
  {
    rule: "Reallocates capital toward the side of the expected range",
    evidence: "Liquidity tilts 61/39 toward predicted leg in 7 of 9 windows",
    confidence: 0.63,
    alternative: "May be passive inventory balancing rather than directional",
    uncertainty: "Direction signal only weakly separable from fee optimisation",
  },
  {
    rule: "Sweeps fees on a bi-monthly cadence",
    evidence: "Collect tx every 42–51 days, $380–$640",
    confidence: 0.9,
    alternative: "Fixed cron job; cadence may be gas-gated",
    uncertainty: "Low — regular and unambiguous",
  },
  {
    rule: "Re-enters the pool after a liquidity decrease (re-deploy)",
    evidence: "Re-deployed in 3 of 5 exit events within ≤30d",
    confidence: 0.7,
    alternative: "Capital redeployment across a new pool, not the same range",
    uncertainty: "Cross-pool movement not fully reconstructed for 2 exits",
  },
];

export type Alternative = { label: string; score: number; why: string };
export const ALTERNATIVES: Alternative[] = [
  { label: "Passive concentrated liquidity", score: 41, why: "Fails — 4 active re-sets contradict a set-and-forget posture" },
  { label: "Periodic range adjustment", score: 66, why: "Plausible — cadence partly regular, but not a fixed interval" },
  { label: "Active range management", score: 78, why: "Best fit — timing tracks price exits, not a clock" },
  { label: "Repeated capital deploy/withdraw", score: 55, why: "Partial — deploy/withdraw present but ranges also shift" },
];

export const INFER_META = {
  requestRef: "0G-PC-req_5f3a9c21 · demo",
  model: "LLM via 0G Private Computer (demo path — not a live 0G call)",
  schemaValid: true,
  attestation: "Not attested (demo inference; no 0G attestation produced)",
  ts: "2025-11-02 07:14 UTC",
};

/* ------------------------------------------------------------------ */
/*  Strategy Lab / backtest                                           */
/* ------------------------------------------------------------------ */
export const BACKTEST = {
  period: "2024-06-11 → 2025-10-30",
  startCapital: 1_200_000,
  gasAssumption: "32 gwei avg",
  slippage: 0.12,
  runs: [
    { name: "Observed wallet replay", net: 0.081, maxDd: 0.19, color: "#171714" },
    { name: "Inferred strategy (replay)", net: 0.064, maxDd: 0.21, color: "#B68A42" },
    { name: "Passive V3 LP (static range)", net: 0.042, maxDd: 0.28, color: "#78866B" },
    { name: "Buy & hold ETH", net: 0.124, maxDd: 0.34, color: "#B7B0A2" },
  ],
};

export function equitySeries(base: number, drift: number, vol: number, n = 90, seed = 11): number[] {
  // deterministic pseudo-random walk so charts are reproducible
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const out: number[] = [base];
  let v = base;
  for (let i = 1; i < n; i++) {
    v = v * (1 + drift / n + (rnd() - 0.5) * vol / Math.sqrt(n));
    out.push(v);
  }
  return out;
}

export const EQUITY: Record<string, number[]> = {
  observed: equitySeries(1_200_000, 0.081, 0.34, 96, 7),
  inferred: equitySeries(1_200_000, 0.064, 0.3, 96, 19),
  passive: equitySeries(1_200_000, 0.042, 0.26, 96, 23),
  bnh: equitySeries(1_200_000, 0.124, 0.42, 96, 31),
};

/* ------------------------------------------------------------------ */
/*  Aqua execution console                                            */
/* ------------------------------------------------------------------ */
export type Compat = { rule: string; status: "full" | "partial" | "unsupported" };
export const COMPAT: Compat[] = [
  { rule: "Bi-monthly fee sweep", status: "full" },
  { rule: "Re-deploy after exit (same range)", status: "partial" },
  { rule: "Price-exit range trigger", status: "unsupported" },
  { rule: "Directional liquidity tilt", status: "unsupported" },
];

export const COMPAT_VERDICT: "FULL" | "PARTIAL" | "INCOMPATIBLE" = "PARTIAL";

export type ExecStep = { label: string; done: boolean; detail?: string };
export const EXEC_STEPS: ExecStep[] = [
  { label: "Validate strategy", done: true },
  { label: "Compile supported rules", done: true },
  { label: "Generate execution plan", done: true },
  { label: "Obtain quote", done: true, detail: "Ship +2 swap legs · est. gas 184k" },
  { label: "Human authorization (World Agent Pass)", done: false },
  { label: "Sign transaction", done: false },
  { label: "Submit transaction", done: false },
  { label: "Verify receipt", done: false },
];

export const EXEC_CONFIG = {
  tokenPair: "ETH / USDC",
  capitalAllocation: "40% of pool A · 60% of pool B",
  priceConditions: "Rebalance when price exits ±6% of mid",
  riskLimits: "Max out-of-range exposure 14 days",
  minOutput: "99.2%",
  slippage: "0.12%",
};

/* ------------------------------------------------------------------ */
/*  World Agent Pass authorization                                    */
/* ------------------------------------------------------------------ */
export const WORLD_AUTH = {
  bound: [
    ["User", "World ID · 0x…9f2a (demo)"],
    ["Strategy version", "v0.4 · sha256:7c1e…d4"],
    ["Execution plan", "plan_8812 · ship-dock-swap"],
    ["Action", "compile + ship + 2 swaps"],
    ["Expiry", "2025-11-05 09:00 UTC"],
    ["Challenge", "0x3af9…c1 (unique)"],
  ] as [string, string][],
  status: "PENDING HUMAN APPROVAL",
  note: "Mock proof flow (hackathon-supported). Not production identity verification.",
};

export const STORAGE = [
  { ref: "0G-STOR-arc_11a3 · demo", kind: "Investigation summary", ts: "2025-11-02 07:15" },
  { ref: "0G-STOR-arc_11a4 · demo", kind: "Behavioural fingerprint", ts: "2025-11-02 07:15" },
  { ref: "0G-STOR-arc_11a5 · demo", kind: "Inference output v0.4", ts: "2025-11-02 07:16" },
  { ref: "0G-STOR-arc_11a6 · demo", kind: "Backtest report", ts: "2025-11-02 07:19" },
];
