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
import { api, withInv, type CaseStudy, type FullInvestigation } from "@/lib/api";
import { buildTerrain, poolsOf } from "@/lib/terrain-data";

const LiquidityTerrain = dynamic(() => import("@/components/liquidity-terrain"), {
  ssr: false,
  loading: () => <div className="h-[420px] grid place-items-center text-[0.8rem] text-ink-600">Building the 3D view…</div>,
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
