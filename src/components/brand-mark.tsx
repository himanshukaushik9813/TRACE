"use client";

import { useId } from "react";
import { starPath } from "@/components/engine-mark";

/**
 * The TRACE mark: a gold four-point star on an ivory tile. Shared by the app
 * shell and the launch intro so there is exactly one logo.
 */
export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  // The mark can render several times (sidebar, mobile drawer, intro). A fixed
  // gradient id made url(#…) resolve to a hidden copy, so each instance gets its own.
  const grad = `mark-g-${useId().replace(/:/g, "")}`;
  return (
    <span className={`grid place-items-center rounded-md2 border border-gold/35 bg-ivory-50 shadow-soft shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} aria-hidden>
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#D8B46C" />
            <stop offset="1" stopColor="#A87C37" />
          </linearGradient>
        </defs>
        <path d={starPath(12, 12, 10)} fill={`url(#${grad})`} />
      </svg>
    </span>
  );
}
