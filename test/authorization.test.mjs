import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildTypedData, newChallenge, verifyAuthorization, worldSignal } from "@trace/world-auth";

// A throwaway key generated per test run — exists only in memory, never funded.
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

const claims = (over = {}) => ({
  wallet: account.address,
  chainId: 11155111,
  strategyId: "ir_abc",
  strategyVersionHash: "fnv1a:1234…ab",
  planHash: "deadbeefdeadbeef",
  action: "aqua:ship",
  challenge: newChallenge(),
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  ...over,
});
const expected = (c) => ({ wallet: account.address, strategyVersionHash: c.strategyVersionHash, planHash: c.planHash, action: c.action, chainId: 11155111 });
const sign = (c, acct = account) => acct.signTypedData(buildTypedData(c));

test("a valid EIP-712 authorization verifies", async () => {
  const c = claims();
  const r = await verifyAuthorization({ claims: c, signature: await sign(c), expected: expected(c), challengeFresh: true });
  assert.equal(r.validated, true, r.verification.notes.join("; "));
  assert.equal(r.signer, account.address);
});

test("tampered plan hash is rejected (signature no longer matches the claims)", async () => {
  const c = claims();
  const sig = await sign(c);
  const r = await verifyAuthorization({ claims: { ...c, planHash: "0000000000000000" }, signature: sig, expected: expected(c), challengeFresh: true });
  assert.equal(r.validated, false);
});

test("claims that do not match the stored plan / strategy version are rejected", async () => {
  const c = claims();
  const r = await verifyAuthorization({ claims: c, signature: await sign(c), expected: { ...expected(c), planHash: "other" }, challengeFresh: true });
  assert.equal(r.validated, false);
  assert.equal(r.verification.planHashMatches, false);
});

test("signature from a different wallet is rejected", async () => {
  const c = claims();
  const r = await verifyAuthorization({ claims: c, signature: await sign(c, other), expected: expected(c), challengeFresh: true });
  assert.equal(r.validated, false);
  assert.equal(r.verification.signerMatches, false);
});

test("expired authorization is rejected", async () => {
  const c = claims({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
  const r = await verifyAuthorization({ claims: c, signature: await sign(c), expected: expected(c), challengeFresh: true });
  assert.equal(r.validated, false);
  assert.equal(r.verification.notExpired, false);
});

test("replayed challenge is rejected", async () => {
  const c = claims();
  const r = await verifyAuthorization({ claims: c, signature: await sign(c), expected: expected(c), challengeFresh: false });
  assert.equal(r.validated, false);
  assert.equal(r.verification.challengeFresh, false);
});

test("non-Sepolia chain id is rejected", async () => {
  const c = claims({ chainId: 1 });
  const r = await verifyAuthorization({ claims: c, signature: await sign(c), expected: expected(c), challengeFresh: true });
  assert.equal(r.validated, false);
});

test("World ID signal binds the exact claims", () => {
  const c = claims();
  assert.equal(worldSignal(c), worldSignal({ ...c }));
  assert.notEqual(worldSignal(c), worldSignal({ ...c, planHash: "x" }));
});
