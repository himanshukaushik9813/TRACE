/**
 * The TRACE Execution Engine: a compact ivory-and-gold isometric stack drawn
 * as plain SVG (no WebGL, no image). It is decorative, but its one moving
 * part carries meaning: the gold seams glow only while an investigation is
 * running, and stay lit once a case is complete.
 */

type Pt = [number, number];

const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + q[0] * k, p[1] + q[1] * k];
const sub = (p: Pt, q: Pt): Pt => [p[0] - q[0], p[1] - q[1]];
const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** Rounded rhombus (the top face of an isometric slab) plus its visible side band. */
function slab(cx: number, cy: number, a: number, t: number, k = 0.16) {
  const b = a * 0.5;
  const P: Pt[] = [
    [cx, cy - b], // top
    [cx + a, cy], // right
    [cx, cy + b], // bottom
    [cx - a, cy], // left
  ];
  const n = P.length;
  const into = (i: number) => add(P[i], sub(P[(i - 1 + n) % n], P[i]), k);
  const out = (i: number) => add(P[i], sub(P[(i + 1) % n], P[i]), k);
  const mid = (i: number): Pt => {
    const a0 = into(i), c = P[i], a1 = out(i);
    return [0.25 * a0[0] + 0.5 * c[0] + 0.25 * a1[0], 0.25 * a0[1] + 0.5 * c[1] + 0.25 * a1[1]];
  };

  const top = `M ${f(out(0))} L ${f(into(1))} Q ${f(P[1])} ${f(out(1))} L ${f(into(2))} Q ${f(P[2])} ${f(out(2))} L ${f(into(3))} Q ${f(P[3])} ${f(out(3))} L ${f(into(0))} Q ${f(P[0])} ${f(out(0))} Z`;

  const d: Pt = [0, t];
  // Lower outline, left → bottom → right, then the same chain shifted down by the slab thickness.
  const side = [
    `M ${f(mid(3))}`,
    `L ${f(into(3))}`,
    `L ${f(out(2))}`,
    `Q ${f(P[2])} ${f(into(2))}`,
    `L ${f(out(1))}`,
    `L ${f(mid(1))}`,
    `L ${f(add(mid(1), d))}`,
    `L ${f(add(out(1), d))}`,
    `L ${f(add(into(2), d))}`,
    `Q ${f(add(P[2], d))} ${f(add(out(2), d))}`,
    `L ${f(add(into(3), d))}`,
    `L ${f(add(mid(3), d))}`,
    "Z",
  ].join(" ");

  // The seam: just the lower front edge of the top face, where the glow sits.
  const seam = `M ${f(mid(3))} L ${f(into(3))} L ${f(out(2))} Q ${f(P[2])} ${f(into(2))} L ${f(out(1))} L ${f(mid(1))}`;
  return { top, side, seam, b };
}

/** Four-point star used as the TRACE mark. */
export function starPath(cx: number, cy: number, r: number, waist = 0.2) {
  const w = r * waist;
  return `M ${cx} ${cy - r} Q ${cx + w} ${cy - w} ${cx + r} ${cy} Q ${cx + w} ${cy + w} ${cx} ${cy + r} Q ${cx - w} ${cy + w} ${cx - r} ${cy} Q ${cx - w} ${cy - w} ${cx} ${cy - r} Z`;
}

export type EngineState = "idle" | "working" | "ready";

export function EngineMark({ state = "idle", className = "" }: { state?: EngineState; className?: string }) {
  const cx = 180;
  const base = slab(cx, 196, 132, 18);
  const mid = slab(cx, 168, 116, 16);
  const top = slab(cx, 138, 100, 20);
  const lit = state !== "idle";
  const label = state === "working" ? "TRACE execution engine, working" : state === "ready" ? "TRACE execution engine, case complete" : "TRACE execution engine";

  return (
    <svg viewBox="0 0 360 300" className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id="em-side" x1={cx - 132} x2={cx + 132} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EFDDB6" />
          <stop offset="0.49" stopColor="#D8B97C" />
          <stop offset="0.5" stopColor="#C29A55" />
          <stop offset="1" stopColor="#A37936" />
        </linearGradient>
        <linearGradient id="em-side-ivory" x1={cx - 116} x2={cx + 116} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FBF7EF" />
          <stop offset="0.49" stopColor="#EFE6D4" />
          <stop offset="0.5" stopColor="#E3D5B9" />
          <stop offset="1" stopColor="#D2BF98" />
        </linearGradient>
        <linearGradient id="em-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F3EBDD" />
        </linearGradient>
        <linearGradient id="em-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E2C27E" />
          <stop offset="1" stopColor="#A87C37" />
        </linearGradient>
        <radialGradient id="em-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#C6A66B" stopOpacity="0.28" />
          <stop offset="1" stopColor="#C6A66B" stopOpacity="0" />
        </radialGradient>
        <filter id="em-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* Faint orbit rings and a soft floor glow — the only atmosphere. */}
      <ellipse cx={cx} cy="214" rx="172" ry="70" fill="none" stroke="#C6A66B" strokeOpacity="0.16" />
      <ellipse cx={cx} cy="214" rx="140" ry="54" fill="none" stroke="#C6A66B" strokeOpacity="0.12" />
      <ellipse cx={cx} cy="236" rx="150" ry="36" fill="url(#em-floor)" />

      <path d={base.side} fill="url(#em-side)" />
      <path d={base.top} fill="url(#em-top)" stroke="#E9DCC2" strokeWidth="0.8" />

      <path d={mid.side} fill="url(#em-side-ivory)" />
      <path d={mid.seam} transform="translate(0 16)" fill="none" stroke="#D9A94E" strokeWidth="5" filter="url(#em-blur)" className={state === "working" ? "engine-live" : ""} opacity={lit ? 0.9 : 0.25} />
      <path d={mid.top} fill="url(#em-top)" stroke="#E9DCC2" strokeWidth="0.8" />

      <path d={top.side} fill="url(#em-side)" />
      <path d={top.seam} transform="translate(0 20)" fill="none" stroke="#E5B45A" strokeWidth="6" filter="url(#em-blur)" className={state === "working" ? "engine-live" : ""} opacity={lit ? 1 : 0.3} />
      <path d={top.seam} transform="translate(0 20)" fill="none" stroke="#F4D592" strokeWidth="1" opacity={lit ? 0.9 : 0.4} />
      <path d={top.top} fill="url(#em-top)" stroke="#FFFFFF" strokeWidth="1.2" />

      <path d={starPath(cx, 112, 15)} fill="url(#em-star)" />
      <text x={cx} y="146" textAnchor="middle" fontFamily="var(--font-serif), Georgia, serif" fontSize="20" fontWeight="600" fill="#171714" letterSpacing="0.5">
        TRACE
      </text>
      <text x={cx} y="160" textAnchor="middle" fontFamily="var(--font-sans), Inter, sans-serif" fontSize="8.5" fill="#77736A">
        Execution Engine
      </text>
    </svg>
  );
}
