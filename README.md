# TRACE — On-Chain Strategy Intelligence

> **Understand the strategy behind any wallet.**
> Reconstruct Uniswap V3 liquidity behaviour. Discover recurring patterns.
> Validate them against history. Compile the compatible rules into executable
> 1inch Aqua programs.

Category: On-Chain Strategy Intelligence · Built for ETHGlobal Mumbai 2026.

The central experience is a single continuous pipeline:

```
INVESTIGATE  →  RECONSTRUCT  →  DISCOVER  →  VALIDATE  →  EXECUTE
```

A user enters a wallet, TRACE reconstructs what happened on-chain, discovers the
recurring behaviour, explains the possible strategy with evidence, tests it
against history, and translates the compatible rules into a new executable Aqua
strategy with explicit human authorization.

---

## Quick start (exact commands)

### 1. The web app (the demo)

```bash
npm install          # installs next/react/tailwind + symlinks the @trace/* workspaces
npm run dev          # → http://localhost:3000
```

That is the whole demo: every screen runs on the labelled fixture with the
**DEMO DATA** badge, fully offline, no env file needed.

### 2. Everything that can be run without network access

The offline scaffolding (`typecheck-stubs.d.ts`, `tsconfig.typecheck.json`,
`tsconfig.server.json`, `packages/tsconfig.check.json`, `packages/types/*.d.ts`)
was written because this project was scaffolded without registry access. All of
it still works and is the fastest way to verify a change in a minute:

```bash
npm run typecheck          # frontend + engine packages + server, three tsc projects
npm test                   # build engine dist + run the whole suite (node:test, 64 tests)
```

`npm test` covers the engine packages, the **complete wallet-investigation
pipeline workflow** (`runPipeline` + the Express API routes in-process), strategy
inference, backtesting, evidence validation, Aqua compatibility/compile, World
Agent Pass sign/verify (including tamper + replay rejection), 0G storage
labelling, and the frontend data layer + navigation surface.

### 3. The full stack (API + worker + Postgres + Redis)

```bash
# one-time
npm install                              # installs server deps (express, pg, bullmq, viem)
createdb trace
psql trace -f db/schema.sql             # load the schema (the server exits if it isn't there)

# server (API on :4000 + BullMQ worker in the same process)
npm run build:packages                   # engines → dist/
npm run build:server                     # + server → server/dist/
DATABASE_URL=postgres://postgres:postgres@localhost:5432/trace \
REDIS_URL=redis://localhost:6379 \
npm run start:server

# web app wired to the API (new terminal)
cp .env.example .env.local               # then:
#   NEXT_PUBLIC_TRACE_API_URL=http://localhost:4000
npm run dev                              # → http://localhost:3000
```

With `NEXT_PUBLIC_TRACE_API_URL` set, the UI queues real investigations against
the API and shows the **live** source label; with it unset, the same screens
run the labelled demo path and the badge stays on.

---

## What is real and what is mocked

TRACE is designed so the **intelligence pipeline is the product**, and it is
important to be precise about which parts are live integrations and which are
clearly-labelled demo fixtures.

| Capability | Status | Where it lives |
|---|---|---|
| Uniswap V3 position reconstruction (order-independent replay, principal ≠ fees) | **Real, deterministic** | `packages/uniswap-v3` |
| Behavioural fingerprints + rule mining + family scoring | **Real, deterministic** | `packages/strategy-inference` |
| 0G inference *gate* (schema validation + evidence audit + deterministic id) | **Real** — gates any LLM proposal; the **model call** is the demo path unless `ZERO_G_ENDPOINT`+`ZERO_G_API_KEY` are set | `packages/strategy-inference/src/zero-g.ts` |
| Look-ahead-safe backtester (canonical V3 position math, train/test split enforced) | **Real, deterministic** | `packages/backtester` |
| 1inch Aqua compatibility + deterministic IR→program compile | **Real logic** — the capability model is structural; a live build verifies it against Aqua's actual capabilities | `packages/aqua-adapter` |
| World Agent Pass bound-claims (sign + server-side verify, replay protection) | **Real verification logic, demo signature** (HMAC demo key, not World's Ed25519 registry) | `packages/world-auth` |
| 0G Storage archiving | **Real client; demo refs** when `ZERO_G_STORAGE_ENDPOINT` is unset — every ref carries `demo: true` and the UI must label it | `packages/zero-g-storage` |
| Live chain reads (NPM log decode via viem) | **Real client, needs an RPC** per request; typed errors fall back to the labelled fixture | `packages/chain-data` |
| Express API + BullMQ worker + Postgres persistence | **Real** — routes, queue, and `db/schema.sql` | `server/`, `db/` |
| Frontend data layer (queue/poll, live↔demo badge, fixture→wire adapter) | **Real** | `src/lib/live.ts` |
| Editorial design system (ivory/charcoal/gold/sage) + 8 screens + SVG charts | **Real** | `src/components/`, `src/app/`, `tailwind.config.js` |
| The investigation dataset itself (positions, events, equity series) | **Labelled demo fixture** | `src/lib/fixture.ts` — **DEMO DATA badge on every screen that renders it** |

The rule the product lives by: **no fabricated data is presented as real.**
Degradation is explicit: if a live step fails, the pipeline falls back to the
labelled fixture *for that step* and flags the result `degraded` with the exact
reasons — it is never labelled "live".

---

## Architecture

A modular monorepo (npm workspaces): the web app, eight deterministic engine
packages, and a single Express/BullMQ/Postgres deployable.

```
src/                      Next.js 14 App Router web app (8 pages)
  app/                    investigate · positions/[id] · strategy · backtest
                         execute · reports · activity · saved
  components/             app-shell, ui, charts, investigate
  lib/                    fixture.ts (labelled demo data) · live.ts (API data layer)

packages/                 The engine — zero-runtime-dependency TS, runs in
  strategy-ir             shared data contract, canonical hashing, schema gates
  uniswap-v3              event → position ledger + accounting
  strategy-inference      fingerprints, rule mining, 0G gate
  backtester              look-ahead-safe simulation
  aqua-adapter            NFT→Aqua compatibility + deterministic compile
  world-auth              Agent Pass bound-claims sign/verify
  zero-g-storage          archiving client (live + labelled demo paths)
  chain-data              viem client: NPM logs → IR V3Event shapes
  types/                  offline ambient stubs (only used without node_modules)

server/                   Express API + BullMQ worker + pg persistence
db/schema.sql             Postgres schema (incl. a DB-level no-look-ahead trigger)
test/                     node:test suite — engines, pipeline, API workflow, UI
scripts/build-packages.mjs offline two-phase build → each package's dist/
```

Key integrity rules encoded in the product:

- **Blockchain evidence is first-class.** Every lifecycle event links to a
  tx hash, block, and block-explorer link. Position accounting keeps principal
  withdrawals strictly distinct from fees.
- **The AI is not the source of blockchain truth.** Deterministic behavioural
  fingerprints are computed from events first; the 0G model only proposes a
  structured Strategy IR, which is then schema-validated and evidence-audited
  against the deterministic layer before it is ever trusted.
- **No look-ahead bias.** Backtests align on block time, separate the
  inference (train) window from the backtest (test) window, and state all
  gas/slippage assumptions. The invariant is enforced in the engine, the IR
  validator, and again in the database (trigger).
- **Human authorization is real and required.** No transaction ships without a
  World Agent Pass proof bound to the user, strategy version, execution plan,
  action, expiry, and a unique challenge — independently validated server-side,
  with replay protection.
- **No arbitrary bytecode.** The compiler is deterministic (same input → same
  program hash, which the proof pins); the LLM only feeds a validated
  structure. No unlimited token approvals by default.

---

## Environment

See `.env.example` (committed template; copy to `.env` / `.env.local`).

| Variable | Consumed by | Meaning when set |
|---|---|---|
| `DATABASE_URL` | server | Postgres for investigations/strategies/backtests/authorizations/archives |
| `REDIS_URL` | server | BullMQ queue (default `redis://localhost:6379`) |
| `PORT` | server | API+worker port (default 4000) |
| `ZERO_G_ENDPOINT` / `ZERO_G_API_KEY` | server | live 0G Private Computer inference (unset → labelled deterministic demo path) |
| `ZERO_G_STORAGE_ENDPOINT` / `ZERO_G_STORAGE_KEY` | server | live 0G archiving (unset → labelled `… · demo` refs, never called live) |
| `WORLD_DEMO_ID` / `WORLD_DEMO_KEY` | server | Agent Pass world id + demo HMAC key |
| `NEXT_PUBLIC_TRACE_API_URL` | web (browser) | points the UI at the API; unset → every screen runs the labelled fixture |

No RPC key is required anywhere: live chain reads take an `rpcUrl` **per
request** on `POST /investigations`, so a deployment can read any chain without
baking a key into env.

---

## Design system

The visual direction is **editorial luxury fintech × institutional research
terminal × on-chain intelligence** — not a generic dark-mode SaaS dashboard.

- **Surfaces** — warm ivory `#F3EBDD` / paper `#FAF7F0`, charcoal `#171714` /
  deep `#11110F`, stone `#E9E0D0`, graphite `#252520`.
- **Accents** — antique gold `#B68A42` (used sparingly, for importance), muted
  gold `#C6A66B`, sage `#78866B`, deep forest `#344C3A`.
- **Typography** — Playfair Display (serif headings) + Inter (body), tabular
  numerals for all financial figures, small uppercase letter-spaced labels.
- **Illustration** — fine-line engravings, topographic contours, restrained
  gold line work, subtle paper grain. One coherent icon family (Lucide,
  consistent stroke weight).
- **Charts** — dark analytical surfaces with muted gold/sage data; live data is
  always real SVG/HTML, never a generated image.

---

## Testing

```bash
npm test                      # build engine dist + 64 tests (node:test)
npm test:engines              # the suite without rebuilding dist
```

Coverage map: `strategy-ir` (canonical hashing, schema gates), `uniswap-v3`
(reconstruction invariants), `strategy-inference` (fingerprints + 0G gate,
including the no-evidence and schema-invalid rejection paths), `backtester`
(look-ahead guard, canonical V3 value formula, determinism), `aqua-adapter`
(compatibility verdicts, deterministic compile, no unlimited approvals),
`world-auth` (valid proof / tampered hash / replay / wrong key / expiry),
`zero-g-storage` (demo labelling, hard-fail live writes), `pipeline`
(the full reconstruction→inference→backtest→compile→archive workflow with and
without a price series), `api` (the same workflow through the Express route
handlers, with in-memory db/queue stand-ins since Postgres/Redis aren't in
this environment), and `frontend` (data-layer demo paths + navigation).

---

## Three-minute demo script

- **0:00–0:20** — "Blockchain shows us transactions. TRACE reveals the strategy
  behind them." Introduce the problem on the Investigate hero.
- **0:20–0:45** — Load the sample public Uniswap V3 LP (`0x2C…E37C`), run
  Investigate Wallet, watch the five-stage reconstruction pipeline.
- **0:45–1:10** — Open Position Intelligence: reconstructed range occupancy,
  lifecycle events, and the transaction-evidence drawer.
- **1:10–1:35** — Reveal the 0G strategy hypothesis on Strategy Intelligence.
- **1:35–2:00** — Show Strategy DNA and the Strategy Lab equity/drawdown
  comparison against benchmarks.
- **2:00–2:25** — Aqua compatibility + deterministic compilation.
- **2:25–2:45** — World Agent Pass human authorization.
- **2:45–3:00** — Verified execution receipt and the 0G Storage reference.

The demo runs end-to-end on the labelled fixture, so it is repeatable without
network access. Where live integrations are wired up, the same screens swap the
fixture for real data and the badges switch off.
