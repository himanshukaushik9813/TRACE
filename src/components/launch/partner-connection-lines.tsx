"use client";

/**
 * PartnerConnectionLines — thin champagne-gold lines from the TRACE emblem to each
 * ecosystem card while it is revealed (SCENE 3). DOM SVG above the canvas; endpoints
 * follow the emblem's projected position and each card's live position every frame.
 */

import { useEffect, useRef } from "react";
import { PARTNERS } from "@/lib/partners";
import type { Anchor } from "./timeline";
import type { PartnerCardsHandle } from "./partner-logo-reveal";

export function PartnerConnectionLines({ anchor, cards, shown, visible }: { anchor: React.MutableRefObject<Anchor>; cards: React.RefObject<PartnerCardsHandle>; shown: number; visible: boolean }) {
  const lines = useRef<(SVGLineElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const els = cards.current?.cards() ?? [];
      const ax = anchor.current.set ? anchor.current.x : window.innerWidth / 2;
      const ay = anchor.current.set ? anchor.current.y : window.innerHeight * 0.33;
      els.forEach((el, i) => {
        const l = lines.current[i];
        if (!el || !l) return;
        const r = el.getBoundingClientRect();
        l.setAttribute("x1", String(ax));
        l.setAttribute("y1", String(ay));
        l.setAttribute("x2", String(r.left + r.width / 2));
        l.setAttribute("y2", String(r.top + r.height / 2));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor, cards]);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden style={{ opacity: visible ? 1 : 0, transition: "opacity 600ms ease" }}>
      {PARTNERS.map((p, i) => (
        <line
          key={p.key}
          ref={(el) => {
            lines.current[i] = el;
          }}
          stroke="#C6A66B"
          strokeWidth={1}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={i < shown ? 0 : 1}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.7,.2,1)", opacity: 0.85 }}
        />
      ))}
    </svg>
  );
}
