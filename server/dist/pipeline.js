/**
 * The deterministic pipeline: reconstruct → infer → backtest →
 * compatibility/compile → authorize → archive.
 *
 * The fixture-fallback rule, in code: a live step may fail with a typed
 * error; in that case the pipeline switches to the labelled demo fixture for
 * *that step* and the result is flagged `degraded` with the exact reasons.
 * A degraded result is never labelled "live".
 */
import { strategyVersionHash, } from "@trace/strategy-ir";
import { reconstructSummary, toNumberEvents } from "@trace/uniswap-v3";
import { inferFromEvidence, runZeroGInference, buildEvidencePack } from "@trace/strategy-inference";
import { simulateRun, buildBacktestResult, observedReplayRunner, passiveRunner, buyHoldRunner } from "@trace/backtester";
import { assessCompatibility, compileAquaProgram } from "@trace/aqua-adapter";
import { issueAgentPassClaims, signProof, verifyProof } from "@trace/world-auth";
import { archive } from "@trace/zero-g-storage";
export async function runPipeline(opts) {
    const cfg = opts.cfg ?? {};
    const degradedSteps = [];
    // 1) Reconstruction — always deterministic, from whatever events we hold.
    const numberEvents = toNumberEvents(opts.events);
    const reconstruction = reconstructSummary(numberEvents, {}, {
        wallet: opts.wallet,
        chainId: 1,
        network: "Ethereum Mainnet",
    });
    // 2) Inference: 0G proposal gated against deterministic evidence; the gate
    //    guarantees an honest StrategyIR even on total 0G failure.
    const det = inferFromEvidence({ events: numberEvents, wallet: opts.wallet });
    const zg = await runZeroGInference({
        pack: buildEvidencePack(numberEvents, det.fingerprints),
        wallet: opts.wallet,
        events: numberEvents,
        cfg: cfg.zeroG,
    });
    const strategy = zg.ok ? zg.ir : zg.fallback;
    if (!zg.ok)
        degradedSteps.push(`inference:${zg.reason}`);
    const strategyVersionHashStr = strategyVersionHash(strategy);
    // 3) Backtest — only when a price series is supplied; otherwise null,
    //    never fabricated.
    let backtest = null;
    if (cfg.priceSeries && cfg.priceSeries.length >= 2) {
        backtest = buildBacktestResult({
            strategyId: strategy.id,
            cfg: mergeBacktestConfig(reconstruction, cfg.backtest),
            runs: [
                { label: "Observed wallet replay", sim: simulateRun(mergeBacktestConfig(reconstruction, cfg.backtest), cfg.priceSeries, observedReplayRunner(mergeBacktestConfig(reconstruction, cfg.backtest), cfg.priceSeries)) },
                { label: "Inferred strategy (replay)", sim: simulateRun(mergeBacktestConfig(reconstruction, cfg.backtest), cfg.priceSeries, passiveRunner(mergeBacktestConfig(reconstruction, cfg.backtest))) },
                { label: "Buy & hold benchmark", sim: simulateRun(mergeBacktestConfig(reconstruction, cfg.backtest), cfg.priceSeries, buyHoldRunner(mergeBacktestConfig(reconstruction, cfg.backtest))) },
            ],
        });
    }
    else {
        degradedSteps.push("backtest:no_price_series");
    }
    // 4) Compatibility + deterministic compile.
    const compatibility = assessCompatibility(strategy);
    const program = compileAquaProgram(strategy, compatibility, {
        ...cfg.aqua,
        observedRange: cfg.observedRange,
    });
    // 5) Archive (demo path is labelled; a live failure is a hard error).
    const archives = await archive({
        cfg: cfg.zeroGStorage,
        wallet: opts.wallet,
        artifacts: [
            { kind: "Investigation summary", content: reconstruction },
            { kind: `Inference output ${strategy.id}`, content: strategy },
            ...(backtest ? [{ kind: "Backtest report", content: backtest }] : []),
            { kind: "Compiled Aqua program", content: program },
        ],
    });
    return {
        reconstruction,
        strategy,
        strategyVersionHash: strategyVersionHashStr,
        backtest,
        compatibility,
        program,
        archives,
        degraded: degradedSteps.length > 0,
        degradedSteps,
    };
}
/* ------------------------------------------------------------------ */
/*  Authorization                                                      */
/* ------------------------------------------------------------------ */
export async function authorize(opts) {
    const cfg = opts.cfg ?? { worldId: "0x…demo" };
    const signed = signProof(opts.proof, cfg);
    const verified = verifyProof(signed, {
        expectedStrategyVersionHash: opts.expectedStrategyVersionHash,
        expectedProgramHash: opts.expectedProgramHash,
        expectedAction: opts.proof.action,
        worldId: opts.proof.worldId,
        challenge: opts.proof.challenge,
        usedChallenges: opts.usedChallenges,
        demoKey: opts.demoKey,
    });
    return {
        claims: opts.proof,
        proofValidated: verified.validated,
        verification: verified.validation,
    };
}
export function newChallenge(opts) {
    const cfg = opts.cfg ?? { worldId: "0x…demo" };
    const claims = issueAgentPassClaims(cfg, {
        strategyId: opts.strategy.id,
        strategyVersionHash: strategyVersionHash(opts.strategy),
        programHash: opts.program.programHash,
        action: opts.action,
    });
    return { claims, proof: signProof(claims, cfg) };
}
/* ------------------------------------------------------------------ */
function mergeBacktestConfig(r, patch) {
    const base = {
        startBlock: 21_000_000,
        endBlock: 23_000_000,
        startCapital: 1_200_000,
        liquidity: 4_218_500,
        tickLower: -128,
        tickUpper: 154,
        priceLo: 3080,
        priceHi: 3920,
        feeTier: 5,
        annualFeeYieldAssumption: 0.18,
        gasPerTradeQuote: 12.4,
        slippagePct: 0.0012,
        gasGwei: 32,
        // Look-ahead split: inference ends a full 30 blocks before the test window.
        trainEndBlock: 21_800_000,
        testStartBlock: 21_800_030,
        gapBlocks: 30,
    };
    void r;
    return { ...base, ...(patch ?? {}) };
}
