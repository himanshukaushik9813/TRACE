import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildEvidencePack, computeFingerprints, gateProposal, inferFromEvidence, runZeroGInference } from "@trace/strategy-inference";
import { validateStrategyIR } from "@trace/strategy-ir";
import { walletHistory } from "./helpers.mjs";

const h = walletHistory();
const base = () => inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions });

test("fingerprints come from real events and positions()", () => {
  const f = computeFingerprints(h.events, h.positions, {}, h.window);
  assert.equal(f.eventCount, h.events.length);
  assert.equal(f.positionCount, Object.keys(h.positions).length);
  assert.equal(f.timeInRangePct, null, "no price data → not measured, never estimated");
  assert.ok(f.avgRangeWidthTicks > 0);
});

test("deterministic baseline is schema-valid and every rule cites a tx present in the evidence", () => {
  const { ir } = base();
  assert.deepEqual(validateStrategyIR(ir).issues, []);
  const txs = new Set(h.events.map((e) => e.tx));
  for (const r of ir.rules) for (const t of r.evidenceRefs) assert.ok(txs.has(t), `rule cites unknown tx ${t}`);
});

test("too little evidence yields an inconclusive strategy with no invented rules", () => {
  const { ir } = inferFromEvidence({ events: h.events.slice(0, 1), wallet: h.wallet, window: h.window, meta: h.positions });
  assert.equal(ir.family, "inconclusive");
  assert.equal(ir.rules.length, 0);
});

test("gate: rules citing transactions outside the evidence set are rejected; confidence capped", () => {
  const { ir: baseline, fingerprints } = base();
  const pack = buildEvidencePack(h.events, fingerprints, h.window);
  const real = h.events[0].tx;
  const run = { status: "succeeded", requestId: "req-1", model: "m", teeVerified: null, rulesRejected: 0 };
  const g = gateProposal(
    {
      family: "active_range_management",
      confidence: 0.99,
      rules: [
        { category: "entry", rule: "ok", evidence: "e", evidenceRefs: [real], confidence: 0.99, alternative: "a", uncertainty: "u" },
        { category: "exit", rule: "invented", evidence: "e", evidenceRefs: [`0x${"ab".repeat(32)}`], confidence: 0.9, alternative: "a", uncertainty: "u" },
      ],
    },
    pack,
    { wallet: h.wallet, baseline, run },
  );
  assert.equal(g.ok, true);
  assert.equal(g.ir.rules.length, 1);
  assert.equal(run.rulesRejected, 1);
  assert.ok(g.ir.confidence < 0.99, "confidence capped at deterministic support");
  assert.equal(g.ir.source.provider, "0G_ROUTER");
  assert.equal(g.ir.source.requestRef, "req-1");
});

test("0G not configured → honest not_configured result, no AI answer fabricated", async () => {
  const { ir: baseline, fingerprints } = base();
  const r = await runZeroGInference({ pack: buildEvidencePack(h.events, fingerprints, h.window), wallet: h.wallet, baseline, cfg: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_configured");
});

test("0G provider error is surfaced with the router request id (controlled local HTTP stub)", async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "no_provider_for_trust_mode", message: "no provider" }, request_id: "rid-42" }));
  });
  await new Promise((r) => srv.listen(0, r));
  const { ir: baseline, fingerprints } = base();
  const r = await runZeroGInference({
    pack: buildEvidencePack(h.events, fingerprints, h.window),
    wallet: h.wallet,
    baseline,
    cfg: { routerUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: "sk-test", model: "m" },
  });
  srv.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "provider_error");
  assert.equal(r.run.requestId, "rid-42");
  assert.equal(r.run.errorCode, "no_provider_for_trust_mode");
});

test("0G success path: a valid JSON hypothesis passes the gate (controlled local HTTP stub)", async () => {
  const { ir: baseline, fingerprints } = base();
  const real = h.events.find((e) => e.kind === "MINT").tx;
  const srv = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chat-1",
        model: "glm-4.7",
        choices: [{ message: { content: JSON.stringify({ family: "active_range_management", confidence: 0.5, rules: [{ category: "entry", rule: "Opens concentrated ranges", evidence: "mints", evidenceRefs: [real], confidence: 0.5, alternative: "a", uncertainty: "u", mapsTo: "allocation" }], limitations: ["x"] }) } }],
        x_0g_trace: { request_id: "rid-ok", provider: "0xprov", tee_verified: true },
      }),
    );
  });
  await new Promise((r) => srv.listen(0, r));
  const r = await runZeroGInference({
    pack: buildEvidencePack(h.events, fingerprints, h.window),
    wallet: h.wallet,
    baseline,
    cfg: { routerUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: "sk-test", model: "glm-4.7", verifyTee: true },
  });
  srv.close();
  assert.equal(r.ok, true);
  assert.equal(r.ir.source.requestRef, "rid-ok");
  assert.equal(r.ir.source.attested, true);
  assert.equal(r.ir.parentId, baseline.id);
});
