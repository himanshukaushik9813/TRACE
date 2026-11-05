"use client";

import {
  Bookmark,
  GitCompare,
  History,
  CheckCircle2,
  ShieldCheck,
  Boxes,
  GitBranch,
  ArrowRight,
  FlaskConical,
  Terminal,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, Pill, DemoBadge, Stat } from "@/components/ui";
import { DEMO, STRATEGY } from "@/lib/fixture";
import { art } from "@/lib/assets";

const VERSIONS = [
  {
    v: "v0.4",
    status: "Current",
    ts: "2025-11-02",
    change: "Adopted “active range management” as top family (78%); demoted periodic cadence.",
    why: "New Q3 events strengthened the price-triggered re-set signal.",
    ir: "ir-0.4 · sha256:7c1e…d4",
  },
  {
    v: "v0.3",
    status: "Superseded",
    ts: "2024-12-02",
    change: "Classified as “periodic range adjustment” (61%).",
    why: "Only 8 months of history at the time; cadence looked clock-driven.",
    ir: "ir-0.3 · sha256:2ab9…c1",
  },
  {
    v: "v0.2",
    status: "Superseded",
    ts: "2024-09-18",
    change: "First hypothesis: “passive concentrated liquidity” (41%).",
    why: "Insufficient events — TRACE flagged inconclusive, did not force a label.",
    ir: "ir-0.2 · sha256:90ff…a2",
  },
];

export default function SavedPage() {
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
          <Bookmark size={15} className="text-gold" />
          Saved Strategies · versioned & provenance-tracked
        </div>
        <DemoBadge />
      </div>

      <div className="mt-4 grid lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5">
          {/* Provenance header */}
          <Card dark pad={false} className="p-5">
            <div className="flex items-center justify-between">
              <Label onDark>Strategy · {DEMO.wallet.display}</Label>
              <Pill tone="gold">{STRATEGY.family}</Pill>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
              <Stat onDark label="Source wallet" value={DEMO.wallet.display} />
              <Stat onDark label="Source positions" value={STRATEGY.supportingPositions.toString()} />
              <Stat onDark label="Inference version" value="TraceInfer v0.4" />
              <Stat onDark label="Evidence complete" value={STRATEGY.evidenceCompleteness + "%"} />
            </div>
          </Card>

          {/* Version history — immutable */}
          <Card pad={false} className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <History size={16} className="text-gold" />
              <span className="text-[0.92rem] font-medium text-ink">Version history</span>
              <span className="text-[0.7rem] text-ink-600">each version is immutable; changes append, never rewrite</span>
            </div>
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-ink/12" />
              <div className="space-y-4">
                {VERSIONS.map((x) => (
                  <div key={x.v} className="relative">
                    <span className={`absolute -left-5 top-1 h-3.5 w-3.5 rounded-full border-2 ${x.status === "Current" ? "bg-gold border-gold" : "bg-ivory-50 border-ink/25"}`} />
                    <div className={`rounded-md2 p-4 border ${x.status === "Current" ? "border-gold/40 bg-gold/8" : "border-ink/10 bg-ivory"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.94rem] font-semibold text-ink tabular">{x.v}</span>
                        <Pill tone={x.status === "Current" ? "gold" : "neutral"}>{x.status}</Pill>
                        <span className="text-[0.7rem] text-ink-600 tabular ml-auto">{x.ts}</span>
                      </div>
                      <div className="text-[0.84rem] text-ink mt-2">{x.change}</div>
                      <div className="text-[0.76rem] text-ink-600 mt-1.5 leading-relaxed">
                        <span className="text-gold font-medium">Why: </span>{x.why}
                      </div>
                      <div className="text-[0.7rem] text-ink-600/70 tabular mt-1.5 flex items-center gap-1.5">
                        <GitBranch size={12} /> {x.ir}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Card dark pad={false} className="p-5 relative overflow-hidden">
            <img src={art.lg.fingerprint} alt="" aria-hidden className="w-full rounded-md2 opacity-90 mb-4" />
            <Label onDark>Strategy DNA</Label>
            <div className="text-[0.78rem] text-cream-muted mt-2 leading-relaxed">
              Behavioural fingerprint for {DEMO.wallet.display}. Compare against any other
              investigated wallet to overlay their DNA.
            </div>
            <a href="/strategy?tab=dna" className="mt-3 inline-flex items-center gap-1.5 text-gold-300 text-[0.8rem] font-medium">
              Open DNA <ArrowRight size={14} />
            </a>
          </Card>

          <Card pad={false} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <GitCompare size={16} className="text-gold" />
              <span className="text-[0.9rem] font-medium text-ink">Compare strategies</span>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-md2 border border-ink/10 bg-ivory-50 px-3 py-2.5">
                <div>
                  <div className="text-[0.84rem] text-ink font-medium">vs 0x7B…4A1F (your wallet)</div>
                  <div className="text-[0.68rem] text-ink-600">range freq · deploy · fees</div>
                </div>
                <Pill tone="neutral">requires 2nd investigation</Pill>
              </div>
              <div className="text-[0.74rem] text-ink-600 leading-relaxed">
                Comparison overlays range-adjustment behaviour, capital deployment, fee collection
                patterns, position persistence, and strategy hypotheses side by side.
              </div>
            </div>
          </Card>

          <Card pad={false} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={16} className="text-gold" />
              <span className="text-[0.9rem] font-medium text-ink">Actions</span>
            </div>
            <div className="space-y-2">
              <a href="/backtest" className="flex items-center gap-2.5 rounded-md2 border border-ink/10 bg-ivory px-3.5 py-2.5 text-[0.84rem] text-ink font-medium hover:border-gold/40">
                <FlaskConical size={15} className="text-gold" /> Backtest v0.4
              </a>
              <a href="/execute" className="flex items-center gap-2.5 rounded-md2 border border-ink/10 bg-ivory px-3.5 py-2.5 text-[0.84rem] text-ink font-medium hover:border-gold/40">
                <Terminal size={15} className="text-gold" /> Compile to Aqua
              </a>
              <a href="/reports" className="flex items-center gap-2.5 rounded-md2 border border-ink/10 bg-ivory px-3.5 py-2.5 text-[0.84rem] text-ink font-medium hover:border-gold/40">
                <Boxes size={15} className="text-gold" /> Open report
              </a>
            </div>
          </Card>

          <div className="rounded-md2 border border-ink/10 bg-ivory-50 p-4 text-[0.72rem] text-ink-600 leading-relaxed flex gap-2">
            <CheckCircle2 size={15} className="text-forest shrink-0" />
            Every saved strategy keeps its full provenance: source wallet, positions, events, inference
            version, IR version, backtest config, and compatibility report.
          </div>
        </div>
      </div>
    </Page>
  );
}
