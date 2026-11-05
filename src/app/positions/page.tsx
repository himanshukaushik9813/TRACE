"use client";

import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { PositionCard } from "@/components/positions";
import { EmptyState, SectionTitle, SourceBadge } from "@/components/ui";
import { fmt } from "@/lib/format";

export default function PositionsPage() {
  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => {
          const s = full.investigation.summary!;
          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-[0.78rem] text-ink-600">
                  Positions · <span className="text-ink font-medium tabular">{fmt.addr(full.investigation.wallet)}</span>
                </div>
                <SourceBadge block={full.investigation.toBlock} />
              </div>
              <SectionTitle eyebrow="Uniswap V3 NonfungiblePositionManager (Sepolia)" title={`${s.counts.positions} reconstructed position${s.counts.positions === 1 ? "" : "s"}`} />
              {s.positions.length === 0 ? (
                <EmptyState title="No positions in this window" />
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {s.positions.map((p) => (
                    <PositionCard key={p.tokenId} p={p} acct={s.accounting.find((a) => a.tokenId === p.tokenId)} inv={inv} />
                  ))}
                </div>
              )}
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
