"use client";

/**
 * The Positions hero: a cinematic 3D liquidity landscape built only from the real
 * investigation (positions, the pool's swap prices) and its case study (every
 * add/remove/collect event), with an honest 2D fallback when WebGL is unavailable.
 * three.js loads client-side only (next/dynamic, ssr: false).
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { RangeBand } from "@/components/charts";
import { tickPrice } from "@/components/positions";
import { Term } from "@/components/term";
import { fmt } from "@/lib/format";
import { api, withInv, type CaseEvent, type CaseStudy, type FullInvestigation, type V3Position } from "@/lib/api";
import type { TerrainAxis, TerrainData, TerrainEvent, TerrainSegment } from "@/components/liquidity-terrain";

const LiquidityTerrain = dynamic(() => import("@/components/liquidity-terrain"), {
  ssr: false,
  loading: () => <div className="h-[420px] grid place-items-center text-[0.8rem] text-ink-600">Building the 3D view…</div>,
});

const BOUND = 887_000;
const LN = Math.log(1.0001);

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** If three.js fails at runtime, show the 2D view instead of a broken canvas. */
class TerrainBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Pools that have positions, most positions first. */
function poolsOf(positions: V3Position[]) {
  const m = new Map<string, V3Position[]>();
  for (const p of positions) if (p.pool !== "unresolved") m.set(p.pool, [...(m.get(p.pool) ?? []), p]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** Readable price direction: show the pair so typical prices are ≥ 1 (e.g. USDC per WETH, not 0.0003 WETH per USDC). */
function axisFor(p0: V3Position, midTick: number): TerrainAxis {
  const d0 = p0.decimals0;
  const d1 = p0.decimals1;
  if (d0 == null || d1 == null) {
    return { dir: 1, unit: "tick", toDisplay: () => null, toTick: (v) => v, fmt: (v) => String(Math.round(v)) };
  }
  const scale = 10 ** (d0 - d1);
  const raw = (t: number) => Math.pow(1.0001, t) * scale; // token1 per token0
  const invert = raw(midTick) < 1;
  return invert
    ? { dir: -1, unit: `${p0.token0} per ${p0.token1}`, toDisplay: (t) => 1 / raw(t), toTick: (v) => Math.log(1 / v / scale) / LN, fmt: (v) => fmt.price(v) }
    : { dir: 1, unit: `${p0.token1} per ${p0.token0}`, toDisplay: (t) => raw(t), toTick: (v) => Math.log(v / scale) / LN, fmt: (v) => fmt.price(v) };
}

/** Liquidity over time from the position's own events (step function). */
function liquiditySteps(events: CaseEvent[]): { block: number; liq: number }[] {
  return events
    .filter((e) => (e.kind === "MINT" || e.kind === "INCREASE" || e.kind === "DECREASE") && e.liquidityAfter != null)
    .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
    .map((e) => ({ block: e.block, liq: Number(e.liquidityAfter) }));
}

/**
 * Split a position's life into stretches of constant liquidity and constant
 * in/out-of-range state, using its real events and the pool's real swap prices.
 */
export function segmentsFor(
  from: number,
  to: number,
  tickLower: number,
  tickUpper: number,
  steps: { block: number; liq: number }[],
  fallbackLiq: number,
  price: { block: number; tick: number }[],
  minLen: number,
): { segments: TerrainSegment[]; inRangeShare: number | null } {
  if (to <= from) return { segments: [], inRangeShare: null };
  const inR = (t: number) => t >= tickLower && t < tickUpper;
  const stateAt = (b: number): boolean | null => {
    let s: boolean | null = price.length ? inR(price[0].tick) : null;
    for (const p of price) {
      if (p.block <= b) s = inR(p.tick);
      else break;
    }
    return s;
  };
  const liqAt = (b: number) => {
    let l = steps.length ? steps[0].liq : fallbackLiq;
    for (const s of steps) {
      if (s.block <= b) l = s.liq;
      else break;
    }
    return l;
  };
  const cuts = new Set<number>([from, to]);
  for (const s of steps) if (s.block > from && s.block < to) cuts.add(s.block);
  let prev = stateAt(from);
  for (const p of price) {
    if (p.block <= from || p.block >= to) continue;
    const st = inR(p.tick);
    if (st !== prev) cuts.add(p.block);
    prev = st;
  }
  const bs = [...cuts].sort((a, b) => a - b);
  const raw: TerrainSegment[] = [];
  for (let i = 0; i < bs.length - 1; i++) raw.push({ fromBlock: bs[i], toBlock: bs[i + 1], liquidity: liqAt(bs[i]), inRange: stateAt(bs[i]) });
  // merge equal neighbours, then absorb slivers too thin to see
  const merged: TerrainSegment[] = [];
  for (const g of raw) {
    const m = merged[merged.length - 1];
    if (m && m.liquidity === g.liquidity && m.inRange === g.inRange) m.toBlock = g.toBlock;
    else if (m && g.toBlock - g.fromBlock < minLen && m.liquidity === g.liquidity) m.toBlock = g.toBlock;
    else merged.push({ ...g });
  }
  let known = 0;
  let inside = 0;
  for (const g of raw) {
    if (g.inRange == null) continue;
    known += g.toBlock - g.fromBlock;
    if (g.inRange) inside += g.toBlock - g.fromBlock;
  }
  return { segments: merged.slice(0, 120), inRangeShare: known > 0 ? inside / known : null };
}

function amounts(a0: string, a1: string, p: V3Position): string {
  const parts: string[] = [];
  if (a0 && a0 !== "0") parts.push(`${fmt.units(a0, p.decimals0, 4)} ${p.token0}`);
  if (a1 && a1 !== "0") parts.push(`${fmt.units(a1, p.decimals1, 4)} ${p.token1}`);
  return parts.join(" + ");
}

function eventsFor(evts: CaseEvent[], p: V3Position): TerrainEvent[] {
  const out: TerrainEvent[] = [];
  const seen = new Set<string>();
  for (const e of [...evts].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)) {
    let kind: TerrainEvent["kind"] | null = null;
    let text = "";
    if ((e.kind === "MINT" || e.kind === "INCREASE") && e.liquidityDelta !== "0") {
      kind = "add";
      text = `Added ${amounts(e.amount0, e.amount1, p) || "liquidity"}`;
    } else if (e.kind === "DECREASE") {
      kind = "remove";
      text = `Removed ${amounts(e.amount0, e.amount1, p) || "liquidity"}`;
    } else if (e.kind === "COLLECT") {
      kind = "collect";
      const fees = amounts(e.fee0, e.fee1, p);
      text = fees ? `Fees ${fees}` : `Collected ${amounts(e.amount0, e.amount1, p) || "tokens"}`;
    } else if (e.kind === "BURN") {
      kind = "close";
      text = "Position NFT burned";
    }
    if (!kind) continue;
    const k = `${e.tx}:${kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind, block: e.block, tx: e.tx, text });
  }
  return out;
}

function dateFn(full: FullInvestigation, cs: CaseStudy | undefined, pool: string): (block: number) => string | null {
  const series = Object.values(full.dna?.data.priceSeries ?? {}).find((s) => s.pool?.toLowerCase() === pool.toLowerCase());
  const pts = (series?.points ?? []).filter((p) => p.timestamp > 0);
  const w = cs?.window;
  const toDate = (ts: number) => new Date(ts > 1e12 ? ts : ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (w && w.toBlock > w.fromBlock && w.fromTs > 0 && w.toTs > 0)
    return (b) => toDate(w.fromTs + ((b - w.fromBlock) / (w.toBlock - w.fromBlock)) * (w.toTs - w.fromTs));
  if (pts.length > 1) {
    const a = pts[0];
    const z = pts[pts.length - 1];
    if (z.block > a.block) return (b) => toDate(a.timestamp + ((b - a.block) / (z.block - a.block)) * (z.timestamp - a.timestamp));
  }
  return () => null;
}

function buildTerrain(full: FullInvestigation, pool: string, positions: V3Position[], cs: CaseStudy | undefined): TerrainData | null {
  const inv = full.investigation;
  // investigations.from_block/to_block are Postgres bigints and arrive as strings.
  const invFrom = inv.fromBlock == null ? null : Number(inv.fromBlock);
  const invTo = inv.toBlock == null ? null : Number(inv.toBlock);
  const series = Object.values(full.dna?.data.priceSeries ?? {}).find((s) => s.pool?.toLowerCase() === pool.toLowerCase());
  const fromBlock = invFrom ?? Math.min(...positions.map((p) => p.openedBlock ?? Infinity), ...(series?.points.map((p) => p.block) ?? []));
  const toBlock = invTo ?? Math.max(...positions.map((p) => p.closedBlock ?? p.lastActivityBlock ?? 0), ...(series?.points.map((p) => p.block) ?? []));
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock) || toBlock <= fromBlock) return null;

  const price = (series?.points ?? [])
    .filter((p) => p.block >= fromBlock && p.block <= toBlock)
    .map((p) => ({ block: p.block, tick: p.tick }))
    .sort((a, b) => a.block - b.block);

  const ticks = [...positions.flatMap((p) => [p.tickLower, p.tickUpper]).filter((t) => Math.abs(t) < BOUND), ...price.map((p) => p.tick)];
  let lo = ticks.length ? Math.min(...ticks) : -1000;
  let hi = ticks.length ? Math.max(...ticks) : 1000;
  const pad = Math.max((hi - lo) * 0.12, 200);
  lo -= pad;
  hi += pad;

  const p0 = positions[0];
  const mid = price.length ? price[Math.floor(price.length / 2)].tick : (lo + hi) / 2;
  const axis = axisFor(p0, mid);
  const priceLabel = (tick: number) => {
    const v = axis.toDisplay(tick);
    return v == null ? `tick ${Math.round(tick)}` : `${axis.fmt(v)} ${axis.unit}`;
  };
  const csPos = new Map((cs?.positions ?? []).map((p) => [p.tokenId, p]));
  const minLen = (toBlock - fromBlock) * 0.004;

  return {
    window: { fromBlock, toBlock },
    tickDomain: [lo, hi],
    priceLabel,
    axis,
    dateAt: dateFn(full, cs, pool),
    price,
    slabs: positions.map((p) => {
      const range =
        p.tickUpper >= BOUND && p.tickLower <= -BOUND
          ? "full price range"
          : (() => {
              const a = p.tickLower > -BOUND ? axis.toDisplay(p.tickLower) : null;
              const b = p.tickUpper < BOUND ? axis.toDisplay(p.tickUpper) : null;
              const vals = [a, b].filter((v): v is number => v != null).sort((x, y) => x - y);
              return vals.length === 2 ? `${axis.fmt(vals[0])} – ${axis.fmt(vals[1])} ${axis.unit}` : `one-sided range (${axis.unit})`;
            })();
      const from = p.openedBlock && p.historyComplete !== false ? p.openedBlock : fromBlock;
      const to = p.status === "active" ? toBlock : (p.closedBlock ?? p.lastActivityBlock ?? toBlock);
      const evts = csPos.get(p.tokenId)?.events ?? [];
      const { segments, inRangeShare } = segmentsFor(from, to, p.tickLower, p.tickUpper, liquiditySteps(evts), p.liquidity, price, minLen);
      return {
        id: p.tokenId,
        label: `#${p.tokenId} · ${p.token0}/${p.token1} · ${p.status === "active" ? "active" : "closed"}`,
        detail: `Range ${range}`,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        fromBlock: from,
        toBlock: to,
        liquidity: p.liquidity,
        active: p.status === "active",
        clippedLow: p.tickLower < lo,
        clippedHigh: p.tickUpper > hi,
        segments,
        events: eventsFor(evts, p),
        inRangeShare,
      };
    }),
  };
}

function Swatch({ c, line }: { c: string; line?: boolean }) {
  return line ? <span className="h-0.5 w-4 rounded" style={{ background: c, boxShadow: `0 0 6px ${c}` }} /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />;
}

export function LiquidityView({ full, invId }: { full: FullInvestigation; invId: string }) {
  const router = useRouter();
  const pools = useMemo(() => poolsOf(full.investigation.summary?.positions ?? []), [full]);
  const [pool, setPool] = useState<string | null>(null);
  const current = pool ?? pools[0]?.[0] ?? null;
  const inPool = useMemo(() => pools.find(([k]) => k === current)?.[1] ?? [], [pools, current]);
  // Same query as the case-study page (shared cache): adds the real events to the view.
  const cs = useQuery({ queryKey: ["case-study", invId], queryFn: () => api<CaseStudy>(`/investigations/${invId}/case-study`), staleTime: 60_000, retry: 1 });
  const data = useMemo(() => (current ? buildTerrain(full, current, inPool, cs.data) : null), [full, current, inPool, cs.data]);
  const [gl, setGl] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setGl(webglAvailable());
    setNarrow(window.matchMedia("(max-width: 640px)").matches);
  }, []);

  if (!current || !data) return null;

  const main = inPool.find((p) => p.status === "active") ?? inPool[0];
  const series = Object.values(full.dna?.data.priceSeries ?? {}).find((s) => s.pool?.toLowerCase() === current.toLowerCase());
  const lo = tickPrice(main.tickLower, main.decimals0, main.decimals1);
  const hi = tickPrice(main.tickUpper, main.decimals0, main.decimals1);
  const fallback =
    series && series.points.length > 1 && lo != null && hi != null && Math.abs(main.tickLower) < BOUND && Math.abs(main.tickUpper) < BOUND ? (
      <div>
        <p className="text-[0.76rem] text-ink-600 mb-2">2D view (this browser has no WebGL): the shaded band is the main position&apos;s price range, the line is the real price.</p>
        <RangeBand price={series.points.map((p) => p.price)} lo={lo} hi={hi} height={300} />
      </div>
    ) : (
      <p className="text-[0.8rem] text-ink-600 py-10 text-center">The 3D view needs WebGL, which this browser does not provide, and this position has no bounded range to draw in 2D.</p>
    );
  const nEvents = data.slabs.reduce((n, s) => n + s.events.length, 0);

  return (
    <figure className="rounded-card border border-line bg-ivory-50 shadow-lift overflow-hidden" aria-label="3D view of the wallet's liquidity positions over price and time">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Liquidity landscape</h2>
          <p className="text-[0.78rem] text-ink-600 mt-0.5 max-w-[70ch] leading-relaxed">
            Each glass block is one <Term k="lpPosition">position</Term>: its width is the <Term k="priceRange">price range</Term>, its length is how long it was open, and its height is its{" "}
            <Term k="liquidity">liquidity</Term>, stepping at every real add or removal. It glows <span className="text-[#9A6E2C] font-medium">gold</span> while the pool&apos;s real price (the bright line) was inside the range, earning fees, and turns{" "}
            <span className="font-medium">grey</span> when it was outside. Drag to turn; hover the markers; click a block to open it.
          </p>
        </div>
        {pools.length > 1 && (
          <label className="text-[0.76rem] text-ink-600 flex items-center gap-2">
            Pool
            <select value={current} onChange={(e) => setPool(e.target.value)} className="h-9 rounded-md2 border border-line bg-ivory px-2.5 text-[0.8rem] text-ink">
              {pools.map(([k, ps]) => (
                <option key={k} value={k}>
                  {ps[0].token0}/{ps[0].token1} · {fmt.feeTier(ps[0].feeTier)} ({ps.length})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="px-3 pb-3 pt-2">
        {gl === null ? (
          <div className="h-[420px]" />
        ) : gl ? (
          <TerrainBoundary fallback={<div className="px-3 pb-3">{fallback}</div>}>
            <LiquidityTerrain data={data} height={narrow ? 330 : 440} onOpen={(id) => router.push(withInv(`/positions/${id}`, invId))} />
          </TerrainBoundary>
        ) : (
          <div className="px-3 pb-3">{fallback}</div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-5 py-2.5 text-[0.72rem] text-ink-600">
        <span className="inline-flex items-center gap-1.5"><Swatch c="#D6AE62" /> In range (earning fees)</span>
        <span className="inline-flex items-center gap-1.5"><Swatch c="#B9B3A7" /> Out of range</span>
        <span className="inline-flex items-center gap-1.5"><Swatch c="#CFC8BB" /> Closed position</span>
        <span className="inline-flex items-center gap-1.5"><Swatch c="#B68A42" line /> Real pool price{data.price.length ? ` (${data.price.length} swaps)` : " (no swaps read)"}</span>
        {nEvents > 0 && (
          <span className="inline-flex items-center gap-2">
            <span className="text-[#278653]">◆ added</span>
            <span className="text-[#B4483A]">▼ removed</span>
            <span className="text-[#9A6E2C]">● fees collected</span>
          </span>
        )}
        <span className="ml-auto tabular">Blocks {data.window.fromBlock.toLocaleString("en-US")} – {data.window.toBlock.toLocaleString("en-US")}</span>
      </figcaption>
      {/* Screen-reader equivalent of the 3D scene */}
      <ul className="sr-only">
        {data.slabs.map((s) => (
          <li key={s.id}>
            Position {s.id}: {s.label}, {s.detail}, open from block {s.fromBlock} to {s.toBlock}
            {s.inRangeShare != null ? `, in range ${Math.round(s.inRangeShare * 100)}% of the time` : ""}. {s.events.map((e) => `${e.text} at block ${e.block}`).join("; ")}
          </li>
        ))}
      </ul>
    </figure>
  );
}
