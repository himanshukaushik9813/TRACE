"use client";

import { useState } from "react";
import { Check, Cpu, Crosshair, History, Archive, ScanSearch, Search, Wallet, FlaskConical } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { Button, Card, EmptyState, ErrorState, LoadingState, Pill, SectionTitle } from "@/components/ui";
import { PositionCard } from "@/components/positions";
import { CaseFile } from "@/components/case-file";
import { useSepoliaWallet } from "@/components/wallet";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useFullInvestigation, useInvestigationStatus, useRecentInvestigations, useSuggestedWallets, type InvestigationStatus } from "@/lib/api";

const STAGES: { key: InvestigationStatus; label: string; icon: typeof ScanSearch; detail: string }[] = [
  { key: "fetching", label: "Read Sepolia", icon: ScanSearch, detail: "Position NFTs, lifecycle logs, receipts" },
  { key: "reconstructing", label: "Reconstruct", icon: History, detail: "Positions, principal vs fees, pool prices" },
  { key: "inferring", label: "Strategy DNA + 0G", icon: Cpu, detail: "Deterministic metrics, gated AI hypothesis" },
  { key: "backtesting", label: "Backtest", icon: FlaskConical, detail: "Look-ahead-safe, real swaps" },
  { key: "archiving", label: "Archive", icon: Archive, detail: "0G Storage (Galileo)" },
];
const ORDER: InvestigationStatus[] = ["queued", "fetching", "reconstructing", "inferring", "backtesting", "archiving", "done"];

export default function InvestigatePage() {
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(30);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invId, setInvId] = useCurrentInvestigationId();
  const wallet = useSepoliaWallet();
  const qc = useQueryClient();
  const status = useInvestigationStatus(invId);
  const full = useFullInvestigation(status.data?.status === "done" ? invId : null);
  const suggested = useSuggestedWallets();
  const recent = useRecentInvestigations();

  const run = async (addr?: string) => {
    const w = (addr ?? query).trim();
    setSubmitErr(null);
    if (!isAddress(w)) return setSubmitErr("Enter a valid 0x… Ethereum address (40 hex characters).");
    setQuery(w);
    setSubmitting(true);
    try {
      const r = await api<{ investigationId: string }>("/investigations", { method: "POST", body: { wallet: w, days } });
      setInvId(r.investigationId);
      await qc.invalidateQueries({ queryKey: ["recent"] });
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const inv = status.data;
  const open = Boolean(inv);
  const stageIdx = inv ? ORDER.indexOf(inv.status) : -1;
  const summary = full.data?.investigation.summary ?? inv?.summary ?? null;

  return (
    <Page>
      <section className="relative overflow-hidden rounded-panel border border-ink/10 bg-charcoal-900 on-dark">
        <img src={art.topoWaves} alt="" aria-hidden className={`absolute inset-0 h-full w-full object-cover mix-blend-screen ${open ? "opacity-30" : "opacity-[0.55]"}`} />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal-900 via-charcoal-900/75 to-transparent" />
        <div className={`relative ${open ? "p-5 md:p-6" : "p-6 md:p-10"}`}>
          {open ? (
            <h1 className="serif text-xl md:text-2xl text-cream">Investigate another wallet</h1>
          ) : (
            <>
              <p className="text-[0.8rem] text-gold-300">Reads Ethereum Sepolia live. No sample data, ever.</p>
              <h1 className="serif text-[2rem] md:text-[3rem] leading-[1.04] text-cream max-w-[18ch] mt-3">Understand the strategy behind any wallet.</h1>
              <p className="mt-4 max-w-[58ch] text-cream-muted text-[0.98rem] leading-relaxed">
                Paste an address. TRACE rebuilds its Uniswap V3 positions from on-chain events, infers the strategy with evidence for every rule, backtests it on real swaps, and lets you ship the compatible rules to 1inch Aqua from your own wallet.
              </p>
            </>
          )}

          <div className={`${open ? "mt-4" : "mt-7"} max-w-3xl`}>
            <div className="flex flex-col sm:flex-row gap-2 rounded-md2 border border-cream/15 bg-charcoal-800/80 p-1.5 backdrop-blur">
              <label className="flex items-center gap-2 px-3 flex-1 min-w-0">
                <Search size={17} className="text-gold-300 shrink-0" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="0x… wallet address on Sepolia"
                  aria-label="Wallet address"
                  spellCheck={false}
                  className="w-full min-w-0 bg-transparent text-cream placeholder:text-cream-muted/50 text-[0.95rem] outline-none py-2.5 tabular"
                />
              </label>
              <div className="flex gap-2">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Observation window"
                  className="flex-1 sm:flex-none h-10 appearance-none bg-charcoal-900 text-cream text-[0.84rem] rounded-md2 pl-3 pr-8 border border-cream/15 bg-[length:12px] bg-no-repeat bg-[right_0.6rem_center]"
                  style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%23C6A66B' stroke-width='1.6' fill='none'/></svg>\")" }}
                >
                  {[7, 14, 30, 90, 180].map((d) => (
                    <option key={d} value={d}>
                      Last {d} days
                    </option>
                  ))}
                </select>
                <Button variant="gold" onClick={() => run()} disabled={submitting} className="flex-1 sm:flex-none sm:px-6 h-10">
                  {submitting ? "Starting…" : "Investigate"}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.76rem] text-cream-muted">
              {wallet.connected && wallet.address && (
                <button onClick={() => run(wallet.address!)} className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 px-2.5 py-1 hover:text-cream hover:border-gold/60">
                  <Wallet size={12} className="text-gold-300" /> My wallet {fmt.addr(wallet.address)}
                </button>
              )}
              {suggested.data && suggested.data.wallets.length > 0 && <span className="mr-0.5">Try a live liquidity provider:</span>}
              {suggested.data?.wallets.slice(0, 3).map((s) => (
                <button
                  key={s.wallet}
                  onClick={() => run(s.wallet)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 px-2.5 py-1 hover:text-cream hover:border-cream/35 tabular"
                  title={`${suggested.data!.source}. ${s.mints} position mints; ${s.poolSwaps} real swaps in its pool recently.`}
                >
                  {s.pair ?? fmt.addr(s.wallet)}
                  <span className="text-cream-muted/60">{fmt.addr(s.wallet)}</span>
                </button>
              ))}
              {suggested.isLoading && <span>Finding active liquidity providers on Sepolia…</span>}
            </div>
            {submitErr && <div className="mt-3"><ErrorState title="Could not start the investigation" message={submitErr} /></div>}
          </div>
        </div>
      </section>

      {invId && inv?.status === "done" && full.data && <CaseFile full={full.data} invId={invId} />}

      {invId && inv?.status !== "done" && (
        <section className="mt-6">
          <SectionTitle
            eyebrow={inv ? `Investigating ${fmt.addr(inv.wallet)}` : undefined}
            title={inv?.status === "no_positions" ? "Nothing to analyse" : inv?.status === "failed" ? "Investigation stopped" : "Reading the chain"}
            action={inv?.status === "no_positions" ? <Pill tone="neutral"><Check size={12} /> Complete, no positions</Pill> : inv?.status === "failed" ? <Pill tone="brick">Stopped</Pill> : inv ? <Pill tone="gold">Running</Pill> : null}
          />
          {status.isError && <ErrorState message={(status.error as Error).message} />}
          {status.isLoading && <LoadingState label="Loading investigation…" />}
          {inv && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {STAGES.map((s, i) => {
                  const idx = ORDER.indexOf(s.key);
                  const empty = inv.status === "no_positions";
                  const state = inv.status === "done" || stageIdx > idx || (empty && s.key === "fetching") ? "done" : stageIdx === idx ? (inv.status === "failed" ? "failed" : "running") : inv.status === "failed" || empty ? "skipped" : "idle";
                  const Icon = s.icon;
                  return (
                    <div key={s.key} className="rounded-md2 border border-ink/10 bg-ivory-50 p-3.5">
                      <div className={`grid h-7 w-7 place-items-center rounded-md border ${state === "done" ? "bg-forest/12 border-forest/30 text-forest" : state === "running" ? "bg-gold/15 border-gold/40 text-gold" : "bg-ink/5 border-ink/10 text-ink-600"}`}>
                        {state === "done" ? <Check size={14} /> : <Icon size={14} className={state === "running" ? "animate-pulseSoft" : ""} />}
                      </div>
                      <div className="text-[0.86rem] font-medium text-ink mt-2.5">{s.label}</div>
                      <div className="text-[0.68rem] text-ink-600 mt-0.5">{s.detail}</div>
                    </div>
                  );
                })}
              </div>
              {inv.status !== "failed" && inv.status !== "no_positions" && (
                <div className="mt-3 text-[0.78rem] text-ink-600">
                  {inv.progress.stage ?? "Queued"}
                  {inv.progress.events != null && ` · ${inv.progress.events} events, ${inv.progress.positions} positions, ${inv.progress.rpcCalls} RPC calls`}
                  {inv.progress.events == null && inv.progress.liveRpcCalls != null && ` · ${inv.progress.liveRpcCalls} RPC calls so far`}
                  <span className="block text-[0.7rem] mt-1">Free-tier RPC limits apply; wallets with many positions take a few minutes.</span>
                </div>
              )}
              {inv.status === "no_positions" && (
                <div className="mt-4">
                  <EmptyState title="No supported Uniswap V3 positions found" icon={<Crosshair size={17} />}>
                    Sepolia was read successfully: {fmt.addr(inv.wallet)} has no Uniswap V3 position NFTs and none were minted or transferred in the last {inv.windowDays} days. TRACE shows nothing rather than sample data.
                    <span className="block mt-2">
                      To continue: pick one of the suggested live LP wallets above, try a longer window, or create a WETH/USDC position from this wallet on app.uniswap.org (Sepolia) and investigate again.
                    </span>
                  </EmptyState>
                </div>
              )}
              {inv.status === "failed" && (
                <div className="mt-4">
                  <ErrorState title="Investigation failed" message={inv.error ?? "unknown error"} />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {inv?.status === "done" && summary && (
        <section className="mt-8">
          <SectionTitle eyebrow="Rebuilt from this wallet's on-chain events" title={`${fmt.count(summary.counts.positions, "Uniswap V3 position")}`} />
          {summary.positions.length === 0 ? (
            <EmptyState title="No positions in this window" />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {summary.positions.map((p) => (
                <PositionCard key={p.tokenId} p={p} acct={summary.accounting.find((a) => a.tokenId === p.tokenId)} inv={invId} />
              ))}
            </div>
          )}
          {inv.notes.length > 0 && (
            <ul className="mt-4 text-[0.8rem] text-ink-600 list-disc pl-5 space-y-1 max-w-[80ch]">
              {inv.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8">
        <SectionTitle title="Recent investigations" />
        {recent.isError && <ErrorState message={(recent.error as Error).message} />}
        {recent.data && recent.data.investigations.length === 0 && <EmptyState title="No investigations yet">Enter a Sepolia address above, connect your wallet, or pick a suggested live LP wallet.</EmptyState>}
        {recent.data && recent.data.investigations.length > 0 && (
          <Card pad={false} className="divide-y divide-ink/8">
            {recent.data.investigations.filter((r, i, all) => all.findIndex((x) => x.wallet.toLowerCase() === r.wallet.toLowerCase()) === i).slice(0, 8).map((r) => (
              <button key={r.id} onClick={() => setInvId(r.id)} className="w-full text-left flex items-center gap-4 px-5 py-3 hover:bg-ink/3">
                <div className="flex-1 min-w-0">
                  <div className="text-[0.9rem] text-ink font-medium tabular">{fmt.addr(r.wallet)}</div>
                  <div className="text-[0.76rem] text-ink-600 break-anywhere">
                    {r.counts ? `${fmt.count(r.counts.positions, "position")}, ${fmt.count(r.counts.events, "event")}` : r.status === "no_positions" ? "No Uniswap V3 positions in the window" : r.status === "failed" ? (r.error ?? "failed").slice(0, 90) : r.status}
                  </div>
                </div>
                <Pill tone={r.status === "done" ? "sage" : r.status === "failed" ? "brick" : r.status === "no_positions" ? "neutral" : "gold"}>{r.status === "no_positions" ? "no positions" : r.status}</Pill>
                <span className="text-[0.74rem] text-ink-600 tabular hidden sm:block whitespace-nowrap">{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            ))}
          </Card>
        )}
      </section>
    </Page>
  );
}
