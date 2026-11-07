"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Crosshair, Plus, RotateCcw, Search, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { EmptyState, ErrorState, Pill } from "@/components/ui";
import { Term } from "@/components/term";
import { WelcomeCard } from "@/components/welcome";
import { markOnboarding, useMarkOnboarding } from "@/lib/onboarding";
import { BestExecution, PendingPanel, PerformancePanel, PositionPanel, WalletOverview, Workflow } from "@/components/investigate";
import { useAquaExecution } from "@/lib/aqua-flow";
import { useSepoliaWallet } from "@/components/wallet";
import { fmt } from "@/lib/format";
import { TERMINAL, api, type InvestigationStatus, useCurrentInvestigationId, useFullInvestigation, useInvestigationStatus, useRecentInvestigations, useSuggestedWallets } from "@/lib/api";

const WINDOWS = [7, 14, 30, 90, 180];

/** A real Sepolia WETH/USDC liquidity provider, investigated end to end by TRACE (see memory.md §3). */
const EXAMPLE_WALLET = "0x4797a94741b2512c3236d61ca0195638c44deb4c";

export default function InvestigatePage() {
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(30);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invId, setInvId, clearInvId] = useCurrentInvestigationId({ resetOnReload: true });
  const wallet = useSepoliaWallet();
  const qc = useQueryClient();
  const status = useInvestigationStatus(invId);
  const inv = status.data;
  const full = useFullInvestigation(inv?.status === "done" ? invId : null);
  const fullData = inv?.status === "done" ? (full.data ?? null) : null;
  const exec = useAquaExecution(fullData, invId);
  const suggested = useSuggestedWallets();
  const recent = useRecentInvestigations();
  useMarkOnboarding("investigated", inv?.status === "done");

  const running = Boolean(inv) && !TERMINAL.includes(inv!.status);
  // Each start request gets a sequence number; only the latest one may switch
  // the page to its investigation, so a slow earlier response can never
  // overwrite a newer run.
  const seq = useRef(0);

  const run = async (addr?: string, windowDays = days, restart = false) => {
    const w = (addr ?? query).trim();
    setSubmitErr(null);
    setExampleNote(null);
    if (!isAddress(w)) return setSubmitErr("Enter a valid 0x… Ethereum address (40 hex characters).");
    setQuery(w);
    setSubmitting(true);
    markOnboarding("seenIntro"); // starting a run means the welcome is no longer needed
    const mine = ++seq.current;
    try {
      // A different wallet supersedes the run on screen: the server cancels it.
      const supersedes = running && invId && inv && inv.wallet.toLowerCase() !== w.toLowerCase() ? invId : undefined;
      const r = await api<{ investigationId: string }>("/investigations", { method: "POST", body: { wallet: w, days: windowDays, restart, supersedes } });
      if (mine !== seq.current) return;
      setInvId(r.investigationId);
      await qc.invalidateQueries({ queryKey: ["recent"] });
    } catch (e) {
      if (mine === seq.current) setSubmitErr((e as Error).message);
    } finally {
      if (mine === seq.current) setSubmitting(false);
    }
  };

  /**
   * "Try an example wallet": reuse before re-running. If the example wallet's
   * investigation is already on screen, nothing new starts. If it was
   * investigated recently (last 24 h, same time window) and finished, that
   * investigation is opened as is. Otherwise a real investigation starts.
   * "Restart investigation" is the explicit way to read it again from Sepolia.
   */
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const tryExample = () => {
    setSubmitErr(null);
    const ex = EXAMPLE_WALLET.toLowerCase();
    if (inv && inv.wallet.toLowerCase() === ex && inv.status !== "failed" && inv.status !== "cancelled") {
      setQuery(EXAMPLE_WALLET);
      setExampleNote(running ? "The example wallet is already being investigated below." : "This is already the example wallet's investigation. Use Restart investigation to read it again from Sepolia.");
      return;
    }
    const recentDone = (recent.data?.investigations ?? []).find(
      (r) =>
        r.wallet.toLowerCase() === ex &&
        r.status === "done" &&
        Date.now() - new Date(r.createdAt).getTime() < 24 * 3600_000 &&
        r.fromTs != null &&
        r.toTs != null &&
        Math.round((r.toTs - r.fromTs) / 86_400) === days,
    );
    if (recentDone) {
      seq.current++; // supersede any start request still in flight
      setQuery(EXAMPLE_WALLET);
      setInvId(recentDone.id);
      markOnboarding("seenIntro");
      setExampleNote(
        `Opened the example wallet's investigation from ${new Date(recentDone.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}. Use Restart investigation to read it again from Sepolia.`,
      );
      return;
    }
    setExampleNote(null);
    void run(EXAMPLE_WALLET);
  };

  /** Clear the page for a new wallet; a run still in progress is cancelled on the server. */
  const startNew = async () => {
    seq.current++;
    setExampleNote(null);
    setSubmitting(false);
    setSubmitErr(null);
    if (invId && running) {
      try {
        await api(`/investigations/${invId}/cancel`, { method: "POST", body: {} });
      } catch (e) {
        setSubmitErr(`The previous run could not be cancelled: ${(e as Error).message}`);
      }
    }
    clearInvId();
    setQuery("");
    await qc.invalidateQueries({ queryKey: ["recent"] });
  };

  /** Once a case is open the hero steps back so the findings come first. */
  const compact = Boolean(invId && inv);
  const recentList = (recent.data?.investigations ?? []).filter((r, i, all) => all.findIndex((x) => x.wallet.toLowerCase() === r.wallet.toLowerCase()) === i).slice(0, 8);

  return (
    <Page>
      {!compact && <WelcomeCard onExample={tryExample} />}
      {/* 1. What TRACE does + the wallet input (the one thing to do first) */}
      <section>
        <div className="min-w-0">
          {compact ? (
            <h1 className="text-[1.5rem] md:text-[1.75rem] leading-tight text-ink">Investigate another wallet</h1>
          ) : (
            <>
              <h1 className="text-[2rem] md:text-[2.75rem] leading-[1.08] text-ink max-w-[22ch]">See how a wallet really manages its liquidity.</h1>
              <p className="mt-3 text-[1rem] md:text-[1.06rem] text-ink-600 leading-relaxed max-w-[58ch]">
                Paste a Uniswap V3 liquidity provider. TRACE rebuilds every position from Sepolia, explains the strategy behind it with evidence, and tests it on real past swaps.
              </p>
            </>
          )}

          <form
            className={`${compact ? "mt-4" : "mt-7"} flex flex-col sm:flex-row gap-2 rounded-lg2 border border-ink/20 bg-ivory-50 p-1.5 max-w-[720px] focus-within:border-ink/50`}
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <label className="flex items-center gap-3 px-3 flex-1 min-w-0">
              <Search size={18} strokeWidth={1.75} className="text-ink-600 shrink-0" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Paste a wallet address (0x…)"
                aria-label="Wallet address"
                aria-describedby="wallet-help"
                spellCheck={false}
                autoComplete="off"
                autoFocus={!invId}
                className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-600/70 text-[0.98rem] py-2.5 tabular !outline-none !ring-0 !shadow-none"
              />
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1 sm:flex-none">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="How far back to look"
                  className="w-full h-11 appearance-none rounded-md2 border border-line bg-ivory pl-3.5 pr-9 text-[0.86rem] font-medium text-ink"
                >
                  {WINDOWS.map((d) => (
                    <option key={d} value={d}>
                      Last {d} days
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-600" aria-hidden />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-md2 bg-ink text-white px-7 h-11 text-[0.92rem] font-medium hover:bg-[#2B2D33] disabled:opacity-50"
              >
                {submitting ? "Starting…" : "Investigate"}
              </button>
            </div>
          </form>

          <p id="wallet-help" className={`${compact ? "sr-only" : ""} mt-2.5 text-[0.8rem] text-ink-600 max-w-[720px] leading-relaxed`}>
            Any Ethereum <Term k="sepolia">Sepolia</Term> address that provides <Term k="liquidity">liquidity</Term> on Uniswap V3. TRACE only reads public data; nothing is signed or sent.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8rem]">
            <button
              onClick={tryExample}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md2 border border-line bg-ivory-50 px-3 h-9 font-medium text-ink hover:border-ink/30 disabled:opacity-50"
              title={`A real Sepolia liquidity provider: ${EXAMPLE_WALLET} (WETH/USDC). Opens its recent investigation if there is one; otherwise investigates it now.`}
            >
              <Crosshair size={14} className="text-ink-600" /> Try an example wallet
            </button>
            {wallet.connected && wallet.address && (
              <button onClick={() => run(wallet.address!)} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md2 border border-line bg-ivory-50 px-3 h-9 text-ink-600 hover:text-ink disabled:opacity-50">
                <Wallet size={13} className="text-ink-600" /> Use my wallet <span className="tabular">{fmt.addr(wallet.address)}</span>
              </button>
            )}
          </div>

          {exampleNote && (
            <p role="status" className="mt-2 max-w-[720px] text-[0.78rem] text-ink-600">
              {exampleNote}
            </p>
          )}

          {(suggested.data?.wallets.length ?? 0) > 0 && (
            <details className="mt-3 max-w-[720px] group">
              <summary className="inline-flex items-center gap-1 text-[0.78rem] text-ink-600 hover:text-ink">
                <ChevronRight size={14} className="transition-transform group-open:rotate-90" /> More real liquidity providers found on Sepolia right now
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggested.data!.wallets.slice(0, 5).map((s) => (
                  <button
                    key={s.wallet}
                    onClick={() => run(s.wallet)}
                    className="inline-flex items-center gap-2 rounded-md2 border border-line bg-ivory-50 px-3 py-1.5 text-[0.76rem] text-ink hover:border-gold/50"
                    title={`${suggested.data!.source}. ${s.mints} position mints; ${s.poolSwaps} real swaps in its pool recently.`}
                  >
                    <span className="font-medium">{s.pair ?? "Unknown pair"}</span>
                    <span className="tabular text-ink-600">{fmt.addr(s.wallet)}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          {submitErr && (
            <div className="mt-3 max-w-[720px]">
              <ErrorState title="Could not start the investigation" message={submitErr} />
            </div>
          )}
        </div>
      </section>

      {/* 2. The four stages: an explainer before a run, live status during and after it */}
      <div className="mt-9 lg:mt-7">
        {!inv && <h2 className="text-[0.95rem] font-semibold text-ink mb-2.5">How it works</h2>}
        <Workflow inv={inv} full={fullData} exec={fullData ? exec : null} fullFailed={full.isError} />
        {inv && (
          <div className="mt-2.5 px-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.76rem]">
            <button
              onClick={() => run(inv.wallet, inv.windowDays, true)}
              disabled={submitting || exec.busy !== null}
              className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink disabled:opacity-50"
              title="Cancel any run in progress and read this wallet again from Sepolia under a new investigation ID"
            >
              <RotateCcw size={13} className="text-gold" /> Restart investigation
            </button>
            <button onClick={startNew} disabled={exec.busy !== null} className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink disabled:opacity-50">
              <Plus size={13} className="text-gold" /> Start new investigation
            </button>
          </div>
        )}
        {inv && running && (
          <p className="mt-2.5 px-1 text-[0.76rem] text-ink-600">
            Investigating <span className="tabular text-ink">{fmt.addr(inv.wallet)}</span>
            {inv.progress.events != null && `: ${fmt.count(inv.progress.events, "event")} and ${fmt.count(inv.progress.positions ?? 0, "position")} found so far`}
            {inv.progress.events == null && inv.progress.liveRpcCalls != null && `: ${inv.progress.liveRpcCalls} blockchain reads so far`}. A wallet seen for the first time can take a minute or two.
          </p>
        )}
        {status.isError && (
          <div className="mt-3">
            <ErrorState
              title="Could not check this investigation"
              message="TRACE could not reach the server to read this investigation's status."
              detail={(status.error as Error).message}
              action={<RetryButton busy={status.isFetching} onClick={() => status.refetch()} />}
            />
          </div>
        )}
        {full.isError && !fullData && (
          <div className="mt-3">
            {/* Re-reads the existing result (GET /investigations/:id/full); it never starts a new investigation. */}
            <ErrorState
              title="The result could not be loaded"
              message="This investigation finished on the server, but the page could not load its result."
              detail={(full.error as Error).message}
              action={<RetryButton busy={full.isFetching} onClick={() => full.refetch()} />}
            />
          </div>
        )}
      </div>

      {inv?.status === "no_positions" && (
        <div className="mt-6">
          <EmptyState title="No supported Uniswap V3 positions found" icon={<Crosshair size={17} />}>
            Sepolia was read successfully: {fmt.addr(inv.wallet)} has no Uniswap V3 position NFTs, and none were minted or transferred in the last {inv.windowDays} days.
            <span className="block mt-2">Try one of the live liquidity providers above, choose a longer window, or open a WETH/USDC position from this wallet on app.uniswap.org (Sepolia) and investigate again.</span>
          </EmptyState>
        </div>
      )}

      {inv?.status === "cancelled" && (
        <div className="mt-6">
          <EmptyState title="Investigation cancelled" icon={<Crosshair size={17} />}>
            {inv.error ?? "This run was stopped before it finished."} Nothing from it will be updated further. Restart it above, or start a new investigation.
          </EmptyState>
        </div>
      )}

      {inv?.status === "failed" && (
        <div className="mt-6 space-y-3">
          <ErrorState title="Investigation stopped" message={inv.error ?? "unknown error"} />
          <button onClick={() => run(inv.wallet, inv.windowDays)} disabled={submitting} className="rounded-md2 border border-gold/45 bg-ivory-50 px-4 h-10 text-[0.86rem] font-medium text-ink hover:bg-ivory-100 disabled:opacity-50">
            Run the investigation again
          </button>
        </div>
      )}

      {/* 3–5. Findings and the recommended action */}
      {inv && inv.status !== "no_positions" && inv.status !== "failed" && inv.status !== "cancelled" && (
        <div className="mt-6 grid lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-5 min-w-0">
            {fullData && invId ? (
              <>
                <WalletOverview full={fullData} invId={invId} />
                <PositionPanel full={fullData} invId={invId} />
              </>
            ) : (
              <>
                <PendingPanel title="Wallet overview">{pendingText(inv.status, "overview", full.isError)}</PendingPanel>
                <PendingPanel title="Main position">{pendingText(inv.status, "positions", full.isError)}</PendingPanel>
              </>
            )}
          </div>
          <div className="space-y-5 min-w-0">
            {fullData ? (
              <PerformancePanel full={fullData} />
            ) : (
              <PendingPanel title="Performance">{pendingText(inv.status, "performance", full.isError)}</PendingPanel>
            )}
            <BestExecution
              full={fullData}
              invId={invId}
              exec={exec}
              pendingNote={inv.status === "done" ? (full.isError ? "The result could not be loaded. Use Try again above." : "Analysis finished; loading the result…") : "Available when the analysis completes."}
            />
          </div>
        </div>
      )}

      {/* Progressive disclosure: history and notes stay out of the way */}
      {(recentList.length > 0 || (fullData && fullData.investigation.notes.length > 0)) && (
        <div className="mt-8 space-y-2">
          {fullData && fullData.investigation.notes.length > 0 && (
            <details className="group rounded-card border border-line bg-ivory-50 px-5 py-3.5">
              <summary className="flex items-center gap-1.5 text-[0.86rem] font-medium text-ink">
                <ChevronRight size={15} className="text-ink-600 transition-transform group-open:rotate-90" /> Investigation notes ({fullData.investigation.notes.length})
              </summary>
              <ul className="mt-2 text-[0.8rem] text-ink-600 list-disc pl-6 space-y-1 max-w-[80ch]">
                {fullData.investigation.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {recentList.length > 0 && (
            <details className="group rounded-card border border-line bg-ivory-50 px-5 py-3.5">
              <summary className="flex items-center gap-1.5 text-[0.86rem] font-medium text-ink">
                <ChevronRight size={15} className="text-ink-600 transition-transform group-open:rotate-90" /> Recent investigations ({recentList.length})
              </summary>
              <div className="mt-2 divide-y divide-line">
                {recentList.map((r) => (
                  <button key={r.id} onClick={() => setInvId(r.id)} className="w-full text-left flex items-center gap-4 py-2.5 hover:bg-ivory -mx-2 px-2 rounded-md2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.88rem] text-ink font-medium tabular">{fmt.addr(r.wallet)}</div>
                      <div className="text-[0.74rem] text-ink-600 break-anywhere">
                        {r.counts ? `${fmt.count(r.counts.positions, "position")}, ${fmt.count(r.counts.events, "event")}` : r.status === "no_positions" ? "No Uniswap V3 positions in the window" : r.status === "failed" ? (r.error ?? "failed").slice(0, 90) : r.status}
                      </div>
                    </div>
                    <Pill tone={r.status === "done" ? "forest" : r.status === "failed" ? "brick" : r.status === "no_positions" || r.status === "cancelled" ? "neutral" : "gold"}>{r.status === "no_positions" ? "no positions" : r.status}</Pill>
                    <span className="text-[0.74rem] text-ink-600 tabular hidden sm:block whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Page>
  );
}

/**
 * Placeholder copy for a findings panel before its data is on the page. It
 * follows the investigation's real status from the server: a panel only says a
 * stage is running while the server reports that stage.
 */
const STAGE_ORDER: InvestigationStatus[] = ["queued", "fetching", "reconstructing", "inferring", "backtesting", "archiving", "done"];
function pendingText(status: InvestigationStatus, panel: "overview" | "positions" | "performance", resultFailed: boolean): string {
  if (status === "done") return resultFailed ? "The analysis finished, but its result could not be loaded. Use Try again above." : "Analysis finished; loading the result…";
  const at = STAGE_ORDER.indexOf(status);
  if (panel === "positions") {
    if (at <= STAGE_ORDER.indexOf("fetching")) return "Waiting for the wallet's history to be read from Sepolia.";
    if (status === "reconstructing") return "Rebuilding the wallet's positions from its transactions…";
    return "Positions rebuilt; shown when the analysis completes.";
  }
  if (panel === "performance") {
    if (at < STAGE_ORDER.indexOf("backtesting")) return "Runs after the strategy is identified.";
    if (status === "backtesting") return "Testing the strategy on the pool's real past trades…";
    return "Backtest finished; shown when the analysis completes.";
  }
  return "Filled in when the analysis completes.";
}

function RetryButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md2 border border-line bg-ivory-50 px-3 h-9 text-[0.84rem] font-medium text-ink hover:border-ink/25 disabled:opacity-50"
    >
      <RotateCcw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "Trying again…" : "Try again"}
    </button>
  );
}
