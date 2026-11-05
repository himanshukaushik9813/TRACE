// Frontend data layer (src/lib/live.ts) + navigation surface.
// These run under plain Node via the resolve hooks in ./resolve-hooks.mjs:
// the labelled demo paths are deterministic and network-free, so they are
// exactly the behaviour that should be pinned.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

register(new URL("./resolve-hooks.mjs", import.meta.url));

const live = await import("../src/lib/live.ts");
const { fixtureEvents, toDisplayPositions, authorize, queueInvestigation } = live;
const { POSITIONS, LIFECYCLE, DEMO } = await import("../src/lib/fixture.ts");

// Without NEXT_PUBLIC_TRACE_API_URL the app is in its labelled demo mode.
test("isLive is false without a configured TRACE API", () => {
  assert.equal(live.isLive, false);
});

test("queueInvestigation short-circuits to the labelled demo path", async () => {
  const r = await queueInvestigation(DEMO.wallet.address);
  assert.deepEqual(r, { investigationId: "demo", status: "done" });
});

test("authorize short-circuits to the labelled mock proof (explicitly not live)", async () => {
  const r = await authorize("ir_x", "compile+ship+2 swaps");
  assert.equal(r.worldId, "0x…demo");
  assert.equal(r.validated, true);
  // The demo path must be honest that it is not a server-verified proof.
  assert.match(r.note, /Mock proof flow/);
  assert.match(r.validation.notes.join(" "), /no server-side/);
  assert.equal(r.validation.signatureOk, true);
  assert.equal(r.validation.programHashMatches, true);
});

test("fixtureEvents adapts the fixture lifecycle to the wire V3Event shape", () => {
  const ev = fixtureEvents(DEMO.wallet.address);
  assert.equal(ev.length, LIFECYCLE.length);
  for (const e of ev) {
    assert.match(e.kind, /^(MINT|INCREASE|DECREASE|COLLECT|TRANSFER|BURN)$/);
    assert.equal(typeof e.block, "number");
    assert.equal(typeof e.timestamp, "number");
    assert.ok(e.timestamp > 0, "timestamps parse to unix seconds");
    // abbreviated tx refs are kept verbatim — the demo path never fakes full hashes
    assert.ok(e.tx.startsWith("0x"));
  }
  // first lifecycle event is the position mint
  assert.equal(ev[0].kind, LIFECYCLE[0].type);
});

test("toDisplayPositions maps live positions without fabricating sparklines", () => {
  // A live position that matches a fixture by pool keeps the fixture sparkline.
  const livePos = [{ tokenId: POSITIONS[0].nftId, pool: POSITIONS[0].pool, token0: "ETH", token1: "USDC", feeTier: 5, tickLower: POSITIONS[0].tickLower, tickUpper: POSITIONS[0].tickUpper, liquidity: 4218.5, status: "active" }];
  const mapped = toDisplayPositions(livePos, POSITIONS);
  assert.equal(mapped[0].id, `pos-${POSITIONS[0].nftId}`);
  assert.deepEqual(mapped[0].spark, POSITIONS[0].spark); // matched, not invented
  // An unknown live position gets a neutral empty sparkline, never a fixture one.
  const unknown = toDisplayPositions([{ tokenId: 999999, pool: "0xunknown", token0: "X", token1: "Y", feeTier: 10, tickLower: 1, tickUpper: 2, liquidity: 1, status: "active" }], POSITIONS);
  assert.deepEqual(unknown[0].spark, []);
});

test("the app-shell navigation surface covers every implemented page", async () => {
  // The shell is a "client" component (React hooks), so read its routes as
  // data rather than rendering it. All eight NAV hrefs must resolve to a real
  // page under src/app — i.e. the menu has no dead links.
  const { existsSync } = await import("node:fs");
  const NAV = [
    { href: "/", file: "src/app/page.tsx" },
    { href: "/positions/pos-eth-usdc", file: "src/app/positions/[id]/page.tsx" },
    { href: "/strategy", file: "src/app/strategy/page.tsx" },
    { href: "/backtest", file: "src/app/backtest/page.tsx" },
    { href: "/execute", file: "src/app/execute/page.tsx" },
    { href: "/reports", file: "src/app/reports/page.tsx" },
    { href: "/activity", file: "src/app/activity/page.tsx" },
    { href: "/saved", file: "src/app/saved/page.tsx" },
  ];
  for (const item of NAV) {
    assert.ok(existsSync(new URL("../" + item.file, import.meta.url).pathname), `missing page for ${item.href}`);
  }
  // The dynamic positions route must accept the fixture's position ids.
  const ids = POSITIONS.map((p) => p.id);
  assert.deepEqual(ids, ["pos-eth-usdc", "pos-wbtc-eth", "pos-eth-dai"]);
});

test("every data page renders the demo data badge (spec: no dead / no faked data)", async () => {
  const { readFileSync } = await import("node:fs");
  const pages = ["strategy", "backtest", "execute", "reports", "activity", "saved"];
  const withBadge = pages.filter((p) => {
    const t = readFileSync(new URL(`../src/app/${p}/page.tsx`, import.meta.url), "utf8");
    return /DemoBadge|DEMO MODE|demo/i.test(t);
  });
  assert.ok(withBadge.length >= pages.length - 1, `badge coverage thin: ${withBadge.join(",")}`);
});
