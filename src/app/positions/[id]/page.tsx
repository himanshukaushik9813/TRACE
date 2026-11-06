"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/page";
import { RangeBand } from "@/components/charts";
import { Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Pill, SectionTitle, SourceBadge, Stat } from "@/components/ui";
import { rangeLabel, tickPrice } from "@/components/positions";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useFullInvestigation, withInv, type ChainEvent, type PriceSeriesUi } from "@/lib/api";

const KIND_TONE: Record<string, "sage" | "gold" | "amber" | "brick" | "neutral"> = { MINT: "sage", INCREASE: "sage", DECREASE: "amber", COLLECT: "gold", BURN: "brick", TRANSFER: "neutral" };

export default function PositionPage() {
  const params = useParams<{ id: string }>();
  const tokenId = params.id;
  const [inv] = useCurrentInvestigationId();
  const full = useFullInvestigation(inv);
  const detail = useQuery({
    queryKey: ["position", inv, tokenId],
    queryFn: () => api<{ position: Record<string, string | number | boolean | null>; events: ChainEvent[]; priceSeries: PriceSeriesUi | null }>(`/investigations/${inv}/positions/${tokenId}`),
    enabled: Boolean(inv && /^\d+$/.test(tokenId)),
  });

  const summary = full.data?.investigation.summary;
  const p = summary?.positions.find((x) => String(x.tokenId) === tokenId);
  const acct = summary?.accounting.find((a) => String(a.tokenId) === tokenId);

  return (
    <Page>
      <Link href={withInv("/positions", inv)} className="inline-flex items-center gap-1 text-[0.8rem] text-ink-600 hover:text-ink mb-3">
        <ArrowLeft size={14} /> All positions
      </Link>
      {!inv && <EmptyState title="No investigation selected">Open a position from an investigation.</EmptyState>}
      {(full.isLoading || detail.isLoading) && <LoadingState />}
      {detail.isError && <ErrorState message={(detail.error as Error).message} />}
      {p && detail.data && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="label">Uniswap V3 position NFT</div>
              <h1 className="serif text-2xl md:text-3xl text-ink mt-1">
                {p.token0} / {p.token1} · #{p.tokenId}
              </h1>
              <div className="text-[0.78rem] text-ink-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <ExplorerLink kind="nft" value={p.tokenId}>NFT on Etherscan</ExplorerLink>
                {p.pool !== "unresolved" && <ExplorerLink kind="address" value={p.pool}>Pool {fmt.addr(p.pool)}</ExplorerLink>}
                <span>Fee tier {fmt.feeTier(p.feeTier)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={p.status === "active" ? "sage" : "neutral"}>{p.status}</Pill>
              <SourceBadge block={full.data?.investigation.toBlock} />
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4 mt-5">
            <Card><Stat label="Range" value={<span className="text-[0.95rem]">{rangeLabel(p)}</span>} sub={`ticks ${p.tickLower} → ${p.tickUpper}`} /></Card>
            <Card><Stat label="Liquidity (end of window)" value={fmt.big(p.liquidity)} sub="uint128 units, replayed from events" /></Card>
            <Card><Stat label="Opened" value={p.openedBlock ? `#${p.openedBlock.toLocaleString("en-US")}` : "—"} sub={p.historyComplete ? "minted inside the window" : "before the window (partial history)"} /></Card>
            <Card><Stat label="Closed" value={p.closedBlock ? `#${p.closedBlock.toLocaleString("en-US")}` : p.status === "closed" ? "liquidity removed" : "—"} /></Card>
          </div>

          {acct && (
            <Card className="mt-5">
              <SectionTitle eyebrow="Accounting — principal and fees kept separate" title="Token flows" />
              <div className="grid sm:grid-cols-4 gap-4 text-[0.85rem]">
                {[
                  ["Deposited (principal in)", acct.deposited],
                  ["Withdrawn (principal out)", acct.withdrawn],
                  ["Fees collected", acct.feesCollected],
                  ["Net principal", acct.netPosition],
                ].map(([label, v]) => (
                  <div key={label as string}>
                    <Label>{label as string}</Label>
                    <div className="tabular text-ink mt-1">
                      {fmt.amt((v as { token0: number }).token0)} {p.token0}
                      <br />
                      {fmt.amt((v as { token1: number }).token1)} {p.token1}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[0.72rem] text-ink-600 mt-3">Uncollected fees are not estimated. A V3 Collect returns principal owed from earlier decreases plus fees; TRACE splits the two from the on-chain amounts.</p>
            </Card>
          )}

          <Card className="mt-5">
            <SectionTitle eyebrow="Real pool Swap prices during the window" title="Range occupancy" />
            {detail.data.priceSeries && detail.data.priceSeries.points.length >= 2 ? (
              (() => {
                const s = detail.data.priceSeries!;
                const lo = tickPrice(p.tickLower, p.decimals0, p.decimals1);
                const hi = tickPrice(p.tickUpper, p.decimals0, p.decimals1);
                const prices = s.points.map((x) => x.price);
                const blocks = s.points.map((x) => x.block);
                const evs = detail.data.events.map((e) => ({ i: Math.max(0, blocks.findIndex((b) => b >= Number(e.block))) }));
                return lo != null && hi != null && p.tickUpper - p.tickLower < 1_700_000 && p.tickUpper < 887_000 && p.tickLower > -887_000 ? (
                  <>
                    <RangeBand price={prices} lo={lo} hi={hi} events={evs} />
                    <div className="text-[0.7rem] text-ink-600 mt-2">
                      {s.points.length} swap prices ({s.symbol1} per {s.symbol0}), blocks {s.fromBlock.toLocaleString("en-US")}–{s.toBlock.toLocaleString("en-US")}
                      {s.truncated ? " (sampled)" : ""}. Timestamps between sampled blocks are interpolated.
                    </div>
                  </>
                ) : (
                  <div className="text-ink-600 text-[0.85rem]">This range is unbounded on at least one side, so the price is always inside it. {s.points.length} real swaps observed in the window.</div>
                );
              })()
            ) : (
              <div className="text-ink-600 text-[0.85rem]">No swap price history available for this pool in the window — occupancy is not shown rather than estimated.</div>
            )}
          </Card>

          <SectionTitle eyebrow="Blockchain evidence" title="Lifecycle events" />
          <Card pad={false} className="overflow-x-auto">
            <table className="w-full text-[0.8rem] min-w-[720px]">
              <thead className="text-left text-ink-600">
                <tr className="border-b border-ink/10">
                  {["Event", "Block", "Time (UTC)", "Liquidity Δ", p.token0, p.token1, "Fees", "Gas", "Tx"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium label">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.data.events.map((e) => (
                  <tr key={`${e.tx}-${e.logIndex}`} className="border-b border-ink/6">
                    <td className="px-4 py-2.5"><Pill tone={KIND_TONE[e.kind]}>{e.kind}</Pill></td>
                    <td className="px-4 py-2.5 tabular"><ExplorerLink kind="block" value={Number(e.block)}>{Number(e.block).toLocaleString("en-US")}</ExplorerLink></td>
                    <td className="px-4 py-2.5 tabular">{fmt.tsSec(e.timestamp)}</td>
                    <td className="px-4 py-2.5 tabular">{e.liquidityDelta === "0" ? "—" : fmt.big(e.liquidityDelta)}</td>
                    <td className="px-4 py-2.5 tabular">{fmt.units(e.amount0, p.decimals0)}</td>
                    <td className="px-4 py-2.5 tabular">{fmt.units(e.amount1, p.decimals1)}</td>
                    <td className="px-4 py-2.5 tabular">{e.kind === "COLLECT" ? `${fmt.units(e.fee0, p.decimals0)} / ${fmt.units(e.fee1, p.decimals1)}` : "—"}</td>
                    <td className="px-4 py-2.5 tabular">{e.gasUsed && e.effectiveGasPrice ? `${fmt.amt((Number(e.gasUsed) * Number(e.effectiveGasPrice)) / 1e18, 6)} ETH` : "—"}</td>
                    <td className="px-4 py-2.5"><ExplorerLink kind="tx" value={e.tx} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {full.data && !p && !full.isLoading && <EmptyState title={`Position #${tokenId} is not part of this investigation`} />}
    </Page>
  );
}
