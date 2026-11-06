"use client";

/**
 * The case file: the whole TRACE story for one wallet in a single band —
 * evidence → inferred strategy → backtest → Aqua — each step a verdict read
 * from the real investigation payload and a link to the screen that proves it.
 * Shown as a compact band above every investigation screen.
 */

import Link from "next/link";
import { ExplorerLink } from "@/components/ui";
import { fmt } from "@/lib/format";
import { withInv, type FullInvestigation } from "@/lib/api";

export const FAMILY: Record<string, string> = {
  passive_concentrated: "Passive concentrated liquidity",
  passive_full_range: "Passive full-range liquidity",
  periodic_range_adjustment: "Periodic range adjustment",
  active_range_management: "Active range management",
  capital_redeployment: "Repeated deploy and withdraw",
  inconclusive: "Inconclusive — too little evidence",
};

/** One plain sentence per strategy family, for people new to liquidity. */
export const FAMILY_PLAIN: Record<string, string> = {
  passive_concentrated: "The wallet picks one price range, deposits into it, and mostly leaves it alone while it collects trading fees.",
  passive_full_range: "The wallet provides liquidity at every possible price, like a classic pool, so it never has to adjust anything.",
  periodic_range_adjustment: "The wallet moves its price range on a fairly regular schedule to follow the market.",
  active_range_management: "The wallet often moves its price range to keep it close to the current price.",
  capital_redeployment: "The wallet repeatedly takes money out and puts it back in, changing how much it has deployed.",
  inconclusive: "There is not enough activity to name a strategy with confidence. TRACE says so instead of guessing.",
};

type Tone = "good" | "warn" | "muted";
type Step = { key: string; title: string; verdict: string; detail: string; href: string; tone: Tone };

function steps(full: FullInvestigation, invId: string): Step[] {
  const inv = full.investigation;
  const c = inv.summary?.counts;
  const primary = full.strategies.find((s) => s.id === full.primaryStrategyId);
  const ai = primary?.role === "ai_hypothesis";
  const bt = full.backtest?.result;
  const observed = bt?.runs.find((r) => r.kind === "observed") ?? bt?.runs[0];
  const hold = bt?.runs.find((r) => r.label.startsWith("Buy & hold"));
  const compat = full.compatibility?.report;

  return [
    {
      key: "evidence",
      title: "Evidence",
      verdict: c ? `${c.positions} position${c.positions === 1 ? "" : "s"}, ${c.events} events` : "—",
      detail: `${c?.pools ?? 0} pool${c?.pools === 1 ? "" : "s"} over ${inv.windowDays} days, read from Sepolia`,
      href: withInv("/positions", invId),
      tone: "good",
    },
    {
      key: "strategy",
      title: "Strategy",
      verdict: primary ? FAMILY[primary.family] ?? primary.family : "Not inferred",
      detail: primary
        ? `${fmt.frac(Number(primary.confidence), 0)} fit to evidence · ${ai ? "0G hypothesis, evidence-gated" : "evidence-only (0G unavailable)"}`
        : "No strategy version stored",
      href: withInv("/strategy", invId),
      tone: primary && primary.family !== "inconclusive" ? "good" : "warn",
    },
    {
      key: "backtest",
      title: "Backtest",
      verdict:
        bt?.status === "completed" && observed
          ? `${fmt.pct(observed.net * 100)} observed`
          : bt?.status === "insufficient_data"
            ? "Not enough real swaps"
            : "Not run",
      detail:
        bt?.status === "completed" && hold
          ? `vs ${fmt.pct(hold.net * 100)} buy & hold · ${bt.series.prices.length} real swaps, look-ahead guarded`
          : bt?.reason ?? inv.integrations.backtest?.detail ?? "Needs a pool with real trading",
      href: withInv("/backtest", invId),
      tone: bt?.status === "completed" ? "good" : "warn",
    },
    {
      key: "aqua",
      title: "1inch Aqua",
      verdict: compat ? (compat.verdict === "FULL" ? "Fully compatible" : compat.verdict === "PARTIAL" ? "Partially compatible" : "Incompatible") : "Ready to check",
      detail: compat
        ? `${compat.rules.filter((r) => r.status === "supported").length} of ${compat.rules.length} rules map to a SwapVM order`
        : "Run on-chain checks, compile, sign and ship",
      href: withInv("/execute", invId),
      tone: compat ? (compat.verdict === "INCOMPATIBLE" ? "warn" : "good") : "muted",
    },
  ];
}

const DOT: Record<Tone, string> = { good: "bg-forest", warn: "bg-amber", muted: "bg-ink/25" };
export function CaseFile({ full, invId }: { full: FullInvestigation; invId: string; compact?: boolean }) {
  const inv = full.investigation;
  const list = steps(full, invId);
  return (
    <div className="mb-6 rounded-card border border-line bg-ivory-50 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 border-b border-line text-[0.78rem] bg-ivory">
        <span className="text-ink-600 min-w-0 break-anywhere">
          Case file for <ExplorerLink kind="address" value={inv.wallet} className="text-ink font-medium" />
        </span>
        <span className="text-ink-600 tabular">
          Sepolia blocks {inv.fromBlock?.toLocaleString("en-US")}–{inv.toBlock?.toLocaleString("en-US")}
        </span>
      </div>
      <ol className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line">
        {list.map((s) => (
          <li key={s.key} className="min-w-0 bg-ivory-50">
            <Link href={s.href} className="block px-4 py-3 hover:bg-ivory focus-visible:bg-ivory h-full">
              <span className="flex items-center gap-1.5 text-[0.72rem] text-ink-600">
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.tone]}`} />
                {s.title}
              </span>
              <span className="block text-[0.86rem] text-ink font-medium mt-0.5 break-anywhere">{s.verdict}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
