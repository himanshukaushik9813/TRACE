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

import { encodeAbiParameters, getAddress, keccak256, recoverTypedDataAddress, toHex, type Hex } from "viem";
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

/** The World ID signal binding a human proof to these exact claims. */
export function worldSignal(c: AuthorizationClaims): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "uint64" }],
      [getAddress(c.wallet), BigInt(c.chainId), c.strategyId, c.strategyVersionHash, c.planHash, c.action, c.challenge as Hex, BigInt(c.expiresAt)],
    ),
  );
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
    worldId: "skipped",
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

/* ------------------------------------------------------------------ */
/*  World ID 4.0 — human authorization of a protected action            */
/* ------------------------------------------------------------------ */
/*
 * Official flow (docs.world.org/world-id/idkit/integrate):
 *   backend signs an RP request (signRequest, @worldcoin/idkit-core/signing) →
 *   browser runs IDKit with rp_context + the signal → World App returns a proof →
 *   backend forwards the proof UNCHANGED to POST developer.world.org/api/v4/verify/{rp_id},
 *   checks environment, and stores the nullifier.
 *
 * TRACE binds each request to one authorization:
 *   - signal  = keccak256(the exact EIP-712 claims: wallet, chain, strategy id,
 *               strategy version hash, plan hash, action, challenge, expiry),
 *   - request = the RP nonce/expiry issued for that challenge, sealed with a server-keyed
 *               token so a proof from any other request (or after expiry) is refused,
 *   - replay  = challenge consumed atomically + (nullifier, action#nonce) recorded once.
 * Identity verification is never inferred from the wallet signature, and vice versa.
 */

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
export const PROTECTED_ACTIONS = new Set(["aqua:ship"]);

export const worldConfigured = (w: WorldConfig) => Boolean(w.appId && w.rpId && w.signingKey);
export const worldRequired = (w: WorldConfig, action: string) => (w.enforce ?? true) && PROTECTED_ACTIONS.has(action);

/** Exactly what an operator must register to enable protected execution. */
export const WORLD_REQUIREMENTS =
  "Register an app at developer.world.org with World ID 4.0 enabled, then set WORLD_APP_ID (app_…), WORLD_RP_ID (rp_…) and WORLD_RP_SIGNING_KEY (secret) on the API server; WORLD_ENVIRONMENT=staging uses the World ID simulator, production needs a real World App.";

export type WorldRequest = {
  app_id: string;
  action: string;
  environment: "staging" | "production";
  signal: Hex;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  /** Seals (challenge, nonce, expiry) so the server can tell which request a proof answers. */
  token: Hex;
};

/** Server-keyed seal over a World ID request; the signing key never leaves the server. */
export function worldRequestToken(w: WorldConfig, challenge: string, nonce: string, expiresAt: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "uint64" }, { type: "string" }],
      ["trace-world-request-v1", w.signingKey ?? "", challenge as Hex, nonce, BigInt(expiresAt), w.action],
    ),
  );
}

/** Backend RP signature + the signal for one authorization challenge (never computed in the browser). */
export async function worldRpRequest(w: WorldConfig, claims: AuthorizationClaims, ttlSeconds = 600): Promise<WorldRequest> {
  if (!worldConfigured(w)) throw new Error("World ID not configured (WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY)");
  const { signRequest } = await import("@worldcoin/idkit-core/signing");
  const sig = signRequest({ signingKeyHex: w.signingKey!, action: w.action, ttl: ttlSeconds });
  return {
    app_id: w.appId!,
    action: w.action,
    environment: w.environment,
    signal: worldSignal(claims),
    rp_context: { rp_id: w.rpId!, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
    token: worldRequestToken(w, claims.challenge, sig.nonce, sig.expiresAt),
  };
}

export type WorldProofSubmission = {
  /** The IDKit result, exactly as IDKit returned it. */
  result: Record<string, unknown>;
  /** Echo of the request the server issued for this challenge. */
  request: { nonce: string; expires_at: number; token: string };
};

export type WorldVerdict = { status: "verified" | "rejected" | "expired"; nullifier: string | null; detail: string };

/**
 * Validate a World ID proof for one authorization. Local checks first (request seal,
 * expiry, environment, action, nonce, signal binding), then World's verify API with the
 * proof forwarded unchanged. Never returns "verified" without World's success response.
 */
export async function verifyWorldProof(
  w: WorldConfig,
  sub: WorldProofSubmission | null | undefined,
  claims: AuthorizationClaims,
  opts: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<WorldVerdict> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const reject = (detail: string): WorldVerdict => ({ status: "rejected", nullifier: null, detail });
  if (!worldConfigured(w)) return reject("World ID is not configured on this server");
  if (!sub || typeof sub !== "object" || !sub.result || !sub.request) return reject("no World ID proof was provided (verification not completed or cancelled)");
  const { result, request } = sub;
  if (worldRequestToken(w, claims.challenge, String(request.nonce), Number(request.expires_at)) !== request.token)
    return reject("proof does not answer a World ID request this server issued for this authorization");
  if (now > Number(request.expires_at)) return { status: "expired", nullifier: null, detail: "the World ID request expired before the proof was submitted" };
  if (result.nonce !== request.nonce) return reject("proof was generated for a different World ID request (nonce mismatch)");
  if (result.session_id && !result.action) return reject("a session proof cannot authorize an action");
  if (result.action !== undefined && result.action !== w.action) return reject(`proof is for action "${String(result.action)}", not "${w.action}"`);
  if (result.environment !== w.environment) return reject(`proof environment "${String(result.environment)}" does not match this server (${w.environment})`);
  const responses = (result.responses as { signal_hash?: string; nullifier?: string }[] | undefined) ?? [];
  if (!Array.isArray(responses) || responses.length === 0) return reject("IDKit result has no credential responses");
  const { hashSignal } = await import("@worldcoin/idkit-core/hashing");
  const expectedHash = hashSignal(worldSignal(claims)).toLowerCase();
  if (!responses.every((r) => (r.signal_hash ?? "").toLowerCase() === expectedHash))
    return reject("proof is bound to different claims (signal mismatch: strategy version, plan hash, action, challenge or expiry changed)");

  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`https://developer.world.org/api/v4/verify/${w.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return reject(`World verify API unreachable: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; nullifier?: string; environment?: string; detail?: string; code?: string };
  if (!res.ok || body.success !== true) return reject(`World verify API rejected the proof (${res.status}${body.code ? ` ${body.code}` : ""}${body.detail ? `: ${body.detail}` : ""})`);
  if (body.environment !== undefined && body.environment !== w.environment) return reject(`World verified the proof in "${body.environment}", not ${w.environment}`);
  const nullifier = (body.nullifier ?? responses[0].nullifier ?? "").toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(nullifier)) return reject("World verify API returned no nullifier");
  return { status: "verified", nullifier, detail: `verified by World (${w.environment})` };
}

export type { AuthorizationClaims, AuthorizationVerification };
