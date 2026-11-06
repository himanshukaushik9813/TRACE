/**
 * One timeline for the 3D scene and the DOM layers (seconds from the first frame).
 *
 *   SCENE 1  0.0–1.5  landscape fades in, contours drift, camera glides, a gold path draws
 *   SCENE 2  1.5–2.5  platform forms, the TRACE emblem rises; TRACE logo + name appear
 *   SCENE 3  2.5–5.0  five ecosystem cards arrive one by one, each linked to the emblem,
 *                     then glide into their final row
 *   SCENE 4  5.0–6.0  identity: category, tagline, "Built with ecosystem technologies"
 *   SCENE 5  6.0–7.0  gold light sweep; terrain and cards dissolve, emblem recedes,
 *                     crossfade with a slight zoom into the real dashboard
 */

export const T = {
  landscapeIn: [0, 1.1],
  pathDraw: [0.3, 1.7],
  platform: [1.5, 2.2],
  emblemRise: [1.7, 2.5],
  brand: 2.0,
  partnerFirst: 2.6,
  partnerStep: 0.36,
  partnersSettle: 4.55,
  identity: 5.0,
  exit: 6.0,
  gone: 7.0,
} as const;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0→1 between a and b with a smootherstep ease. */
export function ramp(t: number, a: number, b: number) {
  const x = clamp01((t - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Screen-space point the connection lines aim at (the emblem), shared without re-renders. */
export type Anchor = { x: number; y: number; set: boolean };

/** DOM flags at time t (used by the ?introAt=<s> QA freeze). */
export function flagsAt(t: number) {
  let shown = 0;
  for (let i = 0; i < 5; i++) if (t >= T.partnerFirst + i * T.partnerStep) shown = i + 1;
  return {
    land: t >= 0,
    emblem: t >= T.platform[0],
    brand: t >= T.brand,
    prepare: t >= T.brand,
    shown,
    settled: t >= T.partnersSettle,
    identity: t >= T.identity,
  };
}

/** ?introAt=<seconds>: freeze the intro at that moment (design QA). */
export function frozenAt(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get("introAt");
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, T.exit - 0.01) : null;
  } catch {
    return null;
  }
}
