/**
 * Launch intro state. Lives in this browser only; nothing is sent anywhere.
 *
 *   localStorage   "trace:intro:v1"      set once the full intro has played or been skipped
 *
 * The intro plays only when the site is launched: opened, reloaded or restarted.
 * It is decided once per page load, before first paint, by INTRO_BOOT_SCRIPT (so
 * there is no flash of the dashboard before the cover, and no layout shift), and
 * never again while moving between screens (client-side navigation keeps the page):
 *   full  — first visit on the landing route: the complete 3D intro (Skip available)
 *   short — every later launch, or a first visit through a deep link: a ~1 s brand transition
 *   none  — only when the intro query asks for none
 *
 * QA switches (query string, for testing): ?intro=full | short | none,
 * ?introFallback=css (skip WebGL), ?introMotion=reduce (simulate reduced motion).
 */

export const INTRO_SEEN_KEY = "trace:intro:v1";
export const INTRO_REPLAY_EVENT = "trace:intro:replay";

export type IntroMode = "full" | "short" | "none";

/** Runs inline in <head> before paint. Must never throw; on any error the app shows without an intro. */
export const INTRO_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement,q=new URLSearchParams(location.search),f=q.get("intro"),m;
if(f==="full"||f==="short"||f==="none"){m=f;}
else{var seen=localStorage.getItem("${INTRO_SEEN_KEY}");
m=(!seen&&location.pathname==="/")?"full":"short";}
d.setAttribute("data-intro",m);
}catch(e){}})();`;

export function readIntroMode(): IntroMode {
  if (typeof document === "undefined") return "none";
  const m = document.documentElement.getAttribute("data-intro");
  return m === "full" || m === "short" ? m : "none";
}

export function markIntroSeen() {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, JSON.stringify({ seen: true, at: Date.now() }));
  } catch {
    /* storage unavailable: the intro may show again next visit, never blocks */
  }
}

/** "Replay intro" (sidebar): plays the full intro over the current page. */
export function replayIntro() {
  window.dispatchEvent(new Event(INTRO_REPLAY_EVENT));
}

export function prefersReducedMotion(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("introMotion") === "reduce") return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** WebGL2 without a major performance caveat (software rendering → the CSS version). */
export function webglUsable(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("introFallback") === "css") return false;
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Lower-cost scene for phones, small screens and low-core devices. */
export function lowPowerDevice(): boolean {
  try {
    const small = window.matchMedia("(max-width: 767px)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    return small || cores <= 4;
  } catch {
    return true;
  }
}
