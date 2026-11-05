"use client";

import { useState } from "react";
import {
  Activity,
  ScanSearch,
  BrainCircuit,
  Terminal,
  FileText,
  Filter,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Pill, DemoBadge, Tabs } from "@/components/ui";
import { DEMO } from "@/lib/fixture";

type Kind = "position" | "inference" | "execution" | "report";
const KIND_DEFAULT: Record<Kind, any> = {
  position: ScanSearch,
  inference: BrainCircuit,
  execution: Terminal,
  report: FileText,
};

const FEED: { kind: Kind; text: string; sub: string; when: string; tone?: "gold" | "sage" | "amber" }[] = [
  { kind: "position", text: "Range re-set on ETH/USDC #12841", sub: "0x9f3a…b21c · block 21,834,102 · 3,080→3,920", when: "2024-06-11 09:24" },
  { kind: "position", text: "Collected $412 fees on #12841", sub: "0x7c1d…40aa · block 21,890,551", when: "2024-07-03 14:11" },
  { kind: "inference", text: "Strategy v0.3 inferred", sub: "0G-PC · TraceInfer · top: periodic range adj (61%)", when: "2024-12-02 06:40", tone: "gold" },
  { kind: "position", text: "Decreased liquidity on #12841", sub: "0x12b8…9e01 · −1,180 liq · withdrew 301,500 USDC", when: "2024-08-01 20:47" },
  { kind: "execution", text: "Compatibility report generated", sub: "partial · 1 full, 1 partial, 2 unsupported", when: "2025-09-14 11:02", tone: "amber" },
  { kind: "inference", text: "Strategy v0.4 inferred", sub: "0G-PC · TraceInfer · top: active range mgmt (78%)", when: "2025-11-02 07:14", tone: "gold" },
  { kind: "position", text: "Re-entered ETH/USDC after pullback", sub: "0xa4f0…c3d7 · +980 liq · 26h after exit", when: "2024-08-27 02:19" },
  { kind: "report", text: "Investigation report archived", sub: "0G-STOR-arc_11a3 · dossier + backtest", when: "2025-11-02 07:20" },
  { kind: "execution", text: "Execution plan signed (awaiting auth)", sub: "plan_8812 · ship-dock-swap · World pending", when: "2025-11-05 01:02", tone: "amber" },
];

export default function ActivityPage() {
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const rows = FEED.filter((f) => filter === "all" || f.kind === filter);
  const kindLabel: Record<Kind, string> = { position: "Position", inference: "Inference", execution: "Execution", report: "Report" };

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
          <Activity size={15} className="text-gold" />
          Activity · <span className="text-ink font-medium">{DEMO.wallet.display}</span>
        </div>
        <DemoBadge />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter as any}
          onChange={(v) => setFilter(v)}
          tabs={[
            { id: "all", label: "All" },
            { id: "position", label: "Position" },
            { id: "inference", label: "Inference" },
            { id: "execution", label: "Execution" },
            { id: "report", label: "Report" },
          ]}
        />
        <div className="text-[0.72rem] text-ink-600 flex items-center gap-2">
          <Filter size={13} /> {rows.length} events · sorted by time
        </div>
      </div>

      <div className="mt-5">
        <Card pad={false} className="divide-y divide-ink/8">
          {rows.map((f, i) => {
            const Icon = KIND_DEFAULT[f.kind];
            return (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <div className={`h-9 w-9 grid place-items-center rounded-md border shrink-0 ${f.tone === "gold" ? "bg-gold/12 border-gold/30 text-gold" : f.tone === "amber" ? "bg-amber/12 border-amber/30 text-amber" : f.tone === "sage" ? "bg-forest/12 border-forest/30 text-forest" : "bg-ink/5 border-ink/10 text-ink-600"}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.9rem] text-ink font-medium">{f.text}</div>
                  <div className="text-[0.72rem] text-ink-600 tabular mt-0.5 truncate">{f.sub}</div>
                </div>
                <Pill tone="neutral">{kindLabel[f.kind]}</Pill>
                <span className="text-[0.7rem] text-ink-600/70 tabular w-32 text-right shrink-0">{f.when}</span>
              </div>
            );
          })}
        </Card>
        <p className="text-[0.72rem] text-ink-600/70 mt-3 flex items-center gap-2">
          <ScanSearch size={13} />
          Timeline reconstructed from public event logs; inference and execution entries are model/backend
          actions, clearly separated from on-chain position events.
        </p>
      </div>
    </Page>
  );
}
