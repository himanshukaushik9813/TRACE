"use client";

/**
 * FloatingTraceEmblem — the TRACE four-point star (same curve as the 2D mark),
 * in champagne-gold metal, floating above a layered ivory platform with gold rims
 * (SCENE 2). It recedes into the background during the exit (SCENE 5).
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, TorusGeometry, Vector3 } from "three";
import { T, ramp } from "./timeline";
import type { SceneQuality } from "./trace-launch-scene";

const IVORY = "#F7F3EB";
const IVORY_CARD = "#FFFFFF";
const IVORY_2 = "#F3EBDD";
const GOLD_MUTED = "#C6A66B";

/** engine-mark starPath(…, waist 0.2), as a three.js Shape. */
function starShape(r: number, waist = 0.2) {
  const w = r * waist;
  const s = new Shape();
  s.moveTo(0, r);
  s.quadraticCurveTo(w, w, r, 0);
  s.quadraticCurveTo(w, -w, 0, -r);
  s.quadraticCurveTo(-w, -w, -r, 0);
  s.quadraticCurveTo(-w, w, 0, r);
  return s;
}

function Platform({ t, quality }: { t: React.MutableRefObject<number>; quality: SceneQuality }) {
  const radial = quality === "high" ? 96 : 48;
  const layers = useMemo(
    () =>
      [
        { r: 1.75, h: 0.16, y: -0.62, color: IVORY_2 },
        { r: 1.38, h: 0.14, y: -0.47, color: IVORY },
        { r: 1.02, h: 0.12, y: -0.34, color: IVORY_CARD },
      ].map((l) => ({
        ...l,
        geo: new CylinderGeometry(l.r, l.r * 1.015, l.h, radial, 1),
        mat: new MeshStandardMaterial({ color: l.color, roughness: 0.82, metalness: 0, transparent: true, opacity: 0 }),
        rimGeo: new TorusGeometry(l.r, 0.008, 6, radial),
        rimMat: new MeshStandardMaterial({ color: GOLD_MUTED, roughness: 0.35, metalness: 0.9, transparent: true, opacity: 0 }),
      })),
    [radial],
  );
  useEffect(
    () => () =>
      layers.forEach((l) => {
        l.geo.dispose();
        l.mat.dispose();
        l.rimGeo.dispose();
        l.rimMat.dispose();
      }),
    [layers],
  );
  const refs = useRef<(Group | null)[]>([]);
  useFrame(() => {
    const tt = t.current;
    const out = 1 - ramp(tt, T.exit, T.exit + 0.85);
    const [a, b] = T.platform;
    layers.forEach((l, i) => {
      const k = ramp(tt, a + i * 0.16, b - 0.32 + i * 0.16);
      const g = refs.current[i];
      if (g) {
        g.scale.set(0.82 + 0.18 * k, Math.max(0.001, k), 0.82 + 0.18 * k);
        g.position.y = l.y - (1 - k) * 0.25;
      }
      l.mat.opacity = k * out;
      l.rimMat.opacity = k * out;
    });
  });
  return (
    <group>
      {layers.map((l, i) => (
        <group
          key={i}
          ref={(g) => {
            refs.current[i] = g;
          }}
          position={[0, l.y, 0]}
        >
          <mesh geometry={l.geo} material={l.mat} />
          <mesh geometry={l.rimGeo} material={l.rimMat} rotation={[Math.PI / 2, 0, 0]} position={[0, l.h / 2, 0]} />
        </group>
      ))}
    </group>
  );
}

export type EmblemHandle = { worldPosition: (out: Vector3) => Vector3 };

export const FloatingTraceEmblem = forwardRef<EmblemHandle, { t: React.MutableRefObject<number>; quality: SceneQuality }>(function FloatingTraceEmblem({ t, quality }, ref) {
  const geo = useMemo(() => {
    const g = new ExtrudeGeometry(starShape(0.62), {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.035,
      bevelSegments: quality === "high" ? 5 : 2,
      curveSegments: quality === "high" ? 28 : 12,
    });
    g.center();
    return g;
  }, [quality]);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#D2AE68", metalness: 1, roughness: 0.28, envMapIntensity: 1.1, transparent: true, opacity: 0 }), []);
  const ringGeo = useMemo(() => new TorusGeometry(0.98, 0.012, 8, quality === "high" ? 128 : 64), [quality]);
  const ringMat = useMemo(() => new MeshStandardMaterial({ color: GOLD_MUTED, metalness: 1, roughness: 0.35, transparent: true, opacity: 0 }), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
    [geo, mat, ringGeo, ringMat],
  );
  const g = useRef<Group>(null);
  const star = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  useImperativeHandle(ref, () => ({ worldPosition: (out: Vector3) => (g.current ? g.current.getWorldPosition(out) : out.set(0, 0.85, 0)) }), []);

  useFrame(() => {
    const tt = t.current;
    const [a, b] = T.emblemRise;
    const rise = ramp(tt, a, b);
    const back = ramp(tt, T.exit, T.exit + 1.0); // moves into the background
    const out = 1 - ramp(tt, T.exit + 0.3, T.exit + 1.0);
    if (g.current) {
      g.current.position.set(0, -0.55 + rise * 1.4 + Math.sin(tt * 1.15) * 0.06 * rise + back * 0.35, -back * 2.2);
      g.current.scale.setScalar(1 - back * 0.25);
    }
    if (star.current) star.current.rotation.y = tt * 0.45 + (1 - rise) * 1.2;
    if (ring.current) {
      ring.current.rotation.x = Math.PI / 2.3 + Math.sin(tt * 0.5) * 0.08;
      ring.current.rotation.z = tt * 0.2;
      ring.current.scale.setScalar(0.85 + 0.15 * ramp(tt, b - 0.4, b + 0.4));
    }
    mat.opacity = ramp(tt, a - 0.05, a + 0.45) * out;
    ringMat.opacity = ramp(tt, b - 0.5, b + 0.3) * out * 0.9;
  });

  return (
    <>
      <Platform t={t} quality={quality} />
      <group ref={g}>
        <mesh ref={star} geometry={geo} material={mat} />
        <mesh ref={ring} geometry={ringGeo} material={ringMat} />
      </group>
    </>
  );
});
