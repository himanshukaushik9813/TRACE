"use client";

/**
 * 3D liquidity terrain (three.js via react-three-fiber). Loaded client-side only
 * (see liquidity-view.tsx). Everything drawn comes from the real investigation:
 *
 *   x  price, on Uniswap's tick scale (ticks are log-price, so equal steps are
 *      equal % moves); the view spans the real price path and bounded ranges
 *   z  time, in Sepolia blocks across the investigation window
 *   y  the position's liquidity on a log scale, relative to the wallet's others
 *
 * Each position is a slab covering its price range for the blocks it was open.
 * The gold line is the pool's real swap price over the same blocks. Rendering is
 * on demand (frameloop "demand"): nothing is drawn unless the view changes.
 */

import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { BoxGeometry } from "three";

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
};

export type TerrainData = {
  slabs: TerrainSlab[];
  price: { block: number; tick: number }[];
  window: { fromBlock: number; toBlock: number };
  tickDomain: [number, number];
  priceLabel: (tick: number) => string;
};

const W = 10; // scene width (price axis)
const D = 7; // scene depth (time axis)
const H_MAX = 1.5;

const GOLD = "#B68A42";
const GOLD_SOFT = "#D9C08F";
const MUTED = "#C9C1B2";
const INK = "#171714";

function useScales(data: TerrainData) {
  return useMemo(() => {
    const [t0, t1] = data.tickDomain;
    const x = (tick: number) => ((Math.min(Math.max(tick, t0), t1) - t0) / (t1 - t0 || 1)) * W - W / 2;
    const span = data.window.toBlock - data.window.fromBlock || 1;
    const z = (block: number) => ((Math.min(Math.max(block, data.window.fromBlock), data.window.toBlock) - data.window.fromBlock) / span) * D - D / 2;
    const logs = data.slabs.filter((s) => s.liquidity > 0).map((s) => Math.log10(s.liquidity));
    // One position (or all equal): a calm mid height rather than a full-height wall.
    const lo = logs.length ? Math.min(...logs) - 1 : 0;
    const hi = logs.length ? Math.max(...logs) + (logs.length === 1 ? 1 : 0) : 1;
    const h = (liq: number) => (liq > 0 ? 0.4 + ((Math.log10(liq) - lo) / (hi - lo || 1)) * (H_MAX - 0.4) : 0.08);
    return { x, z, h };
  }, [data]);
}

function Slab({ s, sc, hovered, onHover, onOpen }: { s: TerrainSlab; sc: ReturnType<typeof useScales>; hovered: boolean; onHover: (id: number | null) => void; onOpen: (id: number) => void }) {
  const x0 = sc.x(s.tickLower);
  const x1 = sc.x(s.tickUpper);
  const z0 = sc.z(s.fromBlock);
  const z1 = sc.z(s.toBlock);
  const w = Math.max(x1 - x0, 0.06);
  const d = Math.max(z1 - z0, 0.06);
  const h = sc.h(s.liquidity);
  const color = hovered ? GOLD : s.active ? GOLD_SOFT : MUTED;
  const geo = useMemo(() => new BoxGeometry(w, h, d), [w, h, d]);
  return (
    <group position={[x0 + w / 2, h / 2, z0 + d / 2]}>
      <mesh
        castShadow
        geometry={geo}
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
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} transparent depthWrite={false} opacity={hovered ? 0.7 : s.active ? 0.5 : 0.32} />
      </mesh>
      {/* crisp top edge so overlapping slabs stay readable */}
      <lineSegments position={[0, 0, 0]}>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color={hovered ? INK : "#A8834A"} transparent opacity={hovered ? 0.9 : 0.45} />
      </lineSegments>
      {hovered && (
        <Html position={[0, h / 2 + 0.25, 0]} center distanceFactor={9} zIndexRange={[40, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md2 border border-line bg-ivory-50 px-3 py-2 shadow-lift text-left">
            <div className="text-[0.8rem] font-semibold text-ink">{s.label}</div>
            <div className="text-[0.72rem] text-ink-600">{s.detail}</div>
            <div className="text-[0.68rem] text-[#8A6528] mt-0.5">Click to open</div>
          </div>
        </Html>
      )}
    </group>
  );
}

const CAM: [number, number, number] = [8, 6.8, 11.5];

/** Pull the camera back on narrow canvases (phones) so the whole scene fits. */
function FitCamera() {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const f = Math.min(Math.max(1.75 / (size.width / size.height), 1), 2.1);
    camera.position.set(CAM[0] * f, CAM[1] * f, CAM[2] * f);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  return null;
}

/**
 * Axis labels: price along the back edge, time along the right edge. The price
 * ends are anchored inward (left label grows right, right label grows left) so
 * they never run off the canvas; on narrow canvases the time labels sit just
 * inside the right edge (only "Latest block", which already shows which way
 * time runs, so it cannot collide with the price label).
 */
function AxisLabels({ low, high }: { low: string; high: string }) {
  const { size } = useThree();
  const narrow = size.width < 520;
  const tx = narrow ? W / 2 - 0.1 : W / 2 + 1.1;
  const timeStyle = narrow ? { transform: "translate(-100%, -50%)", textAlign: "right" as const } : { transform: "translate(-50%, -50%)" };
  const timeCls = `pointer-events-none block text-[0.66rem] text-ink-600 ${narrow ? "w-[3.6rem] leading-tight" : "whitespace-nowrap"}`;
  return (
    <>
      <Html position={[-W / 2, 0, -D / 2 - 0.55]} zIndexRange={[10, 0]}>
        <span className="pointer-events-none block whitespace-nowrap text-[0.66rem] text-ink-600" style={{ transform: "translate(0, -50%)" }}>{low}</span>
      </Html>
      <Html position={[W / 2, 0, -D / 2 - 0.55]} zIndexRange={[10, 0]}>
        <span className="pointer-events-none block whitespace-nowrap text-[0.66rem] text-ink-600" style={{ transform: "translate(-100%, -50%)" }}>{high}</span>
      </Html>
      <Html position={[0, 0, -D / 2 - 1.05]} center zIndexRange={[10, 0]}>
        <span className="pointer-events-none whitespace-nowrap text-[0.7rem] font-medium text-ink">Price (low → high)</span>
      </Html>
      {!narrow && (
        <Html position={[tx, 0, -D / 2 + 0.3]} zIndexRange={[10, 0]}>
          <span className={timeCls} style={timeStyle}>Start of window</span>
        </Html>
      )}
      <Html position={[tx, 0, D / 2 - 0.9]} zIndexRange={[10, 0]}>
        <span className={timeCls} style={timeStyle}>Latest block</span>
      </Html>
    </>
  );
}

function Ground() {
  const lines: [number, number, number][][] = [];
  for (let i = 0; i <= 10; i++) {
    const x = -W / 2 + (i / 10) * W;
    lines.push([
      [x, 0, -D / 2],
      [x, 0, D / 2],
    ]);
  }
  for (let j = 0; j <= 7; j++) {
    const z = -D / 2 + (j / 7) * D;
    lines.push([
      [-W / 2, 0, z],
      [W / 2, 0, z],
    ]);
  }
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[W + 0.6, D + 0.6]} />
        <meshStandardMaterial color="#F3EBDD" roughness={1} />
      </mesh>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#E2D8C6" lineWidth={1} />
      ))}
    </group>
  );
}

export default function LiquidityTerrain({ data, onOpen, height = 380 }: { data: TerrainData; onOpen: (tokenId: number) => void; height?: number }) {
  const sc = useScales(data);
  const [hover, setHover] = useState<number | null>(null);
  const path = useMemo(() => data.price.map((p) => [sc.x(p.tick), 0.03, sc.z(p.block)] as [number, number, number]), [data.price, sc]);
  const [t0, t1] = data.tickDomain;
  // Touch screens: no orbit, so a finger drag over the scene still scrolls the page.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia("(pointer: coarse)").matches), []);

  return (
    <div style={{ height }} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 2]}
        camera={{ position: CAM, fov: 29 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        style={{ cursor: hover != null ? "pointer" : coarse ? "default" : "grab", touchAction: coarse ? "pan-y" : "none" }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-6, 4, -4]} intensity={0.35} />
        <FitCamera />
        <Ground />
        {path.length > 1 && <Line points={path} color={GOLD} lineWidth={2.5} depthTest={false} renderOrder={10} />}
        {path.length > 0 && (
          <mesh position={path[path.length - 1]} renderOrder={11}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshBasicMaterial color={GOLD} depthTest={false} />
          </mesh>
        )}
        {data.slabs.map((s) => (
          <Slab key={s.id} s={s} sc={sc} hovered={hover === s.id} onHover={setHover} onOpen={onOpen} />
        ))}
        <AxisLabels low={data.priceLabel(t0)} high={data.priceLabel(t1)} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} enableRotate={!coarse} enableDamping dampingFactor={0.12} minDistance={9} maxDistance={42} minPolarAngle={0.35} maxPolarAngle={1.32} target={[0.4, 0.1, 0.6]} />
      </Canvas>
    </div>
  );
}
