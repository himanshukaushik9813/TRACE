/**
 * Execution authorization — a real, user-held signature, verified server-side.
 *
 * EIP-712 wallet signature (always required). The connected wallet signs
 * typed data binding: wallet · chainId · strategy id · exact strategy
 * version hash · execution plan hash · action · single-use challenge ·
 * expiry. The server recovers the signer and checks every binding plus
 * challenge freshness (consumed atomically in the DB → replay protection).
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
export type { AuthorizationClaims, AuthorizationVerification };
