"use client";

import Link from "next/link";
import { ChevronRight, Crosshair } from "lucide-react";
import { Sparkline } from "@/components/charts";
import { Pill } from "@/components/ui";
import type { Position } from "@/lib/fixture";
import { fmt } from "@/lib/format";

/** Two overlapping token discs — metallic token identification. */
export function TokenPair({ a, b, colors, size = 30 }: { a: string; b: string; colors: [string, string]; size?: number }) {
  const d = size;
  return (
    <div className="relative shrink-0" style={{ width: d + 12, height: d }}>
      <div
        className="absolute rounded-full grid place-items-center font-semibold text-charcoal-900 shadow-soft"
        style={{ width: d, height: d, left: 0, background: colors[0], fontSize: d * 0.3 }}
      >
        {a.slice(0, 3)}
      </div>
      <div
        className="absolute rounded-full grid place-items-center font-semibold text-charcoal-900 shadow-soft border-2 border-ivory-50"
        style={{ width: d, height: d, left: 12, background: colors[1], fontSize: d * 0.3 }}
      >
        {b.slice(0, 3)}
      </div>
    </div>
  );
}

/** Compact position card (Investigate screen). */
export function SparklineCard({ position: p, dense }: { position: Position; dense?: boolean }) {
  return (
    <Link
      href={`/positions/${p.id}`}
      className="group rounded-md2 border border-ink/10 bg-ivory-50 p-4 hover:border-gold/40 hover:shadow-card transition-all block"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <TokenPair a={p.tokens[0]} b={p.tokens[1]} colors={p.tokenColors} />
          <div className="min-w-0">
            <div className="text-ink font-medium text-[0.95rem]">{p.tokenPair}</div>
            <div className="text-[0.68rem] text-ink-600 tabular">NFT #{p.nftId} · {p.feeTier} · {fmt.addr(p.pool)}</div>
          </div>
        </div>
        <Pill tone={p.status === "Active" ? "sage" : "neutral"}>{p.status}</Pill>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="label">Range</div>
          <div className="text-[0.9rem] text-ink font-semibold tabular mt-0.5">
            {fmt.num(p.rangeLo, p.rangeLo < 100 ? 1 : 0)} – {fmt.num(p.rangeHi, p.rangeHi < 100 ? 1 : 0)}
          </div>
          <div className="text-[0.68rem] text-ink-600 mt-0.5 flex items-center gap-1">
            <Crosshair size={11} className={p.inRange ? "text-forest" : "text-amber"} />
            {p.inRange ? "In range" : "Out of range"} · {p.status === "Active" ? `liq ${fmt.num(p.liquidity)}` : "closed"}
          </div>
        </div>
        <div className="text-right">
          <div className="label !text-right">Price</div>
          <Sparkline data={p.spark} color={p.inRange ? "#78866B" : "#B68A42"} />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-ink/8 flex items-center justify-between text-[0.7rem] text-ink-600">
        <span>{p.lastActivity}</span>
        <span className="flex items-center gap-1 text-gold font-medium opacity-0 group-hover:opacity-100 transition-all">
          View <ChevronRight size={13} />
        </span>
      </div>
    </Link>
  );
}

/** Re-export so screens can pull a shared card from one place. */
export { TokenPair as Pair };
