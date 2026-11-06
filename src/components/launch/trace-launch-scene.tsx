"use client";

/**
 * TraceLaunchScene — the WebGL layer of the launch intro (react-three-fiber).
 * Lazy-loaded only when the full intro plays. Unmounting the Canvas disposes the
 * renderer and releases the WebGL context; each component disposes what it creates.
 * The partner logos and text are NOT in here: they are DOM layers above the canvas,
 * so they stay sharp and accessible.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Group, PMREMGenerator, Vector3, type PerspectiveCamera } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TopographicTerrain } from "./topographic-terrain";
import { FloatingTraceEmblem, type EmblemHandle } from "./floating-trace-emblem";
import { T, ramp, type Anchor } from "./timeline";

export type SceneQuality = "high" | "low";
export type TraceLaunchSceneProps = {
  quality: SceneQuality;
  /** Called once, on the first rendered frame: the shared timeline starts then. */
  onReady: () => void;
  /** Receives the emblem's screen position every frame (for the DOM connection lines). */
  anchor: React.MutableRefObject<Anchor>;
  /** QA: hold the timeline at this time (seconds). */
  fixedTime?: number | null;
};

function useTimeline(onReady: () => void, fixed?: number | null) {
  const start = useRef<number | null>(null);
  const t = useRef(0);
  const fired = useRef(false);
  useFrame(({ clock }) => {
    if (start.current == null) start.current = clock.elapsedTime;
    t.current = fixed != null ? fixed : clock.elapsedTime - start.current;
    if (!fired.current) {
      fired.current = true;
      onReady();
    }
  }, -1);
  return t;
}

/**
 * Camera: glides in across the land from the left (SCENE 1), settles high and back so
 * the emblem sits in the upper third, clear of the identity text, then pulls away (SCENE 5).
 * Framing is solved per aspect ratio so phones keep the platform fully in view.
 */
function Rig({ t }: { t: React.MutableRefObject<number> }) {
  const { camera, size } = useThree();
  const look = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const tt = t.current;
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 0.9;
    const glide = ramp(tt, 0, 2.8);
    const back = ramp(tt, T.exit, T.gone);
    const fov = portrait ? 50 : 36;
    // Settled framing.
    const dist = portrait ? 9.6 : 10.6;
    const tgtY = portrait ? -1.75 : -1.05;
    const elev = 0.2; // radians above the target
    const ex = 0;
    const ey = tgtY + Math.sin(elev) * dist;
    const ez = Math.cos(elev) * dist;
    // Start: further left, higher, further back.
    camera.position.set(ex - 4.2 * (1 - glide) + Math.sin(tt * 0.1) * 0.35, ey + 1.6 * (1 - glide) + back * 0.6, ez + 2.4 * (1 - glide) + back * 2.0);
    look.set(-1.6 * (1 - glide), tgtY, 0);
    camera.lookAt(look);
    const cam = camera as PerspectiveCamera;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pm.fromScene(room, 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
      room.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={["#FFF8EC", "#E9DFCC", 0.9]} />
      <directionalLight position={[-3.5, 6, 4]} intensity={1.6} color="#FFF3DF" />
      <directionalLight position={[4, 2.5, -3]} intensity={0.5} color="#F3E3C4" />
    </>
  );
}

function Shadows({ t, quality }: { t: React.MutableRefObject<number>; quality: SceneQuality }) {
  const g = useRef<Group>(null);
  useFrame(() => {
    if (g.current) g.current.visible = t.current > T.emblemRise[0] && t.current < T.exit + 0.6;
  });
  return (
    <group ref={g} position={[0, -0.3, 0]}>
      <ContactShadows opacity={0.3} scale={2.4} blur={2.4} far={2.2} resolution={quality === "high" ? 512 : 256} color="#5A4A2E" frames={Infinity} />
    </group>
  );
}

/** Projects the emblem to screen space for the DOM lines (no React state, no re-renders). */
function AnchorTracker({ emblem, anchor }: { emblem: React.RefObject<EmblemHandle>; anchor: React.MutableRefObject<Anchor> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!emblem.current) return;
    emblem.current.worldPosition(v).project(camera);
    anchor.current.x = ((v.x + 1) / 2) * size.width;
    anchor.current.y = ((1 - v.y) / 2) * size.height;
    anchor.current.set = true;
  });
  return null;
}

function SceneContents({ quality, onReady, anchor, fixedTime }: TraceLaunchSceneProps) {
  const t = useTimeline(onReady, fixedTime);
  const emblem = useRef<EmblemHandle>(null);
  return (
    <>
      <Studio />
      <Rig t={t} />
      <TopographicTerrain t={t} quality={quality} />
      <FloatingTraceEmblem ref={emblem} t={t} quality={quality} />
      <Shadows t={t} quality={quality} />
      <AnchorTracker emblem={emblem} anchor={anchor} />
    </>
  );
}

export default function TraceLaunchScene(props: TraceLaunchSceneProps) {
  return (
    <Canvas
      aria-hidden
      dpr={props.quality === "high" ? [1, 1.75] : [1, 1.3]}
      gl={{ antialias: props.quality === "high", alpha: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: true }}
      camera={{ position: [-4.2, 2.6, 12.8], fov: 36, near: 0.1, far: 70 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
