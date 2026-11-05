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
import { type AquaProgram, type CompatibilityAssessment, type StrategyIR } from "@trace/strategy-ir";
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
    observedRange?: {
        tickLower: number;
        tickUpper: number;
    };
};
export declare function compileAquaProgram(ir: StrategyIR, compat: CompatibilityAssessment, cfg?: Partial<CompileConfig>): AquaProgram;
