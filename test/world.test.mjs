// Phase 5 — World ID 4.0 proof validation (packages/world-auth).
// World's verify API is replaced by a TEST DOUBLE (fetchImpl); the RP signing key is
// generated locally for the test. No real World ID verification happens here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { worldRpRequest, verifyWorldProof, worldSignal, worldRequired, worldConfigured, WORLD_REQUIREMENTS } from "@trace/world-auth";

const W = { appId: "app_test", rpId: "rp_test", signingKey: generatePrivateKey(), action: "trace-authorize-execution", environment: "staging", enforce: true };
const now = Math.floor(Date.now() / 1000);
const claims = {
  wallet: privateKeyToAccount(generatePrivateKey()).address,
  chainId: 11155111,
  strategyId: "s-1",
  strategyVersionHash: "fnv1a:version",
  planHash: "planhash",
  action: "aqua:ship",
  challenge: `0x${"12".repeat(32)}`,
  expiresAt: now + 600,
};
const ok = (over = {}) => async (_url, init) => {
  const body = JSON.parse(init.body);
  return new Response(JSON.stringify({ success: true, nullifier: body.responses[0].nullifier, environment: body.environment, ...over }), { status: 200 });
};
async function setup(c = claims) {
  const req = await worldRpRequest(W, c);
  const result = { protocol_version: "4.0", nonce: req.rp_context.nonce, action: req.action, environment: req.environment, responses: [{ identifier: "proof_of_human", signal_hash: hashSignal(req.signal), proof: "p", nullifier: "0xAB12" }] };
  return { req, sub: { result, request: { nonce: req.rp_context.nonce, expires_at: req.rp_context.expires_at, token: req.token } } };
}

test("a valid proof bound to these claims is verified, and the nullifier is the identity reference", async () => {
  const { sub } = await setup();
  const v = await verifyWorldProof(W, sub, claims, { fetchImpl: ok() });
  assert.equal(v.status, "verified");
  assert.equal(v.nullifier, "0xab12");
});

test("the signal binds wallet, strategy version, plan hash, action, challenge and expiry", () => {
  const base = worldSignal(claims);
  for (const [k, v] of Object.entries({ wallet: privateKeyToAccount(generatePrivateKey()).address, strategyVersionHash: "fnv1a:other", planHash: "other", action: "aqua:dock", challenge: `0x${"34".repeat(32)}`, expiresAt: claims.expiresAt + 1 }))
    assert.notEqual(worldSignal({ ...claims, [k]: v }), base, k);
});

test("expired: a proof submitted after its World ID request expired is rejected as expired", async () => {
  const { sub } = await setup();
  const v = await verifyWorldProof(W, sub, claims, { fetchImpl: ok(), now: sub.request.expires_at + 1 });
  assert.equal(v.status, "expired");
});

test("modified plan or strategy version: a proof made for other claims is rejected (signal mismatch)", async () => {
  const { sub } = await setup();
  for (const changed of [{ ...claims, planHash: "changed" }, { ...claims, strategyVersionHash: "changed" }, { ...claims, action: "aqua:dock" }]) {
    // Same challenge (so the request seal matches); different bound claims.
    const v = await verifyWorldProof(W, sub, changed, { fetchImpl: ok() });
    assert.equal(v.status, "rejected");
    assert.match(v.detail, /signal mismatch/);
  }
});

test("a proof for another request, a forged request seal, another nonce, action or environment is rejected", async () => {
  const { sub } = await setup();
  const other = await setup({ ...claims, challenge: `0x${"56".repeat(32)}` });
  const cases = [
    [{ ...sub, request: other.sub.request }, /did not|does not answer/],
    [{ ...sub, request: { ...sub.request, expires_at: sub.request.expires_at + 3600 } }, /does not answer/],
    [{ ...sub, result: { ...sub.result, nonce: other.sub.result.nonce } }, /nonce mismatch/],
    [{ ...sub, result: { ...sub.result, action: "other-action" } }, /not "trace-authorize-execution"/],
    [{ ...sub, result: { ...sub.result, environment: "production" } }, /environment/],
    [{ ...sub, result: { ...sub.result, action: undefined, session_id: "session_1" } }, /session proof/],
    [{ ...sub, result: { ...sub.result, responses: [] } }, /no credential responses/],
  ];
  for (const [s, re] of cases) {
    const v = await verifyWorldProof(W, s, claims, { fetchImpl: ok() });
    assert.equal(v.status, "rejected");
    assert.match(v.detail, re);
  }
});

test("World's API decides: a rejected, failing, wrong-environment or nullifier-less answer is never 'verified'", async () => {
  const { sub } = await setup();
  const answers = [
    async () => new Response(JSON.stringify({ success: false, code: "invalid_proof" }), { status: 400 }),
    async () => new Response(JSON.stringify({ success: false, code: "max_verifications_reached" }), { status: 200 }),
    async () => {
      throw new Error("network down");
    },
    ok({ environment: "production" }),
    async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  ];
  const noNull = { ...sub, result: { ...sub.result, responses: [{ ...sub.result.responses[0], nullifier: undefined }] } };
  for (const [i, f] of answers.entries()) {
    const v = await verifyWorldProof(W, i === 4 ? noNull : sub, claims, { fetchImpl: f });
    assert.equal(v.status, "rejected", `answer ${i}: ${v.detail}`);
  }
});

test("no proof (cancelled) and no registration are rejected; protected actions are listed explicitly", async () => {
  assert.equal((await verifyWorldProof(W, null, claims)).status, "rejected");
  assert.equal((await verifyWorldProof({ ...W, signingKey: undefined }, (await setup()).sub, claims)).status, "rejected");
  assert.equal(worldRequired(W, "aqua:ship"), true);
  assert.equal(worldRequired(W, "aqua:dock"), false);
  assert.equal(worldRequired({ ...W, enforce: false }, "aqua:ship"), false);
  assert.equal(worldConfigured({ ...W, appId: undefined }), false);
  assert.match(WORLD_REQUIREMENTS, /developer\.world\.org/);
  await assert.rejects(worldRpRequest({ ...W, rpId: undefined }, claims), /not configured/);
});
