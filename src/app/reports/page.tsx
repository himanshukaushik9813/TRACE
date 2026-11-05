"use client";

import { useState } from "react";
import {
  FileText,
  Download,
  ShieldCheck,
  GitBranch,
  Layers,
  Gauge,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Boxes,
  Cpu,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, SectionTitle, DemoBadge, Stat } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { DEMO, STRATEGY, EQUITY, STORAGE, POSITIONS, LIFECYCLE } from "@/lib/fixture";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";

export default function ReportsPage() {
  const [generated, setGenerated] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
          <FileText size={15} className="text-gold" />
          Investigation Report · <span className="text-ink font-medium">{DEMO.wallet.display}</span>
        </div>
        <DemoBadge />
      </div>

      <div className="mt-4 grid lg:grid-cols-[340px_1fr] gap-5">
        {/* Left: generation + provenance */}
        <div className="space-y-4">
          <Card dark pad={false} className="p-5">
            <Label onDark>Generate report</Label>
            <h2 className="serif text-xl text-cream mt-2">Investigation dossier</h2>
            <p className="text-[0.82rem] text-cream-muted mt-2 leading-relaxed">
              A comprehensive, citable report: wallet summary, position history, behavioural
              fingerprints, inferred strategy, evidence, backtest, and compatibility — each section
              linked to its on-chain sources.
            </p>
            <button
              onClick={() => setGenerated(true)}
              className={`mt-4 w-full flex items-center justify-center gap-2 rounded-md2 py-3 text-[0.9rem] font-medium transition-colors ${
                generated ? "bg-forest text-ivory-50" : "bg-gold text-charcoal-900 hover:bg-gold-300"
              }`}
            >
              {generated ? <CheckCircle2 size={16} /> : <Download size={16} />}
              {generated ? "Report generated" : "Generate report"}
            </button>
            {generated && (
              <div className="mt-3 rounded-md2 border border-forest/30 bg-forest/12 p-3 text-[0.74rem] text-forest">
                Assembled from 342 events · 5 positions · strategy v0.4. Archived to 0G Storage.
              </div>
            )}
          </Card>

          <Card pad={false} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch size={16} className="text-gold" />
              <span className="text-[0.9rem] font-medium text-ink">Strategy provenance</span>
            </div>
            <div className="space-y-2.5 text-[0.78rem]">
              {[
                ["Source wallet", DEMO.wallet.display],
                ["Source positions", "12 NFT · 5 pools"],
                ["Source events", "342 reconstructed"],
                ["Inference version", "TraceInfer v0.4"],
                ["Strategy IR version", "ir-0.4 · sha256:7c1e…d4"],
                ["Backtest config", "seeded · gas 32gwei"],
                ["Compatibility report", "partial · 2/4 rules"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-ink/8 pb-2">
                  <span className="text-ink-600">{k}</span>
                  <span className="text-ink font-medium tabular text-right">{v}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={false} className="p-5">
            <Label>Archived artifacts</Label>
            <div className="mt-3 space-y-2">
              {STORAGE.map((s) => (
                <div key={s.ref} className="flex items-center gap-2.5 text-[0.74rem]">
                  <CheckCircle2 size={13} className="text-forest" />
                  <span className="text-ink flex-1">{s.kind}</span>
                  <span className="text-ink-600 tabular">{s.ref}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: the report itself */}
        <div className="space-y-4">
          <Card pad={false} className="p-6 paper relative overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="label">Investigation Report</div>
                <h1 className="serif text-2xl md:text-3xl text-ink mt-1.5">
                  Wallet {DEMO.wallet.display}
                </h1>
                <div className="text-[0.82rem] text-ink-600 mt-1.5">
                  {DEMO.wallet.network} · {STRATEGY.period} · {DEMO.stats.observedPeriod} observed
                </div>
              </div>
              <div className="h-14 w-14 overflow-hidden rounded-md2 border border-ink/10 shrink-0">
                <img src={art.mountain} alt="" className="h-full w-full object-cover" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="LP positions" value={DEMO.stats.lpPositions} />
              <Stat label="Pools" value={DEMO.stats.pools} />
              <Stat label="Events" value={DEMO.stats.reconstructedEvents} />
              <Stat label="Candidates" value={DEMO.stats.candidateStrategies} />
            </div>
          </Card>

          {/* Findings */}
          <Card pad={false} className="p-5">
            <SectionTitle eyebrow="Finding" title="Inferred strategy" />
            <div className="rounded-md2 bg-ivory border border-ink/8 p-4 flex items-start gap-3">
              <div className="h-9 w-9 grid place-items-center rounded-md bg-gold/12 text-gold border border-gold/30 shrink-0">
                <Gauge size={16} />
              </div>
              <div>
                <div className="text-[0.94rem] font-medium text-ink">{STRATEGY.family} · {STRATEGY.confidence}% fit</div>
                <div className="text-[0.78rem] text-ink-600 mt-1 leading-relaxed">
                  Active re-sets of the liquidity range after price movement, directional capital
                  reallocation, and bi-monthly fee sweeps. Two rules have no Aqua equivalent; see the
                  compatibility report.
                </div>
              </div>
            </div>
          </Card>

          {/* Backtest excerpt */}
          <Card dark pad={false} className="p-5">
            <SectionTitle eyebrow="Backtest excerpt" title="Equity vs benchmark" onDark />
            <div className="rounded-md2 bg-charcoal-800/50 border border-cream/10 p-3">
              <LineChart
                height={200}
                onDark
                labels={["2024-06", "2024-11", "2025-04", "2025-08", "2025-10"]}
                yFmt={(v) => fmt.usd(v, 0)}
                legend={false}
                series={[
                  { name: "Observed replay", data: EQUITY.observed, color: "#F3EBDD" },
                  { name: "Buy & hold", data: EQUITY.bnh, color: "#B7B0A2", dashed: true, area: false },
                ]}
              />
            </div>
            <div className="mt-3 text-[0.76rem] text-cream-muted">
              Observed replay net +8.1%; buy-and-hold +12.4% in the same window — a strong uptrend
              favours passive hold. The strategy’s value is fee capture and range control, not
              out-performing the tape in every regime.
            </div>
          </Card>

          {/* Failure analysis */}
          <Card pad={false} className="p-5">
            <SectionTitle eyebrow="Failure analysis" title="Where the strategy struggled" />
            <div className="space-y-2.5">
              {[
                { t: "Price moved outside its range", d: "Out-of-range 22% of the period; capital idle and IL realised.", tone: "amber" },
                { t: "Frequent rebalancing raised gas", d: "0.6/wk; at higher volatility a tighter trigger would break even.", tone: "amber" },
                { t: "Capital underutilised", d: "81% utilisation — the wide range holds more quote than it needs.", tone: "neutral" },
                { t: "Fees vs IL in the red windows", d: "In 3 of 5 windows, fees did not offset realised IL.", tone: "brick" },
              ].map((f) => (
                <div key={f.t} className="flex items-start gap-3 rounded-md2 border border-ink/8 bg-ivory px-3.5 py-3">
                  <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${f.tone === "brick" ? "text-brick" : f.tone === "amber" ? "text-amber" : "text-ink-600"}`} />
                  <div>
                    <div className="text-[0.86rem] font-medium text-ink">{f.t}</div>
                    <div className="text-[0.76rem] text-ink-600 mt-0.5">{f.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Evidence graph (compact + full) */}
          <Card pad={false} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle eyebrow="Evidence graph" title="Wallet → Position → Event → Hypothesis" />
              <button
                onClick={() => setGraphExpanded((v) => !v)}
                className="text-[0.72rem] text-gold font-medium inline-flex items-center gap-1 hover:text-gold-300 transition-colors"
                aria-expanded={graphExpanded}
              >
                {graphExpanded ? "Compact view" : "Full graph"}
                <ChevronRight size={13} className={`transition-transform ${graphExpanded ? "rotate-90" : ""}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                ["Wallet", Boxes, DEMO.wallet.display],
                ["Position", Layers, "NFT #12841"],
                ["Pool", Gauge, "0xE5e2…b8a1"],
                ["Event", Cpu, "0x9f3a…b21c"],
                ["Hypothesis", ShieldCheck, "Active range mgmt"],
              ].map(([label, Icon, v], i) => {
                const I = Icon as any;
                return (
                  <div key={i} className="relative rounded-md2 border border-ink/10 bg-ivory-50 p-3">
                    <I size={15} className="text-gold" />
                    <div className="label mt-2">{label as string}</div>
                    <div className="text-[0.74rem] text-ink font-medium tabular mt-0.5 truncate">{v as string}</div>
                    {i < 4 && <ChevronRight size={13} className="absolute top-1/2 -right-2.5 -translate-y-1/2 text-gold" />}
                  </div>
                );
              })}
            </div>
            {graphExpanded && (
              <div className="mt-5 pt-5 border-t border-ink/8">
                <div className="text-[0.64rem] uppercase tracking-wide2 text-ink-600 font-semibold mb-3">
                  Full evidence graph · {POSITIONS.length} positions · {LIFECYCLE.length} lifecycle events
                </div>
                <div className="space-y-4">
                  {POSITIONS.map((p) => (
                    <div key={p.id} className="rounded-md2 border border-ink/10 bg-ivory-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Layers size={14} className="text-gold" />
                        <span className="text-[0.8rem] font-medium text-ink">{p.tokenPair}</span>
                        <span className="text-[0.7rem] text-ink-600 tabular">NFT #{p.nftId} · {p.feeTier} tier</span>
                        <span className={`ml-auto text-[0.64rem] font-semibold uppercase tracking-wide2 ${p.status === "Active" ? "text-forest" : "text-ink-600"}`}>{p.status}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <span className="text-[0.7rem] text-ink-600 tabular inline-flex items-center gap-1"><Gauge size={12} className="text-gold" /> {p.pool}</span>
                        <span className="text-[0.7rem] text-ink-600 tabular">range ${p.rangeLo.toLocaleString()} – ${p.rangeHi.toLocaleString()}</span>
                        <span className="text-[0.7rem] text-ink-600 tabular">last {p.lastActivity}</span>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-md2 border border-ink/10 bg-ivory-50 p-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Cpu size={14} className="text-gold" />
                      <span className="text-[0.8rem] font-medium text-ink">Lifecycle events · ETH/USDC position</span>
                    </div>
                    <div className="space-y-1.5">
                      {LIFECYCLE.map((e) => (
                        <div key={e.tx} className="flex flex-wrap items-center gap-2 text-[0.72rem]">
                          <span className="font-medium text-ink tabular w-24">{e.ts}</span>
                          <span className="text-[0.64rem] uppercase tracking-wide2 text-gold font-semibold w-16">{e.type}</span>
                          <a
                            href={`https://etherscan.io/tx/${e.tx}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ink-600 tabular underline decoration-ink/30 underline-offset-2 hover:text-gold transition-colors"
                          >
                            {e.tx}
                          </a>
                          <span className="text-ink-600">{e.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-md2 border border-forest/20 bg-forest/6 p-3">
                    <ShieldCheck size={14} className="text-forest" />
                    <span className="text-[0.78rem] text-ink">
                      <span className="font-medium">{STRATEGY.family.toLowerCase()}</span>
                      <span className="text-ink-600"> · confidence {STRATEGY.confidence}% · {STRATEGY.supportingPositions} supporting positions · {STRATEGY.period}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
