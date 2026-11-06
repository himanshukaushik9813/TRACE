"use client";

/**
 * <Term k="liquidity">liquidity</Term>: a word with a plain-language explanation.
 * Works with a mouse (hover), keyboard (focus) and touch (tap toggles). The
 * popover is fixed-positioned and clamped to the viewport so it never overflows
 * on mobile. Escape or tapping elsewhere closes it.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

export function Term({ k, children, className = "" }: { k: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const entry = GLOSSARY[k];
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = r.bottom + 140 > window.innerHeight && r.top > 160;
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above });
  }, []);

  const show = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent || e instanceof TouchEvent) if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        className={`term inline cursor-help border-b border-dotted border-gold/70 text-inherit leading-[inherit] hover:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 rounded-[2px] ${className}`}
      >
        {children ?? entry.term.toLowerCase()}
      </button>
      {open && pos && (
        <span
          id={id}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: Math.min(280, typeof window !== "undefined" ? window.innerWidth - 24 : 280), transform: pos.above ? "translateY(-100%)" : undefined }}
          className="fixed z-[80] rounded-md2 border border-line bg-ivory-50 px-3.5 py-2.5 text-left shadow-lift pointer-events-none animate-fadeUp"
        >
          <span className="block text-[0.78rem] font-semibold text-ink">{entry.term}</span>
          <span className="block mt-0.5 text-[0.76rem] leading-relaxed text-ink-600 font-normal normal-case tracking-normal">{entry.text}</span>
        </span>
      )}
    </>
  );
}
