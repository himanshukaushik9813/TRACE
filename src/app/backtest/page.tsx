"use client";

import { useState } from "react";
import {
  FlaskConical,
  SlidersHorizontal,
  Gauge,
  ArrowLeftRight,
  Crosshair,
  BarChart3,
  AlertTriangle,
  Check,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, Pill, DemoBadge, Tabs } from "@/components/ui";
import { LineChart, Drawdown, RangeBand } from "@/components/charts";
import { BACKTEST, EQUITY } from "@/lib/fixture";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";

function drawdowns(series: number[], base: number): number[] {
  let peak = series[0];
  return series.map((v) => {
    peak = Math.max(peak, v);
    return (v - peak) / base; // negative fraction
  });
}

export default function BacktestPage() {
  const [tab, setTab] = useState<"overview" | "integrity">("overview");
  const start = BACKTEST.startCapital;
  const observed = EQUITY.observed;
  const observedDD = drawdowns(observed, start);
  const netObserved = observed[observed.length - 1] / start - 1;

  const labels = ["2024-06", "2024-11", "2025-04", "2025-08", "2025-10"];

  const metrics: [string, string, string?][] = [
    ["Starting capital", fmt.usd(start)],
    ["Ending capital", fmt.usd(observed[observed.length - 1])],
    ["Realised fees", "$1,418 (collected)"],
    ["Est. unrealised fees", "$286", "upper bound"],
    ["Impermanent loss", "-3.1% (estimated)"],
    ["Net return", fmt.pct(netObserved * 100), "under stated assumptions"],
    ["Max drawdown", fmt.pct(Math.min(...observedDD) * 100)],
    ["Gas cost", "~$214", BACKTEST.gasAssumption],
    ["Slippage", fmt.pct(BACKTEST.slippage)],
    ["Rebalance frequency", "0.6 / wk"],
    ["Out-of-range duration", "22% of period"],
    ["Capital utilisation", "81%"],
  ];

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
          <FlaskConical size={15} className="text-gold" />
          Strategy Lab · counterfactual backtesting
        </div>
        <DemoBadge />
      </div>

      <Tabs
        className="mt-3"
        value={tab}
        onChange={setTab}
        tabs={[{ id: "overview", label: "Overview" }, { id: "integrity", label: "Backtest integrity" }]}
      />

      {tab === "overview" ? (
        <div className="mt-4 space-y-5">
          <div className="grid lg:grid-cols-[300px_1fr] gap-5">
            {/* Configuration */}
            <Card pad={false} className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-gold" />
                <span className="text-[0.9rem] font-medium text-ink">Configuration</span>
              </div>
              {/* Token-pair identification — metallic token artwork */}
              <div className="flex items-center gap-3 rounded-md2 bg-ivory border border-ink/8 p-3">
                <img src={art.metallicTokens} alt="Token pair" className="h-12 w-12 rounded-md object-cover shrink-0" />
                <div className="min-w-0">
                  <div className="text-[0.9rem] font-medium text-ink">ETH / USDC</div>
                  <div className="text-[0.72rem] text-ink-600 mt-1">Concentrated-liquidity pool under test</div>
                </div>
              </div>
              <Cfg label="Strategy version" value="v0.4 · active range mgmt" />
              <Cfg label="Evaluation period" value={BACKTEST.period} />
              <Cfg label="Starting capital" value={fmt.usd(start)} />
              <Cfg label="Pool / pair" value="ETH/USDC · 0.05% · 0xE5e2…" />
              <Cfg label="Rebalance rule" value="On band exit ±6%" />
              <Cfg label="Gas / slippage" value={`${BACKTEST.gasAssumption} · ${fmt.pct(BACKTEST.slippage)}`} />
              <div className="rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.72rem] text-ink-600 leading-relaxed">
                Simulated returns are <strong>not</strong> guaranteed future returns. Underperformance
                and failure conditions are shown intentionally.
              </div>
            </Card>

            {/* Equity curve */}
            <Card dark pad={false} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label onDark>Equity curve · benchmarks</Label>
                  <div className="serif text-lg text-cream mt-1">Capital over evaluation period</div>
                </div>
                <Pill tone="gold">net {fmt.pct(netObserved * 100)} (observed)</Pill>
              </div>
              <div className="rounded-md2 bg-charcoal-800/50 border border-cream/10 p-3">
                <LineChart
                  height={300}
                  onDark
                  labels={labels}
                  yFmt={(v) => "$" + fmt.usd(v, 0).replace("$", "")}
                  series={[
                    { name: "Observed wallet replay", data: EQUITY.observed, color: "#F3EBDD" },
                    { name: "Inferred strategy (replay)", data: EQUITY.inferred, color: "#B68A42" },
                    { name: "Passive V3 LP", data: EQUITY.passive, color: "#78866B" },
                    { name: "Buy & hold ETH", data: EQUITY.bnh, color: "#B7B0A2", dashed: true, area: false },
                  ]}
                />
              </div>
              <div className="mt-3 text-[0.74rem] text-cream-muted leading-relaxed">
                The <strong className="text-cream">observed wallet replay</strong> is a counterfactual
                simulation of what the reconstructed behaviour would have earned. It is a different
                thing from the actual on-chain P&L, and from the passive benchmark.
              </div>
            </Card>
          </div>

          {/* Drawdown + range occupancy */}
          <div className="grid md:grid-cols-2 gap-5">
            <Card dark pad={false} className="p-5">
              <Label onDark>Drawdown (observed replay)</Label>
              <div className="mt-3 rounded-md2 bg-charcoal-800/50 border border-cream/10 p-3">
                <Drawdown data={observedDD} height={140} />
              </div>
              <div className="mt-2 text-[0.74rem] text-cream-muted">Worst drawdown {fmt.pct(Math.min(...observedDD) * 100)} mid-window.</div>
            </Card>

            <Card dark pad={false} className="p-5">
              <Label onDark>Liquidity range occupancy</Label>
              <div className="mt-3 rounded-md2 bg-charcoal-800/50 border border-cream/10 p-3">
                <RangeBand
                  price={EQUITY.observed.map((_, i) => 3400 + Math.sin((i / 96) * Math.PI * 4) * 470 + Math.sin((i / 96) * Math.PI * 9) * 140)}
                  lo={3080}
                  hi={3920}
                  events={[{ i: 30 }, { i: 55 }, { i: 78 }]}
                  height={140}
                />
              </div>
              <div className="mt-2 flex items-center gap-4 text-[0.72rem] text-cream-muted">
                <span className="inline-flex items-center gap-1.5"><Gauge size={13} className="text-gold-300" /> Capital utilisation 81%</span>
                <span className="inline-flex items-center gap-1.5"><Crosshair size={13} className="text-gold-300" /> 22% out-of-range</span>
              </div>
            </Card>
          </div>

          {/* Performance metrics grid */}
          <Card pad={false} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-gold" />
              <span className="text-[0.9rem] font-medium text-ink">Performance metrics</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-5">
              {metrics.map(([l, v, s]) => (
                <div key={l}>
                  <Label>{l}</Label>
                  <div className="stat-value text-[1.05rem] font-semibold text-ink mt-1 tabular">{v}</div>
                  {s && <div className="text-[0.66rem] text-ink-600 mt-0.5">{s}</div>}
                </div>
              ))}
            </div>
          </Card>

          {/* Supporting chart artwork + reading guide */}
          <div className="grid md:grid-cols-3 gap-4">
            <Card pad={false} className="p-4 relative overflow-hidden">
              <img src={art.candlestick} alt="" aria-hidden className="h-24 w-full object-cover rounded-md2 opacity-70" />
              <div className="mt-3 text-[0.72rem] text-ink-600 leading-relaxed">
                <span className="text-ink font-medium">Supporting context.</span> Candlestick form is
                illustrative only — the price series plotted above is real reconstructed data, not this artwork.
              </div>
            </Card>
            <Card pad={false} className="p-4 relative overflow-hidden">
              <img src={art.equityCurve} alt="" aria-hidden className="h-24 w-full object-cover rounded-md2 opacity-70" />
              <div className="mt-3 text-[0.72rem] text-ink-600 leading-relaxed">
                <span className="text-ink font-medium">Reading the equity curve.</span> The rising
                envelope is unrealised value; the dips are drawdowns and range exits.
              </div>
            </Card>
            <Card dark pad={false} className="p-4 relative overflow-hidden">
              <img src={art.equityCurve} alt="" aria-hidden className="absolute right-0 bottom-0 h-24 w-24 object-cover opacity-20 mix-blend-screen" />
              <div className="relative">
                <Label onDark>Method</Label>
                <p className="text-[0.76rem] text-cream-muted mt-2 leading-relaxed">
                  Counterfactual replay: each block re-applies the inferred rule with only the data
                  available up to that block. Deterministic, seeded, reproducible config.
                </p>
              </div>
            </Card>
          </div>

          {/* Fee accumulation + rebalance events */}
          <div className="grid md:grid-cols-2 gap-5">
            <Card pad={false} className="p-5">
              <Label>Fee accumulation (observed replay)</Label>
              <div className="mt-3"><LineChart height={130} onDark={false} legend={false} labels={["", "", "", "", ""]} yFmt={(v) => "$" + v} series={[{ name: "Cumulative fees", data: [0, 320, 640, 980, 1418, 1418], color: "#B68A42" }]} /></div>
            </Card>
            <Card pad={false} className="p-5">
              <Label>Rebalance events (2 shown per window)</Label>
              <div className="mt-3 space-y-2">
                {["Rebalance · 0x9f3a…b21c · +liquidity tilt up", "Rebalance · 0xd0c2…1a8e · widen on low"].map((t, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md2 bg-ivory border border-ink/8 px-3 py-2.5">
                    <ArrowLeftRight size={15} className="text-gold" />
                    <span className="text-[0.8rem] text-ink flex-1">{t}</span>
                    <span className="text-[0.66rem] text-ink-600 tabular">{["Aug 2024", "Feb 2025"][i]}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Integrity />
      )}
    </Page>
  );
}

function Cfg({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/8 pb-2.5">
      <span className="text-[0.76rem] text-ink-600">{label}</span>
      <span className="text-[0.82rem] text-ink font-medium tabular text-right">{value}</span>
    </div>
  );
}

function Integrity() {
  const items = [
    { t: "Historical time alignment", d: "Events aligned by block number, not wall-clock; sub-second reorg window handled." },
    { t: "No look-ahead bias", d: "Each decision uses only data available up to its block. Future prices are not consulted." },
    { t: "Explicit assumptions", d: "Gas 32 gwei avg, 0.12% slippage, 42% tax on fees. All stated, all reproducible." },
    { t: "Evaluation separation", d: "Inference window (train) and backtest window (test) do not overlap." },
    { t: "Gas & slippage modelling", d: "Rebalance costs deducted; a thin market would fail — shown, not hidden." },
    { t: "Missing-data warnings", d: "2 of 5 exits have incomplete cross-pool history — flagged, not silently dropped." },
    { t: "Reproducible config", d: "Seeded, versioned config hash attached to every run (sha256:7c1e…d4)." },
  ];
  return (
    <div className="mt-4 grid md:grid-cols-2 gap-4">
      {items.map((it) => (
        <Card key={it.t} pad={false} className="p-4 flex gap-3">
          <div className="h-9 w-9 shrink-0 grid place-items-center rounded-md bg-forest/12 text-forest border border-forest/25">
            <Check size={16} />
          </div>
          <div>
            <div className="text-[0.9rem] font-medium text-ink">{it.t}</div>
            <div className="text-[0.78rem] text-ink-600 mt-1 leading-relaxed">{it.d}</div>
          </div>
        </Card>
      ))}
      <Card pad={false} className="p-4 md:col-span-2 border-amber/25 bg-amber/8">
        <div className="flex items-center gap-2 text-amber">
          <AlertTriangle size={16} /> <span className="text-[0.9rem] font-medium">Honesty guardrail</span>
        </div>
        <div className="text-[0.8rem] text-ink-600 mt-1.5 leading-relaxed">
          Nothing on this screen claims the simulated returns are guaranteed. The observed replay and the
          counterfactual strategy simulation are different instruments, and both can underperform a plain
          buy-and-hold in a strong uptrend — exactly as shown.
        </div>
      </Card>
    </div>
  );
}
