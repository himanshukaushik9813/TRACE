/**
 * 0G Private Computer inference client — with a hard validation gate.
 *
 * Product rule: "the LLM is NOT the source of blockchain truth." The 0G
 * model receives a *structured, deterministic evidence pack* (fingerprint
 * values + event references) and returns a structured IR *proposal*. That
 * proposal is then:
 *
 *   1. schema-validated (validateStrategyIR),
 *   2. evidence-audited: every evidence ref it cites must exist in the
 *      deterministic evidence pack; unknown refs are stripped and the rule
 *      is flagged,
 *   3. re-anchored: rule confidences are capped at what the deterministic
 *      layer supports for that evidence,
 *   4. finalized (deterministic id) only if all of the above pass.
 *
 * On any failure the caller falls back to `inferFromEvidence` — an honest
 * deterministic strategy — and the UI labels the source accordingly.
 */
import { type StrategyIR, type StrategyRule } from "@trace/strategy-ir";
import type { Fingerprints } from "./fingerprints.js";
import type { V3Event } from "@trace/strategy-ir";
export type EvidencePack = {
    fingerprints: Fingerprints;
    /** The tx hashes the model is *allowed* to cite. */
    citableEvents: string[];
};
export declare function buildEvidencePack(events: V3Event[], fp: Fingerprints): EvidencePack;
export type ZeroGConfig = {
    /** The 0G inference endpoint. Omit or pass the demo transport to run offline. */
    endpoint?: string;
    apiKey?: string;
    requestTimeoutMs?: number;
};
export type ZeroGResult = {
    ok: true;
    ir: StrategyIR;
    proposalsRejected: number;
} | {
    ok: false;
    reason: "schema_invalid" | "no_citable_evidence" | "transport_error";
    detail: string;
    /** The honest deterministic fallback, always present so the UI degrades gracefully. */
    fallback: StrategyIR;
};
/** Prompt: deterministic evidence pack in, structured IR out. */
export declare function buildZeroGPrompt(pack: EvidencePack, wallet: string): string;
type RawProposal = {
    family: StrategyIR["family"];
    confidence: number;
    rules: StrategyRule[];
    alternatives?: StrategyIR["alternatives"];
    evidenceRefs?: string[];
    limitations?: string[];
};
/**
 * The transport. The default "demo" transport returns a deterministic
 * proposal derived *from the evidence pack itself* (not from a real model),
 * so the whole pipeline — including validation — is exercised offline and is
 * clearly labelled as the demo path. A production deployment swaps in a real
 * 0G endpoint via `endpoint` + `apiKey`.
 */
export declare function runZeroGInference(opts: {
    pack: EvidencePack;
    wallet: string;
    events: V3Event[];
    cfg?: ZeroGConfig;
}): Promise<ZeroGResult>;
/**
 * THE GATE. Returns a validated, evidence-anchored StrategyIR, or a typed
 * failure carrying the deterministic fallback.
 */
export declare function gateProposal(raw: RawProposal, pack: EvidencePack, ctx: {
    events: V3Event[];
    wallet: string;
}, provider?: "0G_PRIVATE_COMPUTER" | "DETERMINISTIC_ONLY"): ZeroGResult;
export type { StrategyIR, StrategyRule, V3Event };
