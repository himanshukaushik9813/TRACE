"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/page";
import { RangeBand } from "@/components/charts";
import { Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Pill, SectionTitle, SourceBadge, Stat } from "@/components/ui";
import { boundLabel, inRange, rangeLabel, tickPrice, TokenPair } from "@/components/positions";
import { Disclosure } from "@/components/disclosure";
import { NextStep } from "@/components/next-step";
import { Term } from "@/components/term";
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
  const pts = detail.data?.priceSeries?.points;
  const current = pts && pts.length ? pts[pts.length - 1].price : null;
  const occupancy = p && p.status === "active" ? inRange(p, current) : null;

  return (
    <Page>
      <Link href={withInv("/positions", inv)} className="inline-flex items-center gap-1 text-[0.8rem] text-ink-600 hover:text-ink mb-3">
        <ArrowLeft size={14} /> All positions
      </Link>
      {!inv && <EmptyState title="No investigation selected">Open a position from an investigation.</EmptyState>}
      {(full.isLoading || detail.isLoading) && <LoadingState />}
      {full.isError && <ErrorState message={(full.error as Error).message} />}
      {detail.isError && <ErrorState message={(detail.error as Error).message} />}
      {p && detail.data && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <TokenPair a={p.token0} b={p.token1} size={38} />
              <div className="min-w-0">
                <div className="label">Liquidity position</div>
                <h1 className="serif text-2xl md:text-3xl text-ink mt-0.5">
                  {p.token0} / {p.token1}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {occupancy != null && <Pill tone={occupancy ? "sage" : "amber"}>{occupancy ? "In range now" : "Out of range now"}</Pill>}
              <Pill tone={p.status === "active" ? "sage" : "neutral"}>{p.status === "active" ? "Active" : "Closed"}</Pill>
              <SourceBadge block={full.data?.investigation.toBlock} />
            </div>
          </div>
          <p className="text-[0.86rem] text-ink-600 mt-2 max-w-[70ch] leading-relaxed">
            {p.status === "active" ? "This position is still open. " : "This position has been closed: its liquidity was removed. "}
            It earns trading fees only while the pool price is inside its <Term k="priceRange">price range</Term>.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
            <Card><Stat label="Current price" value={current != null ? fmt.price(current) : "—"} sub={`${p.token1} per ${p.token0}, last real swap`} /></Card>
            <Card><Stat label="Lower price" value={boundLabel(p, "lower")} sub="earns fees above this" /></Card>
            <Card><Stat label="Upper price" value={boundLabel(p, "upper")} sub="earns fees below this" /></Card>
            <Card><Stat label="Opened" value={p.historyComplete && p.openedBlock ? `Block ${p.openedBlock.toLocaleString("en-US")}` : "Before the window"} sub={p.closedBlock ? `Closed at block ${p.closedBlock.toLocaleString("en-US")}` : p.status === "active" ? "still open" : "liquidity removed"} /></Card>
          </div>

          {acct && (
            <Card className="mt-5">
              <SectionTitle eyebrow="Money in and out" title="What went into this position" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[0.85rem]">
                {(
                  [
                    ["Deposited", "deposited", acct.deposited],
                    ["Withdrawn", null, acct.withdrawn],
                    ["Fees collected", "feesCollected", acct.feesCollected],
                    ["Still in the position", null, acct.netPosition],
                  ] as const
                ).map(([label, k, v]) => (
                  <div key={label}>
                    <Label>{k ? <Term k={k}>{label}</Term> : label}</Label>
                    <div className="tabular text-ink mt-1">
                      {fmt.amt(v.token0)} {p.token0}
                      <br />
                      {fmt.amt(v.token1)} {p.token1}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[0.72rem] text-ink-600 mt-3">Fees that were earned but not yet withdrawn are not estimated. TRACE separates withdrawn principal from fees using the exact on-chain amounts.</p>
            </Card>
          )}

          <Card className="mt-5">
            <SectionTitle eyebrow="Real swap prices during the window" title="Was the price inside the range?" />
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
                    <div className="text-[0.72rem] text-ink-600 mt-2">
                      The shaded band is this position&apos;s range; the line is the real price ({s.symbol1} per {s.symbol0}) from {s.points.length} swaps{s.truncated ? " (sampled)" : ""}. Dots mark the wallet&apos;s own actions.
                    </div>
                  </>
                ) : (
                  <div className="text-ink-600 text-[0.85rem]">This range has no limit on at least one side, so the price was always inside it. {s.points.length} real swaps observed in the window.</div>
                );
              })()
            ) : (
              <div className="text-ink-600 text-[0.85rem]">No swap price history is available for this pool in the window, so occupancy is not shown rather than estimated.</div>
            )}
          </Card>

          <Disclosure className="mt-5" title="Technical details" hint="NFT, pool, ticks, raw liquidity and every on-chain event">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[0.8rem] mb-4">
              <div>
                <Label>Position NFT</Label>
                <div className="mt-1"><ExplorerLink kind="nft" value={p.tokenId}>#{p.tokenId}</ExplorerLink></div>
              </div>
              <div>
                <Label>Pool</Label>
                <div className="mt-1">{p.pool !== "unresolved" ? <ExplorerLink kind="address" value={p.pool}>{fmt.addr(p.pool)}</ExplorerLink> : "unresolved"} · fee {fmt.feeTier(p.feeTier)}</div>
              </div>
              <div>
                <Label>Ticks</Label>
                <div className="mt-1 tabular">{p.tickLower} → {p.tickUpper}</div>
                <div className="text-[0.7rem] text-ink-600">{rangeLabel(p)}</div>
              </div>
              <div>
                <Label>Liquidity (end of window)</Label>
                <div className="mt-1 tabular">{fmt.big(p.liquidity)}</div>
                <div className="text-[0.7rem] text-ink-600">uint128 units, replayed from events</div>
              </div>
            </div>
            <div className="label mb-2">Lifecycle events</div>
            <div className="overflow-x-auto rounded-md2 border border-line bg-white">
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
            </div>
          </Disclosure>

          <NextStep href={withInv("/strategy", inv)} title="See the strategy behind this position" label="Open Strategy">
            TRACE compares how this range was set and moved with known liquidity strategies.
          </NextStep>
        </>
      )}
      {full.data && !p && !full.isLoading && <EmptyState title={`Position #${tokenId} is not part of this investigation`} />}
    </Page>
  );
}
