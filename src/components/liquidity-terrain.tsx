"use client";

/**
 * Cinematic 3D liquidity landscape (three.js via react-three-fiber), loaded
 * client-side only (see liquidity-view.tsx). Everything drawn comes from the real
 * investigation; nothing is decorative data.
 *
 *   x  time, left → right, in Sepolia blocks across the investigation window (dated)
 *   z  price on Uniswap's tick scale (log price: equal steps are equal % moves),
 *      low at the front, high at the back, in the readable direction (e.g. USDC per WETH)
 *   y  the position's liquidity, log-scaled against the wallet's other positions;
 *      it steps up and down at every real add/remove event
 *
 * Each position is a stepped glass "skyline" over its price range. A segment is
 * gold while the pool's real price was inside the range (earning fees) and grey
 * while it was outside. The glowing line is the pool's real swap price, with the
 * latest price as a beacon. Markers on top are the real events: liquidity added,
 * liquidity removed, fees collected, position closed.
 *
 * Motion: a short camera dolly when the figure first comes into view, then a slow
 * sway until the viewer drags. It renders only while on screen, and not at all
 * (beyond one static frame) for people who prefer reduced motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, Line, OrbitControls } from "@react-three/drei";
import { AdditiveBlending, BoxGeometry, CatmullRomCurve3, Color, DoubleSide, EdgesGeometry, Mesh, PMREMGenerator, Spherical, TubeGeometry, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type TerrainEventKind = "add" | "remove" | "collect" | "close";

export type TerrainEvent = {
  kind: TerrainEventKind;
  block: number;
  tx: string;
  /** One line, already formatted with real decimals ("Added 0.5 WETH + 1,200 USDC"). */
  text: string;
};

/** A stretch of a position's life with constant liquidity and constant in/out-of-range state. */
export type TerrainSegment = { fromBlock: number; toBlock: number; liquidity: number; inRange: boolean | null };

export type TerrainSlab = {
  id: number;
  label: string;
  detail: string;
  tickLower: number;
  tickUpper: number;
  fromBlock: number;
  toBlock: number;
  liquidity: number;
  active: boolean;
  /** Range is unbounded on one or both sides within the view (drawn to the edge). */
  clippedLow: boolean;
  clippedHigh: boolean;
  segments: TerrainSegment[];
  events: TerrainEvent[];
  /** Share of the open time the price was inside the range (0–1), if known. */
  inRangeShare: number | null;
};

export type TerrainAxis = {
  /** Readable price for a tick, in the display direction. */
  toDisplay: (tick: number) => number | null;
  /** Inverse of toDisplay. */
  toTick: (value: number) => number;
  /** +1 when display price rises with tick, −1 when the view is inverted. */
  dir: 1 | -1;
  unit: string;
  fmt: (value: number) => string;
};

export type TerrainData = {
  slabs: TerrainSlab[];
  price: { block: number; tick: number }[];
  window: { fromBlock: number; toBlock: number };
  tickDomain: [number, number];
  priceLabel: (tick: number) => string;
  axis: TerrainAxis;
  /** Short date for a block ("Oct 8"), or null if timestamps are unknown. */
  dateAt: (block: number) => string | null;
};

const W = 10.5; // time axis (x)
const D = 6; // price axis (z)
const H_MIN = 0.12;
const H_MAX = 1.9;

const GOLD = "#B68A42";
const GOLD_HI = "#E9C27A";
const IN = "#D9A84E";
const OUT = "#B9B3A7";
const CLOSED = "#CFC8BB";
const EMERALD = "#278653";
const BRICK = "#B4483A";
const INK = "#171714";

/* ------------------------------------------------------------------ scales */

function useScales(data: TerrainData) {
  return useMemo(() => {
    const { dir } = data.axis;
    const [t0, t1] = data.tickDomain;
    // Display coordinate: dir * tick, so low → high price always runs left → right.
    const a = Math.min(dir * t0, dir * t1);
    const b = Math.max(dir * t0, dir * t1);
    // price → depth: low price at the front (+z), high at the back (−z)
    const p = (tick: number) => D / 2 - ((Math.min(Math.max(dir * tick, a), b) - a) / (b - a || 1)) * D;
    const span = data.window.toBlock - data.window.fromBlock || 1;
    // time → x: start of the window on the left, latest block on the right
    const t = (block: number) => ((Math.min(Math.max(block, data.window.fromBlock), data.window.toBlock) - data.window.fromBlock) / span) * W - W / 2;
    const liqs = data.slabs.flatMap((s) => [s.liquidity, ...s.segments.map((g) => g.liquidity)]).filter((v) => v > 0);
    const max = liqs.length ? Math.max(...liqs) : 1;
    const min = liqs.length ? Math.min(...liqs) : 1;
    // Linear (true proportions, e.g. compounding growth) unless sizes differ by >50×; then log.
    const linear = max / min <= 50;
    const logs = liqs.map((v) => Math.log10(v));
    const lo = logs.length ? Math.min(...logs) - 0.6 : 0;
    const hi = logs.length ? Math.max(...logs) : 1;
    const h = (liq: number) =>
      liq <= 0 ? 0 : linear ? H_MIN + (liq / max) * (H_MAX - H_MIN) : H_MIN + ((Math.log10(liq) - lo) / (hi - lo || 1)) * (H_MAX - H_MIN);
    return { p, t, h, pRange: [a, b] as const };
  }, [data]);
}
type Scales = ReturnType<typeof useScales>;

/* ------------------------------------------------------------- environment */

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

const floorVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const floorFrag = /* glsl */ `
uniform vec2 uSize;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uGold;
varying vec3 vW;
float grid(float v, float step) {
  float f = abs(fract(v / step - 0.5) - 0.5) * step;
  float w = max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(0.0, w * 1.2, f);
}
void main() {
  vec2 p = vW.xz;
  // fine grid + stronger grid every 5 cells
  float g = max(grid(p.x, uSize.x / 12.0), grid(p.y, uSize.y / 6.0)) * 0.35;
  g = max(g, max(grid(p.x, uSize.x / 2.0), grid(p.y, uSize.y / 2.0)) * 0.6);
  // soft topographic rings for the brand landscape feel
  float r = length(p * vec2(0.9, 1.25));
  float topo = (1.0 - smoothstep(0.0, max(fwidth(r), 1e-4) * 1.4, abs(fract(r * 1.2) - 0.5) * 0.833)) * 0.12;
  vec3 col = mix(uBase, uLine, g);
  col = mix(col, uGold, topo);
  // inside the plot: full; outside: fade to transparent ivory
  vec2 q = abs(p) - uSize * 0.5;
  float out_ = length(max(q, 0.0));
  float a = 1.0 - smoothstep(0.0, 2.4, out_);
  float inside = step(max(q.x, q.y), 0.0);
  gl_FragColor = vec4(col, a * mix(0.55, 1.0, inside));
}`;

function Floor() {
  const uniforms = useMemo(
    () => ({ uSize: { value: [W, D] }, uBase: { value: new Color("#F4ECDD") }, uLine: { value: new Color("#DCCFB6") }, uGold: { value: new Color("#D9C08F") } }),
    [],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
      <planeGeometry args={[W + 6, D + 6]} />
      <shaderMaterial vertexShader={floorVert} fragmentShader={floorFrag} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ slabs */

function Segment({ x0, len, z0, depth, h, tone, hovered, closed }: { x0: number; len: number; z0: number; depth: number; h: number; tone: "in" | "out" | "unknown"; hovered: boolean; closed: boolean }) {
  const geo = useMemo(() => new BoxGeometry(len, h, depth), [len, h, depth]);
  const edges = useMemo(() => new EdgesGeometry(geo), [geo]);
  const base = closed ? CLOSED : tone === "in" ? IN : tone === "out" ? OUT : "#D2C4A6";
  const glow = tone === "in" && !closed;
  return (
    <group position={[x0 + len / 2, h / 2, z0 + depth / 2]}>
      <mesh geometry={geo} castShadow>
        <meshPhysicalMaterial
          color={hovered ? GOLD_HI : base}
          emissive={glow ? "#8A5A12" : "#000000"}
          emissiveIntensity={glow ? (hovered ? 0.6 : 0.4) : 0}
          roughness={0.22}
          metalness={0.06}
          clearcoat={1}
          clearcoatRoughness={0.18}
          envMapIntensity={1.1}
          transparent
          opacity={hovered ? 0.85 : closed ? 0.32 : tone === "in" ? 0.7 : 0.45}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={hovered ? INK : glow ? "#9A6E2C" : "#8F887C"} transparent opacity={hovered ? 0.9 : glow ? 0.65 : 0.35} />
      </lineSegments>
    </group>
  );
}

const MARKER: Record<TerrainEventKind, { color: string; label: string }> = {
  add: { color: EMERALD, label: "Liquidity added" },
  remove: { color: BRICK, label: "Liquidity removed" },
  collect: { color: GOLD, label: "Fees collected" },
  close: { color: INK, label: "Position closed" },
};

function EventMarker({ e, pos, still, onHover, active }: { e: TerrainEvent; pos: [number, number, number]; still: boolean; onHover: (k: string | null) => void; active: boolean }) {
  const ref = useRef<Mesh>(null);
  const seed = useMemo(() => (e.block % 997) / 997, [e.block]);
  useFrame(({ clock }) => {
    if (still || !ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = Math.sin(t * 1.6 + seed * 6.28) * 0.035;
    if (e.kind === "collect") ref.current.rotation.y = t * 1.4 + seed * 6.28;
    if (e.kind === "add") ref.current.rotation.y = t * 0.8;
  });
  const m = MARKER[e.kind];
  const key = `${e.tx}:${e.kind}:${e.block}`;
  return (
    <group position={pos}>
      <Line points={[[0, -0.22, 0], [0, -0.04, 0]]} color={m.color} lineWidth={1} transparent opacity={0.6} />
      <mesh
        ref={ref}
        castShadow
        rotation={e.kind === "remove" ? [Math.PI, 0, 0] : e.kind === "collect" ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
        scale={active ? 1.35 : 1}
        onPointerOver={(ev) => {
          ev.stopPropagation();
          onHover(key);
        }}
        onPointerOut={() => onHover(null)}
      >
        {e.kind === "add" && <octahedronGeometry args={[0.1]} />}
        {e.kind === "remove" && <coneGeometry args={[0.09, 0.18, 4]} />}
        {e.kind === "collect" && <cylinderGeometry args={[0.11, 0.11, 0.028, 40]} />}
        {e.kind === "close" && <torusGeometry args={[0.09, 0.022, 10, 28]} />}
        <meshStandardMaterial color={e.kind === "collect" ? "#E2B657" : m.color} metalness={e.kind === "collect" ? 0.75 : 0.3} roughness={e.kind === "collect" ? 0.28 : 0.4} emissive={e.kind === "collect" ? "#C08A2E" : m.color} emissiveIntensity={active ? 0.6 : e.kind === "collect" ? 0.35 : 0.18} />
      </mesh>
      {active && (
        <Html position={[0, 0.28, 0]} center zIndexRange={[50, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md2 border border-line bg-ivory-50 px-3 py-2 shadow-lift text-left">
            <div className="text-[0.78rem] font-semibold" style={{ color: m.color === INK ? "#171714" : m.color }}>{m.label}</div>
            <div className="text-[0.72rem] text-ink">{e.text}</div>
            <div className="text-[0.66rem] text-ink-600 tabular">Block {e.block.toLocaleString("en-US")} · tx {e.tx.slice(0, 8)}…</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Slab({ s, sc, hovered, onHover, onOpen, still, hoverEvent, onHoverEvent, price }: {
  s: TerrainSlab;
  sc: Scales;
  hovered: boolean;
  onHover: (id: number | null) => void;
  onOpen: (id: number) => void;
  still: boolean;
  hoverEvent: string | null;
  onHoverEvent: (k: string | null) => void;
  price: { block: number; tick: number }[];
}) {
  const za = sc.p(s.tickLower);
  const zb = sc.p(s.tickUpper);
  const z0 = Math.min(za, zb);
  const depth = Math.max(Math.abs(zb - za), 0.06);
  const segs = s.segments.length ? s.segments : [{ fromBlock: s.fromBlock, toBlock: s.toBlock, liquidity: s.liquidity, inRange: null }];
  const maxH = Math.max(...segs.map((g) => sc.h(g.liquidity)), 0.12);
  const heightAt = (block: number) => {
    const g = segs.find((q) => block >= q.fromBlock && block < q.toBlock) ?? segs[segs.length - 1];
    return Math.max(sc.h(g.liquidity), 0.12);
  };
  // Events sit on the block's top, over the price where it happened (clamped into the range).
  const priceTickAt = (block: number) => {
    let best: number | null = null;
    for (const p of price) {
      if (p.block <= block) best = p.tick;
      else break;
    }
    return best;
  };
  // Events a few blocks apart (e.g. collect, then re-add) stack upwards instead of overlapping.
  const placed = (() => {
    const out: { e: TerrainEvent; pos: [number, number, number] }[] = [];
    let lastX = -Infinity;
    let level = 0;
    for (const e of s.events) {
      const tk = priceTickAt(e.block);
      const pz = tk == null ? z0 + depth / 2 : Math.min(Math.max(sc.p(tk), z0 + 0.12), z0 + depth - 0.12);
      const px = sc.t(e.block);
      level = Math.abs(px - lastX) < 0.14 ? level + 1 : 0;
      lastX = px;
      out.push({ e, pos: [px, Math.max(heightAt(e.block), heightAt(e.block + 5)) + 0.26 + level * 0.3, pz] });
    }
    return out;
  })();
  return (
    <group
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(s.id);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(s.id);
      }}
    >
      {segs.map((g, i) => {
        const x0 = sc.t(g.fromBlock);
        const len = Math.max(sc.t(g.toBlock) - x0, 0.03);
        const h = sc.h(g.liquidity);
        if (h <= 0) return null;
        return <Segment key={i} x0={x0} len={len} z0={z0} depth={depth} h={h} tone={g.inRange == null ? "unknown" : g.inRange ? "in" : "out"} hovered={hovered} closed={!s.active} />;
      })}
      {placed.map(({ e, pos }) => {
        const key = `${e.tx}:${e.kind}:${e.block}`;
        return <EventMarker key={key} e={e} pos={pos} still={still} onHover={onHoverEvent} active={hoverEvent === key} />;
      })}
      {hovered && hoverEvent == null && (
        <Html position={[sc.t((s.fromBlock + s.toBlock) / 2), maxH + 0.6, z0 + depth / 2]} center zIndexRange={[40, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md2 border border-line bg-ivory-50 px-3 py-2 shadow-lift text-left">
            <div className="text-[0.8rem] font-semibold text-ink">{s.label}</div>
            <div className="text-[0.72rem] text-ink-600">{s.detail}</div>
            {s.inRangeShare != null && <div className="text-[0.72rem] text-ink">In range {Math.round(s.inRangeShare * 100)}% of the time it was open</div>}
            <div className="text-[0.68rem] text-[#8A6528] mt-0.5">Click to open</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------- price path */

function PricePath({ points, still, nowLabel, nowShort }: { points: Vector3[]; still: boolean; nowLabel: string | null; nowShort: string | null }) {
  const { size } = useThree();
  const narrow = size.width < 520;
  const curve = useMemo(() => (points.length > 1 ? new CatmullRomCurve3(points, false, "catmullrom", 0.1) : null), [points]);
  const tube = useMemo(() => (curve ? new TubeGeometry(curve, Math.min(points.length * 4, 900), 0.028, 8, false) : null), [curve, points.length]);
  const glowTube = useMemo(() => (curve ? new TubeGeometry(curve, Math.min(points.length * 4, 900), 0.052, 8, false) : null), [curve, points.length]);
  const pulse = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!curve || still) return;
    const t = (clock.elapsedTime % 7) / 7;
    const p = curve.getPointAt(t);
    pulse.current?.position.copy(p);
    halo.current?.position.copy(p);
    const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.15;
    halo.current?.scale.setScalar(s);
  });
  if (!curve || !tube || !glowTube) return null;
  const last = points[points.length - 1];
  return (
    <group>
      <mesh geometry={glowTube} renderOrder={9}>
        <meshBasicMaterial color={GOLD_HI} transparent opacity={0.1} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={tube} renderOrder={10}>
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.55} metalness={0.7} roughness={0.25} toneMapped={false} />
      </mesh>
      {!still && (
        <>
          <mesh ref={pulse} renderOrder={12}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshBasicMaterial color="#FFF3D6" toneMapped={false} />
          </mesh>
          <mesh ref={halo} renderOrder={11}>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshBasicMaterial color={GOLD_HI} transparent opacity={0.28} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        </>
      )}
      {/* "now": the latest real price, as a beacon */}
      <group position={last}>
        <mesh renderOrder={12}>
          <sphereGeometry args={[0.085, 20, 20]} />
          <meshStandardMaterial color={GOLD} emissive={GOLD_HI} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.45, 0]} renderOrder={8}>
          <cylinderGeometry args={[0.01, 0.045, 0.9, 16, 1, true]} />
          <meshBasicMaterial color={GOLD_HI} transparent opacity={0.28} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
        {nowLabel && (
          <Html position={[-0.12, 0.9, 0]} zIndexRange={[30, 0]}>
            <div className="pointer-events-none whitespace-nowrap rounded-full border border-gold/50 bg-ivory-50/95 px-2.5 py-1 text-[0.68rem] text-ink shadow-soft" style={{ transform: "translate(-100%, -50%)" }}>
              <span className="text-[#8A6528] font-semibold">Now</span> · {narrow ? nowShort : nowLabel}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------- axes */

function niceDisplayTicks(axis: TerrainAxis, range: readonly [number, number]): number[] {
  const tickA = axis.dir * range[0];
  const tickB = axis.dir * range[1];
  const va = axis.toDisplay(tickA);
  const vb = axis.toDisplay(tickB);
  if (va == null || vb == null || !(va > 0) || !(vb > 0)) return [];
  const lo = Math.min(va, vb);
  const hi = Math.max(va, vb);
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++)
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v > lo * 1.04 && v < hi / 1.04) out.push(v);
    }
  while (out.length > 6) {
    const keep = out.filter((_, i) => i % 2 === 0);
    out.splice(0, out.length, ...keep);
  }
  return out;
}

function Axes({ data, sc }: { data: TerrainData; sc: Scales }) {
  const { size } = useThree();
  const narrow = size.width < 520;
  const ticks = useMemo(() => niceDisplayTicks(data.axis, sc.pRange), [data.axis, sc.pRange]);
  const xRight = W / 2 + 0.32;
  const times = [data.window.fromBlock, Math.round((data.window.fromBlock + data.window.toBlock) / 2), data.window.toBlock];
  const lab = "pointer-events-none block whitespace-nowrap text-[0.64rem] text-ink-600 tabular";
  return (
    <group>
      {/* price ticks along the right edge (depth) */}
      {(narrow ? ticks.filter((_, i) => i % 2 === 0) : ticks).map((v) => {
        const z = sc.p(data.axis.toTick(v));
        return (
          <group key={v}>
            <Line points={[[W / 2, 0.002, z], [W / 2 + 0.16, 0.002, z]]} color="#A89A80" lineWidth={1} />
            <Html position={[xRight, 0, z]} zIndexRange={[10, 0]}>
              <span className={lab} style={{ transform: "translate(0, -50%)" }}>{data.axis.fmt(v)}</span>
            </Html>
          </group>
        );
      })}
      <Html position={[xRight + 0.1, 0, -D / 2 - 0.75]} zIndexRange={[10, 0]}>
        <span className="pointer-events-none block whitespace-nowrap text-[0.7rem] font-medium text-ink" style={{ transform: "translate(-30%, -50%)" }}>
          {narrow ? "↑ Price" : `↑ Price (${data.axis.unit})`}
        </span>
      </Html>
      {/* time along the front edge */}
      {times.map((b, i) => {
        if (narrow && i === 2) return null;
        const label = data.dateAt(b) ?? `Block ${b.toLocaleString("en-US")}`;
        const x = sc.t(b);
        return (
          <group key={b}>
            <Line points={[[x, 0.002, D / 2], [x, 0.002, D / 2 + 0.16]]} color="#A89A80" lineWidth={1} />
            <Html position={[x, 0, D / 2 + 0.42]} center zIndexRange={[10, 0]}>
              <span className={lab}>{i === 2 && !narrow ? `${label} · latest` : label}</span>
            </Html>
          </group>
        );
      })}
      {!narrow && (
        <Html position={[0, 0, D / 2 + 0.95]} center zIndexRange={[10, 0]}>
          <span className="pointer-events-none whitespace-nowrap text-[0.7rem] font-medium text-ink">Time →</span>
        </Html>
      )}
    </group>
  );
}

/* ----------------------------------------------------------------- camera */

const TARGET = new Vector3(0.7, 0.45, 1.0);
const SETTLE = new Spherical(14.6, 0.98, 0.22); // radius, polar (from up), azimuth (from front, + = right)
const START = new Spherical(26, 0.66, 0.85);

function Director({ controls, still, interacted, visible }: { controls: React.RefObject<OrbitControlsImpl>; still: boolean; interacted: React.MutableRefObject<boolean>; visible: boolean }) {
  const { camera, size } = useThree();
  const t0 = useRef<number | null>(null);
  const fit = Math.min(Math.max(2.15 / (size.width / size.height), 1), 2.2);
  const sph = useMemo(() => new Spherical(), []);
  const v = useMemo(() => new Vector3(), []);
  useEffect(() => {
    // first placement (also the only one when motion is reduced)
    sph.set(SETTLE.radius * fit, SETTLE.phi, SETTLE.theta);
    if (!still) sph.set(START.radius * fit, START.phi, START.theta);
    camera.position.copy(v.setFromSpherical(sph).add(TARGET));
    camera.lookAt(TARGET);
    controls.current?.update();
  }, [camera, controls, fit, sph, v, still]);
  useFrame(({ clock }) => {
    if (still || interacted.current || !visible) return;
    if (t0.current == null) t0.current = clock.elapsedTime;
    const t = clock.elapsedTime - t0.current;
    const k = Math.min(t / 2.6, 1);
    const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
    const sway = k >= 1 ? Math.sin((t - 2.6) * 0.22) * 0.16 : 0;
    sph.set(
      (START.radius + (SETTLE.radius - START.radius) * e) * fit,
      START.phi + (SETTLE.phi - START.phi) * e,
      START.theta + (SETTLE.theta - START.theta) * e + sway,
    );
    camera.position.copy(v.setFromSpherical(sph).add(TARGET));
    camera.lookAt(TARGET);
    controls.current?.update();
  });
  return null;
}

/* ------------------------------------------------------------------ scene */

export default function LiquidityTerrain({ data, onOpen, height = 420 }: { data: TerrainData; onOpen: (tokenId: number) => void; height?: number }) {
  const sc = useScales(data);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverEvent, setHoverEvent] = useState<string | null>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  const interacted = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const pathPts = useMemo(() => data.price.map((p) => new Vector3(sc.t(p.block), 0.06, sc.p(p.tick))), [data.price, sc]);
  const last = data.price[data.price.length - 1];
  const lastV = last ? data.axis.toDisplay(last.tick) : null;
  const nowLabel = lastV != null ? `${data.axis.fmt(lastV)} ${data.axis.unit}` : null;
  const nowShort = lastV != null ? data.axis.fmt(lastV) : null;

  return (
    <div
      ref={wrap}
      style={{ height, background: "radial-gradient(120% 90% at 50% 0%, #FFFDF8 0%, #F7F1E6 55%, #F1E8D8 100%)" }}
      className="relative w-full rounded-[14px]"
      onPointerLeave={() => {
        setHover(null);
        setHoverEvent(null);
      }}
    >
      <Canvas
        frameloop={still ? "demand" : visible ? "always" : "never"}
        shadows
        dpr={[1, 2]}
        camera={{ position: [START.radius, 8, 14], fov: 30, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        style={{ cursor: hover != null ? "pointer" : coarse ? "default" : "grab", touchAction: coarse ? "pan-y" : "none" }}
      >
        <fog attach="fog" args={["#F4ECDD", 26, 48]} />
        <Studio />
        <ambientLight intensity={0.45} />
        <directionalLight position={[7, 11, 6]} intensity={1.25} color="#FFF4E0" castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-8, 5, -6]} intensity={0.35} color="#E8E2FF" />
        <Floor />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.32} scale={16} blur={2.6} far={3} resolution={512} color="#5A4A2E" frames={still ? 1 : Infinity} />
        {data.slabs.map((s) => (
          <Slab key={s.id} s={s} sc={sc} hovered={hover === s.id} onHover={setHover} onOpen={onOpen} still={still} hoverEvent={hoverEvent} onHoverEvent={setHoverEvent} price={data.price} />
        ))}
        <PricePath points={pathPts} still={still} nowLabel={nowLabel} nowShort={nowShort} />
        <Axes data={data} sc={sc} />
        <Director controls={controls} still={still} interacted={interacted} visible={visible} />
        <OrbitControls
          ref={controls}
          makeDefault
          target={TARGET}
          enablePan={false}
          enableZoom={false}
          enableRotate={!coarse}
          enableDamping
          dampingFactor={0.1}
          minPolarAngle={0.45}
          maxPolarAngle={1.3}
          onStart={() => {
            interacted.current = true;
          }}
        />
      </Canvas>
    </div>
  );
}
