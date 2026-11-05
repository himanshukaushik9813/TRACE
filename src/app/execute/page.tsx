"use client";

import { useState } from "react";
import {
  Terminal,
  Lock,
  Boxes,
  CheckCircle2,
  ShieldCheck,
  FileSignature,
  Loader2,
  ArrowRight,
  Boxes as BoxesIcon,
  Ship,
  Play,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, SectionTitle, Pill, DemoBadge, Stat, Button, Tabs } from "@/components/ui";
import { COMPAT, COMPAT_VERDICT, EXEC_STEPS, EXEC_CONFIG, WORLD_AUTH, STORAGE } from "@/lib/fixture";
import { authorize, useLastInvestigation } from "@/lib/live";
import { art } from "@/lib/assets";

type Auth = "none" | "approved" | "rejected";

export default function ExecutePage() {
  const [tab, setTab] = useState<"compat" | "compile" | "execute">("compat");
  const [auth, setAuth] = useState<Auth>("none");
  const [executing, setExecuting] = useState(false);
  const [shipped, setShipped] = useState(false);
  const [authNote, setAuthNote] = useState<string | null>(null);
  const lastInv = useLastInvestigation();

  const approve = async () => {
    setExecuting(true);
    setAuthNote(null);
    // Authorize against the last finished investigation (live API if
    // configured, labelled demo flow otherwise). The proof is bound to
    // strategy version + program hash + action + expiry + challenge and
    // validated server-side.
    const target = lastInv?.summary ? lastInv.id : "ir_demo_v04";
    const r = await authorize(target, "compile+ship+2 swaps");
    if ("error" in r) {
      setAuth("rejected");
      setAuthNote(r.error);
      setExecuting(false);
      return;
    }
    if (r.validated) {
      setAuth("approved");
      setAuthNote(r.note);
      // A real ship would now submit the compiled program to Aqua and verify
      // the receipt — the demo labels that receipt accordingly.
      setTimeout(() => { setExecuting(false); setShipped(true); }, 1400);
    } else {
      setAuth("rejected");
      setAuthNote(r.validation.notes.join(" · ") || "proof rejected server-side");
      setExecuting(false);
    }
  };

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
          <Terminal size={15} className="text-gold" />
          Aqua Execution Console · 1inch Aqua / SwapVM
        </div>
        <DemoBadge />
      </div>

      <div className="mt-3 rounded-md2 border border-ink/10 bg-ivory-50 p-4 flex gap-3 text-[0.8rem] text-ink-600">
        <Ship size={16} className="text-gold shrink-0" />
        <p>Historical Uniswap V3 NFTs and Aqua strategies are <strong className="text-ink">different financial instruments</strong>. TRACE compiles
        a versioned, protocol-independent Strategy IR through an explicit compatibility adapter and a
        deterministic compiler. It never pretends an Aqua strategy recreates the historical NFT.</p>
      </div>

      <Tabs
        className="mt-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "compat", label: "Compatibility" },
          { id: "compile", label: "Compile" },
          { id: "execute", label: "Execute" },
        ]}
      />

      {tab === "compat" && <Compat />}
      {tab === "compile" && <Compile onRun={() => setTab("execute")} />}
      {tab === "execute" && (
        <Execute
          auth={auth}
          approve={approve}
          executing={executing}
          shipped={shipped}
          authNote={authNote}
        />
      )}
    </Page>
  );
}

/* ---------------------------------------------------------------- */
function Compat() {
  const counts = {
    full: COMPAT.filter((c) => c.status === "full").length,
    partial: COMPAT.filter((c) => c.status === "partial").length,
    unsupported: COMPAT.filter((c) => c.status === "unsupported").length,
  };
  return (
    <div className="mt-4 grid lg:grid-cols-[1fr_320px] gap-5">
      <Card pad={false} className="p-5">
        <div className="flex items-center justify-between">
          <SectionTitle eyebrow="Compatibility report" title="Rule coverage" />
          <Pill tone={COMPAT_VERDICT === "FULL" ? "forest" : COMPAT_VERDICT === "PARTIAL" ? "amber" : "brick"}>
            {COMPAT_VERDICT === "PARTIAL" ? "PARTIALLY COMPATIBLE" : COMPAT_VERDICT + " COMPATIBLE"}
          </Pill>
        </div>
        <div className="space-y-2">
          {COMPAT.map((c) => (
            <div key={c.rule} className="flex items-center gap-3 rounded-md2 border border-ink/8 bg-ivory px-3.5 py-3">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  c.status === "full" ? "bg-forest" : c.status === "partial" ? "bg-amber" : "bg-brick"
                }`}
              />
              <span className="text-[0.88rem] text-ink flex-1">{c.rule}</span>
              <Pill tone={c.status === "full" ? "forest" : c.status === "partial" ? "amber" : "brick"}>
                {c.status}
              </Pill>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.78rem] text-ink-600 leading-relaxed">
          Unsupported rules are <strong className="text-ink">never silently discarded</strong> — they are listed, and the
          differences from historical behaviour are flagged. Required user parameters: capital split,
          price trigger threshold, out-of-range cap.
        </div>
      </Card>

      <Card dark pad={false} className="p-5">
        <Label onDark>Coverage</Label>
        <div className="mt-4 space-y-4">
          <CovRow label="Fully compatible" value={counts.full} tone="text-forest" />
          <CovRow label="Partially compatible" value={counts.partial} tone="text-amber" />
          <CovRow label="Unsupported" value={counts.unsupported} tone="text-brick" />
        </div>
        <div className="mt-5 pt-4 border-t border-cream/10 text-[0.74rem] text-cream-muted leading-relaxed">
          The two directional / price-trigger rules have no equivalent Aqua primitive today, so the
          program ships with the supported subset and the rest deferred to a future adapter version.
        </div>
      </Card>
    </div>
  );
}

function CovRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  const total = 4;
  return (
    <div>
      <div className="flex items-center justify-between text-[0.78rem]">
        <span className="text-cream-muted">{label}</span>
        <span className={`tabular font-semibold ${tone}`}>{value}/{total}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-cream/12 overflow-hidden">
        <div className={`h-full rounded-full ${tone === "text-forest" ? "bg-forest" : tone === "text-amber" ? "bg-amber" : "bg-brick"}`} style={{ width: (value / total) * 100 + "%" }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Compile({ onRun }: { onRun: () => void }) {
  const pipeline = [
    { icon: BoxesIcon, label: "Inferred Strategy IR", d: "v0.4 · 4 rules" },
    { icon: ShieldCheck, label: "Validation", d: "schema + evidence checks pass" },
    { icon: Boxes, label: "Compatibility adapter", d: "strip unsupported, map primitives" },
    { icon: Terminal, label: "Deterministic compiler", d: "no LLM-generated bytecode" },
    { icon: Ship, label: "Aqua program", d: "ship-dock-swap · signed plan" },
  ];
  return (
    <div className="mt-4 space-y-5">
      <Card dark pad={false} className="p-6">
        <Label onDark>Deterministic compilation</Label>
        <h3 className="serif text-2xl text-cream mt-2">IR → Aqua program</h3>
        <p className="text-[0.84rem] text-cream-muted mt-1.5 max-w-2xl leading-relaxed">
          The AI proposes the IR; the compiler is deterministic. The LLM never emits executable
          bytecode — it can only feed a validated, schema-checked structure.
        </p>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-2">
          {pipeline.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={i} className="rounded-md2 border border-cream/12 bg-charcoal-800/50 p-3 relative">
                <div className="flex items-center gap-2">
                  <Icon size={16} className="text-gold-300" />
                  <span className="text-[0.6rem] text-cream-muted tabular">0{i + 1}</span>
                </div>
                <div className="text-[0.82rem] text-cream font-medium mt-2 leading-snug">{p.label}</div>
                <div className="text-[0.68rem] text-cream-muted mt-1">{p.d}</div>
                {i < pipeline.length - 1 && <ArrowRight size={12} className="absolute top-4 -right-2 text-gold-300/60" />}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card pad={false} className="p-5">
          <Label>Execution configuration</Label>
          <div className="mt-3 space-y-2.5">
            {(
              [
                ["Token pair", EXEC_CONFIG.tokenPair],
                ["Capital allocation", EXEC_CONFIG.capitalAllocation],
                ["Price conditions", EXEC_CONFIG.priceConditions],
                ["Risk limits", EXEC_CONFIG.riskLimits],
                ["Minimum output", EXEC_CONFIG.minOutput],
                ["Slippage", EXEC_CONFIG.slippage],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-ink/8 pb-2.5">
                <span className="text-[0.78rem] text-ink-600">{k}</span>
                <span className="text-[0.82rem] text-ink font-medium tabular text-right">{v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card pad={false} className="p-5 flex flex-col">
          <Label>Est. execution quote</Label>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <Stat label="Gas est." value="184k" sub="~$9.2 @ 32gwei" />
            <Stat label="Swap legs" value="2" sub="ship + dock" />
            <Stat label="Min. output" value={EXEC_CONFIG.minOutput} />
            <Stat label="Window" value="14d" sub="out-of-range cap" />
          </div>
          <div className="mt-auto pt-5 flex gap-2">
            <Button variant="ghost" onClick={onRun} className="flex-1">
              <Play size={15} /> Run full pipeline
            </Button>
          </div>
          <div className="text-[0.68rem] text-ink-600/70 mt-2">
            No unlimited token approvals. Explicit slippage + min-output enforced at compile.
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Execute({ auth, approve, executing, shipped, authNote }: { auth: Auth; approve: () => void; executing: boolean; shipped: boolean; authNote?: string | null }) {
  const canShip = auth === "approved" && !shipped;
  return (
    <div className="mt-4 grid lg:grid-cols-[1fr_360px] gap-5">
      {/* Lifecycle */}
      <Card pad={false} className="p-5">
        <div className="flex items-center justify-between">
          <SectionTitle eyebrow="Aqua execution lifecycle" title="Ship · dock · swap" />
          {shipped && <Pill tone="forest"><CheckCircle2 size={12} /> Shipped & verified</Pill>}
        </div>
        <div className="space-y-1.5">
          {EXEC_STEPS.map((s, i) => {
            // After World approval, step 5 (auth) becomes done.
            const done = s.done || (i === 4 && (auth === "approved" || shipped));
            const isAuthStep = i === 4;
            return (
              <div key={i} className={`flex items-center gap-3 rounded-md2 px-3.5 py-3 border transition-colors ${done ? "border-forest/25 bg-forest/8" : isAuthStep && auth === "rejected" ? "border-brick/25 bg-brick/8" : "border-ink/8 bg-ivory"}`}>
                <div className={`h-7 w-7 grid place-items-center rounded-full border shrink-0 ${done ? "bg-forest text-ivory border-forest" : "bg-ink/5 border-ink/12 text-ink-600"}`}>
                  {done ? <CheckCircle2 size={15} /> : <span className="text-[0.72rem] tabular text-ink-600">{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.88rem] text-ink font-medium">{s.label}</div>
                  {s.detail && <div className="text-[0.7rem] text-ink-600 mt-0.5">{s.detail}</div>}
                </div>
                {isAuthStep && auth === "approved" && <span className="text-[0.66rem] text-forest">approved</span>}
                {isAuthStep && auth === "rejected" && <span className="text-[0.66rem] text-brick">rejected</span>}
              </div>
            );
          })}
        </div>

        {shipped && (
          <div className="mt-4 rounded-md2 border border-forest/25 bg-forest/8 p-4 flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-md shrink-0 border border-forest/30">
              <img src={art.confirmation} alt="execution confirmation" className="h-full w-full object-cover" />
            </div>
            <div>
              <div className="text-forest font-medium text-[0.9rem] flex items-center gap-1.5">
                <Ship size={15} /> Program shipped to Aqua
              </div>
              <div className="text-[0.72rem] text-ink-600 tabular mt-0.5">
                tx 0x4c8a…e91f · receipt verified · 210,412 gas · 0x… (demo receipt, labelled)
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="gold" disabled={shipped} onClick={approve} className="flex-1 min-w-[180px]">
            {executing ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            {shipped ? "Authorized & shipped" : executing ? "Authorizing…" : "Authorize with World Agent Pass"}
          </Button>
        </div>
        {authNote && auth === "rejected" && (
          <div className="mt-3 rounded-md2 border border-brick/30 bg-brick/8 p-3 text-[0.74rem] text-brick">
            Authorization rejected: {authNote}
          </div>
        )}
        {authNote && auth === "approved" && (
          <div className="mt-3 rounded-md2 border border-forest/30 bg-forest/8 p-3 text-[0.74rem] text-forest">
            {authNote}
          </div>
        )}
      </Card>

      {/* World Agent Pass */}
      <div className="space-y-4">
        <Card dark pad={false} className="p-5 relative overflow-hidden">
          <img src={art.ethEmblem} alt="" aria-hidden className="absolute -right-5 -top-4 w-24 opacity-20 mix-blend-screen" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <Pill tone="gold"><FileSignature size={12} /> World Agent Pass</Pill>
              <Pill tone={auth === "approved" ? "forest" : auth === "rejected" ? "brick" : "neutral"}>
                {auth === "approved" ? "AUTHORIZED" : auth === "rejected" ? "REJECTED" : WORLD_AUTH.status}
              </Pill>
            </div>
            <h3 className="serif text-lg text-cream mt-3">Human authorization</h3>
            <div className="mt-3 space-y-2">
              {WORLD_AUTH.bound.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 border-b border-cream/10 pb-2">
                  <span className="text-[0.7rem] text-cream-muted">{k}</span>
                  <span className="text-[0.76rem] text-cream tabular text-right break-words">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card pad={false} className="p-4">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="text-gold shrink-0 mt-0.5" />
            <p className="text-[0.76rem] text-ink-600 leading-relaxed">{WORLD_AUTH.note}</p>
          </div>
          <div className="mt-3 rounded-md2 bg-ivory border border-ink/8 p-3 text-[0.72rem] text-ink-600 leading-relaxed">
            The backend independently validates the proof: rejects expired, cancelled, replayed, wrong
            strategy-version, or wrong-plan authorizations. World approval is an extra human layer — it
            does not by itself enforce every on-chain action.
          </div>
        </Card>
      </div>

      {/* 0G storage refs */}
      <Card pad={false} className="p-5 lg:col-span-2">
        <Label>0G Storage references</Label>
        <div className="mt-3 grid sm:grid-cols-2 gap-2">
          {STORAGE.map((s) => (
            <div key={s.ref} className="flex items-center gap-3 rounded-md2 border border-ink/8 bg-ivory px-3 py-2.5">
              <CheckCircle2 size={15} className="text-forest" />
              <div className="flex-1 min-w-0">
                <div className="text-[0.8rem] text-ink font-medium truncate">{s.kind}</div>
                <div className="text-[0.68rem] text-ink-600 tabular">{s.ref} · {s.ts}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
