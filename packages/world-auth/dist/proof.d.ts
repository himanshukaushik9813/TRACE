/**
 * World Agent Pass — bound-claims authorization.
 *
 * A proof binds, in one signed payload:
 *   worldId · strategy version hash · program hash · action · expiry ·
 *   challenge
 *
 * Verification is always server-side and checks every binding:
 *   - signature validity,
 *   - expiry in the future,
 *   - challenge is fresh (not reused),
 *   - the strategy version and program hash match the ones being authorized.
 *
 * The hackathon path uses a demo signing key and labels the proof
 * `demo: true`. The data shape is production-identical so a real World
 * verification endpoint can be dropped in without changing the API.
 */
import type { AgentPassClaims, AgentPassProof } from "@trace/strategy-ir";
import { canonicalString } from "@trace/strategy-ir";
export type WorldAuthConfig = {
    /** The World ID being authorized. */
    worldId: string;
    /**
     * A demo HMAC key for the hackathon path. In production the signature would
     * be an Ed25519 signature verifiable against World's public key registry —
     * the claim shape stays the same.
     */
    demoKey?: string;
    /** Seconds until a proof expires. Default 15 minutes. */
    ttlSeconds?: number;
};
export declare function issueAgentPassClaims(cfg: WorldAuthConfig, input: {
    strategyId: string;
    strategyVersionHash: string;
    programHash: string;
    action: string;
    challenge?: string;
}): AgentPassClaims;
/**
 * Sign claims → AgentPassProof. Demo path: HMAC-SHA256 over the canonical
 * claims with the demo key, clearly labelled as non-production identity
 * verification.
 */
export declare function signProof(claims: AgentPassClaims, cfg: WorldAuthConfig): AgentPassProof;
export type VerifyInput = {
    /** The strategy version the proof claims to pin. */
    expectedStrategyVersionHash: string;
    expectedProgramHash: string;
    expectedAction: string;
    /** World ID the proof is issued to. */
    worldId: string;
    /** The challenge that was issued to the requester. */
    challenge: string;
    /** Challenges already consumed (replay protection). */
    usedChallenges?: string[];
    demoKey?: string;
};
/**
 * Server-side validation. Returns a proof with `validated` set and a
 * machine-readable breakdown of every check.
 */
export declare function verifyProof(proof: AgentPassProof, inp: VerifyInput): AgentPassProof;
export { canonicalString };
export type { AgentPassClaims, AgentPassProof };
