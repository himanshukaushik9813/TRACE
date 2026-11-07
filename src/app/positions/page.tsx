"use client";

import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { PositionCard } from "@/components/positions";
import { LiquidityView } from "@/components/liquidity-view";
import { NextStep } from "@/components/next-step";
import { MarkStep } from "@/components/welcome";
import { Term } from "@/components/term";
import { EmptyState, SectionTitle } from "@/components/ui";
import { withInv } from "@/lib/api";

export default function PositionsPage() {
  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => {
          const s = full.investigation.summary!;
          const series = Object.values(full.dna?.data.priceSeries ?? {});
          const lastPrice = (pool: string) => {
            const pts = series.find((x) => x.pool?.toLowerCase() === pool.toLowerCase())?.points;
            return pts && pts.length ? pts[pts.length - 1].price : null;
          };
          const active = s.positions.filter((p) => p.status === "active").length;
          return (
            <>
              <header className="mb-5">
                <div className="label">Positions</div>
                <h1 className="serif text-2xl md:text-3xl text-ink mt-1">
                  {s.counts.positions === 0 ? "No liquidity positions found" : `${s.counts.positions} liquidity position${s.counts.positions === 1 ? "" : "s"}`}
                </h1>
                <p className="text-[0.86rem] text-ink-600 mt-1.5 max-w-[68ch] leading-relaxed">
                  Every <Term k="lpPosition">position</Term> this wallet opened on Uniswap V3 (Sepolia), rebuilt from on-chain events.
                  {s.counts.positions > 0 && ` ${active} still active, ${s.counts.positions - active} closed.`}
                  {s.counts.positions > 0 && (
                    <>
                      {" "}
                      <a href={withInv("/case-study", inv)} className="underline decoration-gold/50 text-ink hover:text-gold-700">See the full case study</a> for the timeline and evidence.
                    </>
                  )}
                </p>
              </header>
              {s.positions.length === 0 ? (
                <EmptyState title="No positions in this window">Try a longer look-back window on Investigate.</EmptyState>
              ) : (
                <>
                  {inv && <LiquidityView full={full} invId={inv} />}
                  <SectionTitle eyebrow="Each position in plain numbers" title="Position list" />
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {s.positions.map((p) => (
                      <PositionCard key={p.tokenId} p={p} acct={s.accounting.find((a) => a.tokenId === p.tokenId)} inv={inv} price={p.pool === "unresolved" ? null : lastPrice(p.pool)} />
                    ))}
                  </div>
                  <p className="text-[0.72rem] text-ink-600 mt-3">
                    Current price is the last real swap price TRACE read in the window. <Term k="feesCollected">Fees collected</Term> counts only fees the wallet actually withdrew; uncollected fees are not estimated.
                  </p>
                </>
              )}
              <MarkStep step="viewedPositions" />
              <NextStep href={withInv("/strategy", inv)} title="See what strategy these positions suggest" label="Open Strategy">
                TRACE reads the pattern in how these ranges were set and moved, and names the closest strategy with its evidence.
              </NextStep>
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
