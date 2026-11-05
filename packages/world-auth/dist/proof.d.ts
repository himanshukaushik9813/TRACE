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
};
export declare const worldConfigured: (w: WorldConfig) => boolean;
/** Backend RP signature for the IDKit request (never computed in the browser). */
export declare function worldRpRequest(w: WorldConfig): Promise<{
    sig: string;
    nonce: string;
    createdAt: number;
    expiresAt: number;
    appId: string | undefined;
    rpId: string | undefined;
    action: string;
    environment: "staging" | "production";
}>;
/** Forward an IDKit result to World's v4 verify API and check the bound signal. */
export declare function verifyWorldProof(w: WorldConfig, idkitResult: Record<string, unknown>, expectedSignal: string): Promise<{
    ok: boolean;
    nullifier: string | null;
    detail: string;
}>;
export type { AuthorizationClaims, AuthorizationVerification };
