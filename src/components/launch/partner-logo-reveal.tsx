"use client";

/**
 * PartnerLogoReveal — the five ecosystem technologies as small white cards
 * (DOM, so logos stay sharp). In SCENE 3 each card arrives on an arc around the
 * TRACE emblem, one after another, then all glide into their final row (SCENE 4)
 * under the heading. Logos are the brands' own files, unmodified (no rotation,
 * recolouring, shadows or stretching — the depth effect moves the card, never
 * the mark). Without a file, a plain text wordmark is shown.
 */

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { PARTNERS, PARTNER_HEADING, type PartnerLogos } from "@/lib/partners";
import type { Anchor } from "./timeline";

export type PartnerCardsHandle = { cards: () => (HTMLElement | null)[] };

type Props = {
  logos: PartnerLogos;
  /** Measure arc positions now (the emblem's screen position is known). */
  prepare: boolean;
  /** Number of cards revealed so far (0–5). */
  shown: number;
  /** Cards have moved into their final row. */
  settled: boolean;
  heading: boolean;
  still: boolean;
  anchor: React.MutableRefObject<Anchor>;
};

/** Arc around the emblem, left→right in the same order as the final row. */
const ARC_DEG = [198, 152, 90, 28, -18];

export const PartnerLogoReveal = forwardRef<PartnerCardsHandle, Props>(function PartnerLogoReveal({ logos, prepare, shown, settled, heading, still, anchor }, ref) {
  const cards = useRef<(HTMLElement | null)[]>([]);
  const [offsets, setOffsets] = useState<{ x: number; y: number }[] | null>(null);
  const [moving, setMoving] = useState(false); // transforms animate only after the arc is in place
  useImperativeHandle(ref, () => ({ cards: () => cards.current }), []);

  // Measure where each card sits in the final row, and offset it to its arc position.
  useLayoutEffect(() => {
    if (still || settled || offsets || !prepare) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const ax = anchor.current.set ? anchor.current.x : W / 2;
    const ay = anchor.current.set ? anchor.current.y : H * 0.33;
    const rx = Math.min(W * 0.36, 470);
    const ry = Math.min(H * (W < 640 ? 0.15 : 0.2), 170);
    setOffsets(
      cards.current.map((el, i) => {
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        const a = (ARC_DEG[i] * Math.PI) / 180;
        const half = r.width / 2 + 8;
        const tx = Math.min(W - half, Math.max(half, ax + Math.cos(a) * rx));
        const ty = Math.max(r.height / 2 + 64, ay - Math.sin(a) * ry);
        return { x: tx - (r.left + r.width / 2), y: ty - (r.top + r.height / 2) };
      }),
    );
  }, [still, settled, offsets, anchor, prepare]);
  useLayoutEffect(() => {
    if (!offsets || moving) return;
    const id = requestAnimationFrame(() => setMoving(true));
    return () => cancelAnimationFrame(id);
  }, [offsets, moving]);

  return (
    <div className="flex flex-col items-center">
      <p
        className="text-[0.62rem] sm:text-[0.66rem] uppercase tracking-[0.3em] text-ink-600 font-medium"
        style={{ opacity: heading ? 1 : 0, transition: `opacity ${still ? 400 : 700}ms ease` }}
      >
        {PARTNER_HEADING}
      </p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2.5 sm:gap-3 max-w-[340px] sm:max-w-none" aria-label={PARTNER_HEADING}>
        {PARTNERS.map((p, i) => {
          const on = still || i < shown;
          const off = !still && !settled && offsets ? offsets[i] : { x: 0, y: 0 };
          const logo = logos[p.key];
          return (
            <li
              key={p.key}
              ref={(el) => {
                cards.current[i] = el;
              }}
              style={{
                opacity: on ? 1 : 0,
                transform: `translate(${off.x}px, ${off.y}px) scale(${on ? 1 : 0.94})`,
                transition: still ? "opacity 400ms ease" : `opacity 600ms ease${moving ? `, transform ${settled ? 850 : 700}ms cubic-bezier(.2,.7,.2,1)` : ""}`,
                visibility: offsets || still || settled ? "visible" : "hidden",
              }}
            >
              {/* The card lifts on hover; the logo inside is never transformed. */}
              <div className="rounded-md2 border border-line bg-ivory-50 px-3.5 sm:px-4 py-2.5 shadow-soft min-w-[96px] sm:min-w-[118px] flex flex-col items-center justify-center transition duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift">
                <span className="h-[20px] sm:h-[22px] flex items-center">
                  {logo ? (
                    // Official asset, unmodified: fixed height, natural width, never stretched.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt={p.name} className="h-full w-auto max-w-[118px] object-contain" draggable={false} />
                  ) : (
                    <span className="text-[0.92rem] sm:text-[0.98rem] font-semibold tracking-tight text-ink leading-none">{p.name}</span>
                  )}
                </span>
                <span className="mt-1 text-[0.6rem] sm:text-[0.62rem] text-ink-600 whitespace-nowrap">{p.role}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
