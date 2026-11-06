/**
 * Frontend data layer — real data only.
 *
 * Every screen reads from the TRACE API (NEXT_PUBLIC_TRACE_API_URL), which
 * reads Ethereum Sepolia. There are no fixtures and no demo fallbacks: when
 * the API is unreachable a screen shows the error; when a wallet has no
 * positions it shows the genuine empty state.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // Covers both real causes of a rejected fetch: the API process is down,
    // and the browser blocking the call (CORS/origin mismatch — e.g. the app
    // was opened at a LAN IP instead of localhost). Tell the user how to fix both.
    throw new ApiError(
      0,
      `TRACE API unreachable at ${API_URL} — make sure the server is running (npm run start:server in its own terminal) and that you opened the app at http://localhost:3000 (other local URLs can be blocked by the browser's CORS rules).`,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`, body);
  return body as T;
}

/* ------------------------------------------------------------------ */
/*  Wire types (mirror the server JSON)                                */
/* ------------------------------------------------------------------ */

export type IntegrationStatus = "VERIFIED LIVE" | "VERIFIED TESTNET" | "IMPLEMENTED BUT NOT VERIFIED" | "BLOCKED BY EXTERNAL DEPENDENCY" | "NOT IMPLEMENTED";
export type Integrations = {
  computedAt: string;
  chain: { chainId: number; ok: boolean; latestBlock: number | null; error?: string };
  contracts: { key: string; label: string; address: string; source: string; hasCode: boolean | null; bytes: number }[];
  integrations: { key: string; label: string; status: IntegrationStatus; detail: string; checkedAt: string }[];
};

export type InvestigationStatus = "queued" | "fetching" | "reconstructing" | "inferring" | "backtesting" | "archiving" | "done" | "no_positions" | "failed";

export type Investigation = {
  id: string;
  wallet: string;
  chainId: number;
  status: InvestigationStatus;
  progress: Record<string, unknown> & { stage?: string; errorCode?: string; events?: number; positions?: number; rpcCalls?: number };
  windowDays: number;
  fromBlock: number | null;
  toBlock: number | null;
  fromTs: number | null;
  toTs: number | null;
  eventsFingerprint: string | null;
  summary: ReconstructionSummary | null;
  notes: string[];
  integrations: {
    inference?: { status: string; reason: string | null; detail: string | null; requestId: string | null; model: string | null; teeVerified: boolean | null };
    backtest?: { status: string; detail: string };
    storage?: { status: string; errors: { kind: string; error: string }[]; uploaded: number };
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type V3Position = {
  tokenId: number;
  pool: string;
  token0: string;
  token1: string;
  token0Address?: string;
  token1Address?: string;
  decimals0?: number | null;
  decimals1?: number | null;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  status: "active" | "closed";
  openedBlock?: number;
  closedBlock?: number;
  lastActivityBlock?: number;
  historyComplete?: boolean;
};

export type Accounting = {
  tokenId: number;
  deposited: { token0: number; token1: number };
  withdrawn: { token0: number; token1: number };
  feesCollected: { token0: number; token1: number };
  feesUncollected: { token0: number; token1: number };
  netPosition: { token0: number; token1: number };
};

export type ReconstructionSummary = {
  wallet: string;
  chainId: number;
  network: string;
  eventsFingerprint: string;
  period: { fromTs: number; toTs: number };
  counts: { events: number; positions: number; pools: number; closed: number };
  positions: V3Position[];
  accounting: Accounting[];
};

export type ChainEvent = {
  tx: string;
  logIndex: number;
  block: string | number;
  timestamp: string | number;
  kind: "MINT" | "INCREASE" | "DECREASE" | "COLLECT" | "TRANSFER" | "BURN";
  tokenId: string;
  pool: string | null;
  from: string | null;
  to: string | null;
  liquidityDelta: string;
  amount0: string;
  amount1: string;
  fee0: string;
  fee1: string;
  tickLower: number;
  tickUpper: number;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
};

export type StrategyRule = {
  category: "entry" | "adjustment" | "exit" | "risk" | "fee";
  rule: string;
  evidence: string;
  evidenceRefs: string[];
  confidence: number;
  alternative: string;
  uncertainty: string;
  mapsTo?: string;
  params?: Record<string, number | string>;
};

export type StrategyIR = {
  version: "2";
  id: string;
  parentId?: string;
  wallet: string;
  chainId: number;
  sourceProtocol: string;
  evidencePeriod: { fromBlock: number; toBlock: number; fromTs: number; toTs: number };
  family: string;
  confidence: number;
  confidenceNote: string;
  rules: StrategyRule[];
  alternatives: { label: string; family: string; score: number; why: string }[];
  evidenceRefs: string[];
  limitations: string[];
  source: { model: string; provider: "0G_ROUTER" | "DETERMINISTIC_ONLY"; requestRef?: string; schemaValid: boolean; attested: boolean; ts: number };
};

export type StrategyRow = {
  id: string;
  irId: string;
  parentIrId: string | null;
  ir: StrategyIR;
  versionHash: string;
  family: string;
  confidence: string | number;
  provider: string;
  role: "evidence_baseline" | "ai_hypothesis";
  createdAt: string;
};

export type InferenceRun = {
  id: string;
  status: "succeeded" | "failed" | "rejected" | "not_configured";
  requestId: string | null;
  model: string | null;
  providerAddress: string | null;
  teeVerified: boolean | null;
  trustMode: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  error: string | null;
  latencyMs: number | null;
  rulesRejected: number;
  createdAt: string;
};

export type Fingerprints = {
  periodDays: number;
  eventCount: number;
  positionCount: number;
  activePositions: number;
  closedPositions: number;
  poolCount: number;
  avgRangeWidthTicks: number | null;
  avgRangeWidthPct: number | null;
  fullRangeShare: number;
  repositionCount: number;
  repositionsPerWeek: number;
  medianPositionDurationHours: number | null;
  increaseCount: number;
  decreaseCount: number;
  collectCount: number;
  collectCadenceDays: number | null;
  withdrawRedeployCount: number;
  medianReentryHours: number | null;
  maxLiquiditySwingPct: number;
  timeInRangePct: number | null;
  gasSpentEth: number | null;
};

export type PriceSeriesUi = {
  pool: string;
  symbol0: string;
  symbol1: string;
  fromBlock: number;
  toBlock: number;
  points: { block: number; timestamp: number; price: number; tick: number }[];
  timestampsInterpolated: boolean;
  truncated: boolean;
};

export type BacktestRun = {
  label: string;
  kind: "observed" | "counterfactual" | "benchmark";
  net: number;
  maxDrawdown: number;
  finalValue: number;
  rangeOccupancy: number | null;
  outOfRangeHours: number | null;
  rebalances: number;
  feesEarned: number;
  gasCost: number;
  impermanentLoss: number | null;
  capitalUtilization: number | null;
};

export type BacktestResult = {
  strategyId: string;
  status: "completed" | "insufficient_data";
  reason?: string;
  pool: string;
  pair: string;
  period: { fromBlock: number; toBlock: number; fromTs: number; toTs: number };
  split: { trainEndBlock: number; testStartBlock: number; gapBlocks: number; lookaheadGuard: string };
  assumptions: { valuationToken: string; startCapital: number; feeModel: string; gasModel: string; slippagePct: number; priceSource: string };
  runs: BacktestRun[];
  series: { blocks: number[]; timestamps: number[]; prices: number[]; values: { label: string; points: number[] }[] };
};

export type CompatibilityCheck = { key: string; label: string; ok: boolean; detail: string; source: string };
export type Compatibility = {
  strategyId: string;
  verdict: "FULL" | "PARTIAL" | "INCOMPATIBLE";
  rules: { rule: string; category: string; status: "supported" | "partial" | "unsupported"; gap?: string }[];
  capabilities: { name: string; usable: boolean; note: string }[];
  checks: CompatibilityCheck[];
  basis?: { tokenId: number; pool: string; token0: string; token1: string; tickLower: number; tickUpper: number; feeTier: number };
  unsupportedNotes: string[];
  assessedAt: number;
};

export type ExecutionStep = { op: "approve" | "ship" | "dock" | "swap"; description: string; to: string; data: string; value: string; approval?: { token: string; spender: string; amount: string } };
export type ExecutionPlan = {
  strategyId: string;
  planHash: string;
  format: string;
  chainId: number;
  maker: string;
  registry: string;
  app: string;
  tokens: { address: string; symbol: string; decimals: number; amount: string }[];
  order: string;
  strategyHash: string;
  params: { priceLow: number; priceHigh: number; sqrtPriceMin: string; sqrtPriceMax: string; feeBps: number; salt: string };
  steps: ExecutionStep[];
  notCompiled: string[];
};

export type StorageArtifact = { kind: string; rootHash: string; txHash: string; contentHash: string; sizeBytes: number; network: string; retrievable: boolean; createdAt: string };

export type FullInvestigation = {
  investigation: Investigation;
  strategies: StrategyRow[];
  primaryStrategyId: string | null;
  inferenceRuns: InferenceRun[];
  dna: { data: { fingerprints: Fingerprints; priceSeries: Record<string, PriceSeriesUi>; seriesErrors: string[] }; computedAt: string } | null;
  positions: Record<string, unknown>[];
  backtest: { result: BacktestResult; status: string; createdAt: string } | null;
  compatibility: { id: string; maker: string | null; verdict: string; report: Compatibility; createdAt: string } | null;
  plans: { id: string; maker: string; planHash: string; plan: ExecutionPlan; createdAt: string }[];
  storage: StorageArtifact[];
};

export type TxRow = {
  id: string;
  op: string;
  tx_hash: string;
  status: "submitted" | "success" | "reverted";
  from_addr: string | null;
  to_addr: string | null;
  block: string | null;
  confirmations: number | null;
  gas_used: string | null;
  matches_plan: boolean | null;
  outcome: string | null;
  created_at: string;
  plan_id: string;
};

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

export function useIntegrations() {
  return useQuery({ queryKey: ["integrations"], queryFn: () => api<Integrations>("/integrations"), refetchInterval: 120_000 });
}

export type SuggestedWallet = { wallet: string; mints: number; lastBlock: number; pool: string | null; pair: string | null; feeTier: number | null; poolSwaps: number };

export function useSuggestedWallets() {
  return useQuery({
    queryKey: ["suggested"],
    queryFn: () => api<{ wallets: SuggestedWallet[]; source: string; computedAt: string }>("/wallets/suggested"),
    staleTime: 10 * 60_000,
  });
}

export const TERMINAL: InvestigationStatus[] = ["done", "no_positions", "failed"];

export function useInvestigationStatus(id: string | null) {
  return useQuery({
    queryKey: ["inv", id],
    queryFn: () => api<Investigation>(`/investigations/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 2_500),
  });
}

export function useFullInvestigation(id: string | null) {
  return useQuery({
    queryKey: ["full", id],
    queryFn: () => api<FullInvestigation>(`/investigations/${id}/full`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.investigation.status) ? false : 4_000),
  });
}

export function useRecentInvestigations(wallet?: string | null) {
  return useQuery({
    queryKey: ["recent", wallet ?? null],
    queryFn: () =>
      api<{ investigations: { id: string; wallet: string; status: InvestigationStatus; error: string | null; createdAt: string; counts: ReconstructionSummary["counts"] | null }[] }>(
        `/investigations/recent?limit=30${wallet ? `&wallet=${wallet}` : ""}`,
      ),
    refetchInterval: 15_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Current investigation (URL ?inv= is the source of truth)           */
/* ------------------------------------------------------------------ */

const LAST_KEY = "trace:lastInvestigation";

/** The investigation the user is looking at: ?inv= in the URL, else the last one they ran (per-browser convenience). */
export function useCurrentInvestigationId(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("inv");
    let fallback: string | null = null;
    try {
      fallback = window.localStorage.getItem(LAST_KEY);
    } catch {
      fallback = null;
    }
    setId(fromUrl ?? fallback);
  }, []);
  const set = useCallback((next: string) => {
    setId(next);
    try {
      window.localStorage.setItem(LAST_KEY, next);
    } catch {
      /* storage unavailable — URL still carries the id */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("inv", next);
    window.history.replaceState(null, "", url.toString());
  }, []);
  return [id, set];
}

export const withInv = (href: string, id: string | null) => (id ? `${href}${href.includes("?") ? "&" : "?"}inv=${id}` : href);
