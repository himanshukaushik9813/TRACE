"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Cpu,
  GitBranch,
  ChevronRight,
  Lightbulb,
  HelpCircle,
  Save,
  GitCompare,
  Fingerprint,
  FileCheck2,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, Pill, DemoBadge, Stat, Button, Tabs, Meter } from "@/components/ui";
import {
  STRATEGY,
  DNA,
  RULES,
  ALTERNATIVES,
  INFER_META,
  DEMO,
  STORAGE,
} from "@/lib/fixture";
import { art } from "@/lib/assets";

type Tab = "results" | "dna" | "rules" | "ai";
const TABS: Tab[] = ["results", "dna", "rules", "ai"];

/**
 * Seed the active tab from the `?tab=` query param (the Saved Strategies page
 * deep-links to /strategy?tab=dna). Read defensively: this is a client
 * component that also renders on the server, where `location` is absent.
 */
function tabFromQuery(): Tab {
  if (typeof window === "undefined") return "results";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t && TABS.includes(t as Tab) ? (t as Tab) : "results";
}

export default function StrategyPage() {
  const [tab, setTab] = useState<Tab>(tabFromQuery);
  const [rule, setRule] = useState(0);
  const r = RULES[rule];

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600">
          Strategy Intelligence · <span className="text-ink font-medium">{DEMO.wallet.display}</span>
        </div>
        <DemoBadge />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "results" as Tab, label: "Result" },
          { id: "dna" as Tab, label: "Strategy DNA" },
          { id: "rules" as Tab, label: "Inferred Rules" },
          { id: "ai" as Tab, label: "0G Inference" },
        ]}
      />

      {tab === "results" && <Results onOpenRules={() => setTab("rules")} onOpenDna={() => setTab("dna")} />}
      {tab === "dna" && <Dna />}
      {tab === "rules" && <Rules rule={rule} setRule={setRule} r={r} />}
      {tab === "ai" && <AiPanel />}
    </Page>
  );
}

/* ---------------------------------------------------------------- */
function Results({ onOpenRules, onOpenDna }: { onOpenRules: () => void; onOpenDna: () => void }) {
  return (
    <div className="mt-4 space-y-5">
      {/* Main strategy result */}
      <Card dark pad={false} className="overflow-hidden">
        <div className="grid md:grid-cols-[1fr_220px]">
          <div className="p-6">
            <div className="flex items-center gap-2">
              <Pill tone="gold"><ShieldCheck size={12} /> Inferred classification</Pill>
            </div>
            <h2 className="serif text-3xl md:text-4xl text-cream mt-3 leading-tight">
              {STRATEGY.family}
            </h2>
            <p className="text-cream-muted text-[0.9rem] mt-2 max-w-xl leading-relaxed">
              Confidence is a <span className="text-gold-300">model estimate</span> of how well this
              family fits the observed behaviour — not a probability that the owner intended it.
            </p>
            <div className="mt-5">
              <div className="flex items-center justify-between text-[0.78rem] text-cream-muted">
                <span>Fit confidence</span>
                <span className="tabular text-cream text-[1rem] font-semibold">{STRATEGY.confidence}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-cream/12 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-gold to-gold-300" style={{ width: STRATEGY.confidence + "%" }} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-cream/10">
              <Stat onDark label="Supporting positions" value={STRATEGY.supportingPositions} />
              <Stat onDark label="Relevant events" value={STRATEGY.relevantEvents} />
              <Stat onDark label="Period" value={STRATEGY.period} />
              <Stat onDark label="Evidence complete" value={STRATEGY.evidenceCompleteness + "%"} />
            </div>
          </div>
          <div className="hidden md:block relative bg-charcoal-800/50 border-l border-cream/10 p-6">
            <img src={art.lg.fingerprint} alt="strategy fingerprint" className="w-full rounded-md2 opacity-90" />
            <div className="label mt-3">Inference</div>
            <div className="text-[0.74rem] text-cream-muted mt-1">{STRATEGY.model}</div>
          </div>
        </div>
      </Card>

      {/* Competing interpretations + actions */}
      <div className="grid md:grid-cols-[1fr_320px] gap-5">
        <Card pad={false} className="p-5">
          <Label>Alternative hypotheses</Label>
          <div className="mt-3 space-y-2.5">
            {ALTERNATIVES.map((a) => (
              <div key={a.label} className="flex items-center gap-3">
                <span className={`w-44 text-[0.84rem] ${a.score === 78 ? "text-ink font-medium" : "text-ink-600"}`}>{a.label}</span>
                <div className="flex-1"><Meter value={a.score} /></div>
                <span className="w-9 text-right text-[0.8rem] tabular text-ink">{a.score}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.8rem] text-ink-600">
            {ALTERNATIVES.find((a) => a.score === 78)?.why}. If evidence were thinner, TRACE would
            report <em>“Insufficient evidence to determine a reliable strategy”</em> rather than force a classification.
          </div>
        </Card>

        <Card dark pad={false} className="p-5">
          <Label onDark>Next</Label>
          <div className="mt-3 space-y-2">
            <button onClick={onOpenRules} className="w-full flex items-center justify-between rounded-md2 border border-cream/12 bg-charcoal-800/60 px-4 py-3 hover:border-gold/40 transition-colors">
              <span className="text-cream text-[0.86rem] font-medium">Inspect inferred rules</span>
              <ChevronRight size={16} className="text-gold-300" />
            </button>
            <button onClick={onOpenDna} className="w-full flex items-center justify-between rounded-md2 border border-cream/12 bg-charcoal-800/60 px-4 py-3 hover:border-gold/40 transition-colors">
              <span className="text-cream text-[0.86rem] font-medium">View Strategy DNA</span>
              <ChevronRight size={16} className="text-gold-300" />
            </button>
            <a href="/backtest" className="w-full flex items-center justify-between rounded-md2 border border-gold/40 bg-gold/12 px-4 py-3">
              <span className="text-gold-200 text-[0.86rem] font-medium">Validate in Strategy Lab</span>
              <ChevronRight size={16} className="text-gold-300" />
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Dna() {
  return (
    <div className="mt-4 grid lg:grid-cols-[300px_1fr] gap-5">
      <Card dark pad={false} className="p-5 relative overflow-hidden">
        <img src={art.fingerprint} alt="fingerprint" className="w-full rounded-md2 mb-4" />
        <Label onDark>Strategy DNA</Label>
        <div className="text-[0.8rem] text-cream-muted mt-2 leading-relaxed">
          A behavioural fingerprint of {DEMO.wallet.display}. Each dimension is calculated from
          defined on-chain metrics — never invented. Click a bar to see its derivation.
        </div>
        <img src={art.fingerprint} alt="" aria-hidden className="absolute -right-6 -top-4 w-28 opacity-15 mix-blend-screen rotate-12" />
      </Card>

      <div className="space-y-5">
        <Card pad={false} className="p-5">
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
            {DNA.map((d) => (
              <div key={d.key}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.86rem] text-ink font-medium">{d.label}</span>
                  <span className="text-[0.9rem] tabular font-semibold text-ink">{d.value}</span>
                </div>
                <div className="mt-1.5"><Meter value={d.value} /></div>
                <div className="text-[0.7rem] text-ink-600 mt-1">{d.derived}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 text-[0.82rem] text-ink-600">
            <GitCompare size={15} className="text-gold" />
            Compare with another investigated wallet
          </div>
          <div className="mt-3 rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.8rem] text-ink-600">
            Load two investigated wallets to overlay their range-adjustment, capital deployment, fee
            collection, and persistence profiles side by side. (Requires a second investigation in demo
            mode — labelled, not fabricated.)
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Rules({ rule, setRule, r }: { rule: number; setRule: (n: number) => void; r: (typeof RULES)[number] }) {
  return (
    <div className="mt-4 grid lg:grid-cols-[320px_1fr] gap-5">
      <Card pad={false} className="p-2 space-y-1.5">
        {RULES.map((r, i) => (
          <button
            key={i}
            onClick={() => setRule(i)}
            className={`w-full text-left rounded-md2 px-3.5 py-3 transition-colors ${i === rule ? "bg-ink text-ivory-50" : "hover:bg-ivory text-ink"}`}
          >
            <div className="text-[0.86rem] font-medium leading-snug">{r.rule}</div>
            <div className={`mt-1 text-[0.7rem] tabular ${i === rule ? "text-gold-300" : "text-ink-600"}`}>
              confidence {Math.round(r.confidence * 100)}%
            </div>
          </button>
        ))}
      </Card>

      {/* Evidence → insight interaction */}
      <div className="space-y-4">
        <Card pad={false} className="p-5">
          <div className="flex items-center gap-2">
            <Pill tone="gold"><Lightbulb size={12} /> Inferred rule</Pill>
          </div>
          <h3 className="serif text-xl text-ink mt-3">{r.rule}</h3>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Insight label="Supporting evidence" value={r.evidence} tone="forest" />
            <Insight label="Alternative explanation" value={r.alternative} tone="amber" />
            <Insight label="Uncertainty" value={r.uncertainty} tone="neutral" />
            <Insight label="Confidence" value={Math.round(r.confidence * 100) + "% model estimate"} tone="gold" />
          </div>
        </Card>

        <Card dark pad={false} className="p-5">
          <Label onDark>Insight → metric → event → transaction</Label>
          <div className="mt-3 space-y-2">
            <TraceRow icon={Cpu} label="AI interpretation" text={r.rule} />
            <TraceRow icon={Fingerprint} label="Behavioural metric" text={DNA.find((d) => d.label.includes("Range"))?.derived ?? "median re-entry lag 26h"} />
            <TraceRow icon={GitBranch} label="Supporting event" text="4 range re-sets across 120d; 18–40h after band exit" />
            <TraceRow icon={FileCheck2} label="Transaction evidence" text="0x9f3a…b21c, 0x12b8…9e01, 0xa4f0…c3d7, 0xd0c2…1a8e (on-chain)" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Insight({ label, value, tone }: { label: string; value: string; tone: "gold" | "forest" | "amber" | "neutral" }) {
  const c: Record<string, string> = { gold: "text-gold", forest: "text-forest", amber: "text-amber", neutral: "text-ink" };
  return (
    <div className="rounded-md2 bg-ivory border border-ink/8 p-3.5">
      <div className={`text-[0.64rem] uppercase tracking-wide2 font-semibold ${c[tone]}`}>{label}</div>
      <div className="text-[0.84rem] text-ink mt-1.5 leading-relaxed">{value}</div>
    </div>
  );
}

function TraceRow({ icon: Icon, label, text }: { icon: any; label: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md2 border border-cream/10 bg-charcoal-800/50 px-3.5 py-2.5">
      <Icon size={15} className="text-gold-300 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[0.64rem] uppercase tracking-wide2 text-cream-muted">{label}</div>
        <div className="text-[0.82rem] text-cream mt-0.5 tabular break-words">{text}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function AiPanel() {
  const [archived, setArchived] = useState(false);
  return (
    <div className="mt-4 grid lg:grid-cols-[1fr_320px] gap-5">
      <Card dark pad={false} className="p-5 relative overflow-hidden">
        <img src={art.aiNetwork} alt="" aria-hidden className="absolute -right-8 -top-6 w-48 opacity-20 mix-blend-screen" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <Pill tone="gold"><Cpu size={12} /> 0G Private Computer</Pill>
            <Pill tone="neutral">{INFER_META.schemaValid ? "schema-valid" : "schema-failed"}</Pill>
          </div>
          <h3 className="serif text-xl text-cream mt-3">Inference run</h3>
          <p className="text-[0.84rem] text-cream-muted mt-2 leading-relaxed max-w-lg">
            Structured evidence (reconstructed events + deterministic fingerprints) is fed to 0G,
            which returns a structured strategy IR proposal. Every claim is validated against the
            deterministic evidence; the LLM is <em>not</em> the source of blockchain truth.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <MetaCard label="Request reference" value={INFER_META.requestRef} />
            <MetaCard label="Model" value={INFER_META.model} />
            <MetaCard label="Attestation" value={INFER_META.attestation} tone="amber" />
            <MetaCard label="Timestamp" value={INFER_META.ts} />
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-gold" />
            <span className="text-[0.88rem] font-medium text-ink">Structured output</span>
          </div>
          <pre className="mt-3 rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.72rem] leading-relaxed text-ink-600 overflow-x-auto dark-scroll">
{`{
  "classification": "active_range_management",
  "confidence": 0.78,
  "rules": ${RULES.length},
  "evidence_refs": [
    "0x9f3a…b21c",
    "0x12b8…9e01",
    "0xa4f0…c3d7"
  ],
  "alternatives": ${ALTERNATIVES.length},
  "limitations": [
    "trigger thresholds inferred, not observed"
  ]
}`}
          </pre>
        </Card>

        <Card pad={false} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[0.8rem] text-ink-600">
              {archived ? "Archived — confirmation recorded" : "Archive to 0G Storage"}
            </div>
            <Button variant="ghost" disabled={archived} onClick={() => setArchived(true)}>
              <Save size={15} /> {archived ? "Archived" : "Archive"}
            </Button>
          </div>
          {archived && (
            <div className="mt-3 text-[0.72rem] text-ink-600 tabular break-words">
              Reference <span className="font-medium text-ink">{STORAGE[STORAGE.length - 1].ref}</span> ·{" "}
              {STORAGE[STORAGE.length - 1].kind} · {STORAGE[STORAGE.length - 1].ts}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MetaCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "amber" }) {
  return (
    <div className="rounded-md2 border border-cream/10 bg-charcoal-800/50 p-3">
      <Label onDark>{label}</Label>
      <div className={`text-[0.78rem] mt-1.5 tabular break-words ${tone === "amber" ? "text-gold-300" : "text-cream"}`}>{value}</div>
    </div>
  );
}
