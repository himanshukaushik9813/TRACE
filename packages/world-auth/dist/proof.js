/**
 * Execution authorization — a real, user-held signature, verified server-side.
 *
 * 1) EIP-712 wallet signature (always required). The connected wallet signs
 *    typed data binding: wallet · chainId · strategy id · exact strategy
 *    version hash · execution plan hash · action · single-use challenge ·
 *    expiry. The server recovers the signer and checks every binding plus
 *    challenge freshness (consumed atomically in the DB → replay protection).
 *
 * 2) World ID v4 (optional layer, staging). When WORLD_RP_ID /
 *    WORLD_RP_SIGNING_KEY are configured, the IDKit proof's `signal` is the
 *    keccak256 of the same EIP-712 claims, so the human proof is bound to the
 *    same strategy version + plan + challenge. The backend signs the RP
 *    request, forwards the proof to World's verify API and checks the
 *    signal hash and nullifier uniqueness. It is labelled "World ID staging —
 *    not production identity verification". Without credentials the layer
 *    reports `not_configured`; it never pretends to have verified anything.
 *
 * A frontend-only button is never treated as authorization.
 */
import { encodeAbiParameters, getAddress, keccak256, recoverTypedDataAddress, toHex } from "viem";
export const AUTH_DOMAIN = { name: "TRACE", version: "2", chainId: 11155111 };
export const AUTH_TYPES = {
    Authorization: [
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "strategyId", type: "string" },
        { name: "strategyVersionHash", type: "string" },
        { name: "planHash", type: "string" },
        { name: "action", type: "string" },
        { name: "challenge", type: "bytes32" },
        { name: "expiresAt", type: "uint64" },
    ],
};
/** The exact typed-data payload the wallet signs (shared by browser and server). */
export function buildTypedData(c) {
    return {
        domain: AUTH_DOMAIN,
        types: AUTH_TYPES,
        primaryType: "Authorization",
        message: {
            wallet: getAddress(c.wallet),
            chainId: BigInt(c.chainId),
            strategyId: c.strategyId,
            strategyVersionHash: c.strategyVersionHash,
            planHash: c.planHash,
            action: c.action,
            challenge: c.challenge,
            expiresAt: BigInt(c.expiresAt),
        },
    };
}
/** A fresh, unpredictable 32-byte challenge. */
export function newChallenge() {
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    return toHex(b);
}
/** The World ID signal binding a human proof to these exact claims. */
export function worldSignal(c) {
    return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "uint64" }], [getAddress(c.wallet), BigInt(c.chainId), c.strategyId, c.strategyVersionHash, c.planHash, c.action, c.challenge, BigInt(c.expiresAt)]));
}
export async function verifyAuthorization(inp) {
    const c = inp.claims;
    const now = inp.now ?? Math.floor(Date.now() / 1000);
    let signer = null;
    let signatureOk = false;
    try {
        signer = await recoverTypedDataAddress({ ...buildTypedData(c), signature: inp.signature });
        signatureOk = true;
    }
    catch {
        signatureOk = false;
    }
    const v = {
        signatureOk,
        signerMatches: signer != null && getAddress(signer) === getAddress(c.wallet) && getAddress(c.wallet) === getAddress(inp.expected.wallet),
        chainOk: c.chainId === inp.expected.chainId && c.chainId === AUTH_DOMAIN.chainId,
        notExpired: c.expiresAt > now && c.expiresAt - now <= 3_600,
        challengeFresh: inp.challengeFresh,
        strategyVersionMatches: c.strategyVersionHash === inp.expected.strategyVersionHash,
        planHashMatches: c.planHash === inp.expected.planHash,
        worldId: "skipped",
        notes: [],
    };
    if (c.action !== inp.expected.action)
        v.notes.push("action does not match the requested action");
    if (!v.signatureOk)
        v.notes.push("signature could not be recovered");
    if (v.signatureOk && !v.signerMatches)
        v.notes.push("signer is not the connected wallet the plan was built for");
    if (!v.chainOk)
        v.notes.push("authorization is not for Sepolia (11155111)");
    if (!v.notExpired)
        v.notes.push("authorization expired (or expiry further than 1h out)");
    if (!v.challengeFresh)
        v.notes.push("challenge unknown, expired or already consumed (replay)");
    if (!v.strategyVersionMatches)
        v.notes.push("strategy version hash does not match the stored version");
    if (!v.planHashMatches)
        v.notes.push("plan hash does not match the stored execution plan");
    const validated = v.signatureOk && v.signerMatches && v.chainOk && v.notExpired && v.challengeFresh && v.strategyVersionMatches && v.planHashMatches && c.action === inp.expected.action;
    return { validated, signer, verification: v };
}
export const worldConfigured = (w) => Boolean(w.rpId && w.signingKey);
/** Backend RP signature for the IDKit request (never computed in the browser). */
export async function worldRpRequest(w) {
    if (!worldConfigured(w))
        throw new Error("World ID not configured (WORLD_RP_ID, WORLD_RP_SIGNING_KEY)");
    const { signRequest } = await import("@worldcoin/idkit-core/signing");
    const sig = signRequest({ signingKeyHex: w.signingKey, action: w.action, ttl: 600 });
    return { appId: w.appId, rpId: w.rpId, action: w.action, environment: w.environment, ...sig };
}
/** Forward an IDKit result to World's v4 verify API and check the bound signal. */
export async function verifyWorldProof(w, idkitResult, expectedSignal) {
    if (!worldConfigured(w))
        return { ok: false, nullifier: null, detail: "World ID not configured" };
    const { hashSignal } = await import("@worldcoin/idkit-core/hashing");
    const expectedHash = hashSignal(expectedSignal).toLowerCase();
    const responses = idkitResult.responses ?? [];
    if (!responses.length)
        return { ok: false, nullifier: null, detail: "IDKit result has no responses" };
    if (!responses.every((r) => (r.signal_hash ?? "").toLowerCase() === expectedHash))
        return { ok: false, nullifier: null, detail: "proof signal does not match the bound authorization claims" };
    if (w.environment === "production" && idkitResult.environment !== "production")
        return { ok: false, nullifier: null, detail: "non-production proof rejected in production mode" };
    const res = await fetch(`https://developer.world.org/api/v4/verify/${w.rpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(idkitResult),
        signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({})));
    if (!res.ok || !body.success)
        return { ok: false, nullifier: null, detail: `World verify failed (${res.status}): ${body.detail ?? body.code ?? "unknown"}` };
    return { ok: true, nullifier: body.nullifier ?? responses[0].nullifier ?? null, detail: `verified (${w.environment})` };
}
