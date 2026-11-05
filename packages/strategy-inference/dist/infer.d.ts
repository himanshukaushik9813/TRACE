/**
 * Deterministic inference: turn Fingerprints + events into a StrategyIR draft.
 *
 * This is the *ground-truth* producer. The 0G layer can add nuance and
 * alternative framings, but every concrete rule it keeps must still map to
 * evidence the deterministic layer can point to. `buildStrategyIR` is the
 * fallback the product always has: a wallet with no 0G access still gets an
 * honest, evidence-anchored strategy.
 */
import { type StrategyIR } from "@trace/strategy-ir";
import { type Fingerprints } from "./fingerprints.js";
import type { V3Event } from "@trace/strategy-ir";
export type InferenceInput = {
    events: V3Event[];
    wallet: string;
    /** Optional deterministic fingerprints; computed if omitted. */
    fingerprints?: Fingerprints;
};
/**
 * Build a StrategyIR from deterministic evidence alone.
 * Confidence values are calibrated to how well the observed behaviour fits
 * the family, and every rule carries its own evidence string.
 */
export declare function inferFromEvidence(input: InferenceInput): {
    ir: StrategyIR;
    fingerprints: Fingerprints;
};
type Family = StrategyIR["family"];
export declare function scoreFamilies(fp: Fingerprints): {
    family: Family;
    score: number;
    why: string;
}[];
export {};
