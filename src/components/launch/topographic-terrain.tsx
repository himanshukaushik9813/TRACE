"use client";

/**
 * TopographicTerrain — warm ivory relief with fine contour lines, champagne-gold
 * index contours, and a gold path that draws itself across the land toward the
 * platform (SCENE 1). Geometry is static; the contours drift by shifting their
 * phase in the shader, so the path always sits on the surface.
 */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { CatmullRomCurve3, Color, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, TubeGeometry, Vector3 } from "three";
import { T, ramp } from "./timeline";
import type { SceneQuality } from "./trace-launch-scene";

const IVORY = "#F7F3EB";
const IVORY_2 = "#F3EBDD";
const GOLD = "#B68A42";
const GOLD_MUTED = "#C6A66B";
const LINE = "#E2D7C4";
export const TERRAIN_Y = -0.75;

/** Height field, identical in GLSL and TS. p = plane-local (x, y); world z = -y. */
const H = `
float hgt(vec2 p) {
  float h = 0.55 * sin(p.x * 0.33) * cos(p.y * 0.29)
          + 0.32 * sin((p.x + p.y) * 0.21 + 1.3)
          + 0.16 * sin(p.x * 0.85 - p.y * 0.66);
  return h * smoothstep(2.4, 6.0, length(p));
}`;
function hgt(x: number, y: number) {
  const h = 0.55 * Math.sin(x * 0.33) * Math.cos(y * 0.29) + 0.32 * Math.sin((x + y) * 0.21 + 1.3) + 0.16 * Math.sin(x * 0.85 - y * 0.66);
  const l = Math.hypot(x, y);
  const s = Math.min(1, Math.max(0, (l - 2.4) / 3.6));
  return h * s * s * (3 - 2 * s);
}

const VERT = /* glsl */ `
varying float vH;
varying vec3 vWorld;
varying vec3 vN;
${H}
void main() {
  vec3 p = position;
  float e = hgt(p.xy);
  p.z += e;
  vH = e;
  float s = 0.18;
  float hx = hgt(p.xy + vec2(s, 0.0)) - hgt(p.xy - vec2(s, 0.0));
  float hy = hgt(p.xy + vec2(0.0, s)) - hgt(p.xy - vec2(0.0, s));
  vN = normalize(mat3(modelMatrix) * normalize(vec3(-hx, -hy, 2.0 * s)));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uGold;
uniform vec3 uFog;
varying float vH;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 L = normalize(vec3(-0.45, 0.85, 0.35));
  float diff = clamp(dot(normalize(vN), L), 0.0, 1.0);
  vec3 col = uBase * (0.9 + 0.1 * diff);
  float f = vH * 8.0 + 4.0 + uTime * 0.12;           // contours drift gently
  float line = 1.0 - smoothstep(0.0, fwidth(f) * 1.25, abs(fract(f - 0.5) - 0.5));
  col = mix(col, uLine, line * 0.6);
  float g = f / 5.0;                                   // every 5th: champagne gold
  float gl = 1.0 - smoothstep(0.0, fwidth(g) * 1.6, abs(fract(g - 0.5) - 0.5));
  float pulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(vWorld.x * 0.55 + vWorld.z * 0.35 - uTime * 0.9), 3.0);
  col = mix(col, uGold, gl * pulse * 0.75);
  float fog = smoothstep(9.0, 24.0, length(vWorld - cameraPosition));
  col = mix(col, uFog, fog);
  gl_FragColor = vec4(col, uOpacity);
}`;

export function TopographicTerrain({ t, quality }: { t: React.MutableRefObject<number>; quality: SceneQuality }) {
  const seg = quality === "high" ? 180 : 72;
  const geo = useMemo(() => new PlaneGeometry(44, 44, seg, seg), [seg]);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uBase: { value: new Color(IVORY_2).lerp(new Color(IVORY), 0.7) },
          uLine: { value: new Color(LINE) },
          uGold: { value: new Color(GOLD_MUTED) },
          uFog: { value: new Color(IVORY) },
        },
      }),
    [],
  );

  // The gold path: from the far left of the land to the foot of the platform, on the surface.
  const path = useMemo(() => {
    const xz: [number, number][] = [[-9.5, -6.5], [-7, -4.6], [-5.2, -1.6], [-4.1, 0.6], [-2.5, 1.5], [-1.5, 0.75]];
    const pts = xz.map(([x, z]) => new Vector3(x, TERRAIN_Y + hgt(x, -z) + 0.03, z));
    const curve = new CatmullRomCurve3(pts, false, "centripetal");
    const tubular = quality === "high" ? 220 : 110;
    const core = new TubeGeometry(curve, tubular, 0.016, 6, false);
    const halo = new TubeGeometry(curve, tubular, 0.05, 6, false);
    const coreMat = new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0 });
    const haloMat = new MeshBasicMaterial({ color: GOLD_MUTED, transparent: true, opacity: 0, depthWrite: false });
    return { core, halo, coreMat, haloMat };
  }, [quality]);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      path.core.dispose();
      path.halo.dispose();
      path.coreMat.dispose();
      path.haloMat.dispose();
    },
    [geo, mat, path],
  );

  useFrame(() => {
    const tt = t.current;
    const out = 1 - ramp(tt, T.exit, T.exit + 0.85);
    mat.uniforms.uTime.value = tt;
    mat.uniforms.uOpacity.value = ramp(tt, T.landscapeIn[0], T.landscapeIn[1]) * out;
    const draw = ramp(tt, T.pathDraw[0], T.pathDraw[1]);
    for (const g of [path.core, path.halo]) g.setDrawRange(0, Math.floor((g.index?.count ?? 0) * draw / 6) * 6);
    path.coreMat.opacity = Math.min(1, draw * 3) * out;
    path.haloMat.opacity = 0.16 * Math.min(1, draw * 3) * out;
  });

  return (
    <group>
      <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, TERRAIN_Y, 0]} />
      <mesh geometry={path.halo} material={path.haloMat} />
      <mesh geometry={path.core} material={path.coreMat} />
    </group>
  );
}
