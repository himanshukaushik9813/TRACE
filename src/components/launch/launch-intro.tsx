"use client";

/**
 * TRACE launch intro — orchestrates the scenes over the REAL app, which renders
 * and loads its data underneath from the first moment.
 *
 *   full    TraceLaunchScene (WebGL, lazy) + DOM layers: TraceBrandReveal,
 *           PartnerLogoReveal, PartnerConnectionLines; DashboardTransition exits.
 *   short   ~1 s brand transition on later visits.
 *   reduced prefers-reduced-motion: no 3D, no movement, everything shown at once.
 *   css     no WebGL / scene error / slow start: 2D landscape, same timeline.
 * Skip any time (button, Esc). A hard limit always releases the page.
 * Mode is chosen before first paint (lib/intro INTRO_BOOT_SCRIPT, layout.tsx).
 */

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { INTRO_REPLAY_EVENT, lowPowerDevice, markIntroSeen, prefersReducedMotion, readIntroMode, webglUsable, type IntroMode } from "@/lib/intro";
import { PARTNERS, type PartnerLogos } from "@/lib/partners";
import type { SceneQuality } from "./trace-launch-scene";
import { T, flagsAt, frozenAt, type Anchor } from "./timeline";
import { TraceBrandReveal, CATEGORY, TAGLINE } from "./trace-brand-reveal";
import { PartnerLogoReveal, type PartnerCardsHandle } from "./partner-logo-reveal";
import { PartnerConnectionLines } from "./partner-connection-lines";
import { CssLandscape } from "./css-landscape";
import { DashboardTransition, type Phase } from "./dashboard-transition";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const loadScene = () => import("./trace-launch-scene");
const TraceLaunchScene = dynamic(loadScene, { ssr: false, loading: () => null });

type Variant = "webgl" | "css" | "reduced" | "short";
type Flags = { land: boolean; emblem: boolean; brand: boolean; prepare: boolean; shown: number; settled: boolean; identity: boolean };
const NONE: Flags = { land: false, emblem: false, brand: false, prepare: false, shown: 0, settled: false, identity: false };
const ALL: Flags = { land: true, emblem: true, brand: true, prepare: true, shown: 5, settled: true, identity: true };

const SCENE_START_TIMEOUT_MS = 2600;
const HARD_LIMIT_MS = 10_000;
const ms = (s: number) => Math.round(s * 1000);

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The launch intro is decided once per page load (a fresh visit, a reload or a
 * restart of the site). Module state survives React re-renders and remounts and
 * resets only when the document itself is reloaded, so client-side navigation
 * between screens can never replay it. Only "Replay intro" plays it again.
 */
let launchConsumed = false;
let launchMode: IntroMode = "none";

export function LaunchIntro({ logos }: { logos: PartnerLogos }) {
  // Server-rendered props arrive as a new object on every navigation: keep them in
  // a ref so they never change the identity of play() and re-run the launch effect.
  const logosRef = useRef(logos);
  logosRef.current = logos;
  const [mode, setMode] = useState<IntroMode>("none");
  const [variant, setVariant] = useState<Variant>("short");
  const [quality, setQuality] = useState<SceneQuality>("high");
  const [phase, setPhase] = useState<Phase>("gone");
  const [flags, setFlags] = useState<Flags>(NONE);
  const [fast, setFast] = useState(false);
  const [calm, setCalm] = useState(false);
  const [run, setRun] = useState(0);
  const [decided, setDecided] = useState(false);
  const [frozen, setFrozen] = useState<number | null>(null); // ?introAt QA freeze
  const started = useRef(false);
  const timers = useRef<number[]>([]);
  const anchor = useRef<Anchor>({ x: 0, y: 0, set: false });
  const cards = useRef<PartnerCardsHandle>(null);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  const after = (s: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms(s)));
  const set = (patch: Partial<Flags>) => setFlags((f) => ({ ...f, ...patch }));

  const finish = useCallback((quick: boolean) => {
    clearTimers();
    setFast(quick);
    setPhase("leaving");
    after(quick ? 0.42 : 1.1, () => setPhase("gone"));
  }, []);

  const skip = useCallback(() => {
    markIntroSeen();
    finish(true);
  }, [finish]);

  /** Starts the shared timeline (WebGL: on the scene's first frame). */
  const begin = useCallback(
    (v: Variant, at: number | null = null) => {
      if (started.current) return;
      started.current = true;
      if (at != null && (v === "webgl" || v === "css")) {
        setFlags(flagsAt(at)); // QA: hold this moment, no exit
        return;
      }
      if (v === "short") {
        after(0.65, () => finish(false));
        return;
      }
      if (v === "reduced") {
        after(3.2, () => {
          markIntroSeen();
          finish(false);
        });
        return;
      }
      set({ land: true });
      after(T.platform[0], () => set({ emblem: true }));
      after(T.brand, () => set({ brand: true, prepare: true }));
      for (let i = 0; i < 5; i++) after(T.partnerFirst + i * T.partnerStep, () => set({ shown: i + 1 }));
      after(T.partnersSettle, () => set({ settled: true }));
      after(T.identity, () => set({ identity: true }));
      after(T.exit, () => {
        markIntroSeen();
        finish(false);
      });
    },
    [finish],
  );

  const play = useCallback(
    (m: IntroMode) => {
      clearTimers();
      started.current = false;
      anchor.current.set = false;
      setDecided(true);
      setFast(false);
      if (m === "none") {
        setPhase("gone");
        return;
      }
      const reduce = prefersReducedMotion();
      setCalm(reduce);
      let v: Variant = "short";
      if (m === "full") v = reduce ? "reduced" : webglUsable() ? "webgl" : "css";
      setQuality(lowPowerDevice() ? "low" : "high");
      const at = m === "full" ? frozenAt() : null;
      setFrozen(at);
      setFlags(v === "reduced" ? ALL : NONE);
      setVariant(v);
      setMode(m);
      setPhase("playing");
      setRun((r) => r + 1);
      if (v !== "short") {
        // Warm the official logo files so they are ready when the cards arrive.
        for (const p of PARTNERS) {
          const img = new Image();
          img.referrerPolicy = "no-referrer";
          img.src = logosRef.current[p.key] ?? p.logo.src;
        }
      }
      if (v === "webgl") {
        void loadScene();
        after(SCENE_START_TIMEOUT_MS / 1000, () => {
          if (!started.current) {
            setVariant("css");
            begin("css", at);
          }
        });
      } else {
        requestAnimationFrame(() => begin(v, at));
      }
      if (at == null) after(HARD_LIMIT_MS / 1000, () => finish(true));
    },
    [begin, finish],
  );

  const playRef = useRef(play);
  playRef.current = play;
  const ownsLaunch = useRef(false); // this instance played the launch intro

  // Mount only (empty deps): nothing a navigation changes can re-run this.
  useIsoLayoutEffect(() => {
    if (!launchConsumed) {
      launchConsumed = true;
      ownsLaunch.current = true;
      launchMode = readIntroMode();
    }
    // StrictMode's dev-only remount of the same instance restarts the same launch
    // cleanly (its timers were cleared); any other later mount shows nothing.
    if (ownsLaunch.current) playRef.current(launchMode);
    else setDecided(true);
    return clearTimers;
  }, []);

  useEffect(() => {
    const onReplay = () => play("full");
    window.addEventListener(INTRO_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(INTRO_REPLAY_EVENT, onReplay);
  }, [play]);

  // Hand over from the pre-paint cover once the overlay exists (or no intro is needed).
  useEffect(() => {
    if (decided) document.documentElement.setAttribute("data-intro-cover", "off");
  }, [decided, phase]);

  if (phase === "gone" || mode === "none") return null;

  const still = variant === "reduced" || calm;
  const animated = variant === "webgl" || variant === "css";

  return (
    <DashboardTransition key={run} phase={phase} fast={fast} still={still} sweep={!fast} dialog={variant !== "short"} onSkip={skip}>
      {variant === "webgl" && (
        <SceneBoundary
          onError={() => {
            setVariant("css");
            begin("css", frozen);
          }}
        >
          <TraceLaunchScene quality={quality} anchor={anchor} fixedTime={frozen} onReady={() => begin("webgl", frozen)} />
        </SceneBoundary>
      )}
      {variant === "css" && <CssLandscape stage={{ land: flags.land, emblem: flags.emblem, out: phase === "leaving" }} anchor={anchor} />}

      {animated && (
        <div
          className="absolute inset-x-0 bottom-0 h-[58%] pointer-events-none"
          aria-hidden
          style={{
            background: "linear-gradient(to top, rgba(247,243,235,0.96) 0%, rgba(247,243,235,0.88) 45%, rgba(247,243,235,0) 100%)",
            opacity: flags.brand ? 1 : 0,
            transition: "opacity 900ms ease",
          }}
        />
      )}
      {animated && <PartnerConnectionLines anchor={anchor} cards={cards} shown={flags.shown} visible={!flags.settled && phase === "playing"} />}

      {variant === "short" ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center">
            <BrandMark size={52} />
            <div className="serif mt-3 leading-none tracking-[0.18em] text-ink text-[2.6rem]">TRACE</div>
          </div>
        </div>
      ) : (
        <div className={`absolute inset-x-0 px-4 flex flex-col items-center ${animated ? "bottom-[5vh] sm:bottom-[7vh]" : "top-1/2 -translate-y-1/2"}`}>
          <TraceBrandReveal brand={flags.brand} identity={flags.identity} still={still} sweep={animated} />
          <div className="mt-6 sm:mt-7">
            <PartnerLogoReveal ref={cards} logos={logos} prepare={flags.prepare} shown={flags.shown} settled={flags.settled} heading={flags.identity} still={!animated} anchor={anchor} />
          </div>
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {variant !== "short" ? `TRACE. ${CATEGORY}. ${TAGLINE}` : ""}
      </span>
    </DashboardTransition>
  );
}
