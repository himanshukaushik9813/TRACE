/**
 * Deterministic compile: StrategyIR (+ compatibility assessment) → AquaProgram.
 *
 * Rules the compiler enforces:
 *  - No raw bytecode is ever emitted. The program is structured intent
 *    (observe / adjust / collect / redeploy / swap / stop) that Aqua executes
 *    through its own verified paths.
 *  - Unlimited token approvals are never requested.
 *  - The program hash is a pure function of (strategyId, steps, approvals,
 *    assumptions): recompile the same input → same hash. The World proof
 *    pins this hash, so a silently-changed program can't be authorized under
 *    an old signature.
 */

import {
  contentHash,
  validateProgram,
  type AquaProgram,
  type AquaStep,
  type CompatibilityAssessment,
  type StrategyIR,
} from "@trace/strategy-ir";

export type CompileConfig = {
  /** Schedule interval the whole program runs on (minutes). */
  intervalMinutes: number;
  slippageBps: number;
  gasGweiAssumption: number;
  minOutPct: number;
  /**
   * The position's observed range ticks — the only legitimate source for any
   * tick value in a compiled program. Omitting it makes trigger/limit rules
   * compile to "manual" (a human must set the ticks) rather than inventing
   * numbers.
   */
  observedRange?: { tickLower: number; tickUpper: number };
};

const DEFAULTS: Omit<CompileConfig, "observedRange"> = {
  intervalMinutes: 60,
  slippageBps: 12,
  gasGweiAssumption: 32,
  minOutPct: 99.2,
};

export function compileAquaProgram(
  ir: StrategyIR,
  compat: CompatibilityAssessment,
  cfg: Partial<CompileConfig> = {},
): AquaProgram {
  const c: CompileConfig = { ...DEFAULTS, ...cfg };
  const steps: AquaStep[] = [];

  // The program's clock.
  steps.push({ op: "observe", intervalMinutes: c.intervalMinutes, source: "pool_price", ref: ir.id });

  // Supported rules → structured actions. Unsupported rules are recorded as
  // gaps, not silently compiled away.
  for (const [i, r] of ir.rules.entries()) {
    const supported = compat.rules[i]?.status === "supported";
    const partial = compat.rules[i]?.status === "partial";
    const key = r.mapsTo ?? "action";

    if (key === "schedule" && supported) {
      steps.push({ op: "collect_fees", when: { kind: "schedule", everyMinutes: c.intervalMinutes } });
    }
    if (key === "allocation" && (supported || partial)) {
      steps.push({
        op: "redeploy",
        when: { kind: "schedule", everyMinutes: c.intervalMinutes },
        targetPool: "primary",
        allocationPct: 100,
      });
    }
    if (key === "trigger" && (supported || partial)) {
      // Price-exit triggers become scheduled checks (the partial gap): the
      // check runs on the interval; between checks the trigger is not observed.
      // Tick values come ONLY from the observed range; without one, the step
      // is manual (a human sets the ticks) — never invented.
      const obs = c.observedRange;
      steps.push({
        op: "adjust_range",
        when: obs
          ? { kind: "price_exit", side: "above", refTick: obs.tickUpper, widthTicks: Math.abs(obs.tickUpper - obs.tickLower) }
          : { kind: "manual", note: "trigger ticks not observed — human must set range" },
        newRange: obs
          ? { tickLower: obs.tickLower, tickUpper: obs.tickUpper }
          : { tickLower: 0, tickUpper: 0 },
      });
    }
    if (key === "limit") {
      // Risk limits are enforced as explicit stop conditions. The days value
      // is the product's stated default (14d out-of-range exposure cap).
      steps.push({ op: "stop", when: { kind: "max_out_of_range_days", days: 14 }, reason: "max out-of-range exposure" });
    }
  }

  const program: AquaProgram = {
    strategyId: ir.id,
    programHash: "", // stamped after content is final
    format: "aqua_program_v1",
    steps,
    approvals: compat.approvals.map((a) => ({ token: a.token, amount: a.amount, unlimited: false })),
    assumptions: {
      slippageBps: c.slippageBps,
      gasGweiAssumption: c.gasGweiAssumption,
      minOutPct: c.minOutPct,
    },
    deterministic: true,
  };

  program.programHash = contentHash({
    strategyId: program.strategyId,
    steps: program.steps,
    approvals: program.approvals,
    assumptions: program.assumptions,
  }).digest;

  const v = validateProgram(program);
  if (!v.ok) {
    throw new Error(`compiled program failed validation: ${v.issues.map((i) => i.message).join("; ")}`);
  }

  return program;
}
