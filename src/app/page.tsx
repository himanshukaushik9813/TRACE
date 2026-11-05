"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Cpu, Crosshair, History, Layers, Archive, ScanSearch, Search, Wallet, FlaskConical } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { Button, Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Pill, SectionTitle, SourceBadge, Stat } from "@/components/ui";
import { PositionCard } from "@/components/positions";
import { useSepoliaWallet } from "@/components/wallet";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";
import {
  api,
  useCurrentInvestigationId,
  useFullInvestigation,
  useInvestigationStatus,
  useRecentInvestigations,
  useSuggestedWallets,
  withInv,
  type InvestigationStatus,
} from "@/lib/api";

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
  const stageIdx = inv ? ORDER.indexOf(inv.status) : -1;
  const summary = full.data?.investigation.summary ?? inv?.summary ?? null;

  return (
    <Page>
      <section className="relative overflow-hidden rounded-panel border border-ink/10 bg-charcoal-900 on-dark">
        <img src={art.topoWaves} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-[0.55] mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal-900 via-charcoal-900/70 to-transparent" />
        <div className="relative p-6 md:p-10">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Pill tone="gold">Investigation workspace</Pill>
            <SourceBadge onDark label="Ethereum Sepolia · live reads" />
          </div>
          <h1 className="serif text-3xl md:text-[2.6rem] leading-[1.05] text-cream max-w-[22ch]">Understand the strategy behind any wallet.</h1>
          <p className="mt-3 max-w-xl text-cream-muted text-[0.95rem] leading-relaxed">
            Reconstruct real Uniswap V3 positions on Sepolia, infer the strategy from on-chain evidence, backtest it on real pool swaps, and ship the compatible rules to 1inch Aqua with your own wallet.
          </p>

          <div className="mt-6 max-w-2xl">
            <div className="flex flex-col sm:flex-row gap-2 rounded-md2 border border-cream/15 bg-charcoal-800/70 p-1.5 backdrop-blur">
              <div className="flex items-center gap-2 px-3 flex-1">
                <Search size={17} className="text-gold-300 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="0x… Sepolia wallet address"
                  aria-label="Wallet address"
                  className="w-full bg-transparent text-cream placeholder:text-cream-muted/50 text-[0.95rem] outline-none py-2.5 tabular"
                />
              </div>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label="Observation window"
                className="bg-charcoal-800 text-cream text-[0.8rem] rounded-md px-2 border border-cream/10"
              >
                {[7, 14, 30, 90, 180].map((d) => (
                  <option key={d} value={d}>
                    last {d} days
                  </option>
                ))}
              </select>
              <Button variant="gold" onClick={() => run()} disabled={submitting} className="sm:px-5">
                {submitting ? "Queuing…" : "Investigate"}
                <ArrowRight size={15} />
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.72rem] text-cream-muted">
              {wallet.connected && wallet.address && (
                <button onClick={() => run(wallet.address!)} className="inline-flex items-center gap-1 rounded-full border border-gold/30 px-2 py-0.5 hover:text-cream">
                  <Wallet size={11} className="text-gold-300" /> Use connected wallet {fmt.addr(wallet.address)}
                </button>
              )}
              {suggested.data?.wallets.slice(0, 3).map((s) => (
                <button key={s.wallet} onClick={() => run(s.wallet)} className="inline-flex items-center gap-1 rounded-full border border-cream/15 px-2 py-0.5 hover:text-cream" title={`${s.mints} position mints in the last ~50k blocks (live scan)`}>
                  {fmt.addr(s.wallet)} · {s.mints} mints
                </button>
              ))}
              {suggested.isLoading && <span>Finding active Sepolia LPs…</span>}
            </div>
            {suggested.data && <div className="text-[0.64rem] text-cream-muted/70 mt-1">Suggested wallets: {suggested.data.source}</div>}
            {submitErr && <div className="mt-3"><ErrorState title="Could not start the investigation" message={submitErr} /></div>}
          </div>
        </div>
      </section>

      {invId && (
        <section className="mt-6">
          <SectionTitle
            eyebrow={inv ? `Investigation ${invId.slice(0, 8)} · ${fmt.addr(inv.wallet)}` : "Investigation"}
            title="Pipeline"
            action={inv?.status === "done" ? <Pill tone="forest"><Check size={12} /> Complete</Pill> : inv?.status === "failed" ? <Pill tone="brick">Stopped</Pill> : inv ? <Pill tone="gold">Running</Pill> : null}
          />
          {status.isError && <ErrorState message={(status.error as Error).message} />}
          {status.isLoading && <LoadingState label="Loading investigation…" />}
          {inv && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {STAGES.map((s, i) => {
                  const idx = ORDER.indexOf(s.key);
                  const state = inv.status === "done" || stageIdx > idx ? "done" : stageIdx === idx ? (inv.status === "failed" ? "failed" : "running") : inv.status === "failed" ? "skipped" : "idle";
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
              {inv.status !== "done" && inv.status !== "failed" && (
                <div className="mt-3 text-[0.78rem] text-ink-600">
                  {inv.progress.stage ?? "Queued"}
                  {inv.progress.events != null && ` · ${inv.progress.events} events, ${inv.progress.positions} positions, ${inv.progress.rpcCalls} RPC calls`}
                  <span className="block text-[0.7rem] mt-1">Free-tier RPC limits apply; wallets with many positions take a few minutes.</span>
                </div>
              )}
              {inv.status === "failed" && (
                <div className="mt-4">
                  {inv.progress.errorCode === "NO_EVENTS" ? (
                    <EmptyState title="No supported Uniswap V3 positions found" icon={<Crosshair size={17} />}>
                      {inv.error?.replace(/^NO_EVENTS:\s*/, "")} — TRACE shows nothing rather than sample data. Try a longer window or another wallet.
                    </EmptyState>
                  ) : (
                    <ErrorState title="Investigation failed" message={inv.error ?? "unknown error"} />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {inv?.status === "done" && summary && (
        <div className="grid lg:grid-cols-[340px_1fr] gap-6 mt-6">
          <Card dark pad>
            <div className="flex items-center justify-between">
              <Label onDark>Wallet</Label>
              <SourceBadge onDark block={inv.toBlock} />
            </div>
            <div className="mt-3 text-cream font-medium tabular break-all text-[0.9rem]">
              <ExplorerLink kind="address" value={inv.wallet} className="text-cream">{inv.wallet}</ExplorerLink>
            </div>
            <div className="text-[0.7rem] text-cream-muted mt-1">Ethereum Sepolia · blocks {inv.fromBlock?.toLocaleString("en-US")}–{inv.toBlock?.toLocaleString("en-US")}</div>
            <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-cream/10">
              <Stat onDark label="Positions" value={summary.counts.positions} />
              <Stat onDark label="Pools" value={summary.counts.pools} />
              <Stat onDark label="Events" value={summary.counts.events} />
              <Stat onDark label="Closed" value={summary.counts.closed} />
            </div>
            <div className="mt-4 text-[0.72rem] text-cream-muted space-y-1">
              <div>From {fmt.tsSec(summary.period.fromTs)}</div>
              <div>To {fmt.tsSec(summary.period.toTs)}</div>
              <div className="break-all">Evidence fingerprint {summary.eventsFingerprint}</div>
            </div>
            {inv.notes.length > 0 && (
              <ul className="mt-4 text-[0.7rem] text-gold-300 list-disc pl-4 space-y-1">
                {inv.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            <div className="mt-5 flex flex-col gap-2 text-[0.82rem]">
              <Link href={withInv("/strategy", invId)} className="text-gold-300 hover:text-gold-200 flex items-center gap-1"><Layers size={14} /> Strategy DNA & hypothesis</Link>
              <Link href={withInv("/backtest", invId)} className="text-gold-300 hover:text-gold-200 flex items-center gap-1"><FlaskConical size={14} /> Backtest</Link>
              <Link href={withInv("/execute", invId)} className="text-gold-300 hover:text-gold-200 flex items-center gap-1"><ArrowRight size={14} /> Aqua compatibility & execution</Link>
            </div>
          </Card>
          <div>
            <SectionTitle eyebrow="Reconstructed from Sepolia" title="Positions" />
            {summary.positions.length === 0 ? (
              <EmptyState title="No positions in this window" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {summary.positions.map((p) => (
                  <PositionCard key={p.tokenId} p={p} acct={summary.accounting.find((a) => a.tokenId === p.tokenId)} inv={invId} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <section className="mt-8">
        <SectionTitle eyebrow="Persisted in Postgres" title="Recent investigations" />
        {recent.isError && <ErrorState message={(recent.error as Error).message} />}
        {recent.data && recent.data.investigations.length === 0 && <EmptyState title="No investigations yet">Enter a Sepolia address above, connect your wallet, or pick a suggested live LP wallet.</EmptyState>}
        {recent.data && recent.data.investigations.length > 0 && (
          <Card pad={false} className="divide-y divide-ink/8">
            {recent.data.investigations.slice(0, 8).map((r) => (
              <button key={r.id} onClick={() => setInvId(r.id)} className="w-full text-left flex items-center gap-4 px-5 py-3 hover:bg-ink/3">
                <div className="flex-1 min-w-0">
                  <div className="text-[0.88rem] text-ink font-medium tabular">{fmt.addr(r.wallet)}</div>
                  <div className="text-[0.7rem] text-ink-600">
                    {r.counts ? `${r.counts.positions} positions · ${r.counts.events} events` : r.status === "failed" ? (r.error ?? "failed").slice(0, 90) : r.status}
                  </div>
                </div>
                <Pill tone={r.status === "done" ? "sage" : r.status === "failed" ? "brick" : "gold"}>{r.status}</Pill>
                <span className="text-[0.66rem] text-ink-600/70 tabular hidden sm:block">{new Date(r.createdAt).toLocaleString("en-US")}</span>
              </button>
            ))}
          </Card>
        )}
      </section>
    </Page>
  );
}
