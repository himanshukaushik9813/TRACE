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
import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronRight, ExternalLink, Search, ShieldCheck, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { explorer } from "@trace/chain-config";
import { FAMILY } from "@/components/case-file";
import { LineChart, sig } from "@/components/charts";
import { TokenPair, rangeLabel } from "@/components/positions";
import { Term } from "@/components/term";
import { snapshot, type AquaExecution, type ExecSnapshot } from "@/lib/aqua-flow";
import { fmt } from "@/lib/format";
import { api, useIntegrations, withInv, type FullInvestigation, type Investigation, type V3Position } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Data helpers                                                       */
/* ------------------------------------------------------------------ */

const ORDER = ["queued", "fetching", "reconstructing", "inferring", "backtesting", "archiving", "done"] as const;
const FULL_RANGE_TICKS = 1_700_000;

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

type StageState = "done" | "active" | "waiting" | "awaiting" | "warn" | "blocked" | "unavailable" | "cancelled";
type Stage = { title: string; subtitle: string; icon: LucideIcon; state: StageState; status: string };

/** The five states the brief asks for (plus honest extras), worded for people. */
const STATE_LABEL: Record<StageState, string> = {
  done: "Completed",
  active: "Running",
  waiting: "Pending",
  awaiting: "Awaiting approval",
  warn: "Inconclusive",
  blocked: "Failed",
  unavailable: "Unavailable",
  cancelled: "Cancelled",
};

/** The four stages in beginner language (exact wording from the product brief). */
export const STAGE_TEXT = {
  analyze: "Discover real wallet activity and liquidity positions.",
  understand: "Identify the wallet's possible strategy using AI.",
  verify: "Review the strategy and authorize the action.",
  execute: "Run supported strategy rules through 1inch Aqua.",
} as const;

/** Pipeline statuses in plain words (the server's stage text is technical). */
const PLAIN_PROGRESS: Record<string, string> = {
  queued: "Waiting for a free worker",
  fetching: "Reading the wallet's history from the Sepolia blockchain",
  reconstructing: "Rebuilding each liquidity position from its transactions",
};

/** What happens after each stage, for the "Next" line under the strip. */
const NEXT_TEXT = [
  "TRACE identifies the wallet's possible strategy from what it found.",
  "You review the strategy and its backtest, then authorize it with a free wallet signature.",
  "You confirm the transactions in your wallet to run the supported rules on 1inch Aqua.",
  "Nothing further: the strategy is live on 1inch Aqua (Sepolia).",
];

const VERIFY_BUSY = { check: "Checking Aqua compatibility live", compile: "Compiling and simulating the plan", challenge: "Preparing the authorization", wallet: "Confirm the signature in MetaMask", server: "The server is verifying your signature" } as const;

function stagesFor(inv: Investigation | undefined, full: FullInvestigation | null | undefined, exec: AquaExecution | null, aquaBlocked: boolean): Stage[] {
  const idx = inv ? ORDER.indexOf(inv.status as (typeof ORDER)[number]) : -1;
  const st = inv?.status;
  const c = inv?.summary?.counts;
  const err = (inv?.error ?? "").replace(/^[A-Z_]+:\s*/, "").slice(0, 90);

  const analyze: Pick<Stage, "state" | "status"> = !inv
    ? { state: "waiting", status: "Waiting for a wallet" }
    : idx >= 0 && idx <= 2
      ? { state: "active", status: PLAIN_PROGRESS[inv.status] ?? "Reading the wallet's history on Sepolia" }
      : st === "no_positions"
        ? { state: "done", status: "No V3 positions found" }
        : st === "cancelled" && !inv.summary
          ? { state: "cancelled", status: inv.error ?? "Cancelled" }
          : st === "failed" && !inv.summary
            ? { state: "blocked", status: err || "Stopped" }
            : { state: "done", status: c ? `Found ${fmt.count(c.positions, "position")} from ${fmt.count(c.events, "on-chain event")}` : "Complete" };

  const primary = full?.strategies.find((s) => s.id === full.primaryStrategyId);
  const understand: Pick<Stage, "state" | "status"> =
    !inv || st === "no_positions" || (idx >= 0 && idx < 3)
      ? { state: "waiting", status: st === "no_positions" ? "Nothing to analyse" : "After analysis" }
      : st === "cancelled"
        ? { state: "cancelled", status: "Not run: investigation cancelled" }
        : st === "inferring"
          ? { state: "active", status: "Looking for a pattern in how the wallet manages its positions" }
          : st === "failed"
            ? inv.summary
              ? { state: "blocked", status: err || "Stopped" }
              : { state: "waiting", status: "Not reached" }
            : st !== "done"
              ? { state: "active", status: st === "backtesting" ? "Testing the strategy on real past trading" : "Saving the analysis" }
              : !full
                ? { state: "active", status: "Loading the analysis" }
                : !primary
                  ? { state: "blocked", status: "No strategy was stored" }
                  : primary.family === "inconclusive"
                    ? { state: "warn", status: "Too little evidence to act on" }
                    : { state: "done", status: `${FAMILY[primary.family] ?? primary.family}${primary.role === "ai_hypothesis" ? " (AI, checked against the evidence)" : " (from the evidence; the AI service is unavailable)"}` };

  const snap: ExecSnapshot = exec?.snap ?? snapshot(full);
  const compat = full?.compatibility?.report;
  const why = aquaBlocked ? "1inch Aqua is unavailable" : primary?.family === "inconclusive" ? "no executable strategy" : compat?.verdict === "INCOMPATIBLE" ? "not compatible with Aqua" : null;
  const analysed = st === "done" && Boolean(full) && understand.state === "done";
  const busy = exec?.busy ?? null;
  const vErr = exec?.error?.stage === "verify" ? exec.error.message : null;
  const eErr = exec?.error?.stage === "execute" ? exec.error.message : null;
  const shipped = snap.ship?.status === "success";
  const signer = snap.auth ?? (full?.authorizations ?? []).find((a) => a.planId === snap.plan?.id && a.validated) ?? null;
  const world = signer?.worldStatus === "verified" ? ", World ID verified" : signer?.worldStatus === "not_configured" ? " (World ID not configured on this server)" : "";

  const verify: Pick<Stage, "state" | "status"> = !analysed
    ? { state: "waiting", status: "After analysis" }
    : shipped || snap.auth
      ? { state: "done", status: `Signed by ${fmt.addr(signer?.wallet ?? snap.plan!.maker)}${world}` }
      : busy?.stage === "verify"
        ? { state: "active", status: VERIFY_BUSY[busy.what] }
        : vErr
          ? { state: "blocked", status: vErr }
          : snap.rejected
            ? { state: "blocked", status: "The server rejected the last signature" }
            : why
              ? { state: "unavailable", status: `Not available: ${why}` }
              : snap.expired
                ? { state: "awaiting", status: "Your signature expired; sign again" }
                : { state: "awaiting", status: "Sign the authorization on the Execute page" };

  const pendingApprove = snap.approvals.some((t) => t.status === "submitted");
  const execute: Pick<Stage, "state" | "status"> = shipped
    ? { state: "done", status: "Shipped on Sepolia" }
    : busy?.stage === "execute"
      ? { state: "active", status: busy.what === "wallet" ? `Confirm the ${busy.op} in MetaMask` : busy.what === "record" ? `Recording the ${busy.op} transaction` : `Waiting for Sepolia to confirm the ${busy.op}` }
      : snap.ship?.status === "submitted"
        ? { state: "active", status: "Ship confirming on Sepolia" }
        : pendingApprove
          ? { state: "active", status: "Approval confirming on Sepolia" }
          : exec?.recovery
            ? { state: "active", status: "Checking Sepolia for a transaction sent during a reload" }
            : eErr
              ? { state: "blocked", status: eErr }
              : snap.ship?.status === "reverted"
                ? { state: "blocked", status: "The ship reverted; you can send it again" }
                : !analysed
                  ? { state: "waiting", status: "After verification" }
                  : why
                    ? { state: "unavailable", status: `Not available: ${why}` }
                    : verify.state === "done"
                      ? { state: "awaiting", status: "Approve and ship on the Execute page" }
                      : { state: "waiting", status: "After verification" };

  return [
    { title: "Analyze", subtitle: STAGE_TEXT.analyze, icon: Search, ...analyze },
    { title: "Understand", subtitle: STAGE_TEXT.understand, icon: Sparkles, ...understand },
    { title: "Verify", subtitle: STAGE_TEXT.verify, icon: ShieldCheck, ...verify },
    { title: "Execute", subtitle: STAGE_TEXT.execute, icon: Zap, ...execute },
  ];
}

const STATE_DOT: Record<StageState, string> = {
  done: "bg-forest",
  active: "bg-gold animate-pulseSoft",
  waiting: "bg-ink/20",
  awaiting: "bg-amber",
  warn: "bg-amber",
  blocked: "bg-brick",
  unavailable: "bg-ink/30",
  cancelled: "bg-ink/30",
};
const STATE_TEXT: Record<StageState, string> = {
  done: "text-forest",
  active: "text-[#8A6528]",
  waiting: "text-ink-600",
  awaiting: "text-[#8A6528]",
  warn: "text-[#8A6528]",
  blocked: "text-brick",
  unavailable: "text-ink-600",
  cancelled: "text-ink-600",
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

export function Workflow({ inv, full, exec }: { inv: Investigation | undefined; full: FullInvestigation | null | undefined; exec: AquaExecution | null }) {
  const integ = useIntegrations();
  const aqua = integ.data?.integrations.find((i) => i.key === "aqua");
  const aquaBlocked = aqua?.status === "BLOCKED BY EXTERNAL DEPENDENCY" || aqua?.status === "NOT IMPLEMENTED";
  const list = stagesFor(inv, full, exec, aquaBlocked);

  // Flip only after the first paint, so ticks that are already earned still animate in once.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const lead = list.findIndex((s) => s.state !== "done");
  const completed = lead === -1 ? list.length : lead; // contiguous steps done, for the progress rail
  const allDone = completed === list.length;
  const ship = (exec?.snap ?? snapshot(full)).ship;
  const shipOk = ship?.status === "success" ? ship : null;

  return (
    <div>
      <ol
        className={`relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 rounded-card border bg-ivory-50 shadow-lift overflow-hidden transition-colors duration-700 ${allDone ? "all-done border-forest/40" : "border-line"}`}
        aria-label={`Investigation workflow, ${completed} of ${list.length} steps complete`}
      >
        {list.map((s, i) => {
          const done = s.state === "done";
          return (
            <li
              key={s.title}
              aria-current={s.state === "active" ? "step" : undefined}
              className={`relative flex items-start gap-3 px-4 md:px-6 py-4 min-w-0 border-line ${STEP_BORDERS[i]}`}
            >
              <StepBadge icon={s.icon} done={painted && done} dim={s.state === "waiting"} delay={i * 140} />
              <div className="min-w-0">
                <div className="text-[0.74rem] font-semibold tracking-[0.14em] uppercase text-ink">
                  <span className="text-gold tabular mr-1.5">{i + 1}</span>
                  {s.title}
                  <span className="sr-only">{done ? ", complete" : s.state === "active" ? ", in progress" : ""}</span>
                </div>
                <div className="text-[0.8rem] text-ink-600 leading-snug mt-0.5">{s.subtitle}</div>
                <div className={`mt-1.5 flex items-start gap-1.5 text-[0.74rem] ${STATE_TEXT[s.state]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 mt-[0.4rem] ${STATE_DOT[s.state]}`} />
                  <span className="min-w-0">
                    <span className="font-semibold">{STATE_LABEL[s.state]}</span>
                    <span className={`block break-words ${s.state === "blocked" ? "" : "text-ink-600"}`} title={s.status}>
                      {s.status.length > 120 ? `${s.status.slice(0, 117)}…` : s.status}
                    </span>
                  </span>
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

      {!allDone && inv && (
        <WorkflowNow stage={list[lead]} index={lead} />
      )}

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
          {shipOk && (
            <a href={explorer.tx(shipOk.tx_hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[0.8rem] font-medium text-forest hover:underline">
              View ship transaction <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Cell borders for 1 column (phone), 2 columns (tablet) and 4 columns (desktop). */
const STEP_BORDERS = ["", "border-t sm:border-t-0 sm:border-l", "border-t lg:border-t-0 lg:border-l", "border-t sm:border-l lg:border-t-0"];

/** Under the strip: the current stage in a sentence, what comes next, and whether the user must act. */
function WorkflowNow({ stage, index }: { stage: Stage; index: number }) {
  const needsYou = stage.state === "awaiting";
  const stuck = stage.state === "blocked" || stage.state === "unavailable" || stage.state === "warn" || stage.state === "cancelled";
  return (
    <div role="status" aria-live="polite" className="mt-3 grid sm:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-card border border-line bg-ivory-50 px-4 py-3 text-[0.8rem]">
      <div className="font-semibold text-ink whitespace-nowrap">
        Now: <span className="uppercase tracking-[0.12em] text-[0.72rem]">{stage.title}</span>
      </div>
      <div className="text-ink-600 min-w-0 break-words">
        {stage.status}.
        {needsYou && <span className="ml-1.5 inline-flex items-center rounded-full bg-amber/15 text-[#8A6528] px-2 py-0.5 text-[0.7rem] font-semibold">Your action is needed</span>}
      </div>
      {!stuck && (
        <>
          <div className="font-semibold text-ink whitespace-nowrap">Next:</div>
          <div className="text-ink-600 min-w-0">{NEXT_TEXT[index]}</div>
        </>
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
          <dt className="text-[0.78rem] text-ink-600"><Term k="lpPosition">Positions</Term></dt>
          <dd className="text-[1.25rem] sm:text-[1.5rem] font-semibold text-ink tabular leading-tight mt-0.5">{c?.positions ?? "—"}</dd>
        </div>
        <div className="min-w-0 px-3 border-l border-line">
          <dt className="text-[0.78rem] text-ink-600">Pools</dt>
          <dd className="text-[1.25rem] sm:text-[1.5rem] font-semibold text-ink tabular leading-tight mt-0.5">{c?.pools ?? "—"}</dd>
        </div>
        <div className="min-w-0 pl-3 border-l border-line">
          {observed ? (
            <>
              <dt className="text-[0.78rem] text-ink-600">
                <Term k="observed">Observed</Term> return
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
          <div className="text-[0.74rem] text-ink-600">Possible <Term k="strategy">strategy</Term></div>
          <div className="text-[0.92rem] font-medium text-ink break-anywhere">{primary ? FAMILY[primary.family] ?? primary.family : "Not inferred"}</div>
          {primary && (
            <div className="text-[0.72rem] text-ink-600 mt-0.5">
              {fmt.frac(Number(primary.confidence), 0)} <Term k="confidence">confidence</Term> · {primary.role === "ai_hypothesis" ? "AI hypothesis checked against the evidence" : "from the on-chain evidence"}
            </div>
          )}
        </div>
        <ChevronRight size={16} className="text-ink-600 group-hover:text-gold shrink-0" aria-label="Open Strategy" />
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

function Row({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
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
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Main position</h2>
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
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Main <Term k="lpPosition">position</Term></h2>
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
        {acct && (
          <Row k={<Term k="deposited">Deposited</Term>}>
            {fmt.amt(acct.deposited.token0)} {p.token0} and {fmt.amt(acct.deposited.token1)} {p.token1}
          </Row>
        )}
        <Row k={<Term k="priceRange">Price range</Term>}>{rangeLabel(p)}</Row>
        {acct && (acct.feesCollected.token0 > 0 || acct.feesCollected.token1 > 0) && (
          <Row k={<Term k="feesCollected">Fees collected</Term>}>
            {fmt.amt(acct.feesCollected.token0)} {p.token0} and {fmt.amt(acct.feesCollected.token1)} {p.token1}
          </Row>
        )}
        <Row k="Current price">
          {swap ? (
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {fmt.price(swap.price)} {p.token1} per {p.token0}
                <span className="block text-[0.72rem] text-ink-600">last real swap, block {swap.block.toLocaleString("en-US")}</span>
              </span>
              {inRange != null && <Chip tone={inRange ? "good" : "warn"}>{inRange ? <Term k="inRange">In range</Term> : "Out of range, not earning fees"}</Chip>}
            </span>
          ) : (
            <span className="text-ink-600">No swaps read for this pool in the window</span>
          )}
        </Row>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[0.78rem]">
        <Link href={withInv(`/positions/${p.tokenId}`, invId)} className="inline-flex items-center gap-1 text-[#8A6528] font-medium hover:text-gold">
          View details <ChevronRight size={14} />
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
        <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Performance</h2>
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
          <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Performance</h2>
          <div className="text-[0.76rem] text-ink-600 mt-0.5">
            {bt.pair}, {shortDate(bt.period.fromTs)} to {shortDate(bt.period.toTs)}
          </div>
        </div>
        {run && (
          <div className="text-right">
            <div className={`text-[1.7rem] font-semibold tabular leading-none ${run.net >= 0 ? "text-forest" : "text-brick"}`}>{fmt.pct(run.net * 100)}</div>
            {hold && <div className="text-[0.76rem] text-ink-600 mt-1 tabular">vs {fmt.pct(hold.net * 100)} <Term k="buyHold">buy and hold</Term></div>}
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

      <p className="mt-3 text-[0.78rem] text-ink-600 leading-relaxed">
        {run?.kind === "observed" ? "The wallet's real ranges, replayed on the pool's real trades" : "A simulation of the inferred strategy on the pool's real trades"}, compared with simply holding the tokens.{" "}
        <Link href={withInv("/backtest", full.investigation.id)} className="text-[#8A6528] font-medium hover:text-gold whitespace-nowrap">
          Full backtest →
        </Link>
      </p>
      <details className="mt-3 border-t border-line pt-3 group">
        <summary className="flex items-center gap-1 text-[0.78rem] text-ink-600 hover:text-ink">
          <ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Source and assumptions
        </summary>
        <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[0.76rem]">
          <div><dt className="text-ink-600 inline">Source: </dt><dd className="inline text-ink">{bt.series.prices.length} real swaps in pool {fmt.addr(bt.pool)}</dd></div>
          <div><dt className="text-ink-600 inline">Blocks: </dt><dd className="inline text-ink tabular">{bt.period.fromBlock.toLocaleString("en-US")} to {bt.period.toBlock.toLocaleString("en-US")}</dd></div>
          <div><dt className="text-ink-600 inline">Start capital: </dt><dd className="inline text-ink">{fmt.amt(bt.assumptions.startCapital)} {bt.assumptions.valuationToken}</dd></div>
          <div><dt className="text-ink-600 inline">Slippage: </dt><dd className="inline text-ink">{fmt.frac(bt.assumptions.slippagePct, 2)}</dd></div>
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

export function BestExecution({ full, invId, exec }: { full: FullInvestigation | null; invId: string | null; exec: AquaExecution }) {
  const integ = useIntegrations();
  const aqua = integ.data?.integrations.find((i) => i.key === "aqua");
  const aquaBlocked = aqua?.status === "BLOCKED BY EXTERNAL DEPENDENCY" || aqua?.status === "NOT IMPLEMENTED";

  const primary = full?.strategies.find((s) => s.id === full.primaryStrategyId);
  const inconclusive = !primary || primary.family === "inconclusive";
  const compat = full?.compatibility?.report;
  const plan = full?.plans[0]?.plan;
  const p = pickPosition(full);
  const swap = full && p && p.pool !== "unresolved" ? lastSwap(full, p.pool) : null;
  const ship = exec.snap.ship;
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
    action = `Recreate this wallet's ${(FAMILY[primary!.family] ?? primary!.family).toLowerCase()} strategy on 1inch Aqua, from your own wallet. You approve every step; nothing runs automatically.`;
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
              <dt className="text-[0.74rem] text-ink-600">Wallet&apos;s current <Term k="priceRange">price range</Term></dt>
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
        {verdict === "FULL" && <Chip tone="good"><Term k="aquaCompatibility">Compatible with Aqua</Term></Chip>}
        {verdict === "PARTIAL" && <Chip tone="warn"><Term k="aquaCompatibility">Partly compatible</Term>: {supported} of {compat!.rules.length} rules can run on Aqua</Chip>}
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
        full &&
        p && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 border-t border-line pt-4">
            <div className="flex-1 min-w-0 text-[0.78rem] text-ink-600">
              {exec.snap.auth
                ? "Authorized. Next: approve and ship from your wallet."
                : exec.snap.plan
                  ? "Transactions prepared. Next: review them and sign the authorization."
                  : "A guided, 8-step flow: check compatibility, choose amounts, review the exact transactions, then confirm each one in your wallet."}
            </div>
            <Link
              href={withInv("/execute", invId)}
              className="inline-flex items-center justify-center gap-2 rounded-md2 bg-gold text-white px-5 h-11 text-[0.92rem] font-medium shadow-glow hover:bg-[#A67C38] shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              {exec.snap.plan ? "Continue to Execute" : "Execute with 1inch Aqua"} <ArrowRight size={15} />
            </Link>
          </div>
        )
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
