// Re-queue decisions for BullMQ jobs (server/src/worker.ts). A boot-time
// re-queue must never leave an investigation stuck in "queued".
import { test } from "node:test";
import assert from "node:assert/strict";
import { requeueDecision } from "../server/dist/worker.js";

test("a job still waiting to run is kept (adding again is idempotent)", () => {
  for (const s of ["waiting", "delayed", "prioritized", "waiting-children"]) assert.equal(requeueDecision(s, true), "keep");
});

test("no existing job → add under the investigation id", () => {
  assert.equal(requeueDecision(null, false), "add");
  assert.equal(requeueDecision("unknown", true), "add");
});

test("a finished job will never run again → a fresh job is added", () => {
  assert.equal(requeueDecision("failed", false), "add-new-id");
  assert.equal(requeueDecision("completed", true), "add-new-id");
});

test("at boot, a job left active by the dead process is replaced; otherwise an active job is kept", () => {
  assert.equal(requeueDecision("active", true), "add-new-id");
  assert.equal(requeueDecision("active", false), "keep");
});
