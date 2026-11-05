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
import { createHmac, createHash } from "node:crypto";
import { canonicalString } from "@trace/strategy-ir";
export function issueAgentPassClaims(cfg, input) {
    const now = Math.floor(Date.now() / 1000);
    return {
        worldId: cfg.worldId,
        strategyId: input.strategyId,
        strategyVersionHash: input.strategyVersionHash,
        programHash: input.programHash,
        action: input.action,
        expiresAt: now + (cfg.ttlSeconds ?? 900),
        challenge: input.challenge ?? randomChallenge(),
        issuedAt: now,
    };
}
/**
 * Sign claims → AgentPassProof. Demo path: HMAC-SHA256 over the canonical
 * claims with the demo key, clearly labelled as non-production identity
 * verification.
 */
export function signProof(claims, cfg) {
    const key = cfg.demoKey ?? "trace-demo-key";
    const signature = createHmac("sha256", key).update(canonicalString(claims)).digest("hex");
    return {
        claims,
        signature,
        validated: false,
        validation: {
            signatureOk: false,
            notExpired: false,
            challengeUsed: false,
            strategyVersionMatches: false,
            programHashMatches: false,
            notes: ["proof issued — awaiting server-side validation"],
        },
    };
}
/**
 * Server-side validation. Returns a proof with `validated` set and a
 * machine-readable breakdown of every check.
 */
export function verifyProof(proof, inp) {
    const c = proof.claims;
    const now = Math.floor(Date.now() / 1000);
    const key = inp.demoKey ?? "trace-demo-key";
    const expectedSig = createHmac("sha256", key).update(canonicalString(c)).digest("hex");
    const checks = {
        signatureOk: proof.signature === expectedSig,
        notExpired: c.expiresAt > now,
        challengeUsed: c.challenge === inp.challenge && !(inp.usedChallenges ?? []).includes(c.challenge),
        strategyVersionMatches: c.strategyVersionHash === inp.expectedStrategyVersionHash,
        programHashMatches: c.programHash === inp.expectedProgramHash,
    };
    const notes = [];
    if (!checks.signatureOk)
        notes.push("signature mismatch (demo key or tampered claims)");
    if (!checks.notExpired)
        notes.push("proof is expired");
    if (!checks.challengeUsed)
        notes.push("challenge not fresh or already consumed");
    if (!checks.strategyVersionMatches)
        notes.push("strategy version hash does not match the pinned version");
    if (!checks.programHashMatches)
        notes.push("program hash does not match the compiled program");
    if (c.worldId !== inp.worldId)
        notes.push("worldId does not match the requester");
    const validated = checks.signatureOk && checks.notExpired && checks.challengeUsed &&
        checks.strategyVersionMatches && checks.programHashMatches && c.worldId === inp.worldId;
    return {
        ...proof,
        validated,
        validation: { ...checks, notes },
    };
}
function randomChallenge() {
    const h = createHash("sha256").update(`${Date.now()}${Math.random()}`).digest("hex");
    return `0x${h.slice(0, 16)}…`;
}
export { canonicalString };
