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

import { getAddress, recoverTypedDataAddress, toHex, type Hex } from "viem";
import type { AuthorizationClaims, AuthorizationVerification } from "@trace/strategy-ir";

export const AUTH_DOMAIN = { name: "TRACE", version: "2", chainId: 11155111 } as const;

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
} as const;

/** The exact typed-data payload the wallet signs (shared by browser and server). */
export function buildTypedData(c: AuthorizationClaims) {
  return {
    domain: AUTH_DOMAIN,
    types: AUTH_TYPES,
    primaryType: "Authorization" as const,
    message: {
      wallet: getAddress(c.wallet),
      chainId: BigInt(c.chainId),
      strategyId: c.strategyId,
      strategyVersionHash: c.strategyVersionHash,
      planHash: c.planHash,
      action: c.action,
      challenge: c.challenge as Hex,
      expiresAt: BigInt(c.expiresAt),
    },
  };
}

/** A fresh, unpredictable 32-byte challenge. */
export function newChallenge(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

export type VerifyInput = {
  claims: AuthorizationClaims;
  signature: Hex;
  /** Server-side expectations, read from the DB — never from the request. */
  expected: { wallet: string; strategyVersionHash: string; planHash: string; action: string; chainId: number };
  /** True iff the challenge was issued by the server and not yet consumed. */
  challengeFresh: boolean;
  now?: number;
};

export async function verifyAuthorization(inp: VerifyInput): Promise<{ validated: boolean; signer: string | null; verification: AuthorizationVerification }> {
  const c = inp.claims;
  const now = inp.now ?? Math.floor(Date.now() / 1000);
  let signer: string | null = null;
  let signatureOk = false;
  try {
    signer = await recoverTypedDataAddress({ ...buildTypedData(c), signature: inp.signature });
    signatureOk = true;
  } catch {
    signatureOk = false;
  }
  const v: AuthorizationVerification = {
    signatureOk,
    signerMatches: signer != null && getAddress(signer) === getAddress(c.wallet) && getAddress(c.wallet) === getAddress(inp.expected.wallet),
    chainOk: c.chainId === inp.expected.chainId && c.chainId === AUTH_DOMAIN.chainId,
    notExpired: c.expiresAt > now && c.expiresAt - now <= 3_600,
    challengeFresh: inp.challengeFresh,
    strategyVersionMatches: c.strategyVersionHash === inp.expected.strategyVersionHash,
    planHashMatches: c.planHash === inp.expected.planHash,
    notes: [],
  };
  if (c.action !== inp.expected.action) v.notes.push("action does not match the requested action");
  if (!v.signatureOk) v.notes.push("signature could not be recovered");
  if (v.signatureOk && !v.signerMatches) v.notes.push("signer is not the connected wallet the plan was built for");
  if (!v.chainOk) v.notes.push("authorization is not for Sepolia (11155111)");
  if (!v.notExpired) v.notes.push("authorization expired (or expiry further than 1h out)");
  if (!v.challengeFresh) v.notes.push("challenge unknown, expired or already consumed (replay)");
  if (!v.strategyVersionMatches) v.notes.push("strategy version hash does not match the stored version");
  if (!v.planHashMatches) v.notes.push("plan hash does not match the stored execution plan");
  const validated =
    v.signatureOk && v.signerMatches && v.chainOk && v.notExpired && v.challengeFresh && v.strategyVersionMatches && v.planHashMatches && c.action === inp.expected.action;
  return { validated, signer, verification: v };
}

export type { AuthorizationClaims, AuthorizationVerification };
