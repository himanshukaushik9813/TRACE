/**
 * "What happens next": one calm line at the end of a screen that tells the user
 * where to go and why. Every screen ends with one, so the journey
 * Investigate → Positions → Strategy → Backtest → Execute → Reports is always
 * one click away.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function NextStep({ href, title, children, label = "Continue" }: { href: string; title: string; children?: React.ReactNode; label?: string }) {
  return (
    <aside aria-label="Next step" className="mt-8 rounded-card border border-gold/40 bg-ivory-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 shadow-soft">
      <div className="flex-1 min-w-0">
        <div className="text-[0.7rem] uppercase tracking-[0.14em] text-gold font-semibold">Next step</div>
        <div className="text-[0.95rem] font-semibold text-ink mt-0.5">{title}</div>
        {children && <p className="text-[0.8rem] text-ink-600 mt-0.5 leading-relaxed">{children}</p>}
      </div>
      <Link href={href} className="inline-flex items-center justify-center gap-2 rounded-md2 bg-gold text-white px-4 h-10 text-[0.86rem] font-medium hover:bg-[#A67C38] shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50">
        {label} <ArrowRight size={15} />
      </Link>
    </aside>
  );
}
