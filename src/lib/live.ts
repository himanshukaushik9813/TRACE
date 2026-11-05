/**
 * Frontend live-data layer — real data only, no fixtures.
 *
 * `NEXT_PUBLIC_TRACE_API_URL` points at the TRACE server. Every screen loads
 * from that server: investigation status, the full pipeline payload, raw
 * on-chain events, archives, recent investigations. When the API is not
 * configured, screens show an explicit "API not configured" empty state —
 * they never fall back to demo data.
 *
 * Integrity rule, in code: `source` is always "live" | "demo_fixture" and the
 * badge on each screen derives from that investigation's source.
 *
 * NOTE: the types below mirror the server's JSON (the Strategy IR shapes) as
 * seen over HTTP. They are deliberately local to the frontend so the web app
 * has no build-time dependency on the workspace packages.
 */

import { useEffect, useState } from "react";

export const TRACE_API_URL: string | undefined = process.env.NEXT_PUBLIC_TRACE_API_URL;
export const isLive = Boolean(TRACE_API_URL);

/* ------------------------------------------------------------------ */
/*  Wire types (mirror the server's JSON)                              */
/* ------------------------------------------------------------------ */

export type StorageRef = {
  ref: string;
  kind: string;
  contentHash: string;
  sizeBytes: number;
  demo: boolean;
  ts: string;
};

export type V3Event = {
  kind: "MINT" | "INCREASE" | "DECREASE" | "COLLECT" | "TRANSFER" | "BURN";
  tokenId: number;
  owner?: string;
  tx: string;
  block: number;
  logIndex: number;
  timestamp: number; // unix seconds (0 = unknown, never fabricated)
  liquidityDelta: number;
  amount0: number;
  amount1: number;
  fee0: number;
  fee1: number;
  tickLower: number;
  tickUpper: number;
  note?: string;
};

export type Position = {
  tokenId: number;
  pool: string;
  token0: string;
  token1: string;
  feeTier: number; // bps (0 = unresolved)
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  status: "active" | "closed";
  openedBlock?: number;
  closedBlock?: number;
  lastActivityBlock?: number;
};

export type PositionAccounting = {
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
  positions: Position[];
  accounting: PositionAccounting[];
};

export type StrategyRule = {
  rule: string;
  evidence: string;
  confidence: number;
  alternative: string;
  uncertainty: string;
  mapsTo?: string;
};

export type Strategy = {
  version: string;
  id: string;
  wallet: string;
  family: string;
  confidence: number; // 0..1
  rules: StrategyRule[];
  alternatives: { label: string; family: string; score: number; why: string }[];
  evidenceRefs: string[];
  limitations: string[];
  source: {
    model: string;
    provider: string;
    requestRef?: string;
    schemaValid: boolean;
    attested: boolean;
    ts: number;
  };
};

export type BacktestRunSummary = {
  label: string;
  result: {
    netReturnPct?: number;
    maxDrawdownPct?: number;
    sharpe?: number;
    finalEquity: number;
  };
};

export type Backtest = {
  strategyId: string;
  period: { fromBlock: number; toBlock: number };
  split: {
    trainEndBlock: number;
    testStartBlock: number;
    gapBlocks: number;
    lookaheadGuard: "enforced" | "waived";
    waiveReason?: string;
  };
  assumptions: {
    startCapital: number;
    gasGwei: number;
    slippagePct: number;
    feeModel: string;
  };
  runs: BacktestRunSummary[];
  equitySeries: { label: string; points: number[] }[];
};

export type Compatibility = {
  strategyId: string;
  verdict: "FULL" | "PARTIAL" | "INCOMPATIBLE";
  rules: { rule: string; status: "supported" | "partial" | "unsupported"; gap?: string }[];
  capabilities: { name: string; usable: boolean; note: string }[];
  approvals: { token: string; amount: string; unlimited: boolean; reason: string }[];
  unsupportedNotes: string[];
};

export type AquaProgram = {
  strategyId: string;
  programHash: string;
  format: string;
  steps: unknown[];
  approvals: { token: string; amount: string; unlimited: boolean }[];
  assumptions: { slippageBps: number; gasGweiAssumption: number; minOutPct: number };
  deterministic: boolean;
};

export type Investigation = {
  id: string;
  wallet: string;
  status: "queued" | "reconstructing" | "done" | "failed";
  source: "live" | "demo_fixture";
  error?: string | null;
  summary?: ReconstructionSummary;
};

/** The full pipeline payload for one investigation (GET /:id/full). */
export type FullInvestigation = {
  id: string;
  wallet: string;
  status: string;
  source: string;
  error?: string | null;
  reconstruction: ReconstructionSummary;
  strategy: Strategy | null;
  strategyVersionHash: string | null;
  program: AquaProgram | null;
  programHash: string | null;
  compatibility: Compatibility | null;
  compatibilityVerdict: "FULL" | "PARTIAL" | "INCOMPATIBLE" | null;
  backtest: Backtest | null;
  archives: StorageRef[];
};

export type RecentRow = {
  id: string;
  wallet: string;
  status: string;
  source: string;
  fingerprint: string;
  fromTs: number | null;
  toTs: number | null;
  error: string | null;
  createdAt: string;
};

export type AuthorizationResult = {
  worldId: string;
  strategyId: string;
  challenge: string;
  validated: boolean;
  validation: {
    signatureOk: boolean;
    notExpired: boolean;
    challengeUsed: boolean;
    strategyVersionMatches: boolean;
    programHashMatches: boolean;
    notes: string[];
  };
  note: string;
};

export type StrategyVersionRow = {
  ir: string;
  versionHash: string;
  family: string;
  confidence: number;
  source: string;
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Shared client-side store (the last finished investigation + full)  */
/* ------------------------------------------------------------------ */

type Store = {
  investigation: Investigation | null;
  full: FullInvestigation | null;
  recents: RecentRow[];
  hydrated: boolean;
};

const listeners = new Set<() => void>();
let store: Store = { investigation: null, full: null, recents: [], hydrated: false };

function emit() {
  listeners.forEach((l) => l());
}

export function setLastInvestigation(inv: Investigation | null, full: FullInvestigation | null = null) {
  store = { ...store, investigation: inv, full: full ?? store.full };
  emit();
}

export function setRecents(rows: RecentRow[]) {
  store = { ...store, recents: rows, hydrated: true };
  emit();
}

/** Reactive read of the shared store (the last investigation + its full payload). */
export function useLiveStore() {
  const [v, setV] = useState<Store>(store);
  useEffect(() => {
    const update = () => setV(store);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return v;
}

/** Legacy name — resolves to the same store. */
export function useLastInvestigation(): Investigation | null {
  return useLiveStore().investigation;
}

/* ------------------------------------------------------------------ */
/*  API calls — real data only                                         */
/* ------------------------------------------------------------------ */

const notConfigured = (what: string): { error: string } => ({
  error: isLive
    ? `${what}: API error`
    : "TRACE API not configured — set NEXT_PUBLIC_TRACE_API_URL and start the server (with TRACE_RPC_URL for chain reads)",
});

/**
 * Queue a live investigation. The server fetches the wallet's real on-chain
 * events (its RPC; the browser never talks to the chain directly).
 */
export async function queueInvestigation(
  wallet: string,
  opts?: { days?: number; fromBlock?: number; toBlock?: number },
): Promise<{ investigationId: string; status: string } | { error: string }> {
  if (!isLive) return notConfigured("Queue investigation");
  try {
    const res = await fetch(`${TRACE_API_URL}/investigations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, ...opts }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { error: (j as { error?: string }).error ?? `queue failed (${res.status})` };
    }
    return (await res.json()) as { investigationId: string; status: string };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getInvestigation(id: string): Promise<Investigation | { error: string }> {
  if (!isLive) return notConfigured("Fetch investigation");
  try {
    const res = await fetch(`${TRACE_API_URL}/investigations/${id}`);
    if (!res.ok) return { error: `poll failed (${res.status})` };
    return (await res.json()) as Investigation;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getFullInvestigation(id: string): Promise<FullInvestigation | { error: string }> {
  if (!isLive) return notConfigured("Fetch full investigation");
  try {
    const res = await fetch(`${TRACE_API_URL}/investigations/${id}/full`);
    if (!res.ok) return { error: `full fetch failed (${res.status})` };
    return (await res.json()) as FullInvestigation;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getEvents(
  id: string,
  tokenId?: number,
): Promise<{ events: V3Event[] } | { error: string }> {
  if (!isLive) return notConfigured("Fetch events");
  try {
    const qs = tokenId != null ? `?tokenId=${tokenId}` : "";
    const res = await fetch(`${TRACE_API_URL}/investigations/${id}/events${qs}`);
    if (!res.ok) return { error: `events failed (${res.status})` };
    const j = (await res.json()) as { events: unknown[] };
    return {
      events: j.events.map((r) => ({
        kind: String(r.kind) as V3Event["kind"],
        tokenId: Number(r.tokenId),
        owner: r.owner ? String(r.owner) : undefined,
        tx: String(r.tx),
        block: Number(r.block),
        logIndex: Number(r.logIndex),
        timestamp: Number(r.ts),
        liquidityDelta: Number(r.liquidityDelta),
        amount0: Number(r.amount0),
        amount1: Number(r.amount1),
        fee0: Number(r.fee0),
        fee1: Number(r.fee1),
        tickLower: Number(r.tickLower),
        tickUpper: Number(r.tickUpper),
        note: r.note ? String(r.note) : undefined,
      })),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getRecentInvestigations(limit = 10): Promise<RecentRow[]> {
  if (!isLive) return [];
  try {
    const res = await fetch(`${TRACE_API_URL}/investigations/recent?limit=${limit}`);
    if (!res.ok) return [];
    const j = (await res.json()) as { investigations: RecentRow[] };
    return j.investigations ?? [];
  } catch {
    return [];
  }
}

export async function getArchives(investigationId: string): Promise<{ archives: StorageRef[]; allDemo: boolean } | { error: string }> {
  if (!isLive) return notConfigured("Fetch archives");
  try {
    const res = await fetch(`${TRACE_API_URL}/archives/${investigationId}`);
    if (!res.ok) return { error: `archives failed (${res.status})` };
    return (await res.json()) as { archives: StorageRef[]; allDemo: boolean };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function getStrategyVersions(wallet: string): Promise<StrategyVersionRow[]> {
  if (!isLive) return [];
  try {
    const res = await fetch(`${TRACE_API_URL}/strategies/by-wallet/${wallet}`);
    if (!res.ok) return [];
    const j = (await res.json()) as { strategies: StrategyVersionRow[] };
    return j.strategies ?? [];
  } catch {
    return [];
  }
}

export async function authorize(strategyId: string, action: string): Promise<AuthorizationResult | { error: string }> {
  if (!isLive) return notConfigured("Authorize");
  try {
    const res = await fetch(`${TRACE_API_URL}/authorizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategyId, action }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { error: (j as { error?: string }).error ?? `authorize failed (${res.status})` };
    }
    return (await res.json()) as AuthorizationResult;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Poll a queued investigation until done/failed; on done, load the full payload. */
export function useInvestigation(id: string | null) {
  const [inv, setInv] = useState<Investigation | null>(null);

  useEffect(() => {
    if (!id || !isLive) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const r = await getInvestigation(id);
      if (!alive) return;
      if ("error" in r) {
        timer = setTimeout(poll, 2000); // transient — keep polling
        return;
      }
      setInv(r);
      if (r.status === "done") {
        const full = await getFullInvestigation(id);
        if (!alive) return;
        setLastInvestigation(r, "error" in full ? null : full);
      }
      if (r.status !== "done" && r.status !== "failed") {
        timer = setTimeout(poll, 1500);
      }
    };
    void poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return inv;
}

/**
 * One-time hydration: load recent investigations and, when there is a
 * finished one, its full payload into the shared store. Every screen reads
 * the store — so navigating between pages after one investigation is free.
 */
export function useHydrateStore() {
  useEffect(() => {
    if (!isLive || store.hydrated) return;
    let alive = true;
    (async () => {
      const recents = await getRecentInvestigations(10);
      if (!alive) return;
      setRecents(recents);
      const done = recents.find((r) => r.status === "done");
      if (done) {
        const inv = await getInvestigation(done.id);
        if ("error" in inv || !alive) return;
        const full = await getFullInvestigation(done.id);
        if (!alive) return;
        setLastInvestigation(inv, "error" in full ? null : full);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
}
