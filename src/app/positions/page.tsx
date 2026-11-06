"use client";

import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { PositionCard } from "@/components/positions";
import { EmptyState, SectionTitle } from "@/components/ui";

export default function PositionsPage() {
  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => {
          const s = full.investigation.summary!;
          return (
            <>
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
