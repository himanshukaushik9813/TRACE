"use client";

import Link from "next/link";
import { ChevronRight, Crosshair } from "lucide-react";
import { Pill } from "@/components/ui";
import { fmt } from "@/lib/format";
import { withInv, type Accounting, type V3Position } from "@/lib/api";

/** Real price (token1 per token0) at a tick, decimal-adjusted. */
export function tickPrice(tick: number, d0?: number | null, d1?: number | null): number | null {
  if (d0 == null || d1 == null) return null;
  return Math.pow(1.0001, tick) * 10 ** (d0 - d1);
}

const FULL = 1_700_000;

export function rangeLabel(p: V3Position): string {
  if (p.tickUpper - p.tickLower >= FULL) return "Full range";
  const lo = tickPrice(p.tickLower, p.decimals0, p.decimals1);
  const hi = tickPrice(p.tickUpper, p.decimals0, p.decimals1);
  if (lo == null || hi == null) return `ticks ${p.tickLower} → ${p.tickUpper}`;
  return `${fmt.amt(lo, 6)} – ${fmt.amt(hi, 6)} ${p.token1}/${p.token0}`;
}

function TokenPair({ a, b }: { a: string; b: string }) {
  const short = (s: string) => (s.startsWith("0x") ? s.slice(2, 5) : s.slice(0, 4));
  return (
    <div className="relative shrink-0" style={{ width: 42, height: 30 }}>
      <div className="absolute h-[30px] w-[30px] rounded-full grid place-items-center font-semibold text-charcoal-900 text-[0.62rem] bg-gold-300 shadow-soft">{short(a)}</div>
      <div className="absolute left-3 h-[30px] w-[30px] rounded-full grid place-items-center font-semibold text-charcoal-900 text-[0.62rem] bg-sage-300 border-2 border-ivory-50 shadow-soft">{short(b)}</div>
    </div>
  );
}

export function PositionCard({ p, acct, inv }: { p: V3Position; acct?: Accounting; inv: string | null }) {
  return (
    <Link href={withInv(`/positions/${p.tokenId}`, inv)} className="group rounded-md2 border border-ink/10 bg-ivory-50 p-4 hover:border-gold/40 hover:shadow-card transition-all block">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <TokenPair a={p.token0} b={p.token1} />
          <div className="min-w-0">
            <div className="text-ink font-medium text-[0.95rem] truncate">
              {p.token0} / {p.token1}
            </div>
            <div className="text-[0.68rem] text-ink-600 tabular truncate">
              NFT #{p.tokenId} · {fmt.feeTier(p.feeTier)} · {p.pool === "unresolved" ? "pool unresolved" : fmt.addr(p.pool)}
            </div>
          </div>
        </div>
        <Pill tone={p.status === "active" ? "sage" : "neutral"}>{p.status === "active" ? "Active" : "Closed"}</Pill>
      </div>
      <div className="mt-3">
        <div className="label">Range</div>
        <div className="text-[0.86rem] text-ink font-semibold tabular mt-0.5 flex items-center gap-1.5">
          <Crosshair size={12} className="text-gold" />
          {rangeLabel(p)}
        </div>
      </div>
      {acct && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[0.72rem]">
          <div>
            <div className="label">Deposited</div>
            <div className="tabular text-ink">
              {fmt.amt(acct.deposited.token0)} {p.token0}
              <br />
              {fmt.amt(acct.deposited.token1)} {p.token1}
            </div>
          </div>
          <div>
            <div className="label">Fees collected</div>
            <div className="tabular text-ink">
              {fmt.amt(acct.feesCollected.token0)} {p.token0}
              <br />
              {fmt.amt(acct.feesCollected.token1)} {p.token1}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-ink/8 flex items-center justify-between text-[0.7rem] text-ink-600">
        <span>{p.historyComplete ? `Opened block ${p.openedBlock?.toLocaleString("en-US") ?? "—"}` : "Opened before the window (partial history)"}</span>
        <span className="flex items-center gap-1 text-gold font-medium opacity-0 group-hover:opacity-100 transition-all">
          Evidence <ChevronRight size={13} />
        </span>
      </div>
    </Link>
  );
}
