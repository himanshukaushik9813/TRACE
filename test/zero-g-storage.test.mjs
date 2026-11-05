// @trace/zero-g-storage — 0G archiving: the demo path is labelled `demo:true`
// and never masquerades as a live write; a failed live write is a hard error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archive } from "@trace/zero-g-storage";

test("the demo path (no endpoint) returns labelled, content-hashed refs", async () => {
  const refs = await archive({
    cfg: {},
    wallet: "0x2C4a9f1bD3e8C2a0F7b1c6E35A9b2F0e1C7DE37C",
    artifacts: [{ kind: "Investigation summary", content: { a: 1 } }],
  });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].demo, true); // the label that drives the UI badge
  assert.ok(refs[0].ref.endsWith("· demo"));
  assert.ok(refs[0].contentHash.length > 0);
  assert.ok(refs[0].sizeBytes > 0);
});

test("content hash is deterministic for identical content", async () => {
  const [a] = await archive({ cfg: {}, wallet: "w", artifacts: [{ kind: "k", content: { x: 1 } }] });
  const [b] = await archive({ cfg: {}, wallet: "w", artifacts: [{ kind: "k", content: { x: 1 } }] });
  assert.equal(a.contentHash, b.contentHash);
  const [c] = await archive({ cfg: {}, wallet: "w", artifacts: [{ kind: "k", content: { x: 2 } }] });
  assert.notEqual(a.contentHash, c.contentHash);
});

test("a failed live write is a hard error, not a silent demo fallback", async () => {
  // Point the endpoint at a local port that immediately rejects — the live
  // path must throw rather than degrade to a labelled ref and call it real.
  let called = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called++;
    return new Response("{}", { status: 500 });
  };
  try {
    await assert.rejects(
      archive({
        cfg: { endpoint: "http://127.0.0.1:0/0g", apiKey: "k" },
        wallet: "w",
        artifacts: [{ kind: "k", content: { x: 1 } }],
      }),
      /0G storage archive failed/,
    );
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.equal(called, 1);
});
