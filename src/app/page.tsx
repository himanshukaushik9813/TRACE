"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Crosshair, Plus, RotateCcw, Search, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { EmptyState, ErrorState, Pill } from "@/components/ui";
import { EngineMark, type EngineState } from "@/components/engine-mark";
import { BestExecution, PendingPanel, PerformancePanel, PositionPanel, WalletOverview, Workflow } from "@/components/investigate";
import { useAquaExecution } from "@/lib/aqua-flow";
import { useSepoliaWallet } from "@/components/wallet";
import { fmt } from "@/lib/format";
import { TERMINAL, api, useCurrentInvestigationId, useFullInvestigation, useInvestigationStatus, useRecentInvestigations, useSuggestedWallets } from "@/lib/api";

const WINDOWS = [7, 14, 30, 90, 180];

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

  const running = Boolean(inv) && !TERMINAL.includes(inv!.status);
  // Each start request gets a sequence number; only the latest one may switch
  // the page to its investigation, so a slow earlier response can never
  // overwrite a newer run.
  const seq = useRef(0);

  const run = async (addr?: string, windowDays = days, restart = false) => {
    const w = (addr ?? query).trim();
    setSubmitErr(null);
    if (!isAddress(w)) return setSubmitErr("Enter a valid 0x… Ethereum address (40 hex characters).");
    setQuery(w);
    setSubmitting(true);
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

  /** Clear the page for a new wallet; a run still in progress is cancelled on the server. */
  const startNew = async () => {
    seq.current++;
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

  const engine: EngineState = running || submitting ? "working" : fullData ? "ready" : "idle";
  const recentList = (recent.data?.investigations ?? []).filter((r, i, all) => all.findIndex((x) => x.wallet.toLowerCase() === r.wallet.toLowerCase()) === i).slice(0, 8);

  return (
    <Page>
      {/* 1. Wallet search */}
      <section className="grid lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px] items-center gap-6 lg:gap-10">
        <div className="min-w-0">
          <h1 className="serif text-[2.4rem] md:text-[3.25rem] leading-[1.05] text-ink">Investigate a wallet</h1>
          <p className="mt-3 text-[1rem] md:text-[1.12rem] text-ink-600 leading-relaxed max-w-[50ch]">
            Analyze real on-chain activity, understand the strategy, and get an execution recommendation.
          </p>

          <form
            className="mt-7 flex flex-col sm:flex-row gap-2 rounded-card border border-line bg-ivory-50 p-2 shadow-lift max-w-[720px]"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <label className="flex items-center gap-3 px-3 flex-1 min-w-0">
              <Search size={19} strokeWidth={1.6} className="text-gold shrink-0" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter an Ethereum Sepolia wallet address"
                aria-label="Wallet address"
                spellCheck={false}
                autoComplete="off"
                className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-600/70 text-[0.95rem] outline-none py-2.5 tabular"
              />
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1 sm:flex-none">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Observation window"
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
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-md2 bg-gold text-white px-7 h-11 text-[0.92rem] font-medium shadow-glow hover:bg-[#A67C38] disabled:opacity-50"
              >
                {submitting ? "Starting…" : "Investigate"}
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-ink-600 max-w-[720px]">
            {wallet.connected && wallet.address && (
              <button onClick={() => run(wallet.address!)} className="inline-flex items-center gap-1.5 hover:text-ink">
                <Wallet size={13} className="text-gold" /> Use my wallet <span className="tabular">{fmt.addr(wallet.address)}</span>
              </button>
            )}
            {suggested.data && suggested.data.wallets.length > 0 && <span>Or try a live liquidity provider:</span>}
            {suggested.data?.wallets.slice(0, 3).map((s) => (
              <button
                key={s.wallet}
                onClick={() => run(s.wallet)}
                className="inline-flex items-center gap-1 underline decoration-gold/40 underline-offset-2 hover:text-ink tabular"
                title={`${suggested.data!.source}. ${s.mints} position mints; ${s.poolSwaps} real swaps in its pool recently.`}
              >
                {s.pair ?? fmt.addr(s.wallet)}
              </button>
            ))}
            {suggested.isLoading && <span>Finding active liquidity providers on Sepolia…</span>}
          </div>
          {submitErr && (
            <div className="mt-3 max-w-[720px]">
              <ErrorState title="Could not start the investigation" message={submitErr} />
            </div>
          )}
        </div>
        <EngineMark state={engine} className="hidden lg:block w-full h-auto" />
      </section>

      {/* 2. Workflow, with the real stage of the current investigation */}
      <div className="mt-8 lg:mt-6">
        <Workflow inv={inv} full={fullData} exec={fullData ? exec : null} />
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
            {inv.progress.events != null && `: ${inv.progress.events} events, ${inv.progress.positions} positions, ${inv.progress.rpcCalls} RPC calls`}
            {inv.progress.events == null && inv.progress.liveRpcCalls != null && `: ${inv.progress.liveRpcCalls} RPC calls so far`}. Free-tier RPC limits apply; wallets with many positions take a few minutes.
          </p>
        )}
        {status.isError && (
          <div className="mt-3">
            <ErrorState message={(status.error as Error).message} />
          </div>
        )}
        {full.isError && (
          <div className="mt-3">
            <ErrorState message={(full.error as Error).message} />
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
      {inv?.status !== "no_positions" && inv?.status !== "failed" && inv?.status !== "cancelled" && (
        <div className="mt-6 grid lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-5 min-w-0">
            {fullData && invId ? (
              <>
                <WalletOverview full={fullData} invId={invId} />
                <PositionPanel full={fullData} invId={invId} />
              </>
            ) : (
              <>
                <PendingPanel title="Wallet overview">{running ? "Filled in when the analysis completes." : "Positions, pools and observed performance for the wallet you investigate."}</PendingPanel>
                <PendingPanel title="Uniswap V3 position">{running ? "Rebuilding positions from on-chain events…" : "Token pair, liquidity, tick range and whether the price is inside it."}</PendingPanel>
              </>
            )}
          </div>
          <div className="space-y-5 min-w-0">
            {fullData ? (
              <PerformancePanel full={fullData} />
            ) : (
              <PendingPanel title="Position performance">{running ? "Replaying the strategy on real pool swaps…" : "The wallet's strategy against buy-and-hold, replayed on real pool swaps."}</PendingPanel>
            )}
            <BestExecution full={fullData} invId={invId} exec={exec} />
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
