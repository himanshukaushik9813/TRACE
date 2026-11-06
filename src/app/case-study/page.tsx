"use client";

/**
 * Case study: one wallet's Uniswap V3 history, told from its on-chain events.
 * Everything here comes from GET /investigations/:id/case-study (stored events,
 * positions() metadata, DNA, strategy). Nothing is estimated or illustrative
 * unless labelled; missing history is shown as a limitation.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { Card, EmptyState, ErrorState, ExplorerLink, LoadingState, Pill, SectionTitle, Stat } from "@/components/ui";
import { RangeBand } from "@/components/charts";
import { tickPrice } from "@/components/positions";
import { NextStep } from "@/components/next-step";
import { Term } from "@/components/term";
import { FAMILY } from "@/components/case-file";
import { fmt } from "@/lib/format";
import { api, withInv, type CaseEvent, type CaseObservation, type CasePosition, type CaseStudy, type FullInvestigation, type V3Kind } from "@/lib/api";

const KIND: Record<V3Kind, { label: string; color: string; plain: string }> = {
  MINT: { label: "Mint", color: "#278653", plain: "Opened the position" },
  INCREASE: { label: "Increase", color: "#78866B", plain: "Added liquidity" },
  DECREASE: { label: "Decrease", color: "#C08A3E", plain: "Removed liquidity" },
  COLLECT: { label: "Collect", color: "#B68A42", plain: "Collected tokens and fees" },
  TRANSFER: { label: "Transfer", color: "#77736A", plain: "Moved the NFT to another owner" },
  BURN: { label: "Burn", color: "#A4533C", plain: "Closed (burned) the NFT" },
};
const KINDS = Object.keys(KIND) as V3Kind[];
const EDGE = 880_000;

const pair = (p: Pick<CasePosition, "symbol0" | "symbol1">) => (p.symbol0 && p.symbol1 ? `${p.symbol0}/${p.symbol1}` : "unknown pair");
const when = (ts: number) => (ts ? fmt.tsSec(ts) : "time unknown");

function bound(p: CasePosition, side: "lower" | "upper"): string {
  const t = side === "lower" ? p.tickLower : p.tickUpper;
  if (side === "lower" && t <= -EDGE) return "0 (edge)";
  if (side === "upper" && t >= EDGE) return "∞ (edge)";
  const v = tickPrice(t, p.decimals0, p.decimals1);
  return v == null ? `tick ${t}` : fmt.price(v);
}

/* ---------------- summary in plain words ---------------- */
function PlainSummary({ cs, full }: { cs: CaseStudy; full: FullInvestigation }) {
  const primary = full.strategies.find((s) => s.id === full.primaryStrategyId);
  const o = cs.overview;
  const fees = cs.positions.reduce((a, p) => a + p.feeCollections.length, 0);
  const partial = cs.positions.filter((p) => !p.historyComplete).length;
  const parts = [
    `Between ${cs.window ? when(cs.window.fromTs).split(",").slice(0, 2).join(",") : "the start of the window"} and ${cs.window ? when(cs.window.toTs).split(",").slice(0, 2).join(",") : "now"}, this wallet ran ${fmt.count(o.positions, "Uniswap V3 position")} across ${fmt.count(o.pools, "pool")}.`,
    `${o.closed ? `${o.closed} ${o.closed === 1 ? "was" : "were"} closed and ` : ""}${o.active} ${o.active === 1 ? "is" : "are"} still active.`,
    fees ? `It collected fees ${fmt.count(fees, "time")}.` : "It never collected fees in this window.",
    cs.rangeChanges.length ? `It moved to a new price range ${fmt.count(cs.rangeChanges.length, "time")}.` : "It never moved a position to a new price range.",
    primary ? `The pattern most resembles ${FAMILY[primary.family] ?? primary.family} (${Math.round(Number(primary.confidence) * 100)}% fit to the evidence), a hypothesis, not the owner's stated intent.` : "",
    partial ? `${fmt.count(partial, "position")} started before the window, so part of its history is missing.` : "",
  ];
  return <p className="text-[0.95rem] text-ink leading-relaxed max-w-[75ch]">{parts.filter(Boolean).join(" ")}</p>;
}

/* ---------------- interactive timeline ---------------- */
function Timeline({ cs, selected, onSelect }: { cs: CaseStudy; selected: CaseEvent | null; onSelect: (e: CaseEvent) => void }) {
  const [shown, setShown] = useState<Set<V3Kind>>(new Set(KINDS));
  const all = cs.positions.flatMap((p) => p.events);
  const timed = all.filter((e) => e.timestamp > 0);
  const t0 = cs.window?.fromTs || Math.min(...timed.map((e) => e.timestamp));
  const t1 = cs.window?.toTs || Math.max(...timed.map((e) => e.timestamp));
  const span = Math.max(1, t1 - t0);
  const x = (ts: number) => `${Math.max(0, Math.min(100, ((ts - t0) / span) * 100))}%`;
  const lanes = [...cs.positions].sort((a, b) => (a.opened?.block ?? 0) - (b.opened?.block ?? 0) || a.tokenId - b.tokenId);

  return (
    <Card>
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Show event types">
        {KINDS.filter((k) => cs.overview.byKind[k] > 0).map((k) => {
          const on = shown.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setShown((s) => { const n = new Set(s); if (on) n.delete(k); else n.add(k); return n; })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.74rem] ${on ? "border-line bg-ivory-50 text-ink" : "border-line/60 text-ink-600 opacity-60"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: KIND[k].color }} aria-hidden />
              {KIND[k].label} · {cs.overview.byKind[k]}
            </button>
          );
        })}
      </div>
      <div className="space-y-2.5">
        {lanes.map((p) => {
          const start = p.opened?.timestamp || t0;
          const end = p.closed?.timestamp || (p.status === "closed" ? p.events.at(-1)?.timestamp || t1 : t1);
          return (
            <div key={p.tokenId} className="grid grid-cols-[88px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] items-center gap-2">
              <div className="text-[0.72rem] text-ink-600 leading-tight min-w-0">
                <div className="text-ink tabular">#{p.tokenId}</div>
                <div className="truncate">{pair(p)}</div>
              </div>
              <div className="relative h-7">
                <div className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full ${p.status === "active" ? "bg-forest/30" : "bg-ink-600/20"}`}
                  style={{ left: x(start), width: `calc(${x(end)} - ${x(start)})`, borderLeft: p.historyComplete ? undefined : "2px dashed #77736A" }}
                  aria-hidden
                />
                {p.events.filter((e) => shown.has(e.kind) && e.timestamp > 0).map((e) => {
                  const sel = selected?.tx === e.tx && selected.logIndex === e.logIndex;
                  return (
                    <button
                      key={`${e.tx}-${e.logIndex}`}
                      type="button"
                      onClick={() => onSelect(e)}
                      aria-label={`${KIND[e.kind].plain}, NFT #${e.tokenId}, block ${e.block.toLocaleString("en-US")}, ${when(e.timestamp)}`}
                      aria-pressed={sel}
                      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ivory-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${sel ? "h-4 w-4 ring-2 ring-ink" : "h-3 w-3"}`}
                      style={{ left: x(e.timestamp), background: KIND[e.kind].color }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[88px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] gap-2 mt-2 text-[0.68rem] text-ink-600 tabular">
        <span />
        <div className="flex justify-between"><span>{when(t0)}</span><span>{when(t1)}</span></div>
      </div>
      <p className="text-[0.72rem] text-ink-600 mt-3">
        Each dot is a real event, placed by its block time. Bars show when each position was open; a dashed start means it opened before the window. Select a dot to see its evidence.
      </p>
      <EventDetail e={selected} cs={cs} />
    </Card>
  );
}

function EventDetail({ e, cs }: { e: CaseEvent | null; cs: CaseStudy }) {
  if (!e) return <div className="mt-4 rounded-md2 border border-dashed border-line px-4 py-3 text-[0.8rem] text-ink-600">No event selected.</div>;
  const p = cs.positions.find((x) => x.tokenId === e.tokenId);
  const amt = (v: string, i: 0 | 1) => fmt.units(v, i === 0 ? p?.decimals0 : p?.decimals1);
  return (
    <div className="mt-4 rounded-md2 border border-line bg-ivory px-4 py-3 text-[0.8rem]" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND[e.kind].color }} aria-hidden />
        <span className="text-ink font-medium">{KIND[e.kind].plain}</span>
        <span className="text-ink-600">· NFT #{e.tokenId} · {p ? pair(p) : ""}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ink-600">
        <dt>Source event</dt><dd className="text-ink">{e.kind} (log index {e.logIndex})</dd>
        <dt>Block</dt><dd><ExplorerLink kind="block" value={e.block}>{e.block.toLocaleString("en-US")}</ExplorerLink></dd>
        <dt>Time</dt><dd className="text-ink">{when(e.timestamp)}</dd>
        <dt>Transaction</dt><dd className="break-anywhere"><ExplorerLink kind="tx" value={e.tx} /></dd>
        {(e.kind === "MINT" || e.kind === "INCREASE" || e.kind === "DECREASE") && (
          <><dt>Principal</dt><dd className="text-ink">{amt(e.amount0, 0)} {p?.symbol0} · {amt(e.amount1, 1)} {p?.symbol1}</dd></>
        )}
        {e.kind === "COLLECT" && (
          <><dt>Fees in it</dt><dd className="text-ink">{amt(e.fee0, 0)} {p?.symbol0} · {amt(e.fee1, 1)} {p?.symbol1}</dd></>
        )}
        {e.kind === "TRANSFER" && (
          <><dt>Owner</dt><dd className="text-ink break-anywhere">{e.from ? fmt.addr(e.from) : "?"} → {e.to ? fmt.addr(e.to) : "?"}</dd></>
        )}
        <dt>Liquidity after</dt><dd className="text-ink tabular">{fmt.big(e.liquidityAfter)}</dd>
      </dl>
    </div>
  );
}

/* ---------------- ranges ---------------- */
function Ranges({ cs, full, selected }: { cs: CaseStudy; full: FullInvestigation; selected: number | null }) {
  const series = full.dna?.data.priceSeries ?? {};
  const byPool = new Map<string, CasePosition[]>();
  for (const p of cs.positions) byPool.set(p.pool ?? `nft-${p.tokenId}`, [...(byPool.get(p.pool ?? `nft-${p.tokenId}`) ?? []), p]);
  const focus = cs.positions.find((p) => p.tokenId === selected) ?? cs.positions.find((p) => p.pool && series[p.pool]) ?? null;
  const pts = focus?.pool ? series[focus.pool]?.points ?? [] : [];
  const lo = focus ? tickPrice(focus.tickLower, focus.decimals0, focus.decimals1) : null;
  const hi = focus ? tickPrice(focus.tickUpper, focus.decimals0, focus.decimals1) : null;
  const finite = focus && lo != null && hi != null && focus.tickLower > -EDGE && focus.tickUpper < EDGE && pts.length > 1;

  return (
    <Card>
      <div className="space-y-4">
        {[...byPool.entries()].map(([pool, list]) => {
          const ticks = list.flatMap((p) => [Math.max(p.tickLower, -EDGE), Math.min(p.tickUpper, EDGE)]);
          const last = pool.startsWith("0x") ? series[pool]?.points?.at(-1) : undefined;
          if (last) ticks.push(last.tick);
          const a = Math.min(...ticks), b = Math.max(...ticks);
          const pad = Math.max(1, (b - a) * 0.08);
          const x = (t: number) => `${((Math.max(a - pad, Math.min(b + pad, t)) - (a - pad)) / (b - a + 2 * pad)) * 100}%`;
          return (
            <div key={pool}>
              <div className="text-[0.74rem] text-ink-600 mb-1.5">
                {pair(list[0])} · fee {fmt.feeTier(list[0].feeTier)} · {pool.startsWith("0x") ? <ExplorerLink kind="address" value={pool} /> : "pool unresolved"}
              </div>
              <div className="relative rounded-md2 border border-line bg-ivory px-2 py-2 space-y-1.5">
                {last && <div className="absolute top-0 bottom-0 w-px bg-ink" style={{ left: x(last.tick) }} title="Last real swap price in the window" aria-hidden />}
                {list.map((p) => (
                  <div key={p.tokenId} className="relative h-5">
                    <div
                      className={`absolute top-0.5 h-4 rounded ${p.status === "active" ? "bg-forest/35" : "bg-ink-600/20"} ${p.tokenId === focus?.tokenId ? "ring-2 ring-gold" : ""}`}
                      style={{ left: x(p.tickLower), width: `calc(${x(p.tickUpper)} - ${x(p.tickLower)})`, minWidth: 3 }}
                      title={`#${p.tokenId}: ${bound(p, "lower")} – ${bound(p, "upper")}`}
                    />
                    <span className="absolute left-1 top-0.5 text-[0.66rem] text-ink tabular leading-4">#{p.tokenId}{p.tickLower <= -EDGE || p.tickUpper >= EDGE ? " · to the edge" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[0.72rem] text-ink-600 mt-3">
        Real ranges from each position&apos;s on-chain ticks, on a log-price axis per pool. The dark line is the last real swap price TRACE read. Ranges that reach the edge of Uniswap&apos;s tick range are cut at the axis.
      </p>
      {focus && (
        <div className="mt-5">
          <div className="label mb-1">Price against the range · NFT #{focus.tokenId}</div>
          {finite ? (
            <RangeBand price={pts.map((p) => p.price)} lo={lo!} hi={hi!} events={[]} />
          ) : (
            <p className="text-[0.8rem] text-ink-600">{pts.length > 1 ? "This range reaches the edge of the tick range, so a price-versus-range chart would be meaningless." : "No swap price data for this pool in the window, so the price is not charted (never estimated)."}</p>
          )}
        </div>
      )}
    </Card>
  );
}

/* ---------------- evidence explorer ---------------- */
function Observation({ o, cs }: { o: CaseObservation; cs: CaseStudy }) {
  const [all, setAll] = useState(false);
  const rows = all ? o.evidence : o.evidence.slice(0, 5);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-ink font-medium text-[0.95rem]">{o.title}</div>
        <Pill tone={o.source === "strategy_rule" ? "gold" : "neutral"}>{o.source === "strategy_rule" ? "Strategy rule" : "Measured"}</Pill>
      </div>
      <p className="text-[0.82rem] text-ink-600 mt-1.5 leading-relaxed">{o.explanation}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[0.74rem] min-w-[520px]">
          <thead className="text-ink-600 text-left">
            <tr><th className="py-1 pr-3 font-normal">Source event</th><th className="py-1 pr-3 font-normal">NFT</th><th className="py-1 pr-3 font-normal">Block</th><th className="py-1 pr-3 font-normal">Time (UTC)</th><th className="py-1 font-normal">Transaction</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={`${e.tx}-${e.logIndex}`} className="border-t border-line">
                <td className="py-1.5 pr-3"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: KIND[e.kind].color }} aria-hidden />{e.kind} <span className="text-ink-600">#{e.logIndex}</span></span></td>
                <td className="py-1.5 pr-3 tabular">#{e.tokenId}</td>
                <td className="py-1.5 pr-3"><ExplorerLink kind="block" value={e.block}>{e.block.toLocaleString("en-US")}</ExplorerLink></td>
                <td className="py-1.5 pr-3 tabular">{when(e.timestamp)}</td>
                <td className="py-1.5"><ExplorerLink kind="tx" value={e.tx} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.evidence.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[0.76rem] text-ink underline decoration-gold/50 hover:text-gold">
          {all ? "Show fewer" : `Show all ${o.evidence.length} events`}
        </button>
      )}
      {o.missingRefs.length > 0 && (
        <p className="mt-2 text-[0.74rem] text-[#8A6528]">{fmt.count(o.missingRefs.length, "cited transaction")} not found among this investigation&apos;s events: {o.missingRefs.map((t) => fmt.addr(t)).join(", ")}</p>
      )}
      {cs.coverage.events > 0 && o.evidence.length === 0 && <p className="mt-2 text-[0.74rem] text-ink-600">No supporting events.</p>}
    </Card>
  );
}

/* ---------------- positions table ---------------- */
function PositionsTable({ cs, inv, onPick }: { cs: CaseStudy; inv: string; onPick: (id: number) => void }) {
  return (
    <Card pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.78rem] min-w-[760px]">
          <thead className="text-ink-600 text-left bg-ivory">
            <tr>
              {["NFT", "Pair", "Range (price)", "Status", "Opened", "Closed", "Deposited", "Fees collected", "Owners"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {cs.positions.map((p) => (
              <tr key={p.tokenId} className="border-t border-line align-top">
                <td className="px-3 py-2"><button type="button" onClick={() => onPick(p.tokenId)} className="underline decoration-gold/50 tabular">#{p.tokenId}</button></td>
                <td className="px-3 py-2">{pair(p)}<div className="text-ink-600">{fmt.feeTier(p.feeTier)}</div></td>
                <td className="px-3 py-2 tabular">{bound(p, "lower")} – {bound(p, "upper")}</td>
                <td className="px-3 py-2">
                  <Pill tone={p.status === "active" ? "forest" : "neutral"}>{p.status}</Pill>
                  {!p.historyComplete && <div className="text-[0.7rem] text-[#8A6528] mt-1">history before window missing</div>}
                </td>
                <td className="px-3 py-2">{p.opened ? <ExplorerLink kind="tx" value={p.opened.tx}>{fmt.tsSec(p.opened.timestamp, false)}</ExplorerLink> : <span className="text-ink-600">before window</span>}</td>
                <td className="px-3 py-2">{p.closed ? <ExplorerLink kind="tx" value={p.closed.tx}>{fmt.tsSec(p.closed.timestamp, false)}</ExplorerLink> : <span className="text-ink-600">{p.status === "closed" ? "emptied (not burned)" : "—"}</span>}</td>
                <td className="px-3 py-2 tabular">{fmt.units(p.totals.deposited0, p.decimals0)} {p.symbol0}<br />{fmt.units(p.totals.deposited1, p.decimals1)} {p.symbol1}</td>
                <td className="px-3 py-2 tabular">{fmt.units(p.totals.fees0, p.decimals0)} {p.symbol0}<br />{fmt.units(p.totals.fees1, p.decimals1)} {p.symbol1}<div className="text-ink-600">{fmt.count(p.feeCollections.length, "collect")}</div></td>
                <td className="px-3 py-2 text-ink-600">{p.ownership.filter((o) => o.event.kind === "TRANSFER").length ? `${p.ownership.filter((o) => o.event.kind === "TRANSFER").length} transfer(s)` : "never transferred"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[0.72rem] text-ink-600 px-4 py-3 border-t border-line">
        Amounts use each token&apos;s real decimals. Fees are only the fee part of each Collect; principal is counted once, when it was removed. <a className="underline" href={withInv("/positions", inv)}>Position pages</a> have each NFT&apos;s full event table.
      </p>
    </Card>
  );
}

/* ---------------- page ---------------- */
function CaseStudyView({ full, inv }: { full: FullInvestigation; inv: string }) {
  const q = useQuery({ queryKey: ["case-study", inv], queryFn: () => api<CaseStudy>(`/investigations/${inv}/case-study`), staleTime: 60_000 });
  const [selected, setSelected] = useState<CaseEvent | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const cs = q.data;
  const coverage = useMemo(() => {
    if (!cs) return [];
    const c = cs.coverage;
    const frac = (a: number, b: number) => (b ? `${a} of ${b}` : "—");
    return [
      { label: "Events with block time", value: frac(c.eventsWithTimestamp, c.events) },
      { label: "Events with gas receipt", value: frac(c.eventsWithReceipt, c.events) },
      { label: "Positions with full history", value: frac(c.positionsWithFullHistory, c.positions) },
      { label: "Positions with on-chain metadata", value: frac(c.positionsWithMetadata, c.positions) },
      { label: "Observations backed by events", value: frac(c.observationsWithEvidence, c.observations) },
      { label: "Strategy citations found", value: frac(c.ruleRefsFound, c.ruleRefs) },
    ];
  }, [cs]);

  if (q.isLoading) return <LoadingState label="Building the case study from stored on-chain events…" />;
  if (q.error) return <ErrorState title="The case study could not be built" message={(q.error as Error).message} />;
  if (!cs) return null;
  const o = cs.overview;
  const fees = cs.positions.reduce((a, p) => a + p.feeCollections.length, 0);

  return (
    <>
      <header className="mb-5">
        <div className="label">Case study</div>
        <h1 className="serif text-2xl md:text-3xl text-ink mt-1">
          <ExplorerLink kind="address" value={cs.wallet}>{fmt.addr(cs.wallet)}</ExplorerLink> on Uniswap V3
        </h1>
        <p className="text-[0.8rem] text-ink-600 mt-1 tabular">
          Ethereum Sepolia · {cs.window ? `blocks ${cs.window.fromBlock.toLocaleString("en-US")}–${cs.window.toBlock.toLocaleString("en-US")}` : "window unknown"} · investigation {inv.slice(0, 8)}
        </p>
      </header>

      {o.events === 0 ? (
        <EmptyState title="Nothing to reconstruct">This wallet has no Uniswap V3 position events in this window. TRACE reports that instead of showing sample data. Try a longer look-back on Investigate.</EmptyState>
      ) : (
        <>
          <Card>
            <PlainSummary cs={cs} full={full} />
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-5">
              <Stat label="Positions" value={o.positions} sub={`${o.active} active · ${o.closed} closed`} />
              <Stat label="Pools" value={o.pools} />
              <Stat label="On-chain events" value={o.events} />
              <Stat label="Fee collections" value={fees} />
              <Stat label="Range changes" value={cs.rangeChanges.length} />
              <Stat label="First → last" value={o.firstEvent ? fmt.tsSec(o.firstEvent.timestamp, false) : "—"} sub={o.lastEvent ? `to ${fmt.tsSec(o.lastEvent.timestamp, false)}` : undefined} />
            </div>
          </Card>

          <SectionTitle eyebrow="Every event, in chain order" title="Position lifecycle timeline" />
          <Timeline cs={cs} selected={selected} onSelect={setSelected} />

          <SectionTitle eyebrow="Where each position put its liquidity" title="Liquidity ranges" />
          <Ranges cs={cs} full={full} selected={pick} />

          <SectionTitle eyebrow="Each NFT, from mint to close" title="Positions" />
          <PositionsTable cs={cs} inv={inv} onPick={(id) => setPick(id)} />

          <SectionTitle eyebrow="Every observation cites its source events" title="Evidence Explorer" />
          <p className="text-[0.8rem] text-ink-600 -mt-2 mb-3 max-w-[75ch]">
            <Term k="evidence">On-chain evidence</Term> for what TRACE measured and for each rule of the strategy hypothesis. Each row is a real log: event, NFT, block, time and transaction, all linked to the Sepolia explorer.
          </p>
          <div className="grid lg:grid-cols-2 gap-3">
            {cs.observations.map((ob) => <Observation key={ob.id} o={ob} cs={cs} />)}
          </div>

          <div className="grid lg:grid-cols-2 gap-3 mt-8">
            <Card>
              <div className="label mb-3">Evidence coverage</div>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[0.82rem]">
                {coverage.map((c) => (
                  <div key={c.label} className="contents"><dt className="text-ink-600">{c.label}</dt><dd className="text-ink tabular text-right">{c.value}</dd></div>
                ))}
              </dl>
            </Card>
            <Card>
              <div className="label mb-3">Data limitations</div>
              {cs.limitations.length ? (
                <ul className="list-disc pl-5 space-y-1 text-[0.82rem] text-ink-600">{cs.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              ) : (
                <p className="text-[0.82rem] text-ink-600">None found for this window.</p>
              )}
            </Card>
          </div>
        </>
      )}

      <NextStep href={withInv("/strategy", inv)} title="See the strategy hypothesis in full" label="Open Strategy">
        The rules above, with their confidence, alternatives, the 0G run details and version history.
      </NextStep>
    </>
  );
}

export default function CaseStudyPage() {
  return (
    <Page>
      <InvestigationGate>{(full, inv) => (inv ? <CaseStudyView full={full} inv={inv} /> : null)}</InvestigationGate>
    </Page>
  );
}
