"use client";

/**
 * The Investigate screen's findings, in the order a reader needs them:
 * workflow status → wallet + position → performance → best execution.
 *
 * Everything here is read from the real investigation payload (and the
 * TRACE-recorded transactions for its execution plans). When a figure cannot
 * be computed honestly the card says so instead of showing a number.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { Check, ChevronRight, ExternalLink, Loader2, Search, X, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { explorer } from "@trace/chain-config";
import { FAMILY } from "@/components/case-file";
import { LineChart, sig } from "@/components/charts";
import { TokenPair, rangeLabel } from "@/components/positions";
import { useSepoliaWallet } from "@/components/wallet";
import { useAquaExecution, type FlowPhase } from "@/lib/aqua-flow";
import { fmt } from "@/lib/format";
import { api, useIntegrations, withInv, type FullInvestigation, type Investigation, type TxRow, type V3Position } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Data helpers                                                       */
/* ------------------------------------------------------------------ */

const ORDER = ["queued", "fetching", "reconstructing", "inferring", "backtesting", "archiving", "done"] as const;
const FULL_RANGE_TICKS = 1_700_000;

/**
 * Transactions TRACE recorded against this investigation's execution plans
 * (newest first). Served by /investigations/:id/full; an older API build that
 * omits them falls back to the maker's activity feed.
 */
export function usePlanTransactions(full: FullInvestigation | null | undefined): TxRow[] {
  const fromFull = full?.transactions;
  const maker = fromFull ? null : (full?.plans[0]?.maker ?? null);
  const q = useQuery({
    queryKey: ["activity", maker],
    queryFn: () => api<{ transactions: TxRow[] }>(`/activity/${maker}`),
    enabled: Boolean(maker),
    refetchInterval: 15_000,
  });
  if (fromFull) return fromFull;
  const ids = new Set(full?.plans.map((p) => p.id) ?? []);
  return (q.data?.transactions ?? []).filter((t) => ids.has(t.plan_id));
}

/** The position the page talks about: the Aqua basis if assessed, else the largest active one. */
export function pickPosition(full: FullInvestigation | null | undefined): V3Position | null {
  const ps = full?.investigation.summary?.positions ?? [];
  const basisId = full?.compatibility?.report.basis?.tokenId;
  return (
    ps.find((p) => p.tokenId === basisId) ??
    [...ps].filter((p) => p.status === "active").sort((a, b) => b.liquidity - a.liquidity)[0] ??
    ps[0] ??
    null
  );
}

/** Last real swap TRACE read in this position's pool (price is token1 per token0). */
function lastSwap(full: FullInvestigation, pool: string) {
  const s = Object.values(full.dna?.data.priceSeries ?? {}).find((x) => x.pool?.toLowerCase() === pool.toLowerCase());
  if (!s || s.points.length === 0) return null;
  return s.points[s.points.length - 1];
}

const isFullRange = (p: Pick<V3Position, "tickLower" | "tickUpper">) => p.tickUpper - p.tickLower >= FULL_RANGE_TICKS;

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-ivory-50 shadow-lift p-5 md:p-6 min-w-0 ${className}`}>{children}</section>;
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.86rem] text-ink-600 leading-relaxed max-w-[56ch]">{children}</p>;
}

function Chip({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  const map = {
    good: "bg-forest/8 text-forest border-forest/20",
    warn: "bg-amber/10 text-[#8A6528] border-amber/25",
    bad: "bg-brick/8 text-brick border-brick/25",
    neutral: "bg-ivory-100 text-ink-600 border-line",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.74rem] font-medium whitespace-nowrap ${map[tone]}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/*  2. Four-step workflow                                              */
/* ------------------------------------------------------------------ */

type StageState = "done" | "active" | "waiting" | "warn" | "blocked";
type Stage = { title: string; subtitle: string; icon: LucideIcon; state: StageState; status: string };

function stagesFor(inv: Investigation | undefined, full: FullInvestigation | null | undefined, txs: TxRow[], aquaBlocked: boolean): Stage[] {
  const idx = inv ? ORDER.indexOf(inv.status as (typeof ORDER)[number]) : -1;
  const st = inv?.status;
  const c = inv?.summary?.counts;

  const analyze: Pick<Stage, "state" | "status"> = !inv
    ? { state: "waiting", status: "Waiting for a wallet" }
    : idx >= 0 && idx <= 2
      ? { state: "active", status: inv.progress.stage ?? "Reading Sepolia" }
      : st === "no_positions"
        ? { state: "done", status: "No V3 positions found" }
        : st === "failed" && !inv.summary
          ? { state: "blocked", status: "Stopped" }
          : { state: "done", status: c ? `${fmt.count(c.events, "event")} read` : "Complete" };

  const primary = full?.strategies.find((s) => s.id === full.primaryStrategyId);
  const understand: Pick<Stage, "state" | "status"> =
    !inv || st === "no_positions" || (idx >= 0 && idx < 3)
      ? { state: "waiting", status: st === "no_positions" ? "Nothing to analyse" : "Not started" }
      : st === "inferring"
        ? { state: "active", status: "Inferring the strategy" }
        : st === "failed"
          ? inv.summary
            ? { state: "blocked", status: "Stopped" }
            : { state: "waiting", status: "Not reached" }
          : !full
            ? { state: "done", status: "Strategy inferred" }
            : !primary
              ? { state: "blocked", status: "Not inferred" }
              : primary.family === "inconclusive"
                ? { state: "warn", status: "Inconclusive evidence" }
                : { state: "done", status: FAMILY[primary.family] ?? primary.family };

  const compat = full?.compatibility?.report;
  const unavailable = aquaBlocked || compat?.verdict === "INCOMPATIBLE" || primary?.family === "inconclusive";
  const done = st === "done" && Boolean(full);
  // Verify = a server-validated EIP-712 authorization (plus World ID when the server requires it).
  const auths = full?.authorizations ?? [];
  const okAuth = auths.find((a) => a.validated);
  const verify: Pick<Stage, "state" | "status"> = !done
    ? { state: "waiting", status: "After analysis" }
    : okAuth
      ? { state: "done", status: okAuth.worldStatus === "verified" ? `Signed and World ID verified` : `Signed by ${fmt.addr(okAuth.wallet)}` }
      : txs.length > 0
        ? { state: "done", status: `Signed by ${fmt.addr(full!.plans[0].maker)}` }
        : auths.length > 0
          ? { state: "blocked", status: "Signature rejected by the server" }
          : unavailable
            ? { state: "waiting", status: "Not applicable" }
            : full!.plans.length > 0
              ? { state: "active", status: "Plan ready to sign" }
              : { state: "waiting", status: "Awaiting your signature" };

  // Execute = the Aqua ship transaction, confirmed on Sepolia by its receipt.
  const ship = txs.find((t) => t.op === "ship");
  const approving = txs.some((t) => t.op === "approve");
  const execute: Pick<Stage, "state" | "status"> = ship?.status === "success"
    ? { state: "done", status: "Shipped on Sepolia" }
    : ship?.status === "submitted"
      ? { state: "active", status: "Confirming on Sepolia" }
      : ship?.status === "reverted"
        ? { state: "blocked", status: "Ship reverted" }
        : !done
          ? { state: "waiting", status: "After analysis" }
          : unavailable
            ? { state: "blocked", status: "Unavailable" }
            : approving
              ? { state: "active", status: "Approvals sent, ship next" }
              : { state: "waiting", status: "Not executed yet" };

  return [
    { title: "Analyze", subtitle: "Read on-chain data", icon: Search, ...analyze },
    { title: "Understand", subtitle: "AI strategy analysis", icon: Sparkles, ...understand },
    { title: "Verify", subtitle: "Human authorization", icon: ShieldCheck, ...verify },
    { title: "Execute", subtitle: "Via 1inch Aqua", icon: Zap, ...execute },
  ];
}

const STATE_DOT: Record<StageState, string> = {
  done: "bg-forest",
  active: "bg-gold animate-pulseSoft",
  waiting: "bg-ink/20",
  warn: "bg-amber",
  blocked: "bg-brick",
};
const STATE_TEXT: Record<StageState, string> = {
  done: "text-forest",
  active: "text-[#8A6528]",
  waiting: "text-ink-600",
  warn: "text-[#8A6528]",
  blocked: "text-brick",
};

/** A step's icon on a two-sided disc: it turns over in 3D to a green tick when the step completes. */
function StepBadge({ icon: Icon, done, dim, delay }: { icon: LucideIcon; done: boolean; dim: boolean; delay: number }) {
  return (
    <span className="flip relative h-10 w-10 shrink-0" aria-hidden>
      <span className={`flip-inner ${done ? "is-flipped" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
        <span className="flip-face">
          <Icon size={25} strokeWidth={1.4} className={dim ? "text-gold/60" : "text-gold"} />
        </span>
        <span className="flip-face flip-back rounded-full bg-forest text-white shadow-[0_6px_16px_-6px_rgba(39,134,83,0.65)]">
          <Check size={20} strokeWidth={2.75} />
        </span>
      </span>
      {done && <span className="tick-ring" style={{ animationDelay: `${delay + 380}ms` }} />}
    </span>
  );
}

export function Workflow({ inv, full, txs }: { inv: Investigation | undefined; full: FullInvestigation | null | undefined; txs: TxRow[] }) {
  const integ = useIntegrations();
  const aqua = integ.data?.integrations.find((i) => i.key === "aqua");
  const aquaBlocked = aqua?.status === "BLOCKED BY EXTERNAL DEPENDENCY" || aqua?.status === "NOT IMPLEMENTED";
  const list = stagesFor(inv, full, txs, aquaBlocked);

  // Flip only after the first paint, so ticks that are already earned still animate in once.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const lead = list.findIndex((s) => s.state !== "done");
  const completed = lead === -1 ? list.length : lead; // contiguous steps done, for the progress rail
  const allDone = completed === list.length;
  const ship = txs.find((t) => t.op === "ship" && t.status === "success");

  return (
    <div>
      <ol
        className={`relative grid grid-cols-2 lg:grid-cols-4 rounded-card border bg-ivory-50 shadow-lift overflow-hidden transition-colors duration-700 ${allDone ? "all-done border-forest/40" : "border-line"}`}
        aria-label={`Investigation workflow, ${completed} of ${list.length} steps complete`}
      >
        {list.map((s, i) => {
          const done = s.state === "done";
          return (
            <li
              key={s.title}
              aria-current={s.state === "active" ? "step" : undefined}
              className={`relative flex items-start gap-3 px-4 md:px-6 py-4 min-w-0 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t lg:border-t-0 border-line" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            >
              <StepBadge icon={s.icon} done={painted && done} dim={s.state === "waiting"} delay={i * 140} />
              <div className="min-w-0">
                <div className="text-[0.95rem] font-semibold text-ink">
                  {s.title}
                  <span className="sr-only">{done ? ", complete" : s.state === "active" ? ", in progress" : ""}</span>
                </div>
                <div className="text-[0.78rem] text-ink-600">{s.subtitle}</div>
                <div className={`mt-1.5 flex items-start gap-1.5 text-[0.74rem] font-medium ${STATE_TEXT[s.state]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 mt-[0.4rem] ${STATE_DOT[s.state]}`} />
                  <span className="break-words min-w-0">{s.status}</span>
                </div>
              </div>
            </li>
          );
        })}
        {/* Progress rail: fills green as consecutive steps complete. */}
        <span
          aria-hidden
          className="absolute left-0 bottom-0 h-[3px] rounded-r-full bg-forest transition-[width] duration-1000 ease-out"
          style={{ width: `${painted ? (completed / list.length) * 100 : 0}%` }}
        />
      </ol>

      {allDone && (
        <div role="status" className="complete-in mt-3 flex flex-wrap items-center gap-3 rounded-card border border-forest/30 bg-forest/[0.06] px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-forest text-white">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} className="draw" style={{ animationDelay: "1500ms" }} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.92rem] font-semibold text-ink">All four steps complete</div>
            <div className="text-[0.78rem] text-ink-600">Analyzed on-chain, strategy understood, authorized by you, and shipped to 1inch Aqua on Sepolia.</div>
          </div>
          {ship && (
            <a href={explorer.tx(ship.tx_hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[0.8rem] font-medium text-forest hover:underline">
              View ship transaction <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3a. Wallet overview                                                */
/* ------------------------------------------------------------------ */

export function WalletOverview({ full, invId }: { full: FullInvestigation; invId: string }) {
  const inv = full.investigation;
  const c = inv.summary?.counts;
  const primary = full.strategies.find((s) => s.id === full.primaryStrategyId);
  const bt = full.backtest?.result;
  const observed = bt?.status === "completed" ? bt.runs.find((r) => r.kind === "observed") : undefined;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[0.8rem] text-ink-600">Wallet</div>
          <a href={explorer.address(inv.wallet)} target="_blank" rel="noopener noreferrer" className="group mt-0.5 inline-flex items-center gap-2 serif text-[1.7rem] md:text-[1.9rem] leading-tight text-ink hover:text-[#8A6528]" title={inv.wallet}>
            <span className="tabular">{fmt.addr(inv.wallet)}</span>
            <ExternalLink size={15} className="text-ink-600 group-hover:text-gold" aria-label="Open on Sepolia Etherscan" />
          </a>
        </div>
        <Chip tone="neutral">
          <span className="h-1.5 w-1.5 rounded-full bg-forest" /> Sepolia
        </Chip>
      </div>

      <dl className="mt-5 grid grid-cols-3 border-t border-line pt-4">
        <div className="min-w-0 pr-3">
          <dt className="text-[0.78rem] text-ink-600">Positions</dt>
          <dd className="text-[1.25rem] sm:text-[1.5rem] font-semibold text-ink tabular leading-tight mt-0.5">{c?.positions ?? "—"}</dd>
        </div>
        <div className="min-w-0 px-3 border-l border-line">
          <dt className="text-[0.78rem] text-ink-600">Pools</dt>
          <dd className="text-[1.25rem] sm:text-[1.5rem] font-semibold text-ink tabular leading-tight mt-0.5">{c?.pools ?? "—"}</dd>
        </div>
        <div className="min-w-0 pl-3 border-l border-line">
          {observed ? (
            <>
              <dt className="text-[0.78rem] text-ink-600" title="Replay of this wallet's own ranges on the pool's real swaps, valued in the backtest's quote token">
                Observed return
              </dt>
              <dd className={`text-[1.25rem] sm:text-[1.5rem] font-semibold tabular leading-tight mt-0.5 ${observed.net >= 0 ? "text-forest" : "text-brick"}`}>{fmt.pct(observed.net * 100)}</dd>
            </>
          ) : (
            <>
              <dt className="text-[0.78rem] text-ink-600">Events read</dt>
              <dd className="text-[1.25rem] sm:text-[1.5rem] font-semibold text-ink tabular leading-tight mt-0.5">{c?.events ?? "—"}</dd>
            </>
          )}
        </div>
      </dl>

      <Link href={withInv("/strategy", invId)} className="group mt-4 flex items-center justify-between gap-3 rounded-md2 bg-ivory px-3.5 py-3 hover:bg-ivory-100">
        <div className="min-w-0">
          <div className="text-[0.74rem] text-ink-600">Identified strategy</div>
          <div className="text-[0.92rem] font-medium text-ink break-anywhere">{primary ? FAMILY[primary.family] ?? primary.family : "Not inferred"}</div>
          {primary && (
            <div className="text-[0.72rem] text-ink-600 mt-0.5">
              {fmt.frac(Number(primary.confidence), 0)} fit to evidence, {primary.role === "ai_hypothesis" ? "0G hypothesis checked against evidence" : "evidence only"}
            </div>
          )}
        </div>
        <ChevronRight size={16} className="text-ink-600 group-hover:text-gold shrink-0" aria-label="Open Strategy DNA" />
      </Link>

      <div className="mt-3 text-[0.72rem] text-ink-600 tabular">
        {inv.windowDays}-day window, {fmt.tsSec(inv.fromTs, false)} to {fmt.tsSec(inv.toTs, false)}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  3b. Uniswap V3 position                                            */
/* ------------------------------------------------------------------ */

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 border-t border-line first:border-t-0 items-baseline">
      <dt className="text-[0.82rem] text-ink-600">{k}</dt>
      <dd className="text-[0.86rem] text-ink tabular break-anywhere">{children}</dd>
    </div>
  );
}

export function PositionPanel({ full, invId }: { full: FullInvestigation; invId: string }) {
  const p = pickPosition(full);
  const total = full.investigation.summary?.counts.positions ?? 0;
  if (!p)
    return (
      <Panel>
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Uniswap V3 position</h2>
        <div className="mt-2">
          <Quiet>No positions were reconstructed in this window.</Quiet>
        </div>
      </Panel>
    );
  const acct = full.investigation.summary?.accounting.find((a) => a.tokenId === p.tokenId);
  const swap = p.pool !== "unresolved" ? lastSwap(full, p.pool) : null;
  const inRange = swap && p.status === "active" ? swap.tick >= p.tickLower && swap.tick < p.tickUpper : null;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Uniswap V3 position</h2>
        <Chip tone={p.status === "active" ? "good" : "neutral"}>{p.status === "active" ? "Active" : "Closed"}</Chip>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md2 border border-line bg-ivory px-3 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <TokenPair a={p.token0} b={p.token1} size={30} />
          <div className="min-w-0">
            <div className="text-[0.95rem] font-semibold text-ink truncate">
              {p.token0} / {p.token1}
            </div>
            <div className="text-[0.72rem] text-ink-600">{fmt.feeTier(p.feeTier)} fee tier</div>
          </div>
        </div>
        <a href={explorer.nft(p.tokenId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[0.78rem] text-ink-600 hover:text-gold tabular">
          NFT #{p.tokenId} <ExternalLink size={12} />
        </a>
      </div>

      <dl className="mt-3">
        <Row k="Liquidity">{fmt.big(p.liquidity)}</Row>
        {acct && (
          <Row k="Deposited">
            {fmt.amt(acct.deposited.token0)} {p.token0} and {fmt.amt(acct.deposited.token1)} {p.token1}
          </Row>
        )}
        <Row k="Range">
          {rangeLabel(p)}
          {!isFullRange(p) && (
            <span className="block text-[0.72rem] text-ink-600">
              ticks {p.tickLower.toLocaleString("en-US")} to {p.tickUpper.toLocaleString("en-US")}
            </span>
          )}
        </Row>
        <Row k="Last swap price">
          {swap ? (
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {fmt.price(swap.price)} {p.token1}/{p.token0}
                <span className="block text-[0.72rem] text-ink-600">block {swap.block.toLocaleString("en-US")}</span>
              </span>
              {inRange != null && <Chip tone={inRange ? "good" : "warn"}>{inRange ? "In range" : "Out of range"}</Chip>}
            </span>
          ) : (
            <span className="text-ink-600">No swaps read for this pool in the window</span>
          )}
        </Row>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[0.78rem]">
        <Link href={withInv(`/positions/${p.tokenId}`, invId)} className="inline-flex items-center gap-1 text-[#8A6528] font-medium hover:text-gold">
          Position evidence <ChevronRight size={14} />
        </Link>
        {total > 1 && (
          <Link href={withInv("/positions", invId)} className="text-ink-600 hover:text-ink">
            All {total} positions
          </Link>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Position performance                                            */
/* ------------------------------------------------------------------ */

const shortDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function PerformancePanel({ full }: { full: FullInvestigation }) {
  const bt = full.backtest?.result;

  if (!bt || bt.status !== "completed") {
    return (
      <Panel>
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Position performance</h2>
        <div className="mt-3">
          <Quiet>
            {bt?.status === "insufficient_data"
              ? `Not enough real trading to compare against buy-and-hold. ${bt.reason ?? ""}`
              : (full.investigation.integrations.backtest?.detail ?? "No pool with a usable price history was found for this wallet.")}{" "}
            TRACE does not fill in missing history.
          </Quiet>
        </div>
      </Panel>
    );
  }

  const run = bt.runs.find((r) => r.kind === "observed") ?? bt.runs.find((r) => r.kind === "counterfactual");
  const hold = bt.runs.find((r) => r.label.startsWith("Buy & hold"));
  const sv = run && bt.series.values.find((v) => v.label === run.label);
  const hv = hold && bt.series.values.find((v) => v.label === hold.label);
  const ts = bt.series.timestamps;
  const labels = sv && ts.length === sv.points.length ? ts.map(shortDate) : [];
  const runName = run?.kind === "observed" ? "Observed wallet ranges" : "Inferred strategy (simulated)";

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Position performance</h2>
          <div className="text-[0.76rem] text-ink-600 mt-0.5">
            {bt.pair}, {shortDate(bt.period.fromTs)} to {shortDate(bt.period.toTs)}
          </div>
        </div>
        {run && (
          <div className="text-right">
            <div className={`text-[1.7rem] font-semibold tabular leading-none ${run.net >= 0 ? "text-forest" : "text-brick"}`}>{fmt.pct(run.net * 100)}</div>
            {hold && <div className="text-[0.76rem] text-ink-600 mt-1 tabular">vs {fmt.pct(hold.net * 100)} buy &amp; hold</div>}
          </div>
        )}
      </div>

      {sv && sv.points.length > 1 ? (
        <div className="mt-4">
          <LineChart
            height={190}
            labels={labels}
            series={[
              { name: runName, data: sv.points, color: "#278653", area: true },
              ...(hv ? [{ name: "Buy & hold (50/50)", data: hv.points, color: "#A8A296", area: false, width: 1.2 }] : []),
            ]}
            yFmt={sig}
          />
        </div>
      ) : (
        <div className="mt-3">
          <Quiet>The replay produced too few points to chart.</Quiet>
        </div>
      )}

      <details className="mt-3 border-t border-line pt-3 group">
        <summary className="flex items-center gap-1 text-[0.78rem] text-ink-600 hover:text-ink">
          <ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Source and assumptions
        </summary>
        <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[0.76rem]">
          <div><dt className="text-ink-600 inline">Source: </dt><dd className="inline text-ink">{bt.series.prices.length} real swaps in pool {fmt.addr(bt.pool)}</dd></div>
          <div><dt className="text-ink-600 inline">Blocks: </dt><dd className="inline text-ink tabular">{bt.period.fromBlock.toLocaleString("en-US")} to {bt.period.toBlock.toLocaleString("en-US")}</dd></div>
          <div><dt className="text-ink-600 inline">Start capital: </dt><dd className="inline text-ink">{fmt.amt(bt.assumptions.startCapital)} {bt.assumptions.valuationToken}</dd></div>
          <div><dt className="text-ink-600 inline">Slippage: </dt><dd className="inline text-ink">{bt.assumptions.slippagePct}%</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-600 inline">Fees: </dt><dd className="inline text-ink">{bt.assumptions.feeModel}</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-600 inline">Gas: </dt><dd className="inline text-ink">{bt.assumptions.gasModel}</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-600 inline">Look-ahead guard: </dt><dd className="inline text-ink">{bt.split.lookaheadGuard}; each decision uses only earlier swaps</dd></div>
        </dl>
      </details>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  5. Best execution                                                  */
/* ------------------------------------------------------------------ */

/** Where the last swap sits relative to the range, on a tick scale. Only drawn when both ends are bounded. */
function RangeMeter({ lower, upper, current }: { lower: number; upper: number; current: number }) {
  const span = upper - lower;
  const lo = Math.min(lower, current) - span * 0.35;
  const hi = Math.max(upper, current) + span * 0.35;
  const x = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const inside = current >= lower && current < upper;
  return (
    <div className="mt-4" aria-hidden>
      <div className="relative h-2 rounded-full bg-ivory-100">
        <div className="absolute inset-y-0 rounded-full bg-gold/35" style={{ left: `${x(lower)}%`, width: `${x(upper) - x(lower)}%` }} />
        <div className={`absolute -top-1 h-4 w-[3px] rounded-full ${inside ? "bg-forest" : "bg-brick"}`} style={{ left: `calc(${x(current)}% - 1.5px)` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[0.68rem] text-ink-600">
        <span>Range</span>
        <span className={inside ? "text-forest" : "text-brick"}>Last swap {inside ? "inside" : "outside"} the range</span>
      </div>
    </div>
  );
}

/* The four on-chain stages the one-click flow walks through, mapped to flow phases. */
const FLOW_STEPS: { label: string; hint: string; phases: FlowPhase[] }[] = [
  { label: "Check and compile", hint: "Live Aqua reads, then a simulated SwapVM plan", phases: ["check", "compile"] },
  { label: "Sign authorization", hint: "Verify: one EIP-712 signature, checked by the server", phases: ["sign"] },
  { label: "Approve exact amounts", hint: "One ERC-20 approval per token you commit", phases: ["approve"] },
  { label: "Ship to 1inch Aqua", hint: "Execute: the ship transaction, confirmed on Sepolia", phases: ["ship"] },
];
const stepIndex = (ph: FlowPhase) => FLOW_STEPS.findIndex((s) => s.phases.includes(ph));

/**
 * Runs Verify and Execute right here: compile, sign, approve, ship. Each
 * wallet action is an explicit MetaMask prompt, and the workflow above ticks
 * as soon as the server has the evidence.
 */
function ExecutePanel({ full, p, invId }: { full: FullInvestigation; p: V3Position; invId: string | null }) {
  const qc = useQueryClient();
  const w = useSepoliaWallet();
  const onProgress = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["full", invId] });
  }, [qc, invId]);
  const flow = useAquaExecution(onProgress);
  const [a0, setA0] = useState("");
  const [a1, setA1] = useState("");
  const [inputErr, setInputErr] = useState<string | null>(null);

  const basis = full.compatibility?.report.basis;
  const t0 = (p.token0Address ?? basis?.token0) as `0x${string}` | undefined;
  const t1 = (p.token1Address ?? basis?.token1) as `0x${string}` | undefined;
  const bal = useReadContracts({
    contracts: w.address && t0 && t1
      ? [
          { address: t0, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`] },
          { address: t1, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`] },
        ]
      : [],
    query: { enabled: Boolean(w.address && t0 && t1) },
  });
  const balance = (i: 0 | 1) => {
    const r = bal.data?.[i];
    const d = i === 0 ? p.decimals0 : p.decimals1;
    return r?.status === "success" && d != null ? Number(formatUnits(r.result as bigint, d)) : null;
  };

  const start = () => {
    setInputErr(null);
    if (!w.address) return;
    if (p.decimals0 == null || p.decimals1 == null) return setInputErr("This position's token decimals are unknown, so amounts cannot be encoded.");
    let x0: bigint, x1: bigint;
    try {
      x0 = a0.trim() ? parseUnits(a0.trim(), p.decimals0) : 0n;
      x1 = a1.trim() ? parseUnits(a1.trim(), p.decimals1) : 0n;
    } catch {
      return setInputErr("Amounts must be plain decimal numbers, like 0.01.");
    }
    if (x0 + x1 === 0n) return setInputErr(`Enter how much ${p.token0} or ${p.token1} the Aqua order may use.`);
    flow.run({ strategyId: full.primaryStrategyId!, maker: w.address, tokenId: p.tokenId, amount0: x0, amount1: x1 });
  };

  const current = flow.phase === "done" ? FLOW_STEPS.length : flow.phase === "error" ? stepIndex(flow.failedAt) : stepIndex(flow.phase);
  const showSteps = flow.phase !== "idle";
  const short = (i: 0 | 1, amt: string) => {
    const b = balance(i);
    const want = Number(amt);
    return b != null && amt.trim() && Number.isFinite(want) && want > b;
  };
  const underfunded = short(0, a0) || short(1, a1);

  const blocked = !w.connected ? "Connect your wallet (top right) to execute." : !w.onSepolia ? "Switch your wallet to Sepolia to execute." : null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      {flow.phase !== "done" && (
        <div className="grid grid-cols-2 gap-3">
          {([0, 1] as const).map((i) => {
            const sym = i === 0 ? p.token0 : p.token1;
            const b = balance(i);
            return (
              <label key={i} className="min-w-0">
                <span className="text-[0.74rem] text-ink-600">{sym} to commit</span>
                <input
                  value={i === 0 ? a0 : a1}
                  onChange={(e) => (i === 0 ? setA0 : setA1)(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                  disabled={flow.busy}
                  className="mt-1 w-full rounded-md2 border border-line bg-ivory-50 px-3 h-10 text-[0.9rem] text-ink tabular outline-none focus:border-gold/60 disabled:opacity-60"
                />
                <span className="mt-1 block text-[0.68rem] text-ink-600 tabular">{b != null ? `Wallet holds ${fmt.amt(b)} ${sym}` : " "}</span>
              </label>
            );
          })}
        </div>
      )}
      {underfunded && flow.phase !== "done" && (
        <p className="mt-2 text-[0.74rem] text-[#8A6528] leading-relaxed">
          Your wallet holds less than this. The order still ships, because Aqua pulls tokens only when a swap fills, but swaps can fill only once the tokens are in your wallet.
        </p>
      )}

      {showSteps && (
        <ol className="mt-4 space-y-2" aria-label="Execution progress">
          {FLOW_STEPS.map((s, i) => {
            const state = i < current ? "done" : i === current ? (flow.phase === "error" ? "failed" : "active") : "pending";
            return (
              <li key={s.label} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                    state === "done" ? "bg-forest text-white" : state === "failed" ? "bg-brick text-white" : state === "active" ? "border border-gold/60 text-gold" : "border border-line text-ink-600"
                  }`}
                  aria-hidden
                >
                  {state === "done" ? <Check size={12} strokeWidth={3} /> : state === "failed" ? <X size={12} strokeWidth={3} /> : state === "active" ? <Loader2 size={12} className="animate-spin" /> : null}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[0.84rem] font-medium ${state === "pending" ? "text-ink-600" : "text-ink"}`}>
                    {s.label}
                    {state === "active" && (flow.phase === "sign" || flow.phase === "approve" || flow.phase === "ship") && <span className="font-normal text-[#8A6528]">: confirm in MetaMask, then wait for Sepolia</span>}
                  </span>
                  <span className="block text-[0.72rem] text-ink-600">{s.hint}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {(flow.error || inputErr) && (
        <p role="alert" className="mt-3 rounded-md2 border border-brick/25 bg-brick/5 px-3 py-2 text-[0.78rem] text-brick break-anywhere">
          {inputErr ?? flow.error}
        </p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 text-[0.74rem] text-ink-600" id="exec-reason">
          {flow.phase === "done" ? (
            <span className="inline-flex items-center gap-1.5 text-forest font-medium">
              <Check size={14} /> Shipped to 1inch Aqua on Sepolia
              {flow.shipHash && (
                <a href={explorer.tx(flow.shipHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                  view tx <ExternalLink size={11} />
                </a>
              )}
            </span>
          ) : (
            (blocked ?? "Tokens stay in your wallet; approvals are for exactly these amounts.")
          )}
          <Link href={withInv("/execute", invId)} className="block mt-1 text-ink-600 underline decoration-line underline-offset-2 hover:text-ink">
            Open the step-by-step view
          </Link>
        </div>
        {flow.phase !== "done" && (
          <button
            onClick={start}
            disabled={Boolean(blocked) || flow.busy}
            aria-describedby="exec-reason"
            className="inline-flex items-center justify-center gap-2 rounded-md2 bg-gold text-white px-5 h-11 text-[0.92rem] font-medium shadow-glow hover:bg-[#A67C38] disabled:bg-ivory-100 disabled:text-ink-600 disabled:shadow-none disabled:border disabled:border-line disabled:cursor-not-allowed shrink-0"
          >
            {flow.busy && <Loader2 size={15} className="animate-spin" />}
            {flow.busy ? "Executing…" : flow.phase === "error" ? "Continue execution" : "Execute with 1inch Aqua"}
          </button>
        )}
      </div>
    </div>
  );
}

export function BestExecution({ full, invId, txs }: { full: FullInvestigation | null; invId: string | null; txs: TxRow[] }) {
  const integ = useIntegrations();
  const aqua = integ.data?.integrations.find((i) => i.key === "aqua");
  const aquaBlocked = aqua?.status === "BLOCKED BY EXTERNAL DEPENDENCY" || aqua?.status === "NOT IMPLEMENTED";

  const primary = full?.strategies.find((s) => s.id === full.primaryStrategyId);
  const inconclusive = !primary || primary.family === "inconclusive";
  const compat = full?.compatibility?.report;
  const plan = full?.plans[0]?.plan;
  const p = pickPosition(full);
  const swap = full && p && p.pool !== "unresolved" ? lastSwap(full, p.pool) : null;
  const ship = txs.find((t) => t.op === "ship");
  const supported = compat?.rules.filter((r) => r.status === "supported").length ?? 0;

  let reason: string | null = null; // why the button is disabled
  let action: string;
  if (!full) {
    action = "Investigate a wallet to see whether its strategy can run on 1inch Aqua.";
    reason = "Needs a completed investigation.";
  } else if (aquaBlocked) {
    action = "Execution unavailable on this network.";
    reason = aqua?.detail ?? "1inch Aqua is not reachable on Sepolia right now.";
  } else if (inconclusive) {
    action = "The evidence is inconclusive, so TRACE does not recommend an execution for this wallet.";
    reason = "No executable strategy was inferred.";
  } else if (compat?.verdict === "INCOMPATIBLE") {
    action = "This strategy cannot be expressed as a 1inch Aqua order.";
    reason = compat.unsupportedNotes[compat.unsupportedNotes.length - 1] ?? "None of its rules map to a SwapVM order.";
  } else if (!p) {
    action = "No position to take a range from.";
    reason = "No reconstructed position.";
  } else {
    action = `Run this wallet's ${(FAMILY[primary!.family] ?? primary!.family).toLowerCase()} range as a 1inch Aqua order, signed from your own wallet.`;
  }

  const verdict = compat?.verdict;
  const showRanges = full && p && !aquaBlocked && !inconclusive && verdict !== "INCOMPATIBLE";
  const unit = p ? `${p.token1}/${p.token0}` : "";
  const planRange = plan ? (plan.params.priceHigh ? `${fmt.price(plan.params.priceLow)} – ${fmt.price(plan.params.priceHigh)} ${unit}` : "Full range") : null;

  return (
    <section className="rounded-card border border-gold/55 bg-ivory-50 shadow-lift p-5 md:p-6 min-w-0">
      <div className="flex items-start gap-3">
        <Zap size={28} strokeWidth={1.4} className="text-gold shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          <h2 className="serif text-[1.6rem] leading-tight text-ink">Best Execution</h2>
          <p className="text-[0.86rem] text-ink-600 mt-1 leading-relaxed max-w-[52ch]">{action}</p>
        </div>
      </div>

      {showRanges && p && (
        <>
          <dl className="mt-4 grid sm:grid-cols-2 gap-3">
            <div className="rounded-md2 bg-ivory px-3.5 py-3 min-w-0">
              <dt className="text-[0.74rem] text-ink-600">Wallet&apos;s current range</dt>
              <dd className="text-[0.9rem] font-medium text-ink tabular mt-0.5 break-anywhere">{rangeLabel(p)}</dd>
              <dd className="text-[0.7rem] text-ink-600 mt-0.5">Position #{p.tokenId}</dd>
            </div>
            <div className="rounded-md2 bg-ivory px-3.5 py-3 min-w-0">
              <dt className="text-[0.74rem] text-ink-600">Recommended Aqua range</dt>
              <dd className="text-[0.9rem] font-medium text-ink tabular mt-0.5 break-anywhere">{planRange ?? rangeLabel(p)}</dd>
              <dd className="text-[0.7rem] text-ink-600 mt-0.5">{plan ? "From your compiled plan" : "Same bounds, compiled from this position's ticks"}</dd>
            </div>
          </dl>
          {swap && !isFullRange(p) && p.tickLower > -887_000 && p.tickUpper < 887_000 && <RangeMeter lower={p.tickLower} upper={p.tickUpper} current={swap.tick} />}
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {verdict === "FULL" && <Chip tone="good">Compatible with Aqua</Chip>}
        {verdict === "PARTIAL" && <Chip tone="warn">Partially compatible: {supported} of {compat!.rules.length} rules compile</Chip>}
        {verdict === "INCOMPATIBLE" && <Chip tone="bad">Not compatible</Chip>}
        {full && !compat && !reason && <Chip tone="neutral">Compatibility is checked when you execute</Chip>}
        {ship && (
          <a href={explorer.tx(ship.tx_hash)} target="_blank" rel="noopener noreferrer">
            <Chip tone={ship.status === "success" ? "good" : ship.status === "reverted" ? "bad" : "warn"}>
              {ship.status === "success" ? "Shipped" : ship.status === "reverted" ? "Ship reverted" : "Ship confirming"} <ExternalLink size={11} />
            </Chip>
          </a>
        )}
      </div>

      {reason ? (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 border-t border-line pt-4">
          <div id="exec-reason" className="flex-1 min-w-0 text-[0.74rem] text-ink-600">{reason}</div>
          <button disabled aria-describedby="exec-reason" className="inline-flex items-center justify-center rounded-md2 border border-line bg-ivory-100 text-ink-600 px-5 h-11 text-[0.92rem] font-medium cursor-not-allowed shrink-0" title={reason}>
            Execute with 1inch Aqua
          </button>
        </div>
      ) : ship?.status === "success" ? (
        <div className="mt-4 border-t border-line pt-4 text-[0.8rem] text-forest font-medium inline-flex items-center gap-1.5">
          <Check size={15} /> This strategy is live on 1inch Aqua (Sepolia).
        </div>
      ) : (
        full && p && <ExecutePanel full={full} p={p} invId={invId} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Placeholders while there is no completed investigation             */
/* ------------------------------------------------------------------ */

export function PendingPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <h2 className="font-sans text-[1.05rem] font-semibold text-ink">{title}</h2>
      <div className="mt-2">
        <Quiet>{children}</Quiet>
      </div>
    </Panel>
  );
}
