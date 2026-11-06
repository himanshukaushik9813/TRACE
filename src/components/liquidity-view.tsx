"use client";

/**
 * The Positions hero: a 3D liquidity terrain built only from the real
 * investigation, with an honest 2D fallback when WebGL is unavailable.
 * three.js loads client-side only (next/dynamic, ssr: false) so it never
 * affects server rendering or pages that don't show the terrain.
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { RangeBand } from "@/components/charts";
import { tickPrice } from "@/components/positions";
import { Term } from "@/components/term";
import { fmt } from "@/lib/format";
import { withInv, type FullInvestigation, type V3Position } from "@/lib/api";
import type { TerrainData } from "@/components/liquidity-terrain";

const LiquidityTerrain = dynamic(() => import("@/components/liquidity-terrain"), {
  ssr: false,
  loading: () => <div className="h-[380px] grid place-items-center text-[0.8rem] text-ink-600">Building the 3D view…</div>,
});

const BOUND = 887_000;

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

function buildTerrain(full: FullInvestigation, pool: string, positions: V3Position[]): TerrainData | null {
  const inv = full.investigation;
  // investigations.from_block/to_block are Postgres bigints and arrive as strings.
  const invFrom = inv.fromBlock == null ? null : Number(inv.fromBlock);
  const invTo = inv.toBlock == null ? null : Number(inv.toBlock);
  const series = Object.values(full.dna?.data.priceSeries ?? {}).find((s) => s.pool?.toLowerCase() === pool.toLowerCase());
  const fromBlock = invFrom ?? Math.min(...positions.map((p) => p.openedBlock ?? Infinity), ...(series?.points.map((p) => p.block) ?? []));
  const toBlock = invTo ?? Math.max(...positions.map((p) => p.closedBlock ?? p.lastActivityBlock ?? 0), ...(series?.points.map((p) => p.block) ?? []));
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock) || toBlock <= fromBlock) return null;

  const ticks = [
    ...positions.flatMap((p) => [p.tickLower, p.tickUpper]).filter((t) => Math.abs(t) < BOUND),
    ...(series?.points.map((p) => p.tick) ?? []),
  ];
  let lo = ticks.length ? Math.min(...ticks) : -1000;
  let hi = ticks.length ? Math.max(...ticks) : 1000;
  const pad = Math.max((hi - lo) * 0.15, 200);
  lo -= pad;
  hi += pad;

  const p0 = positions[0];
  const priceLabel = (tick: number) => {
    const v = tickPrice(tick, p0.decimals0, p0.decimals1);
    return v == null ? `tick ${Math.round(tick)}` : `${fmt.price(v)} ${p0.token1}/${p0.token0}`;
  };

  return {
    window: { fromBlock, toBlock },
    tickDomain: [lo, hi],
    priceLabel,
    price: (series?.points ?? []).filter((p) => p.block >= fromBlock && p.block <= toBlock).map((p) => ({ block: p.block, tick: p.tick })),
    slabs: positions.map((p) => {
      const lower = tickPrice(p.tickLower, p.decimals0, p.decimals1);
      const upper = tickPrice(p.tickUpper, p.decimals0, p.decimals1);
      const range =
        p.tickUpper >= BOUND && p.tickLower <= -BOUND
          ? "full price range"
          : `${lower != null && p.tickLower > -BOUND ? fmt.price(lower) : "0"} – ${upper != null && p.tickUpper < BOUND ? fmt.price(upper) : "∞"} ${p.token1}/${p.token0}`;
      return {
        id: p.tokenId,
        label: `${p.token0}/${p.token1} · ${p.status === "active" ? "active" : "closed"}`,
        detail: `Range ${range}`,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        fromBlock: p.openedBlock && p.historyComplete !== false ? p.openedBlock : fromBlock,
        toBlock: p.status === "active" ? toBlock : (p.closedBlock ?? p.lastActivityBlock ?? toBlock),
        liquidity: p.liquidity,
        active: p.status === "active",
        clippedLow: p.tickLower < lo,
        clippedHigh: p.tickUpper > hi,
      };
    }),
  };
}

export function LiquidityView({ full, invId }: { full: FullInvestigation; invId: string }) {
  const router = useRouter();
  const pools = useMemo(() => poolsOf(full.investigation.summary?.positions ?? []), [full]);
  const [pool, setPool] = useState<string | null>(null);
  const current = pool ?? pools[0]?.[0] ?? null;
  const inPool = useMemo(() => pools.find(([k]) => k === current)?.[1] ?? [], [pools, current]);
  const data = useMemo(() => (current ? buildTerrain(full, current, inPool) : null), [full, current, inPool]);
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

  return (
    <figure className="rounded-card border border-line bg-ivory-50 shadow-lift overflow-hidden" aria-label="3D view of the wallet's liquidity positions over price and time">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="font-sans text-[1.05rem] font-semibold text-ink">Liquidity over price and time</h2>
          <p className="text-[0.78rem] text-ink-600 mt-0.5 max-w-[62ch] leading-relaxed">
            Each block is one <Term k="lpPosition">position</Term>: its width is the <Term k="priceRange">price range</Term>, its depth is how long it was open, its height is its relative{" "}
            <Term k="liquidity">liquidity</Term>. The gold line is the pool&apos;s real price. Drag to turn the view; click (or tap) a block to open it.
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
      <div className="px-2 pb-2">
        {gl === null ? (
          <div className="h-[380px]" />
        ) : gl ? (
          <TerrainBoundary fallback={<div className="px-3 pb-3">{fallback}</div>}>
            <LiquidityTerrain data={data} height={narrow ? 300 : 380} onOpen={(id) => router.push(withInv(`/positions/${id}`, invId))} />
          </TerrainBoundary>
        ) : (
          <div className="px-3 pb-3">{fallback}</div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-5 py-2.5 text-[0.72rem] text-ink-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#D9C08F]" /> Active position</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#C9C1B2]" /> Closed position</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-gold" /> Real pool price{data.price.length ? ` (${data.price.length} swaps sampled)` : " (no swaps read)"}</span>
        <span className="ml-auto tabular">Blocks {data.window.fromBlock.toLocaleString("en-US")} – {data.window.toBlock.toLocaleString("en-US")}</span>
      </figcaption>
      {/* Screen-reader equivalent of the 3D scene */}
      <ul className="sr-only">
        {data.slabs.map((s) => (
          <li key={s.id}>
            Position {s.id}: {s.label}, {s.detail}, open from block {s.fromBlock} to {s.toBlock}.
          </li>
        ))}
      </ul>
    </figure>
  );
}
