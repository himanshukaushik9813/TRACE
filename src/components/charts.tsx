"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Measure the rendered width so the SVG draws at 1:1 — no letterboxing, crisp text at any size. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Hand-built SVG financial charts. The editorial, restrained gold/sage style
 * is intentionally chosen over a generic colourful trading UI, per the design
 * spec. Live data is always rendered here (or in HTML), never as a generated
 * image.
 */

/** Significant-digit label (testnet prices can be tiny, e.g. 0.0000377). */
export function sig(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toPrecision(3);
}

function linePath(
  data: number[],
  xFor: (i: number, n: number) => number,
  yFor: (v: number) => number
) {
  const n = data.length;
  return Array.from({ length: n }, (_, k) => {
    const x = xFor(k, n);
    const y = yFor(data[k]);
    return `${k === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

/** A single or multi-series line chart. Pure SVG, responsive via viewBox. */
export function LineChart({
  series,
  labels = [],
  height = 240,
  onDark = false,
  showArea = true,
  legend = true,
  yFmt = sig,
}: {
  series: { name: string; data: number[]; color: string; area?: boolean; dashed?: boolean; width?: number }[];
  labels?: string[];
  height?: number;
  onDark?: boolean;
  showArea?: boolean;
  legend?: boolean;
  yFmt?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const [box, W] = useWidth();
  const H = height;
  const padT = 14;
  const padB = labels.length ? 26 : 10;
  const all = series.flatMap((s) => s.data);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  // Left margin sized to the widest y-axis label (testnet prices like 0.0000593 are long).
  const padL = Math.max(40, Math.max(...[0, 0.25, 0.5, 0.75, 1].map((g) => yFmt(min + g * range).length)) * 6.4 + 14);
  const plotW = W - padL - 10;
  const plotH = H - padT - padB;
  const xFor = (i: number, n: number) => padL + (i / (n - 1)) * plotW;
  const yFor = (v: number) => padT + (1 - (v - min) / range) * plotH;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => min + g * range);
  const gridColor = onDark ? "rgba(243,235,221,0.08)" : "rgba(23,23,20,0.06)";
  const axisColor = onDark ? "rgba(183,176,162,0.55)" : "#77736A";
  const n0 = series[0]?.data.length ?? 0;

  return (
    <div className="w-full" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={series.map((x) => x.name).join(", ")}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`g-${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={onDark ? 0.34 : 0.16} />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {grid.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 10} y1={yFor(v)} y2={yFor(v)} stroke={gridColor} />
            <text x={padL - 8} y={yFor(v) + 3} textAnchor="end" fontSize="10" fill={axisColor} className="tabular">
              {yFmt(v)}
            </text>
          </g>
        ))}

        {labels.length > 1 &&
          [0, Math.floor(labels.length / 2), labels.length - 1].map((idx, k) => (
            <text key={idx} x={xFor(idx, n0)} y={H - 8} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} fontSize="10" fill={axisColor}>
              {labels[idx]}
            </text>
          ))}

        {series.map((s, i) => {
          const n = s.data.length;
          const line = linePath(s.data, xFor, yFor);
          const areaPath = `${line} L ${xFor(n - 1, n)} ${yFor(min)} L ${xFor(0, n)} ${yFor(min)} Z`;
          return (
            <g key={i}>
              {(s.area ?? showArea) && <path d={areaPath} fill={`url(#g-${id}-${i})`} />}
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? (s.dashed ? 1.6 : 2.2)}
                strokeDasharray={s.dashed ? "5 5" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>

      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-[0.72rem]" style={{ color: axisColor }}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny sparkline used on position cards. */
export function Sparkline({
  data,
  color = "#B68A42",
  w = 120,
  h = 34,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={w} cy={h - ((data[data.length - 1] - min) / range) * h} r={2.2} fill={color} />
    </svg>
  );
}

/**
 * Liquidity range occupancy: a price path with the LP's [lower, upper] band
 * shaded, in-range vs out-of-range periods tinted, and lifecycle event
 * markers. Rendered on a light card.
 */
export function RangeBand({
  price,
  lo,
  hi,
  events = [],
  height = 260,
}: {
  price: number[];
  lo: number;
  hi: number;
  events?: { i: number }[];
  height?: number;
}) {
  const [box, W] = useWidth();
  const H = height;
  const padT = 16,
    padB = 26;
  const min = Math.min(lo, ...price) * 0.985;
  const max = Math.max(hi, ...price) * 1.015;
  const range = max - min || 1;
  const padL = Math.max(40, Math.max(sig(min).length, sig(max).length, sig(min + range / 2).length) * 6.4 + 14);
  const plotW = W - padL - 12;
  const plotH = H - padT - padB;
  const x = (i: number, n: number) => padL + (i / (n - 1)) * plotW;
  const y = (v: number) => padT + (1 - (v - min) / range) * plotH;
  const n = price.length;
  const path = linePath(price, x, y);

  const inRange = price.map((v) => v >= lo && v <= hi);

  return (
    <div className="w-full" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Price against the position's range">
        <defs>
          <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#78866B" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#78866B" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((g, i) => {
          const v = min + g * range;
          return (
            <g key={i}>
              <line x1={padL} x2={W - 12} y1={y(v)} y2={y(v)} stroke="rgba(23,23,20,0.06)" />
              <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#77736A" className="tabular">
                {sig(v)}
              </text>
            </g>
          );
        })}

        <rect x={padL} y={y(hi)} width={plotW} height={Math.max(0, y(lo) - y(hi))} fill="url(#band)" />
        <line x1={padL} x2={W - 12} y1={y(hi)} y2={y(hi)} stroke="rgba(120,134,107,0.6)" strokeDasharray="4 4" />
        <line x1={padL} x2={W - 12} y1={y(lo)} y2={y(lo)} stroke="rgba(120,134,107,0.6)" strokeDasharray="4 4" />
        <text x={W - 12} y={y(hi) - 5} textAnchor="end" fontSize="9" fill="#5E6B52" className="tabular">
          upper {sig(hi)}
        </text>
        <text x={W - 12} y={y(lo) + 12} textAnchor="end" fontSize="9" fill="#5E6B52" className="tabular">
          lower {sig(lo)}
        </text>

        {Array.from({ length: n - 1 }, (_, k) => {
          if (!(inRange[k] && inRange[k + 1])) return null;
          const x0 = x(k, n),
            x1 = x(k + 1, n);
          const seg = `M ${x0},${H - padB} L ${x0},${y(price[k])} L ${x1},${y(price[k + 1])} L ${x1},${H - padB} Z`;
          return <path key={k} d={seg} fill="rgba(39,134,83,0.12)" />;
        })}

        <path d={path} fill="none" stroke="#B68A42" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {events.map((e, i) => (
          <g key={i}>
            <line x1={x(e.i, n)} x2={x(e.i, n)} y1={padT} y2={H - padB} stroke="rgba(182,138,66,0.35)" strokeDasharray="2 3" />
            <circle cx={x(e.i, n)} cy={y(price[e.i])} r={3} fill="#B68A42" stroke="#FFFFFF" strokeWidth={1.2} />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 mt-2 text-[0.7rem] text-ink-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: "rgba(120,134,107,0.4)" }} /> In-range band
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: "rgba(39,134,83,0.3)" }} /> In-range period
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3" style={{ background: "#B68A42" }} /> Price
        </span>
      </div>
    </div>
  );
}

/** Drawdown chart (negative area over a base of 100%). */
export function Drawdown({ data, height = 120 }: { data: number[]; height?: number }) {
  return (
    <LineChart
      height={height}
      legend={false}
      showArea
      yFmt={(v) => v.toFixed(0) + "%"}
      series={[{ name: "Drawdown", data: data.map((v) => v * 100), color: "#9A4B3A", area: true }]}
    />
  );
}
