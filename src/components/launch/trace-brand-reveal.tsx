"use client";

/**
 * TraceBrandReveal — the TRACE identity, in DOM text (sharp, readable by screen
 * readers, available without animation). SCENE 2 shows the mark and name;
 * SCENE 4 adds the category and tagline. TRACE stays the largest element.
 */

import { BrandMark } from "@/components/brand-mark";

export const CATEGORY = "On-chain Strategy Intelligence";
export const TAGLINE = "Understand. Reconstruct. Validate. Execute.";

export function TraceBrandReveal({ brand, identity, still, sweep }: { brand: boolean; identity: boolean; still: boolean; sweep: boolean }) {
  const fade = (on: boolean, delay = 0) => ({
    opacity: on ? 1 : 0,
    transform: still || on ? "none" : "translateY(10px)",
    transition: `opacity ${still ? 400 : 800}ms ease ${delay}ms, transform 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
  });
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center gap-3" style={fade(brand)}>
        <BrandMark size={44} />
        <h1 className={`wordmark leading-none tracking-[0.16em] text-ink text-[2.5rem] sm:text-[3.3rem] ${sweep && brand && !still ? "intro-sweep" : ""}`}>TRACE</h1>
      </div>
      <p className="mt-2.5 text-[0.7rem] sm:text-[0.76rem] uppercase tracking-[0.28em] text-[#8A6528] font-medium" style={fade(identity)}>
        {CATEGORY}
      </p>
      <p className="mt-2 text-[0.86rem] sm:text-[1rem] text-[#5F5B53] font-medium max-w-[36ch]" style={fade(identity, 150)}>
        {TAGLINE}
      </p>
    </div>
  );
}
