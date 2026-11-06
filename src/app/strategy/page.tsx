"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { Card, ErrorState, ExplorerLink, Label, Meter, Pill, SectionTitle, Stat, Tabs } from "@/components/ui";
import { fmt } from "@/lib/format";
import type { Fingerprints, FullInvestigation, StrategyRow } from "@/lib/api";

const FAMILY: Record<string, string> = {
  passive_concentrated: "Passive concentrated liquidity",
  passive_full_range: "Passive full-range liquidity",
  periodic_range_adjustment: "Periodic range adjustment",
  active_range_management: "Active range management",
  capital_redeployment: "Repeated capital deploy / withdraw",
  inconclusive: "Inconclusive",
};
const CATS: { key: string; label: string }[] = [
  { key: "entry", label: "Entry" },
  { key: "adjustment", label: "Adjustment" },
  { key: "exit", label: "Exit" },
  { key: "fee", label: "Fees" },
  { key: "risk", label: "Risk" },
];

function dnaRows(f: Fingerprints): { label: string; value: string; derived: string }[] {
  const hours = (h: number | null) => (h == null ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`);
  return [
    { label: "Average range width", value: f.avgRangeWidthPct != null ? (f.avgRangeWidthPct >= 1 ? `${(1 + f.avgRangeWidthPct).toLocaleString("en-US", { maximumFractionDigits: 1 })}× price span` : `${fmt.frac(f.avgRangeWidthPct)} wide`) : f.fullRangeShare === 1 ? "Full range" : "—", derived: f.avgRangeWidthTicks != null ? `${Math.round(f.avgRangeWidthTicks)} ticks mean; ${fmt.frac(f.fullRangeShare, 0)} of positions full-range` : "no range known" },
    { label: "Range adjustment frequency", value: `${f.repositionsPerWeek.toFixed(2)} / week`, derived: `${f.repositionCount} re-sets (new NFT in the same pool after reducing the previous)` },
    { label: "Position duration (median)", value: hours(f.medianPositionDurationHours), derived: `${f.closedPositions} closed of ${f.positionCount} positions` },
    { label: "Time in range", value: f.timeInRangePct != null ? fmt.frac(f.timeInRangePct) : "not measured", derived: f.timeInRangePct != null ? "share of real pool swaps inside each position's range" : "no swap price data for the pool(s)" },
    { label: "Capital deployment changes", value: `${f.increaseCount} in · ${f.decreaseCount} out`, derived: `largest single-position liquidity swing ${fmt.frac(f.maxLiquiditySwingPct, 0)}` },
    { label: "Fee collection", value: f.collectCadenceDays != null ? `every ${hours(f.collectCadenceDays * 24)}` : `${f.collectCount} collect(s)`, derived: `${f.collectCount} Collect events (fee portion split from returned principal)` },
    { label: "Withdraw → redeploy", value: `${f.withdrawRedeployCount} cycle(s)`, derived: `median re-entry ${hours(f.medianReentryHours)}` },
    { label: "Gas paid", value: f.gasSpentEth != null ? `${f.gasSpentEth.toFixed(5)} ETH` : "—", derived: "sum of real receipts (gasUsed × effectiveGasPrice)" },
  ];
}

function StrategyView({ s, full }: { s: StrategyRow; full: FullInvestigation }) {
  const ir = s.ir;
  return (
    <>
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-5 mt-4">
        <Card dark>
          <Label onDark>{s.role === "ai_hypothesis" ? "0G-proposed hypothesis (evidence-gated)" : "Evidence-only analysis (no AI)"}</Label>
          <h2 className="serif text-2xl text-cream mt-2">{FAMILY[ir.family] ?? ir.family}</h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat onDark label="Confidence" value={fmt.frac(ir.confidence, 0)} sub="fit to evidence — not a probability" />
            <Stat onDark label="Rules" value={ir.rules.length} sub={`${ir.evidenceRefs.length} cited transactions`} />
          </div>
          <p className="text-[0.72rem] text-cream-muted mt-3">{ir.confidenceNote}</p>
          <div className="mt-4 text-[0.7rem] text-cream-muted space-y-1 break-all">
            <div>Version {ir.id}{ir.parentId ? ` (derived from ${ir.parentId})` : ""}</div>
            <div>Version hash {s.versionHash}</div>
            <div>Evidence blocks {ir.evidencePeriod.fromBlock.toLocaleString("en-US")}–{ir.evidencePeriod.toBlock.toLocaleString("en-US")} · {ir.sourceProtocol} · chain {ir.chainId}</div>
            <div>Source: {ir.source.model} · {ir.source.provider}{ir.source.requestRef ? ` · request ${ir.source.requestRef}` : ""} · attested {String(ir.source.attested)}</div>
          </div>
        </Card>
        <Card>
          <SectionTitle eyebrow="Competing explanations" title="Alternatives" />
          <div className="space-y-3">
            {ir.alternatives.map((a) => (
              <div key={a.family}>
                <div className="flex items-center justify-between text-[0.85rem]">
                  <span className="text-ink font-medium">{a.label}</span>
                  <span className="tabular text-ink-600">{a.score}</span>
                </div>
                <Meter value={a.score} />
                <div className="text-[0.72rem] text-ink-600 mt-1">{a.why}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionTitle eyebrow="Every rule cites real Sepolia transactions" title="Inferred rules" />
      {ir.rules.length === 0 ? (
        <Card>
          <div className="text-ink-600 text-[0.88rem]">No rules: the evidence is insufficient for a hypothesis. TRACE reports this instead of inventing one.</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {CATS.filter((c) => ir.rules.some((r) => r.category === c.key)).map((c) => (
            <div key={c.key}>
              <Label>{c.label}</Label>
              <div className="grid md:grid-cols-2 gap-3 mt-2">
                {ir.rules.filter((r) => r.category === c.key).map((r) => (
                  <Card key={r.rule}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-ink font-medium text-[0.92rem]">{r.rule}</div>
                      <Pill tone="gold">{fmt.frac(r.confidence, 0)}</Pill>
                    </div>
                    <div className="text-[0.8rem] text-ink-600 mt-2">{r.evidence}</div>
                    <div className="flex flex-wrap gap-2 mt-2 text-[0.72rem]">
                      {r.evidenceRefs.slice(0, 6).map((t) => <ExplorerLink key={t} kind="tx" value={t} />)}
                      {r.evidenceRefs.length > 6 && <span className="text-ink-600">+{r.evidenceRefs.length - 6} more</span>}
                    </div>
                    <div className="mt-3 text-[0.72rem] text-ink-600 space-y-0.5">
                      <div><span className="text-ink">Alternative:</span> {r.alternative}</div>
                      <div><span className="text-ink">Uncertainty:</span> {r.uncertainty}</div>
                      {r.mapsTo && <div><span className="text-ink">Maps to:</span> {r.mapsTo}</div>}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle eyebrow="Stated honestly" title="Limitations" />
      <Card>
        <ul className="list-disc pl-5 text-[0.84rem] text-ink-600 space-y-1">
          {ir.limitations.map((l) => <li key={l}>{l}</li>)}
          {full.dna?.data.seriesErrors?.map((e) => <li key={e}>Price history error: {e}</li>)}
        </ul>
      </Card>
    </>
  );
}

export default function StrategyPage() {
  const [which, setWhich] = useState<"primary" | "baseline">("primary");
  return (
    <Page>
      <InvestigationGate>
        {(full) => {
          const ai = full.strategies.find((s) => s.role === "ai_hypothesis");
          const base = full.strategies.find((s) => s.role === "evidence_baseline");
          const run = full.inferenceRuns[0];
          const shown = which === "baseline" ? base : (ai ?? base);
          const f = full.dna?.data.fingerprints;
          return (
            <>

              <div className={`flex items-start gap-3 rounded-panel border px-4 py-3.5 ${run?.status === "succeeded" ? "border-forest/30 bg-forest/5" : "border-amber/30 bg-amber/5"}`}>
                {run?.status === "succeeded" ? <ShieldCheck className="text-forest mt-0.5 shrink-0" size={18} /> : <ShieldAlert className="text-amber mt-0.5 shrink-0" size={18} />}
                <div className="min-w-0 flex-1">
                  <div className="text-ink font-medium text-[0.92rem]">
                    {run?.status === "succeeded"
                      ? "0G Private Computer proposed this hypothesis; every rule passed the evidence gate"
                      : "0G Private Computer was unavailable, so this is the evidence-only analysis"}
                  </div>
                  <div className="text-[0.8rem] text-ink-600 mt-0.5 break-anywhere">
                    {run?.status === "succeeded"
                      ? `Model ${run.model}. TEE verified: ${run.teeVerified == null ? "not reported" : run.teeVerified ? "yes" : "no"}. ${run.rulesRejected} proposed rule${run.rulesRejected === 1 ? "" : "s"} rejected for citing transactions outside the evidence.`
                      : run
                        ? "No rule below comes from a model; each is computed from the wallet's transactions and links to them."
                        : "No inference run is recorded for this investigation."}
                  </div>
                  {run && run.status !== "succeeded" && (
                    <details className="mt-1.5 text-[0.76rem] text-ink-600">
                      <summary className="cursor-pointer text-ink hover:text-gold w-fit">Why 0G was unavailable</summary>
                      <p className="mt-1 break-anywhere">
                        {run.errorCode ?? run.status}: {run.error ?? "no detail"}
                        {run.requestId ? ` Router request ${run.requestId}.` : ""}
                      </p>
                    </details>
                  )}
                </div>
              </div>

              {f && (
                <>
                  <SectionTitle eyebrow="Eight behaviour measurements computed from the wallet's own transactions" title="Strategy DNA" />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-panel overflow-hidden border border-ink/10 bg-ink/10">
                    {dnaRows(f).map((d) => (
                      <div key={d.label} className="bg-ivory-50 p-4 min-w-0">
                        <Label>{d.label}</Label>
                        <div className="text-ink font-semibold text-lg mt-1 tabular break-anywhere">{d.value}</div>
                        <div className="text-[0.74rem] text-ink-600 mt-1 leading-snug break-anywhere">{d.derived}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {ai && base && (
                <Tabs
                  className="mt-6"
                  value={which}
                  onChange={setWhich}
                  tabs={[
                    { id: "primary", label: "0G hypothesis" },
                    { id: "baseline", label: "Evidence-only baseline" },
                  ]}
                />
              )}
              {shown ? <StrategyView s={shown} full={full} /> : <ErrorState message="No strategy version stored for this investigation." />}
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
