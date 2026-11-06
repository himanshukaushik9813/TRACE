"use client";

/**
 * First-visit welcome on Investigate: what TRACE does, what to paste, and the
 * four stages. Dismissible ("Skip" for this session, "Don't show again" for
 * good); "Replay the tour" in the sidebar brings it back.
 */

import { useRouter } from "next/navigation";
import { Search, Sparkles, X } from "lucide-react";
import { ONBOARDING_STEPS, hideOnboarding, markOnboarding, replayOnboarding, useMarkOnboarding, useOnboarding, useSessionSkip, type OnboardingStep } from "@/lib/onboarding";

const STAGES = [
  { t: "Analyze", d: "TRACE reads the wallet's real liquidity activity on Sepolia." },
  { t: "Understand", d: "It names the strategy that best fits that activity, with evidence." },
  { t: "Verify", d: "You check it, and authorize with your own wallet if you want to run it." },
  { t: "Execute", d: "You send it to 1inch Aqua, confirming every transaction yourself." },
];

/** Marks an onboarding step when rendered (for use inside render-prop gates). */
export function MarkStep({ step }: { step: OnboardingStep }) {
  useMarkOnboarding("investigated"); // these pages only render a completed investigation
  useMarkOnboarding(step);
  return null;
}

/** Sidebar footer: getting-started progress and "Replay the tour". */
export function TourFooter({ onNavigate }: { onNavigate?: () => void }) {
  const ob = useOnboarding();
  const router = useRouter();
  if (!ob) return null;
  const done = ONBOARDING_STEPS.filter((s) => ob.done[s.key]).length;
  const total = ONBOARDING_STEPS.length;
  const next = ONBOARDING_STEPS.find((s) => !ob.done[s.key]);
  return (
    <div className="rounded-md2 border border-line bg-ivory-50 px-3 py-2 text-[0.74rem] text-ink-600">
      {done < total && !ob.hidden && (
        <>
          <div className="flex items-center justify-between text-ink">
            <span className="font-medium">Getting started</span>
            <span className="tabular">{done} of {total}</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-ink/10 overflow-hidden" role="progressbar" aria-label="Getting started progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-gold" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          {next && <div className="mt-1.5">Next: {next.label.toLowerCase()}</div>}
        </>
      )}
      <button
        onClick={() => {
          replayOnboarding();
          onNavigate?.();
          router.push("/");
        }}
        className={`${done < total && !ob.hidden ? "mt-1.5" : ""} underline-offset-2 hover:underline hover:text-ink`}>
        Replay the tour
      </button>
    </div>
  );
}

export function WelcomeCard({ onExample }: { onExample: () => void }) {
  const ob = useOnboarding();
  const [skipped, skip] = useSessionSkip();
  if (!ob || ob.hidden || ob.done.seenIntro || skipped) return null;
  return (
    <section aria-labelledby="welcome-title" className="relative mb-7 rounded-card border border-gold/45 bg-ivory-50 shadow-lift p-5 md:p-6">
      <button onClick={skip} aria-label="Skip the welcome for now" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md2 text-ink-600 hover:text-ink hover:bg-ivory-100">
        <X size={16} />
      </button>
      <div className="text-[0.7rem] uppercase tracking-[0.14em] text-gold font-semibold">Welcome to TRACE</div>
      <h2 id="welcome-title" className="serif text-[1.5rem] md:text-[1.7rem] text-ink mt-1 leading-tight">See how any wallet provides liquidity, in plain words.</h2>
      <p className="text-[0.9rem] text-ink-600 mt-2 max-w-[70ch] leading-relaxed">
        Paste the address of a wallet that provides liquidity on Uniswap V3 (Sepolia test network). TRACE reads its public history, explains its strategy and shows how it performed. Nothing is signed or sent unless you choose to execute later.
      </p>
      <ol aria-label="The four stages" className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8rem] text-ink">
        {STAGES.map((s, i) => (
          <li key={s.t} className="inline-flex items-center gap-1.5" title={s.d}>
            {i > 0 && <span aria-hidden className="text-ink-600">→</span>}
            <span className="tabular text-gold font-semibold">{i + 1}</span>
            <span className="font-medium">{s.t}</span>
            <span className="sr-only">: {s.d}</span>
          </li>
        ))}
      </ol>
      <p className="text-[0.76rem] text-ink-600 mt-1">Each stage is explained under &ldquo;How it works&rdquo; below, and its status updates live while TRACE works.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            markOnboarding("seenIntro");
            onExample();
          }}
          className="inline-flex items-center gap-2 rounded-md2 bg-gold text-white px-4 h-10 text-[0.86rem] font-medium hover:bg-[#A67C38] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
        >
          <Sparkles size={15} /> Start with an example wallet
        </button>
        <button
          onClick={() => {
            markOnboarding("seenIntro");
            document.querySelector<HTMLInputElement>('input[aria-label="Wallet address"]')?.focus();
          }}
          className="inline-flex items-center gap-2 rounded-md2 border border-line bg-white text-ink px-4 h-10 text-[0.86rem] font-medium hover:border-gold/50"
        >
          <Search size={15} /> I have an address
        </button>
        <button onClick={skip} className="text-[0.8rem] text-ink-600 hover:text-ink underline-offset-2 hover:underline">Skip</button>
        <button onClick={hideOnboarding} className="text-[0.8rem] text-ink-600 hover:text-ink underline-offset-2 hover:underline">Don&apos;t show again</button>
      </div>
    </section>
  );
}
