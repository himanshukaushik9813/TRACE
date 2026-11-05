import { test } from "node:test";
import assert from "node:assert/strict";
import { archive, storageConfigured } from "@trace/zero-g-storage";

test("0G Storage without configuration returns NO references (never a fabricated ref)", async () => {
  assert.equal(storageConfigured({}), false);
  const r = await archive({ cfg: {}, artifacts: [{ kind: "x", content: { a: 1 } }] });
  assert.equal(r.status, "not_configured");
  assert.equal(r.refs.length, 0);
  assert.equal(r.errors.length, 1);
});
