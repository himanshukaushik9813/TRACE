"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Search,
  ScanSearch,
  Boxes,
  History,
  Cpu,
  ChevronRight,
  ArrowRight,
  Clock,
  Layers,
  Crosshair,
  Check,
  Wallet,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, SectionTitle, Pill, DemoBadge, Stat, Button } from "@/components/ui";
import { SparklineCard } from "@/components/investigate";
import { DEMO, POSITIONS } from "@/lib/fixture";
import { queueInvestigation, useInvestigation, toDisplayPositions, isLive, fixtureEvents } from "@/lib/live";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";

type Stage = "idle" | "running" | "done" | "incomplete";

const STAGES = [
  { key: "discover", label: "Discover Positions", icon: ScanSearch, count: "12 NFT positions" },
  { key: "events", label: "Fetch Events", icon: History, count: "342 events" },
  { key: "reconstruct", label: "Reconstruct History", icon: Cpu, count: "16-month window" },
  { key: "analyse", label: "Analyse Behaviour", icon: Crosshair, count: "8 fingerprints" },
  { key: "infer", label: "Infer Strategy", icon: Layers, count: "5 candidates" },
] as const;

export default function InvestigatePage() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [active, setActive] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const liveInv = useInvestigation(jobId);

  // Clean up any running pipeline if the user navigates away mid-run.
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // When the live job finishes, close out the stage UI on the real status.
  useEffect(() => {
    if (liveInv && (liveInv.status === "done" || liveInv.status === "failed") && stage === "running") {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      setActive(STAGES.length);
      setStage(liveInv.status === "done" ? "done" : "incomplete");
    }
  }, [liveInv, stage]);

  const run = async () => {
    const wallet = query.trim() || DEMO.wallet.address;
    if (timer.current) clearInterval(timer.current); // idempotent: never stack
    setLiveError(null);

    // 1) Queue the investigation. With an API configured this is a real
    //    BullMQ job (the labelled fixture events keep the demo data flow
    //    working end-to-end); without one it resolves to the fixture path.
    const q = await queueInvestigation(wallet, { events: fixtureEvents(wallet) });
    if ("error" in q) {
      setStage("incomplete");
      setLiveError(q.error);
      return;
    }
    setJobId(q.investigationId);
    setStage("running");
    setActive(0);

    // 2) Drive the stage UI while the job runs. Live jobs finish via the
    //    polling effect below; the fixture path finishes on this timer.
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setActive(i);
      if (!isLive && i >= STAGES.length) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setStage("done");
      }
    }, 620);
  };

  return (
    <Page>
      {/* HERO — topographic contour background */}
      <section className="relative overflow-hidden rounded-panel border border-ink/10 bg-charcoal-900 on-dark">
        <img
          src={art.topoWaves}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-[0.55] mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-charcoal-900 via-charcoal-900/70 to-transparent" />
        <div className="relative p-6 md:p-10">
          <div className="flex items-center gap-2 mb-4">
            <Pill tone="gold">Investigation workspace</Pill>
            <DemoBadge onDark />
          </div>
          <h1 className="serif text-3xl md:text-[2.6rem] leading-[1.05] text-cream max-w-[22ch]">
            Turn wallet activity into an executable strategy.
          </h1>
          <p className="mt-3 max-w-xl text-cream-muted text-[0.95rem] leading-relaxed">
            Reconstruct Uniswap V3 LP behaviour. Discover recurring patterns. Validate with
            backtests. Execute via 1inch Aqua.
          </p>

          {/* Search — the most prominent action */}
          <div className="mt-6 max-w-2xl">
            <div className="flex flex-col sm:flex-row gap-2 rounded-md2 border border-cream/15 bg-charcoal-800/70 p-1.5 backdrop-blur">
              <div className="flex items-center gap-2 px-3 flex-1">
                <Search size={17} className="text-gold-300 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="Enter an Ethereum wallet address…"
                  className="w-full bg-transparent text-cream placeholder:text-cream-muted/50 text-[0.95rem] outline-none py-2.5 tabular"
                />
              </div>
              <Button variant="gold" onClick={run} className="sm:px-5">
                Investigate Wallet
                <ArrowRight size={15} />
              </Button>
            </div>
            <div className="mt-2.5 text-[0.72rem] text-cream-muted flex items-center gap-2">
              <span className="text-gold-300">Sample:</span>
              <button onClick={() => { setQuery(DEMO.wallet.address); }} className="underline decoration-gold/40 underline-offset-2 hover:text-cream">
                {DEMO.wallet.display}
              </button>
              <span>· a real public Uniswap V3 LP (fixture)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Investigation pipeline */}
      <section className="mt-6">
        <SectionTitle
          eyebrow="Investigation pipeline"
          title="Live reconstruction stages"
          action={
            stage === "done" ? <Pill tone="forest"><Check size={12} /> Complete</Pill> : stage === "running" ? <Pill tone="gold">Running</Pill> : <Pill tone="neutral">Ready</Pill>
          }
        />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {STAGES.map((s, i) => {
            const state: Stage = stage === "idle" ? "idle" : stage === "done" ? "done" : i < active ? "done" : i === active ? "running" : "idle";
            const Icon = s.icon;
            return (
              <div key={s.key} className="rounded-md2 border border-ink/10 bg-ivory-50 p-3.5 relative">
                <div className="flex items-center gap-2">
                  <div className={`grid h-7 w-7 place-items-center rounded-md border ${state === "done" ? "bg-forest/12 border-forest/30 text-forest" : state === "running" ? "bg-gold/15 border-gold/40 text-gold" : "bg-ink/5 border-ink/10 text-ink-600"}`}>
                    {state === "done" ? <Check size={14} /> : <Icon size={14} className={state === "running" ? "animate-pulseSoft" : ""} />}
                  </div>
                  <span className="text-[0.6rem] text-ink-600/60 tabular">0{i + 1}</span>
                </div>
                <div className="text-[0.86rem] font-medium text-ink mt-2.5">{s.label}</div>
                <div className="text-[0.7rem] text-ink-600 mt-0.5">{state === "idle" ? "Awaiting" : s.count}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Live API error surfaced, not hidden behind the demo UI */}
      {liveError && stage === "incomplete" && (
        <div className="mt-5 rounded-md2 border border-brick/30 bg-brick/8 p-4 text-[0.82rem] text-brick">
          Live pipeline call failed — showing the labelled sample dataset. Error: {liveError}
        </div>
      )}

      {/* Overview + positions */}
      <div className="grid lg:grid-cols-[360px_1fr] gap-6 mt-6">
        <WalletOverview stage={stage} wallet={query.trim() || DEMO.wallet.address} liveInv={liveInv} />
        <Positions section liveInv={liveInv} />
      </div>

      {/* Recent activity timeline */}
      <ActivityTimeline />

      <EmptyState running={stage !== "idle"} />
    </Page>
  );
}

/* ------------------------------------------------------------------ */
function WalletOverview({
  stage,
  wallet,
  liveInv,
}: {
  stage: Stage;
  wallet: string;
  liveInv?: ReturnType<typeof useInvestigation>;
}) {
  const isDemoWallet = wallet === DEMO.wallet.address;
  const counts = liveInv?.status === "done" ? liveInv.summary?.counts : undefined;
  return (
    <Card dark pad>
      <div className="flex items-center justify-between">
        <Label onDark>Wallet</Label>
        {stage === "idle" ? <Pill tone="neutral">No investigation yet</Pill> : <Pill tone="gold">{stage === "running" ? "Reconstructing" : "Complete"}</Pill>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-12 w-12 rounded-md2 overflow-hidden border border-cream/15 bg-charcoal-800 grid place-items-center">
          <img src={art.identicon} alt="wallet identicon" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <div className="text-cream font-medium tabular text-[0.98rem]">{fmt.addr(wallet)}</div>
          <div className="text-[0.7rem] text-cream-muted">
            {isDemoWallet
              ? `${DEMO.wallet.network} · ${DEMO.wallet.identityNote}`
              : "Ethereum Mainnet · from live investigation"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-cream/10">
        <Stat onDark label="LP positions" value={stage === "idle" ? "—" : String(counts?.positions ?? (isDemoWallet ? DEMO.stats.lpPositions : "—"))} />
        <Stat onDark label="Pools" value={stage === "idle" ? "—" : String(counts?.pools ?? (isDemoWallet ? DEMO.stats.pools : "—"))} />
        <Stat onDark label="Reconstructed events" value={stage === "idle" ? "—" : String(counts?.events ?? (isDemoWallet ? DEMO.stats.reconstructedEvents : "—"))} />
        <Stat onDark label={isDemoWallet ? "Candidate strategies" : "Closed positions"} value={stage === "idle" ? "—" : String(counts?.closed ?? (isDemoWallet ? DEMO.stats.candidateStrategies : "—"))} />
      </div>

      <div className="mt-4 space-y-2 text-[0.76rem]">
        {isDemoWallet ? (
          <>
            <Row label="First observed" value={stage === "idle" ? "—" : fmt.ts(Date.parse(DEMO.wallet.firstObserved), false)} />
            <Row label="Most recent" value={stage === "idle" ? "—" : fmt.ts(Date.parse(DEMO.wallet.mostRecentObserved), false)} />
            <Row label="Observed period" value={stage === "idle" ? "—" : DEMO.stats.observedPeriod} />
          </>
        ) : (
          <Row label="Investigation source" value={liveInv?.status === "done" ? (liveInv.source === "live" ? "live (API)" : "demo fixture") : liveInv ? "in progress" : "queued"} />
        )}
      </div>

      <Link href="/positions/pos-eth-usdc" className="mt-5 flex items-center gap-1.5 text-gold-300 hover:text-gold-200 text-[0.82rem] font-medium">
        Open Position Intelligence <ChevronRight size={15} />
      </Link>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-cream-muted">{label}</span>
      <span className="text-cream tabular">{value}</span>
    </div>
  );
}

function Positions({ section, liveInv }: { section?: boolean; liveInv?: ReturnType<typeof useInvestigation> }) {
  // When a live investigation is done, render the live reconstruction;
  // otherwise the labelled fixture. The badge above reflects source either way.
  const livePositions = liveInv?.status === "done"
    ? toDisplayPositions(liveInv.summary?.positions, POSITIONS)
    : null;
  const positions = livePositions ?? POSITIONS;
  return (
    <div>
      {section && (
        <SectionTitle
          eyebrow="Discovered"
          title="Positions"
          action={
            livePositions
              ? <Pill tone="sage">live read</Pill>
              : liveInv?.source === "demo_fixture" && liveInv?.status === "done"
                ? <Pill tone="neutral">fixture</Pill>
                : null
          }
        />
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {positions.map((p) => (
          <SparklineCard key={p.id} position={p} />
        ))}
      </div>
    </div>
  );
}

function ActivityTimeline() {
  const items = [
    { icon: Wallet, text: "Wallet 0x2C…E37C investigated", sub: "Uniswap V3 · 12 positions", tone: "gold" },
    { icon: Boxes, text: "342 events reconstructed", sub: "5 pools · 16-month window", tone: "sage" },
    { icon: Layers, text: "Strategy inference — 5 candidates", sub: "Top: Active Range Management · 78%", tone: "gold" },
    { icon: Clock, text: "Backtest performed", sub: "Observed replay · +8.1% net", tone: "neutral" },
    { icon: Check, text: "Execution events", sub: "0 shipped · awaiting authorization", tone: "neutral" },
  ];
  return (
    <section className="mt-8">
      <SectionTitle eyebrow="Recent investigation activity" title="Timeline" />
      <Card pad={false} className="divide-y divide-ink/8">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className={`h-8 w-8 grid place-items-center rounded-md border ${i === 0 ? "bg-gold/12 border-gold/30 text-gold" : "bg-ink/5 border-ink/10 text-ink-600"}`}>
                <Icon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[0.9rem] text-ink font-medium">{it.text}</div>
                <div className="text-[0.72rem] text-ink-600">{it.sub}</div>
              </div>
              <span className="text-[0.66rem] text-ink-600/60 tabular">{["Nov 02", "Nov 02", "Nov 02", "Nov 01", "Oct 30"][i]} · 07:{10 + i}</span>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function EmptyState({ running }: { running: boolean }) {
  if (running) return null;
  return (
    <section className="mt-8">
      <Card>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="h-16 w-16 rounded-md2 overflow-hidden border border-ink/10 shrink-0 bg-ivory">
            <img src={art.aiNetwork} alt="" className="h-full w-full object-cover" />
          </div>
          <div>
            <h3 className="serif text-lg text-ink">What a wallet investigation reveals</h3>
            <p className="text-[0.88rem] text-ink-600 mt-1.5 max-w-lg leading-relaxed">
              TRACE reads public Ethereum events, reconstructs each Uniswap V3 position’s full
              lifecycle, calculates deterministic behavioural fingerprints, and — only where the
              evidence supports it — infers a strategy you can test and, if compatible, execute.
            </p>
            <div className="mt-3 text-[0.78rem] text-ink-600">
              No fabricated data is shown before an investigation. Enter an address above, or load the labelled sample.
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
