"use client";

/**
 * DashboardTransition — the overlay shell between the intro and the REAL app.
 * The app renders underneath the whole time (its data loads immediately). On
 * exit: a gold light sweep, then a crossfade with a slight zoom (overlay scales
 * up and fades while the app settles from 98.5% to 100%). While the intro is up
 * the app is inert; Esc or "Skip intro" leaves at once. Reduced motion: opacity only.
 */

import { useEffect, useRef, type ReactNode } from "react";

export type Phase = "playing" | "leaving" | "gone";

export function DashboardTransition({
  phase,
  fast,
  still,
  sweep,
  dialog,
  onSkip,
  children,
}: {
  phase: Phase;
  fast: boolean;
  still: boolean;
  /** Play the gold light sweep (a normal exit, not a skip). */
  sweep: boolean;
  /** Full intro: a labelled dialog with a Skip button. Short transition: decorative. */
  dialog: boolean;
  onSkip: () => void;
  children: ReactNode;
}) {
  const skipRef = useRef<HTMLButtonElement>(null);

  // Page state for the app underneath: zoom (CSS) and inert while playing.
  useEffect(() => {
    const html = document.documentElement;
    const app = document.getElementById("trace-app");
    if (phase === "playing") {
      html.setAttribute("data-intro-state", "playing");
      app?.setAttribute("inert", "");
    } else if (phase === "leaving") {
      html.setAttribute("data-intro-state", "leaving");
      app?.removeAttribute("inert");
    }
    return () => {
      html.removeAttribute("data-intro-state");
      app?.removeAttribute("inert");
    };
  }, [phase]);

  // Keyboard: focus Skip, Esc skips, focus returns afterwards.
  useEffect(() => {
    if (!dialog || phase !== "playing") return;
    const prev = document.activeElement as HTMLElement | null;
    skipRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prev && prev !== document.body) prev.focus?.({ preventScroll: true });
    };
  }, [dialog, phase, onSkip]);

  const leaving = phase === "leaving";
  return (
    <div
      role={dialog ? "dialog" : undefined}
      aria-modal={dialog ? true : undefined}
      aria-label={dialog ? "TRACE introduction" : undefined}
      aria-hidden={dialog ? undefined : true}
      className="fixed inset-0 z-[100] overflow-hidden bg-ivory"
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving && !still ? "scale(1.04)" : "scale(1)",
        transition: `opacity ${fast ? 380 : 850}ms cubic-bezier(.2,.7,.2,1) ${leaving && sweep ? 200 : 0}ms, transform ${fast ? 380 : 1000}ms cubic-bezier(.2,.7,.2,1)`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      {children}
      {sweep && !still && leaving && <div className="intro-light-sweep absolute inset-0 pointer-events-none" aria-hidden />}
      {dialog && (
        <button
          ref={skipRef}
          type="button"
          onClick={onSkip}
          aria-keyshortcuts="Escape"
          className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 inline-flex items-center gap-2 rounded-full border border-line bg-ivory-50/90 px-4 h-10 text-[0.82rem] font-medium text-ink shadow-soft hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          Skip intro <span className="text-ink-600 text-[0.72rem] hidden sm:inline">Esc</span>
        </button>
      )}
    </div>
  );
}
