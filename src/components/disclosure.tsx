/**
 * Progressive disclosure: technical detail stays one click away instead of on
 * the surface. A styled <details>, so it works without JavaScript and is
 * keyboard/screen-reader accessible by default.
 */

import { ChevronRight } from "lucide-react";

export function Disclosure({
  title = "Technical details",
  hint,
  children,
  defaultOpen = false,
  className = "",
  id,
}: {
  title?: React.ReactNode;
  /** One short line shown next to the title (what is inside). */
  hint?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <details id={id} open={defaultOpen} className={`group rounded-md2 border border-line bg-ivory-50 ${className}`}>
      <summary className="flex items-center gap-2 px-4 py-3 text-[0.84rem] font-medium text-ink select-none hover:bg-ivory/60 rounded-md2 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
        <ChevronRight size={15} className="text-gold shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <span>{title}</span>
        {hint && <span className="ml-1 text-[0.74rem] font-normal text-ink-600 truncate">{hint}</span>}
      </summary>
      <div className="px-4 pb-4 pt-1 min-w-0">{children}</div>
    </details>
  );
}
