/**
 * 0G Private Computer inference via the 0G Router (OpenAI-compatible) — with
 * a hard deterministic validation gate.
 *
 * Product rule: the model is NOT the source of blockchain truth. It receives
 * a structured evidence pack (fingerprints + citable tx hashes + position
 * facts) and returns a structured hypothesis. The gate then:
 *   1. parses + schema-checks the proposal,
 *   2. audits every rule's evidenceRefs against the citable set — refs not
 *      in the set are stripped; a rule left with no valid ref is rejected,
 *   3. caps each confidence at the deterministic support level,
 *   4. validates the final IR (validateStrategyIR) and stamps its content id.
 *
 * There is NO demo transport. If the router is not configured or the call
 * fails, the result is `ok:false` with the real error and the run metadata;
 * the caller shows the error and (separately labelled) the evidence-only
 * deterministic analysis — never a fabricated AI answer.
 */
import { type StrategyIR, type StrategyRule, type V3Event } from "@trace/strategy-ir";
import type { Fingerprints } from "./fingerprints.js";
import { type EvidenceWindow } from "./infer.js";
export type EvidencePack = {
    fingerprints: Fingerprints;
    /** The only tx hashes the model may cite. */
    citableEvents: string[];
    /** Compact event + position facts (no free-form text from the chain). */
    events: {
        kind: string;
        tx: string;
        block: number;
        tokenId: number;
        pool?: string;
    }[];
    positions: {
        tokenId: number;
        pool: string;
        pair: string;
        feeTier: number;
        tickLower: number;
        tickUpper: number;
        status: string;
    }[];
    window: EvidenceWindow;
};
export declare function buildEvidencePack(events: V3Event[], fp: Fingerprints, window: EvidenceWindow, positions?: EvidencePack["positions"]): EvidencePack;
export type ZeroGConfig = {
    /** e.g. https://router-api.0g.ai/v1 */
    routerUrl?: string;
    apiKey?: string;
    model?: string;
    /** Optional X-0G-Provider-Trust-Mode header: standard | verified | private. */
    trustMode?: "standard" | "verified" | "private";
    /** Ask the router to verify the provider's TEE signature (verify_tee). */
    verifyTee?: boolean;
    requestTimeoutMs?: number;
};
export type InferenceRun = {
    status: "succeeded" | "failed" | "rejected" | "not_configured";
    requestId: string | null;
    model: string | null;
    providerAddress: string | null;
    teeVerified: boolean | null;
    trustMode: string | null;
    httpStatus: number | null;
    errorCode: string | null;
    error: string | null;
    usage: {
        promptTokens?: number;
        completionTokens?: number;
        totalCostNeuron?: string;
    } | null;
    responseHash: string | null;
    latencyMs: number;
    startedAt: number;
    rulesRejected: number;
};
export type ZeroGResult = {
    ok: true;
    ir: StrategyIR;
    run: InferenceRun;
} | {
    ok: false;
    reason: "not_configured" | "transport_error" | "provider_error" | "unparseable" | "schema_invalid" | "no_citable_evidence";
    detail: string;
    run: InferenceRun;
};
type RawProposal = {
    family?: string;
    confidence?: number;
    rules?: Partial<StrategyRule>[];
    alternatives?: StrategyIR["alternatives"];
    limitations?: string[];
};
/** Real router call. Throws nothing: every failure becomes ok:false with the real error. */
export declare function runZeroGInference(opts: {
    pack: EvidencePack;
    wallet: string;
    cfg?: ZeroGConfig;
    /** Deterministic baseline, used only to cap confidences. */
    baseline: StrategyIR;
}): Promise<ZeroGResult>;
/** THE GATE: a validated, evidence-anchored StrategyIR, or a typed rejection. */
export declare function gateProposal(raw: RawProposal, pack: EvidencePack, ctx: {
    wallet: string;
    baseline: StrategyIR;
    run: InferenceRun;
}): {
    ok: true;
    ir: StrategyIR;
} | {
    ok: false;
    reason: "schema_invalid" | "no_citable_evidence";
    detail: string;
};
export type { StrategyIR, StrategyRule, V3Event };
