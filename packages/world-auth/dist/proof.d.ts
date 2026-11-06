/**
 * Execution authorization — a real, user-held signature, verified server-side.
 *
 * 1) EIP-712 wallet signature (always required). The connected wallet signs
 *    typed data binding: wallet · chainId · strategy id · exact strategy
 *    version hash · execution plan hash · action · single-use challenge ·
 *    expiry. The server recovers the signer and checks every binding plus
 *    challenge freshness (consumed atomically in the DB → replay protection).
 *
 * 2) World ID 4.0 human verification (required for protected actions such as
 *    aqua:ship). The IDKit proof's `signal` is keccak256 of the same claims, so
 *    the human proof is bound to the same strategy version + plan + action +
 *    challenge + expiry. See verifyWorldProof below. Without a World ID
 *    registration, protected actions are refused (never silently allowed).
 *
 * A frontend-only button is never treated as authorization.
 */
import { type Hex } from "viem";
import type { AuthorizationClaims, AuthorizationVerification } from "@trace/strategy-ir";
export declare const AUTH_DOMAIN: {
    readonly name: "TRACE";
    readonly version: "2";
    readonly chainId: 11155111;
};
export declare const AUTH_TYPES: {
    readonly Authorization: readonly [{
        readonly name: "wallet";
        readonly type: "address";
    }, {
        readonly name: "chainId";
        readonly type: "uint256";
    }, {
        readonly name: "strategyId";
        readonly type: "string";
    }, {
        readonly name: "strategyVersionHash";
        readonly type: "string";
    }, {
        readonly name: "planHash";
        readonly type: "string";
    }, {
        readonly name: "action";
        readonly type: "string";
    }, {
        readonly name: "challenge";
        readonly type: "bytes32";
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
    }];
};
/** The exact typed-data payload the wallet signs (shared by browser and server). */
export declare function buildTypedData(c: AuthorizationClaims): {
    domain: {
        readonly name: "TRACE";
        readonly version: "2";
        readonly chainId: 11155111;
    };
    types: {
        readonly Authorization: readonly [{
            readonly name: "wallet";
            readonly type: "address";
        }, {
            readonly name: "chainId";
            readonly type: "uint256";
        }, {
            readonly name: "strategyId";
            readonly type: "string";
        }, {
            readonly name: "strategyVersionHash";
            readonly type: "string";
        }, {
            readonly name: "planHash";
            readonly type: "string";
        }, {
            readonly name: "action";
            readonly type: "string";
        }, {
            readonly name: "challenge";
            readonly type: "bytes32";
        }, {
            readonly name: "expiresAt";
            readonly type: "uint64";
        }];
    };
    primaryType: "Authorization";
    message: {
        wallet: `0x${string}`;
        chainId: bigint;
        strategyId: string;
        strategyVersionHash: string;
        planHash: string;
        action: string;
        challenge: Hex;
        expiresAt: bigint;
    };
};
/** A fresh, unpredictable 32-byte challenge. */
export declare function newChallenge(): Hex;
/** The World ID signal binding a human proof to these exact claims. */
export declare function worldSignal(c: AuthorizationClaims): Hex;
export type VerifyInput = {
    claims: AuthorizationClaims;
    signature: Hex;
    /** Server-side expectations, read from the DB — never from the request. */
    expected: {
        wallet: string;
        strategyVersionHash: string;
        planHash: string;
        action: string;
        chainId: number;
    };
    /** True iff the challenge was issued by the server and not yet consumed. */
    challengeFresh: boolean;
    now?: number;
};
export declare function verifyAuthorization(inp: VerifyInput): Promise<{
    validated: boolean;
    signer: string | null;
    verification: AuthorizationVerification;
}>;
export type WorldConfig = {
    appId?: string;
    rpId?: string;
    signingKey?: string;
    action: string;
    environment: "staging" | "production";
    /** Require a verified human for protected actions (default true). */
    enforce?: boolean;
};
/** Actions that move value on the user's behalf and therefore need a verified human. */
export declare const PROTECTED_ACTIONS: Set<string>;
export declare const worldConfigured: (w: WorldConfig) => boolean;
export declare const worldRequired: (w: WorldConfig, action: string) => boolean;
/** Exactly what an operator must register to enable protected execution. */
export declare const WORLD_REQUIREMENTS = "Register an app at developer.world.org with World ID 4.0 enabled, then set WORLD_APP_ID (app_\u2026), WORLD_RP_ID (rp_\u2026) and WORLD_RP_SIGNING_KEY (secret) on the API server; WORLD_ENVIRONMENT=staging uses the World ID simulator, production needs a real World App.";
export type WorldRequest = {
    app_id: string;
    action: string;
    environment: "staging" | "production";
    signal: Hex;
    rp_context: {
        rp_id: string;
        nonce: string;
        created_at: number;
        expires_at: number;
        signature: string;
    };
    /** Seals (challenge, nonce, expiry) so the server can tell which request a proof answers. */
    token: Hex;
};
/** Server-keyed seal over a World ID request; the signing key never leaves the server. */
export declare function worldRequestToken(w: WorldConfig, challenge: string, nonce: string, expiresAt: number): Hex;
/** Backend RP signature + the signal for one authorization challenge (never computed in the browser). */
export declare function worldRpRequest(w: WorldConfig, claims: AuthorizationClaims, ttlSeconds?: number): Promise<WorldRequest>;
export type WorldProofSubmission = {
    /** The IDKit result, exactly as IDKit returned it. */
    result: Record<string, unknown>;
    /** Echo of the request the server issued for this challenge. */
    request: {
        nonce: string;
        expires_at: number;
        token: string;
    };
};
export type WorldVerdict = {
    status: "verified" | "rejected" | "expired";
    nullifier: string | null;
    detail: string;
};
/**
 * Validate a World ID proof for one authorization. Local checks first (request seal,
 * expiry, environment, action, nonce, signal binding), then World's verify API with the
 * proof forwarded unchanged. Never returns "verified" without World's success response.
 */
export declare function verifyWorldProof(w: WorldConfig, sub: WorldProofSubmission | null | undefined, claims: AuthorizationClaims, opts?: {
    now?: number;
    fetchImpl?: typeof fetch;
}): Promise<WorldVerdict>;
export type { AuthorizationClaims, AuthorizationVerification };
