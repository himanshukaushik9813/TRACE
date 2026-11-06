"use client";

/**
 * 2D fallback for the 3D scene (no WebGL, a scene error, or a slow start):
 * SVG contour landscape with a gold path, a layered platform and the TRACE star,
 * on the same timeline. Reports the star's centre as the anchor for the lines.
 */

import { useLayoutEffect, useRef } from "react";
import { starPath } from "@/components/engine-mark";
import type { Anchor } from "./timeline";

export function CssLandscape({ stage, anchor }: { stage: { land: boolean; emblem: boolean; out: boolean }; anchor: React.MutableRefObject<Anchor> }) {
  const star = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = star.current?.getBoundingClientRect();
      if (!r) return;
      anchor.current.x = r.left + r.width / 2;
      anchor.current.y = r.top + r.height / 2;
      anchor.current.set = true;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);

  const lines = Array.from({ length: 22 }, (_, i) => {
    const y = 300 + i * 26;
    const a = 18 + (i % 5) * 6;
    const ph = i * 0.7;
    let d = `M -40 ${y}`;
    for (let x = -40; x <= 1480; x += 40) d += ` L ${x} ${(y + Math.sin(x / 170 + ph) * a + Math.cos(x / 97 - ph) * a * 0.35).toFixed(1)}`;
    return { d, gold: i % 5 === 2 };
  });
  return (
    <div className="absolute inset-0" aria-hidden style={{ opacity: stage.land && !stage.out ? 1 : 0, transition: "opacity 900ms ease" }}>
      <svg className="absolute inset-x-0 bottom-0 w-full h-[78%] intro-drift" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        {lines.map((l, i) => (
          <path key={i} d={l.d} fill="none" stroke={l.gold ? "#C6A66B" : "#E2D7C4"} strokeWidth={l.gold ? 1.4 : 1} opacity={0.35 + (i / lines.length) * 0.65} />
        ))}
        <path d="M -40 860 C 260 760, 420 700, 610 640 S 820 560, 720 470" fill="none" stroke="#B68A42" strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={stage.land ? 0 : 1} style={{ transition: "stroke-dashoffset 1400ms cubic-bezier(.3,.6,.2,1) 300ms" }} />
      </svg>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 34%, rgba(247,243,235,0) 0%, rgba(247,243,235,0.55) 55%, #F7F3EB 88%)" }} />
      <div className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 w-[min(56vw,300px)] aspect-square">
        {[1, 0.78, 0.56].map((s, i) => (
          <div
            key={i}
            className="absolute left-1/2 bottom-[14%] rounded-[50%] border border-[#E9E2D6]"
            style={{
              width: `${s * 100}%`,
              height: `${s * 22}%`,
              marginBottom: `${i * 3.2}%`,
              background: i === 2 ? "#FFFFFF" : i === 1 ? "#F7F3EB" : "#F3EBDD",
              boxShadow: "0 10px 30px -18px rgba(80,62,30,0.35), inset 0 -1px 0 rgba(198,166,107,0.6)",
              opacity: stage.emblem ? 1 : 0,
              transform: `translateX(-50%) scale(${stage.emblem ? 1 : 0.9})`,
              transition: `opacity 700ms ease ${i * 140}ms, transform 700ms ease ${i * 140}ms`,
            }}
          />
        ))}
        <svg
          ref={star}
          viewBox="0 0 24 24"
          className="absolute left-1/2 top-[10%] w-[38%] intro-float"
          style={{ opacity: stage.emblem ? 1 : 0, filter: "drop-shadow(0 18px 18px rgba(90,74,46,0.25))", transform: `translateX(-50%) translateY(${stage.emblem ? 0 : 30}px)`, transition: "opacity 900ms ease, transform 900ms cubic-bezier(.2,.7,.2,1)" }}
        >
          <defs>
            <linearGradient id="intro-star" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E6C98C" />
              <stop offset="0.5" stopColor="#C49A52" />
              <stop offset="1" stopColor="#9C7231" />
            </linearGradient>
          </defs>
          <path d={starPath(12, 12, 10)} fill="url(#intro-star)" />
        </svg>
      </div>
    </div>
  );
}
