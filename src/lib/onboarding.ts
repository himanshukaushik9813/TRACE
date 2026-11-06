"use client";

/**
 * First-time user experience. Progress lives in this browser only
 * (localStorage "trace:onboarding:v1"); nothing is sent to the server.
 *
 * Steps follow the TRACE journey. Each screen marks its own step when it is
 * viewed with a real investigation, so the sidebar can show progress and the
 * tour can be replayed from the start.
 */

import { useCallback, useEffect, useState } from "react";

export const ONBOARDING_KEY = "trace:onboarding:v1";
const EVENT = "trace:onboarding";

export const ONBOARDING_STEPS = [
  { key: "seenIntro", label: "Read the welcome" },
  { key: "investigated", label: "Investigate a wallet" },
  { key: "viewedPositions", label: "See its positions" },
  { key: "viewedStrategy", label: "Read its strategy" },
  { key: "viewedBacktest", label: "Check the backtest" },
  { key: "viewedExecute", label: "Open Execute" },
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["key"];

export type OnboardingState = { done: Partial<Record<OnboardingStep, true>>; hidden: boolean };
const EMPTY: OnboardingState = { done: {}, hidden: false };

export function readOnboarding(): OnboardingState {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<OnboardingState>;
    return { done: v.done ?? {}, hidden: Boolean(v.hidden) };
  } catch {
    return EMPTY;
  }
}

function write(s: OnboardingState) {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: onboarding simply shows again */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function markOnboarding(step: OnboardingStep) {
  const s = readOnboarding();
  if (s.done[step]) return;
  write({ ...s, done: { ...s.done, [step]: true } });
}

/** "Don't show again": hides the welcome card and hints for good (until a replay). */
export function hideOnboarding() {
  write({ ...readOnboarding(), hidden: true, done: { ...readOnboarding().done, seenIntro: true } });
}

/** "Replay the tour": start over from the welcome card. */
export function replayOnboarding() {
  try {
    window.sessionStorage.removeItem(`${ONBOARDING_KEY}:skipped`);
  } catch {
    /* ignore */
  }
  write(EMPTY);
}

/** Live onboarding state; null until read on the client (avoids a hydration flash). */
export function useOnboarding(): OnboardingState | null {
  const [s, setS] = useState<OnboardingState | null>(null);
  useEffect(() => {
    const sync = () => setS(readOnboarding());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return s;
}

/** Mark a step as soon as the screen is shown (only when `when` is true). */
export function useMarkOnboarding(step: OnboardingStep, when = true) {
  useEffect(() => {
    if (when) markOnboarding(step);
  }, [step, when]);
}

/** "Skip" hides the welcome for this browser session only. */
export function useSessionSkip(): [boolean, () => void] {
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    try {
      setSkipped(window.sessionStorage.getItem(`${ONBOARDING_KEY}:skipped`) === "1");
    } catch {
      /* ignore */
    }
    const sync = () => {
      try {
        setSkipped(window.sessionStorage.getItem(`${ONBOARDING_KEY}:skipped`) === "1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const skip = useCallback(() => {
    try {
      window.sessionStorage.setItem(`${ONBOARDING_KEY}:skipped`, "1");
    } catch {
      /* ignore */
    }
    setSkipped(true);
  }, []);
  return [skipped, skip];
}
