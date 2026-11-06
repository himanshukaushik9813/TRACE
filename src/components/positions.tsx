"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Pill } from "@/components/ui";
import { fmt } from "@/lib/format";
import { withInv, type Accounting, type V3Position } from "@/lib/api";

/** Real price (token1 per token0) at a tick, decimal-adjusted. */
export function tickPrice(tick: number, d0?: number | null, d1?: number | null): number | null {
  if (d0 == null || d1 == null) return null;
  return Math.pow(1.0001, tick) * 10 ** (d0 - d1);
}

const FULL = 1_700_000;

const MAX_TICK = 887_000; // within a tick-spacing of Uniswap's MAX_TICK (887272)

export function rangeLabel(p: V3Position): string {
  if (p.tickUpper - p.tickLower >= FULL) return "Full range";
  const lo = tickPrice(p.tickLower, p.decimals0, p.decimals1);
  const hi = tickPrice(p.tickUpper, p.decimals0, p.decimals1);
  if (lo == null || hi == null) return `ticks ${p.tickLower} → ${p.tickUpper}`;
  const unit = `${p.token1}/${p.token0}`;
  if (p.tickUpper >= MAX_TICK) return `Above ${fmt.price(lo)} ${unit}, no upper bound`;
  if (p.tickLower <= -MAX_TICK) return `Below ${fmt.price(hi)} ${unit}, no lower bound`;
  return `${fmt.price(lo)} – ${fmt.price(hi)} ${unit}`;
}

/** Two overlapping token discs; the label always fits its disc. */
export function TokenPair({ a, b, size = 34 }: { a: string; b: string; size?: number }) {
  const short = (t: string) => (t.startsWith("0x") ? t.slice(2, 5) : t.replace(/[^A-Za-z0-9]/g, "").slice(0, 4));
  const disc = (t: string, bg: string, extra: string) => {
    const label = short(t);
    const fs = Math.min(size * 0.34, (size * 1.12) / Math.max(label.length, 1));
    return (
      <div
        title={t}
        className={`absolute grid place-items-center rounded-full font-semibold text-charcoal-900 shadow-soft leading-none ${extra}`}
        style={{ width: size, height: size, background: bg, fontSize: fs }}
      >
        {label}
      </div>
    );
  };
  return (
    <div className="relative shrink-0" style={{ width: size * 1.8, height: size }}>
      {disc(a, "#D9C08F", "left-0")}
      <div className="absolute" style={{ left: size * 0.8 }}>
        {disc(b, "#9AA88C", "border-2 border-ivory-50")}
      </div>
    </div>
  );
}

/** One side of a range as a plain price, or a plain-words bound. */
export function boundLabel(p: V3Position, side: "lower" | "upper"): string {
  if (side === "lower" && p.tickLower <= -MAX_TICK) return "No lower limit";
  if (side === "upper" && p.tickUpper >= MAX_TICK) return "No upper limit";
  const v = tickPrice(side === "lower" ? p.tickLower : p.tickUpper, p.decimals0, p.decimals1);
  return v == null ? `tick ${side === "lower" ? p.tickLower : p.tickUpper}` : fmt.price(v);
}

/** Whether a real price sits inside the position's range (null = unknown). */
export function inRange(p: V3Position, price: number | null | undefined): boolean | null {
  if (price == null) return null;
  const lo = p.tickLower <= -MAX_TICK ? 0 : tickPrice(p.tickLower, p.decimals0, p.decimals1);
  const hi = p.tickUpper >= MAX_TICK ? Infinity : tickPrice(p.tickUpper, p.decimals0, p.decimals1);
  if (lo == null || hi == null) return null;
  return price >= lo && price <= hi;
}

/**
 * A beginner-first position card: pair, status, current price, the two edges of
 * the range, what was deposited and the fees collected. NFT id, pool address and
 * blocks live on the details page ("View details").
 */
export function PositionCard({ p, acct, inv, price }: { p: V3Position; acct?: Accounting; inv: string | null; price?: number | null }) {
  const unit = `${p.token1} per ${p.token0}`;
  const range = p.status === "active" ? inRange(p, price) : null;
  return (
    <article className="group rounded-md2 border border-ink/10 bg-ivory-50 p-4 hover:border-gold/40 hover:shadow-card transition-all flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <TokenPair a={p.token0} b={p.token1} />
          <h3 className="text-ink font-medium text-[0.95rem] truncate">
            {p.token0} / {p.token1}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {range != null && <Pill tone={range ? "sage" : "amber"}>{range ? "In range" : "Out of range"}</Pill>}
          <Pill tone={p.status === "active" ? "sage" : "neutral"}>{p.status === "active" ? "Active" : "Closed"}</Pill>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[0.74rem]">
        <div className="min-w-0">
          <dt className="label">Current price</dt>
          <dd className="tabular text-ink font-semibold mt-0.5 break-anywhere">{price != null ? fmt.price(price) : "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="label">Lower</dt>
          <dd className="tabular text-ink font-semibold mt-0.5 break-anywhere">{boundLabel(p, "lower")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="label">Upper</dt>
          <dd className="tabular text-ink font-semibold mt-0.5 break-anywhere">{boundLabel(p, "upper")}</dd>
        </div>
      </dl>
      <div className="text-[0.66rem] text-ink-600 mt-1">Prices in {unit}</div>
      {acct && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.72rem]">
          <div>
            <dt className="label">Deposited</dt>
            <dd className="tabular text-ink">
              {fmt.amt(acct.deposited.token0)} {p.token0}
              <br />
              {fmt.amt(acct.deposited.token1)} {p.token1}
            </dd>
          </div>
          <div>
            <dt className="label">Fees collected</dt>
            <dd className="tabular text-ink">
              {fmt.amt(acct.feesCollected.token0)} {p.token0}
              <br />
              {fmt.amt(acct.feesCollected.token1)} {p.token1}
            </dd>
          </div>
        </dl>
      )}
      <div className="mt-auto pt-3">
        <Link
          href={withInv(`/positions/${p.tokenId}`, inv)}
          className="mt-1 flex items-center justify-between border-t border-ink/8 pt-3 text-[0.76rem] font-medium text-[#8A6528] hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 rounded-sm"
          aria-label={`View details of ${p.token0}/${p.token1} position ${p.tokenId}`}
        >
          View details <ChevronRight size={14} />
        </Link>
      </div>
    </article>
  );
}
