// Case study (Phase 2): the evidence-backed report built from a wallet's stored events.
// Real Sepolia data captured by scripts/capture-test-data.mjs; test-only inputs are labelled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaseStudy, computeFingerprints, inferFromEvidence, isFullRangeLike } from "@trace/strategy-inference";
import { reconstructPositions } from "@trace/uniswap-v3";
import { walletHistory } from "./helpers.mjs";

const h = walletHistory(); // real wallet 0x4A22…909e: MINT ×5, INCREASE, DECREASE ×4, COLLECT ×5, BURN
const metas = Object.values(h.positions);
const fp = computeFingerprints(h.events, h.positions, {}, h.window);
const strategy = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: h.positions, fingerprints: fp }).ir;
const study = (over = {}) => buildCaseStudy({ wallet: h.wallet, chainId: 11155111, events: h.events, meta: metas, window: h.window, fingerprints: fp, strategy, ...over });

test("real wallet: every position and event is reconstructed, in chain order", () => {
  const s = study();
  assert.equal(s.overview.events, h.events.length);
  assert.equal(s.overview.positions, Object.keys(h.positions).length);
  assert.deepEqual(s.overview.byKind, { MINT: 5, INCREASE: 1, DECREASE: 4, COLLECT: 5, TRANSFER: 0, BURN: 1 });
  const all = s.positions.flatMap((p) => p.events).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].block < all[i].block || (all[i - 1].block === all[i].block && all[i - 1].logIndex < all[i].logIndex));
  for (const p of s.positions) for (const e of p.events) assert.equal(e.tokenId, p.tokenId, "events are attached to their own NFT");
});

test("real wallet: fees are kept apart from principal and match the reconstruction ledger", () => {
  const s = study();
  const ledger = reconstructPositions(h.events);
  const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-9);
  for (const [id, t] of ledger) {
    const p = s.positions.find((x) => x.tokenId === id);
    assert.ok(p, `position #${id} present`);
    assert.ok(close(Number(p.totals.fees0), t.feesCollected.t0) && close(Number(p.totals.fees1), t.feesCollected.t1), `#${id} fees match`);
    assert.ok(close(Number(p.totals.withdrawn0), t.withdrawn.t0) && close(Number(p.totals.withdrawn1), t.withdrawn.t1), `#${id} principal withdrawn matches`);
    assert.ok(close(Number(p.totals.deposited0), t.deposited.t0) && close(Number(p.totals.deposited1), t.deposited.t1), `#${id} deposits match`);
  }
  // A Collect's principal part is never counted as fees.
  for (const p of s.positions) for (const c of p.feeCollections) assert.ok(BigInt(c.fee0) > 0n || BigInt(c.fee1) > 0n);
});

test("real wallet: lifecycle, ownership and liquidity replay", () => {
  const s = study();
  const burned = s.positions.find((p) => p.closed);
  assert.ok(burned, "the burned NFT is recognised");
  assert.equal(burned.status, "closed");
  assert.equal(burned.events.at(-1).liquidityAfter, "0");
  for (const p of s.positions.filter((x) => x.opened)) assert.equal(p.ownership[0].from, "0x0000000000000000000000000000000000000000", "a mint comes from the zero address");
  assert.ok(s.liquidityTimeline.every((e) => ["MINT", "INCREASE", "DECREASE", "BURN"].includes(e.kind)));
});

test("every observation cites real events with tx, block, log index, timestamp and source event", () => {
  const s = study();
  const txs = new Set(h.events.map((e) => e.tx.toLowerCase()));
  assert.ok(s.observations.length >= 4);
  for (const o of s.observations) {
    assert.ok(o.explanation.length > 20, `${o.id} explains itself`);
    assert.ok(o.evidence.length > 0, `${o.id} has evidence`);
    for (const e of o.evidence) {
      assert.ok(txs.has(e.tx.toLowerCase()), `${o.id} cites a real tx`);
      assert.ok(Number.isInteger(e.block) && e.block > 0 && Number.isInteger(e.logIndex) && e.timestamp > 0 && e.kind);
    }
  }
  assert.equal(s.coverage.observationsWithEvidence, s.coverage.observations);
  assert.equal(s.coverage.ruleRefsFound, s.coverage.ruleRefs, "every tx the strategy cites is in the evidence");
});

test("incomplete history is reported honestly, not filled in", () => {
  // Test-only: mark one REAL position as opened before the window and drop its mint, as a shorter window would.
  const id = 234012;
  const meta = metas.map((m) => (m.tokenId === id ? { ...m, historyComplete: false } : m));
  const events = h.events.filter((e) => !(e.tokenId === id && e.kind === "MINT"));
  const s = study({ events, meta });
  const p = s.positions.find((x) => x.tokenId === id);
  assert.equal(p.historyComplete, false);
  assert.equal(p.opened, null, "no invented mint");
  assert.equal(s.coverage.positionsWithFullHistory, s.coverage.positions - 1);
  assert.ok(s.limitations.some((l) => l.includes(`#${id}`) && /before the window/.test(l)));
});

test("a cited transaction that is not in the evidence is flagged, never silently dropped", () => {
  const ghost = "0x" + "ab".repeat(32);
  const bad = { ...strategy, rules: [{ ...strategy.rules[0], evidenceRefs: [...strategy.rules[0].evidenceRefs, ghost] }, ...strategy.rules.slice(1)] };
  const s = study({ strategy: bad });
  const o = s.observations.find((x) => x.source === "strategy_rule" && x.missingRefs.length);
  assert.deepEqual(o.missingRefs, [ghost]);
  assert.ok(s.limitations.some((l) => /not among this investigation's events/.test(l)));
});

test("empty wallet: no events → an empty case study that says so, with no observations", () => {
  const s = buildCaseStudy({ wallet: "0x000000000000000000000000000000000000dEaD", chainId: 11155111, events: [], meta: [] });
  assert.equal(s.overview.positions, 0);
  assert.equal(s.overview.events, 0);
  assert.equal(s.observations.length, 0);
  assert.equal(s.overview.firstEvent, null);
  assert.ok(s.limitations[0].startsWith("No Uniswap V3 position events"));
});

test("ranges reaching the edge of the tick range are full-range-like, not 'concentrated' with an absurd width", () => {
  // Found live on 2026-11-06: wallet 0xDb54…45BC opens [-207244, 887272] (unbounded above).
  assert.equal(isFullRangeLike(-207244, 887272), true);
  assert.equal(isFullRangeLike(-887270, 887270), true);
  assert.equal(isFullRangeLike(-600, 600), false);
  // Test-only: give a REAL position that edge range.
  const pos = { ...h.positions, 234012: { ...h.positions[234012], tickLower: -207244, tickUpper: 887272 } };
  const f = computeFingerprints(h.events, pos, {}, h.window);
  assert.ok(f.avgRangeWidthPct == null || f.avgRangeWidthPct < 1e6, "the edge range is excluded from the concentrated average");
  const { ir } = inferFromEvidence({ events: h.events, wallet: h.wallet, window: h.window, meta: pos, fingerprints: f });
  for (const r of ir.rules) assert.doesNotMatch(r.rule, /\d{1,3}(,\d{3}){5,}/, `no astronomically large multiple in "${r.rule}"`);
});
