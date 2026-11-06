"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, CircleDot, GitCompare, ShieldAlert, ShieldCheck } from "lucide-react";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Meter, Pill, SectionTitle, Tabs } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { NextStep } from "@/components/next-step";
import { MarkStep } from "@/components/welcome";
import { Term } from "@/components/term";
import { FAMILY, FAMILY_PLAIN } from "@/components/case-file";
import { fmt } from "@/lib/format";
import { api, withInv, type Compatibility, type Fingerprints, type FullInvestigation, type StrategyIR, type StrategyRow } from "@/lib/api";

const CATS: { key: string; label: string }[] = [
  { key: "entry", label: "Entry" },
  { key: "adjustment", label: "Adjustment" },
  { key: "exit", label: "Exit" },
  { key: "fee", label: "Fees" },
  { key: "risk", label: "Risk" },
];

const hours = (h: number | null) => (h == null ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hours`);

/** The technical DNA table (kept, under Technical details). */
function dnaRows(f: Fingerprints): { label: string; value: string; derived: string }[] {
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

/** "Why TRACE thinks this": the same measurements, said in plain words. */
function plainReasons(f: Fingerprints): string[] {
  const out: string[] = [];
  if (f.fullRangeShare === 1) out.push("Its liquidity covers every possible price, so it never needs adjusting.");
  else if (f.avgRangeWidthPct != null)
    out.push(
      f.avgRangeWidthPct >= 1
        ? `It sets a wide price range: the top is about ${(1 + f.avgRangeWidthPct).toLocaleString("en-US", { maximumFractionDigits: 1 })}× the bottom.`
        : `It sets a narrow price range, about ${fmt.frac(f.avgRangeWidthPct)} wide.`,
    );
  out.push(f.repositionCount === 0 ? "It never moved its price range during the window." : `It moved its price range ${fmt.count(f.repositionCount, "time")} (about ${f.repositionsPerWeek.toFixed(1)} a week).`);
  if (f.timeInRangePct != null) out.push(`The price stayed inside its range ${fmt.frac(f.timeInRangePct, 0)} of the time${f.timeInRangePct >= 0.8 ? ", so it kept earning fees" : ", so it often earned nothing"}.`);
  if (f.collectCount > 0) out.push(`It collected its fees ${fmt.count(f.collectCount, "time")}${f.collectCadenceDays != null ? `, about every ${hours(f.collectCadenceDays * 24)}` : ""}.`);
  out.push(f.withdrawRedeployCount === 0 && f.decreaseCount === 0 ? "It never took money out to put it back in later." : `It withdrew and redeployed money ${fmt.count(f.withdrawRedeployCount, "time")}.`);
  return out;
}

const RULE_STATUS: Record<string, { label: string; tone: "sage" | "amber" | "neutral"; Icon: typeof CheckCircle2 }> = {
  supported: { label: "Runs on Aqua", tone: "sage", Icon: CheckCircle2 },
  partial: { label: "Partly on Aqua", tone: "amber", Icon: CircleDot },
  unsupported: { label: "Not on Aqua", tone: "neutral", Icon: CircleSlash },
};

function StrategyStory({ s, full, inv }: { s: StrategyRow; full: FullInvestigation; inv: string }) {
  const ir = s.ir;
  const f = full.dna?.data.fingerprints;
  const run = full.inferenceRuns[0];
  const compat: Compatibility | undefined = full.compatibility && [s.id, s.irId].includes(full.compatibility.report.strategyId) ? full.compatibility.report : undefined;
  const status = (rule: string) => compat?.rules.find((r) => r.rule === rule);
  const conf = Math.round(Number(ir.confidence) * 100);
  const evidenceCount = ir.evidenceRefs.length;
  const alts = ir.alternatives.filter((a) => a.family !== ir.family);

  return (
    <>
      {/* 1–2: the strategy, in one plain sentence */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Label>Possible <Term k="strategy">strategy</Term></Label>
          <Pill tone="neutral">A hypothesis, not confirmed intent</Pill>
        </div>
        <h1 className="serif text-2xl md:text-[2rem] text-ink mt-2 leading-tight">{FAMILY[ir.family] ?? ir.family}</h1>
        <p className="text-[0.95rem] text-ink mt-2 max-w-[68ch] leading-relaxed">{FAMILY_PLAIN[ir.family] ?? ""}</p>
        <div className="mt-5 grid sm:grid-cols-[minmax(0,320px)_1fr] gap-5 items-start">
          {/* 5: confidence with its caveat */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[0.8rem] text-ink-600"><Term k="confidence">Confidence</Term></span>
              <span className="text-[1.4rem] font-semibold text-ink tabular">{conf}%</span>
            </div>
            <Meter value={conf} />
            <p className="text-[0.74rem] text-ink-600 mt-1.5 leading-snug">How well this fits the evidence. It is not the chance that the owner meant this.</p>
          </div>
          <div className="text-[0.82rem] text-ink-600 leading-relaxed">
            Based on <Term k="evidence">{fmt.count(evidenceCount, "real transaction")}</Term> from this wallet on Sepolia.{" "}
            {s.role === "ai_hypothesis" && run?.status === "succeeded"
              ? "Proposed by 0G AI, then every rule was checked against those transactions."
              : "Worked out directly from those transactions (AI was not used for this version)."}
          </div>
        </div>
      </Card>

      {/* 3: why, in plain words */}
      {f && (
        <Card className="mt-5">
          <SectionTitle eyebrow="In plain words" title="Why TRACE thinks this" />
          <ul className="space-y-2">
            {plainReasons(f).map((r) => (
              <li key={r} className="flex gap-2.5 text-[0.9rem] text-ink leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gold shrink-0" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 4 + 7: the rules, each with its evidence and whether Aqua can run it */}
      <SectionTitle eyebrow="Each rule links to the transactions behind it" title="Supporting on-chain evidence" />
      {ir.rules.length === 0 ? (
        <Card>
          <div className="text-ink-600 text-[0.88rem]">No rules: the evidence is not enough for a hypothesis. TRACE reports this instead of inventing one.</div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {ir.rules.map((r) => {
            const st = status(r.rule);
            const meta = st ? RULE_STATUS[st.status] : null;
            return (
              <Card key={r.rule}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-ink font-medium text-[0.95rem]">{r.rule}</div>
                  {meta && (
                    <Pill tone={meta.tone}>
                      <span className="inline-flex items-center gap-1"><meta.Icon size={12} aria-hidden /> {meta.label}</span>
                    </Pill>
                  )}
                </div>
                <div className="text-[0.82rem] text-ink-600 mt-1.5">{r.evidence}</div>
                {st?.gap && st.status !== "supported" && <div className="text-[0.76rem] text-ink-600 mt-1.5"><span className="text-ink">Why not on Aqua:</span> {st.gap}</div>}
                <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[0.74rem]">
                  <span className="text-ink-600">Evidence:</span>
                  {r.evidenceRefs.slice(0, 3).map((t) => <ExplorerLink key={t} kind="tx" value={t} />)}
                  {r.evidenceRefs.length > 3 && <span className="text-ink-600">+{r.evidenceRefs.length - 3} more</span>}
                </div>
                <details className="mt-2 text-[0.76rem] text-ink-600">
                  <summary className="cursor-pointer text-ink hover:text-gold w-fit">What could be wrong</summary>
                  <div className="mt-1 space-y-0.5">
                    <div><span className="text-ink">Uncertainty:</span> {r.uncertainty}</div>
                    <div><span className="text-ink">Another reading:</span> {r.alternative}</div>
                    <div><span className="text-ink">Rule confidence:</span> {fmt.frac(r.confidence, 0)}</div>
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
      {!compat && ir.rules.length > 0 && (
        <p className="text-[0.74rem] text-ink-600 mt-2">
          Whether each rule can run on 1inch Aqua is shown after the <Term k="aquaCompatibility">Aqua compatibility</Term> check on the <Link href={withInv("/execute", inv)} className="underline text-[#8A6528]">Execute</Link> screen.
        </p>
      )}

      {/* 6: alternatives */}
      {alts.length > 0 && (
        <>
          <SectionTitle eyebrow="Other explanations TRACE considered" title="Alternatives" />
          <Card>
            <div className="space-y-3.5">
              {alts.map((a) => (
                <div key={a.family}>
                  <div className="flex items-center justify-between text-[0.86rem]">
                    <span className="text-ink font-medium">{a.label}</span>
                    <span className="tabular text-ink-600">{a.score}% fit</span>
                  </div>
                  <Meter value={a.score} />
                  <div className="text-[0.74rem] text-ink-600 mt-1">{a.why}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <SectionTitle eyebrow="Stated honestly" title="Limitations" />
      <Card>
        <ul className="list-disc pl-5 text-[0.84rem] text-ink-600 space-y-1">
          {ir.limitations.map((l) => <li key={l}>{l}</li>)}
          {full.dna?.data.seriesErrors?.map((e) => <li key={e}>Price history error: {e}</li>)}
        </ul>
      </Card>

      {/* Everything technical, one click away */}
      <Disclosure className="mt-5" title="Technical details" hint="AI source, version id and hash, the eight DNA measurements, rule parameters">
        <div className="space-y-4 text-[0.78rem]">
          <AiSource full={full} />
          <div className="text-ink-600 space-y-1 break-all">
            <div><span className="text-ink">Version</span> {ir.id}{ir.parentId ? ` (derived from ${ir.parentId})` : ""}</div>
            <div><span className="text-ink">Version hash</span> {s.versionHash}</div>
            <div><span className="text-ink">Evidence blocks</span> {ir.evidencePeriod.fromBlock.toLocaleString("en-US")}–{ir.evidencePeriod.toBlock.toLocaleString("en-US")} · {ir.sourceProtocol} · chain {ir.chainId}</div>
            <div><span className="text-ink">Source</span> {ir.source.model} · {ir.source.provider}{ir.source.requestRef ? ` · request ${ir.source.requestRef}` : ""} · attested {String(ir.source.attested)}</div>
          </div>
          {f && (
            <div>
              <div className="label mb-2">Strategy DNA: eight measurements from the wallet&apos;s own transactions</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-md2 overflow-hidden border border-ink/10 bg-ink/10">
                {dnaRows(f).map((d) => (
                  <div key={d.label} className="bg-white p-3 min-w-0">
                    <Label>{d.label}</Label>
                    <div className="text-ink font-semibold text-[0.95rem] mt-1 tabular break-anywhere">{d.value}</div>
                    <div className="text-[0.72rem] text-ink-600 mt-1 leading-snug break-anywhere">{d.derived}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ir.rules.length > 0 && (
            <div>
              <div className="label mb-2">Rules by category</div>
              <div className="space-y-1.5">
                {CATS.filter((c) => ir.rules.some((r) => r.category === c.key)).flatMap((c) =>
                  ir.rules.filter((r) => r.category === c.key).map((r) => (
                    <div key={r.rule} className="text-ink-600 break-anywhere">
                      <span className="text-ink">{c.label}:</span> {r.rule} · confidence {fmt.frac(r.confidence, 0)}
                      {r.mapsTo ? ` · maps to ${r.mapsTo}` : ""}
                      {r.params ? ` · ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""} · {r.evidenceRefs.length} tx
                    </div>
                  )),
                )}
              </div>
            </div>
          )}
        </div>
      </Disclosure>
    </>
  );
}

/** The AI source notice, with the exact reason when 0G was unavailable. */
function AiSource({ full }: { full: FullInvestigation }) {
  const run = full.inferenceRuns[0];
  const ok = run?.status === "succeeded";
  return (
    <div className={`flex items-start gap-3 rounded-md2 border px-3.5 py-3 ${ok ? "border-forest/30 bg-forest/5" : "border-amber/30 bg-amber/5"}`}>
      {ok ? <ShieldCheck className="text-forest mt-0.5 shrink-0" size={16} /> : <ShieldAlert className="text-amber mt-0.5 shrink-0" size={16} />}
      <div className="min-w-0 flex-1">
        <div className="text-ink font-medium text-[0.84rem]">
          {ok ? "0G Private Computer proposed this hypothesis; every rule passed the evidence gate" : "0G Private Computer was unavailable, so this is the evidence-only analysis"}
        </div>
        <div className="text-[0.76rem] text-ink-600 mt-0.5 break-anywhere">
          {ok
            ? `Model ${run.model}. TEE verified: ${run.teeVerified == null ? "not reported" : run.teeVerified ? "yes" : "no"}. ${run.rulesRejected} proposed rule${run.rulesRejected === 1 ? "" : "s"} rejected for citing transactions outside the evidence.`
            : run
              ? `No rule comes from a model. Reason: ${run.errorCode ?? run.status}: ${run.error ?? "no detail"}${run.requestId ? ` (router request ${run.requestId})` : ""}.`
              : "No inference run is recorded for this investigation."}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Versions + Compare ---------------- */

type VersionRow = { id: string; irId: string; parentIrId: string | null; versionHash: string; family: string; confidence: string; provider: string; role: string; createdAt: string; investigation: string };
type VersionFull = VersionRow & { ir: StrategyIR; wallet: string; windowDays: number | null };

function VersionsPanel({ wallet, currentInv }: { wallet: string; currentInv: string }) {
  const q = useQuery({ queryKey: ["versions", wallet], queryFn: () => api<{ strategies: VersionRow[] }>(`/strategies/by-wallet/${wallet}`) });
  const [picked, setPicked] = useState<string[]>([]);
  const rows = useMemo(() => q.data?.strategies ?? [], [q.data]);
  useEffect(() => {
    if (picked.length === 0 && rows.length >= 2) setPicked([rows[1].id, rows[0].id]);
  }, [rows, picked.length]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  if (q.isLoading) return <LoadingState label="Loading saved versions…" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (rows.length === 0) return <EmptyState title="No strategy versions for this wallet yet" />;

  return (
    <>
      <p className="text-[0.84rem] text-ink-600 mt-4 max-w-[70ch] leading-relaxed">
        Every analysis of {fmt.addr(wallet)} is saved as a <Term k="version">version</Term> that never changes. Pick two to see what changed between them.
      </p>
      <Card pad={false} className="mt-3 divide-y divide-ink/8">
        {rows.map((s) => {
          const on = picked.includes(s.id);
          return (
            <label key={s.id} className={`px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 text-[0.84rem] cursor-pointer ${on ? "bg-gold/5" : "hover:bg-ink/3"}`}>
              <span className="flex items-center gap-3 md:w-[300px] min-w-0">
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[#B68A42]" aria-label={`Compare version from ${new Date(s.createdAt).toLocaleString("en-US")}`} />
                <span className="text-ink font-medium truncate">{FAMILY[s.family] ?? s.family}</span>
              </span>
              <span className="flex-1 text-ink-600">{fmt.frac(Number(s.confidence), 0)} confidence · {new Date(s.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className="flex items-center gap-2">
                {s.investigation === currentInv && <Pill tone="gold">This investigation</Pill>}
                <Pill tone={s.role === "ai_hypothesis" ? "gold" : "neutral"}>{s.role === "ai_hypothesis" ? "0G AI" : "Evidence only"}</Pill>
                <Link href={withInv("/strategy", s.investigation)} className="text-[0.76rem] text-[#8A6528] hover:text-ink underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                  Open
                </Link>
              </span>
            </label>
          );
        })}
      </Card>
      {picked.length === 2 ? <CompareView ids={picked as [string, string]} /> : <p className="text-[0.8rem] text-ink-600 mt-3">Select two versions to compare them.</p>}
    </>
  );
}

function CompareView({ ids }: { ids: [string, string] }) {
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: ["strategy", id], queryFn: () => api<{ strategy: VersionFull }>(`/strategies/${id}`) })) });
  if (qs.some((q) => q.isLoading)) return <LoadingState label="Loading both versions…" />;
  const err = qs.find((q) => q.isError);
  if (err) return <ErrorState message={(err.error as Error).message} />;
  // Older version on the left.
  const [a, b] = qs.map((q) => q.data!.strategy).sort((x, y) => +new Date(x.createdAt) - +new Date(y.createdAt));
  const same = a.versionHash === b.versionHash;
  const win = (v: VersionFull) => `${v.windowDays ?? "?"} days (blocks ${v.ir.evidencePeriod.fromBlock.toLocaleString("en-US")}–${v.ir.evidencePeriod.toBlock.toLocaleString("en-US")})`;
  const rows: { label: string; a: string; b: string }[] = [
    { label: "Strategy", a: FAMILY[a.ir.family] ?? a.ir.family, b: FAMILY[b.ir.family] ?? b.ir.family },
    { label: "Confidence", a: fmt.frac(a.ir.confidence, 0), b: fmt.frac(b.ir.confidence, 0) },
    { label: "Made by", a: a.role === "ai_hypothesis" ? "0G AI, evidence-checked" : "Evidence only", b: b.role === "ai_hypothesis" ? "0G AI, evidence-checked" : "Evidence only" },
    { label: "Rules", a: String(a.ir.rules.length), b: String(b.ir.rules.length) },
    { label: "Evidence", a: fmt.count(a.ir.evidenceRefs.length, "transaction"), b: fmt.count(b.ir.evidenceRefs.length, "transaction") },
    { label: "Window", a: win(a), b: win(b) },
  ];
  const ruleSet = (v: VersionFull) => new Set(v.ir.rules.map((r) => r.rule));
  const ra = ruleSet(a);
  const rb = ruleSet(b);
  const onlyA = [...ra].filter((r) => !rb.has(r));
  const onlyB = [...rb].filter((r) => !ra.has(r));
  const both = [...ra].filter((r) => rb.has(r));
  const date = (v: VersionFull) => new Date(v.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card className="mt-5" aria-label="Version comparison">
      <div className="flex items-center gap-2">
        <GitCompare size={16} className="text-gold" />
        <h2 className="text-[1rem] font-semibold text-ink">Compare versions</h2>
      </div>
      {same && <p className="text-[0.82rem] text-forest mt-2">These two versions have the same version hash: the strategy is identical.</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[0.84rem] min-w-[560px]">
          <thead>
            <tr className="text-left text-ink-600 border-b border-ink/10">
              <th className="py-2 pr-3 font-medium label w-[140px]">&nbsp;</th>
              <th className="py-2 pr-3 font-medium">Older · {date(a)}</th>
              <th className="py-2 font-medium">Newer · {date(b)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = r.a !== r.b;
              return (
                <tr key={r.label} className="border-b border-ink/6 align-top">
                  <td className="py-2 pr-3 text-ink-600">{r.label}</td>
                  <td className="py-2 pr-3 text-ink">{r.a}</td>
                  <td className={`py-2 ${changed ? "text-ink font-semibold" : "text-ink"}`}>
                    {r.b}
                    {changed && <span className="ml-2 align-middle"><Pill tone="amber">changed</Pill></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid md:grid-cols-3 gap-3 text-[0.8rem]">
        <RuleList title="Only in the older version" tone="brick" items={onlyA} />
        <RuleList title="In both" tone="neutral" items={both} />
        <RuleList title="Only in the newer version" tone="sage" items={onlyB} />
      </div>
      <Disclosure className="mt-4" title="Technical details" hint="version ids and hashes">
        <div className="text-[0.74rem] text-ink-600 space-y-1 break-all">
          <div>Older: {a.irId} · {a.versionHash}{a.parentIrId ? ` · parent ${a.parentIrId}` : ""}</div>
          <div>Newer: {b.irId} · {b.versionHash}{b.parentIrId ? ` · parent ${b.parentIrId}` : ""}</div>
        </div>
      </Disclosure>
    </Card>
  );
}

function RuleList({ title, items, tone }: { title: string; items: string[]; tone: "brick" | "neutral" | "sage" }) {
  const dot = tone === "brick" ? "bg-[#B4553D]" : tone === "sage" ? "bg-forest" : "bg-ink/30";
  return (
    <div className="rounded-md2 border border-line bg-ivory-50 p-3">
      <div className="label mb-1.5">{title}</div>
      {items.length === 0 ? (
        <div className="text-ink-600">None</div>
      ) : (
        <ul className="space-y-1">
          {items.map((r) => (
            <li key={r} className="flex gap-2 text-ink">
              <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Page ---------------- */

type Tab = "strategy" | "versions";

export default function StrategyPage() {
  const [tab, setTab] = useState<Tab>("strategy");
  const [which, setWhich] = useState<"primary" | "baseline">("primary");
  // ?tab=versions (also where /saved redirects); kept in the URL so a refresh stays put.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "versions") setTab("versions");
  }, []);
  const changeTab = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "versions") u.searchParams.set("tab", "versions");
    else u.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", u.toString());
  };

  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => {
          const ai = full.strategies.find((s) => s.role === "ai_hypothesis");
          const base = full.strategies.find((s) => s.role === "evidence_baseline");
          const shown = which === "baseline" ? base : (ai ?? base);
          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                  value={tab}
                  onChange={changeTab}
                  tabs={[
                    { id: "strategy", label: "Strategy" },
                    { id: "versions", label: "Versions" },
                  ]}
                />
                {tab === "strategy" && ai && base && (
                  <Tabs
                    value={which}
                    onChange={setWhich}
                    tabs={[
                      { id: "primary", label: "0G hypothesis" },
                      { id: "baseline", label: "Evidence-only" },
                    ]}
                  />
                )}
              </div>
              {tab === "strategy" ? (
                shown ? <StrategyStory s={shown} full={full} inv={inv} /> : <ErrorState message="No strategy version stored for this investigation." />
              ) : (
                <VersionsPanel wallet={full.investigation.wallet} currentInv={inv} />
              )}
              <MarkStep step="viewedStrategy" />
              <NextStep href={withInv("/backtest", inv)} title="Check how this strategy performed" label="Open Backtest">
                See the wallet&apos;s real result next to simple alternatives, then try your own &ldquo;what if&rdquo; settings.
              </NextStep>
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
