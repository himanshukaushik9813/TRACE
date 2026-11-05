/**
 * Deterministic, evidence-only inference: Fingerprints + events → StrategyIR v2.
 *
 * This is the ground truth the 0G proposal is audited against, and the
 * analysis shown (labelled "evidence-only, no AI") when the model is not
 * available. Every rule cites the real transaction hashes it was drawn from.
 * When the evidence cannot support a hypothesis the family is "inconclusive"
 * and no rule is invented.
 */
import { type PositionMeta, type StrategyFamily, type StrategyIR, type V3Event } from "@trace/strategy-ir";
import { type Fingerprints } from "./fingerprints.js";
export type EvidenceWindow = {
    fromBlock: number;
    toBlock: number;
    fromTs: number;
    toTs: number;
};
export type InferenceInput = {
    events: V3Event[];
    wallet: string;
    window: EvidenceWindow;
    meta?: Record<string, PositionMeta>;
    fingerprints?: Fingerprints;
};
export declare const CONFIDENCE_NOTE = "Heuristic fit of the hypothesis to the observed on-chain evidence (0\u20131). It is not the probability that this is the wallet's actual strategy.";
export declare function inferFromEvidence(input: InferenceInput): {
    ir: StrategyIR;
    fingerprints: Fingerprints;
};
export declare function familyLabel(f: StrategyFamily): string;
export declare function scoreFamilies(fp: Fingerprints): {
    family: StrategyFamily;
    score: number;
    why: string;
}[];
