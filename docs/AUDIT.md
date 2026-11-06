# TRACE: feature audit (2026-11-06)

Statuses: **Working**, **Partially Working**, **Broken**, **Mock Only**, **Not Implemented**.

Every status below cites evidence that was actually run: a command, a test, or a
live check on Sepolia, Supabase or Upstash. Reading code alone was never enough
to mark a feature "Working".

> Mock data: none in live mode. A search of `src/`, `server/src` and
> `packages/*/src` for mock, fixture, demo, sample, fake and simulate found only
> comments that state there is none. "Simulate" always means a real `eth_call`
> or the backtester. Test doubles live only under `test/` and `e2e/`.

## 1. Module status (before the redesign)

| # | Module | Status | Real data | Loading / error / empty | Refresh | Beginner-clear | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Investigate (wallet search + on-chain investigation) | **Working** | Sepolia via Infura (credit-limited), Supabase | yes / yes / yes | resets to a blank page on reload (by request); keeps `?inv=` on links | **No**: tick ranges, RPC calls, SwapVM and EIP-712 on the first screen | Live run of `0x4797…`: `done` in 17 s (cached), 1 position, backtest completed, 4 runs. `test:live` covers find, reconstruct, and `NO_EVENTS` for an empty wallet. E2E "empty state". |
| 2 | Positions (NFT discovery + reconstruction) | **Working** | NPM ERC-721 transfers + lifecycle logs | from the gate / gate + detail / yes | `?inv=` kept | **No**: NonfungiblePositionManager, uint128, ticks | `test/reconstruction.test.mjs` (order independence, collect split, decimals). The live run above stored 1 position. E2E "renders real data on every screen". |
| 3 | Strategy Intelligence (inference, fingerprints, evidence) | **Partially Working** | deterministic baseline from real events | yes / yes / yes | kept | **No**: wall of rules, IR hashes, TEE | The baseline works (`inference.test.mjs`, live run gives `passive_concentrated`). The **0G hypothesis is blocked**; see row 8. |
| 4 | Backtest (replay, benchmarks, What If) | **Partially Working** | real pool swaps; look-ahead guard enforced by a DB trigger | yes / yes / yes | kept | **No**: Max DD, IL, counterfactual | `backtester.test.mjs` (valuation bounds, look-ahead, determinism). The live run completed 4 runs. **What If: Not Implemented. Capital utilization is computed but never shown.** |
| 5 | Strategy Versions (history + comparison) | **Partially Working** | `strategies` table (immutable, content-addressed) | yes / partial / yes | kept | **No**: raw family keys, irId, hash | List works (`/strategies/by-wallet`). **Compare: Not Implemented.** Ids carried only ~24 bits (bug B6). |
| 6 | Execute (compatibility, compile, authorization, execution) | **Working** | Aqua registry + router on Sepolia, real receipts | yes / yes / yes | refresh-safe (send intents are reconciled) | **No**: calldata, plan hash, `signatureOk` | **Real MetaMask runs from `0x6583…d2De` (two):** approve `0x04b632a8…` + ship `0x48350bf8…` (blocks 12074436/438), approve `0x0983a2de…` + ship `0x4de0a62e…` (12074613/615), all `success`. `test:fork`: approve → ship → dock on an Anvil Sepolia fork. Two separate execution UIs existed (home and `/execute`). |
| 8 | 0G Private Computer (AI inference) | **Not available (blocked)** | — | labelled with the reason | — | partly | Every live call returns `no_provider_for_trust_mode`: the key is locked to "private" trust mode and no private provider exists. The baseline is kept as primary; no fake hypothesis is shown. |
| 9 | 0G Storage (artifacts) | **Not available (blocked)** | — | labelled with the reason | — | partly | The burner `0xe8f9…754A` has a balance of 0 on Galileo, so the archive fails fast with a faucet message. `storage.test.mjs`: unconfigured gives no refs. |
| 10 | Reports | **Working** (no export) | `/full`, `/integrations`, `/archive` | yes / yes / yes | kept | **No**: fingerprint, `eth_getCode` | E2E visits Reports. Integration labels re-checked live (see section 3). **Download/export: Not Implemented.** |
| 11 | Activity | **Working** | `/activity/:wallet` (Postgres + receipts) | yes / yes / yes | n/a (wallet input) | **No**: raw op names | Shows the user's real approve/ship rows. |

## 2. Bugs found and fixed (Phase 1)

| ID | Bug | Fix | Proof |
|---|---|---|---|
| B1 | `POST /plans/:id/reconcile` used a raw viem client: up to 150 full-block `getBlock` calls outside the shared Infura credit limiter, competing with running investigations | New `findSentTx` / `pendingNonce` in `packages/chain-data` (credit-limited). Candidates come from the contract's logs (ERC-20 `Approval` with owner = maker, Aqua `Shipped`/`Docked`), then a tx lookup per candidate | Live: reconcile found the real ship `0x4de0a62e…` in 2 s and approve `0x0983a2de…` in 5 s, with no duplicate rows. With nothing sent, it returns `not_sent` |
| B2 | With BullMQ, a run that was active when the API died could stay `queued` forever. The old job was still "active" (15-minute lock) or already "failed", and the idempotent `add` treated it as present | `requeueDecision()` in `server/src/worker.ts`: a waiting job is kept; a failed or completed job, or one left active by a dead process (boot `recover`), gets a fresh job id | `test/worker.test.mjs` (4 tests) |
| B3 | Two concurrent ship posts for one plan: the second hit the `transactions_one_live_ship` unique index and returned **500** | Postgres `23505` on that index now returns **409** "not recording a duplicate" | `test/api.test.mjs` |
| B4 | "Retry archive" uploaded 3 artifacts; the pipeline uploads 4 (it dropped `inference-run`) | The retry now archives the latest inference run too | code review; same `archive()` call as the pipeline |
| B5 | Malformed investigation id on `/events` or `/positions/:tokenId` returned **500** | uuid check, now **404** | `test/api.test.mjs` |
| B6 | Strategy ids (`ir_fnv1a` + 6 hex) and version hashes (`fnv1a:xxxx…yy`) carried **~24 bits**. `insertStrategy` uses `on conflict (ir_id) do nothing`, so a collision silently attached *another investigation's* strategy. The version hash is what the EIP-712 authorization binds to | `idHash()`: 64 bits for ids, version hashes and event fingerprints. Old stored ids stay valid (they are opaque strings) | `test/strategy-ir.test.mjs`: 5,000 distinct IRs produce 5,000 distinct ids and hashes. Live run: `ir_075b2892542398e8` / `fnv1a:5c00290f25cd21b1` |
| B7 | The EIP-712 integration label was hardcoded "IMPLEMENTED BUT NOT VERIFIED" even after real signatures | Derived from the DB (≥ 1 validated authorization gives VERIFIED TESTNET), the same rule as Aqua | Live `/integrations?refresh=1`: "2 wallet signature(s) verified" |
| B8 | A run cancelled mid-stage still wrote DNA, strategies, the inference run, the backtest and storage until the next stage boundary | `checkpoint()` before every write in `pipeline.ts`; the backtest `catch` re-throws the cancellation | Live: cancelled during `fetching`, then **0** rows in positions, strategies, DNA, backtest, storage and events. Worker log: "cancelled; stopped at a stage boundary" |
| B9 | Home "Source and assumptions" printed slippage `0.003%` (the fraction 0.003 = 0.3 %) | `fmt.frac` | — |
| B10 | `/positions/[id]` ignored an error loading the investigation; `/saved` ignored an investigation load error and showed raw family keys (`passive_concentrated`) | Error states added; `FAMILY` labels | typecheck |
| B11 | (found in Phase 3) `investigation.fromBlock/toBlock` are Postgres bigints and reach the browser as **strings**, although the client type says `number`. Arithmetic on them silently failed (`Number.isFinite("118…")` is false) | The terrain coerces with `Number()`; the audit records the type mismatch | Live: the 3D view now renders for `0x4797…` |

## 3. Integrations (live, `GET /integrations?refresh=1`, re-checked at the end of Phase 8, block 12,075,158)

| Key | Status | Detail |
|---|---|---|
| sepolia | VERIFIED TESTNET | chainId 11155111, live head block |
| uniswap | VERIFIED TESTNET | Factory / NPM / QuoterV2 / SwapRouter02 code present |
| aqua | VERIFIED TESTNET | 2 successful ship transactions verified from receipts |
| eip712 | VERIFIED TESTNET | 2 wallet signatures verified by the server |
| zerog_inference | BLOCKED BY EXTERNAL DEPENDENCY | `no_provider_for_trust_mode` (key locked to "private") |
| zerog_storage | BLOCKED BY EXTERNAL DEPENDENCY | uploader balance 0 0G on Galileo |
| database | VERIFIED LIVE | migrations 0001–0003 |
| queue | VERIFIED LIVE | BullMQ on Upstash (TLS) |

Two further bugs were found while testing the redesign:

| ID | Bug | Fix | Proof |
|---|---|---|---|
| B12 | (Phase 8) A `<Term>` tooltip opened on hover/focus and was then toggled **shut** by the click of the same tap or click. Touch browsers emulate `mouseenter` before `click`, so **on a phone a tap never showed the explanation** | A click within 400 ms of opening keeps the tooltip open; a later click, Escape, or a tap elsewhere closes it | `e2e/ux.spec.ts` "glossary terms…" on desktop and on a 390 px touch viewport |
| B13 | (Phase 8) At 390 px the 3D terrain's centred edge labels (the upper price, "Start of window") ran off the canvas | Price labels are anchored inward; on narrow canvases only "Latest block" sits just inside the right edge | Screenshot `docs/screenshots/03-positions-390.jpg` |

## 4. Module status (after the redesign)

| # | Module | Status | What changed | Evidence |
|---|---|---|---|---|
| 1 | Investigate | **Working** | The hero is the wallet input. "Try an example wallet" uses `0x4797…` (a real WETH/USDC LP). It adds a first-visit welcome card, a four-stage workflow (Analyze, Understand, Verify, Execute) driven by real status, and summary cards that link to each page. Execution moved to `/execute`. A refresh still starts fresh | E2E 5, 6 and 7. `ux.spec` checks every page |
| 2 | Positions | **Working** | A three.js liquidity terrain (price × time × liquidity, plus the real price line), with a 2D fallback without WebGL. Cards are plain; technical details are collapsed on `/positions/[id]` | E2E 4. `ux.spec` checks the terrain and the no-WebGL fallback (desktop and mobile) |
| 3 | Strategy Intelligence | **Partially Working** (0G AI blocked externally) | Leads with "possible strategy", stated as a hypothesis and not confirmed intent. Then a plain explanation, "Why TRACE thinks this", evidence with tx links and an Aqua mark per rule, confidence with its caveat, alternatives and limitations. IR, hashes and the 0G source sit under Technical details | E2E 4 |
| 4 | Backtest | **Working** | Plain cards for Observed vs Simulated, now including capital utilization. Simulated lines are dashed. **What If** (`POST /investigations/:id/whatif`): width, re-centre, starting money and cost per move; not persisted; always labelled "Simulation, not observed". Default options reproduce the stored backtest byte for byte | `backtester.test.mjs` (golden plus What If isolation), `api.test.mjs` (validation), E2E 4 runs a real What If |
| 5 | Strategy Versions | **Working** | Now a tab of Strategy. **Compare** shows two versions side by side, with changed rows highlighted and the rule-set difference. `GET /strategies/:id`. `/saved` redirects | `api.test.mjs`, E2E 4 and `ux.spec` |
| 6 | Execute | **Working** | One 8-step guided flow on the single server-state hook:<br>1. Review<br>2. Compatibility<br>3. What will not run<br>4. Amounts<br>5. Transaction review<br>6. Authorize<br>7. Wallet confirm<br>8. Receipt<br>Dock and taker moved under Advanced. Nothing is sent without a wallet confirmation | E2E 6 (mocked wallet: rejected approve, then resume, ship, 8 of 8, and nothing sent twice). `test:fork` (approve → ship → dock on the real Aqua bytecode). The real MetaMask runs in section 1 |
| 8 | 0G Private Computer | **Not available (blocked)** | Plain reason on Strategy, Reports and the top bar | `/integrations` |
| 9 | 0G Storage | **Not available (blocked)** | The Reports archive section explains why, with a "Try archiving again" button | `/integrations` |
| 10 | Reports | **Working** | A plain summary (found, strategy, performance, executed), **Download report (JSON)** of the real `/full` payload, plain integration statuses with technical labels in tooltips | E2E 4 (download filename) |
| 11 | Activity | **Working** | Plain actions ("Approved WETH for Aqua", "Strategy sent to Aqua"), grouped by investigation; receipts in details. `listTransactions` joins the strategy and investigation | Screenshot 10 shows the real transactions of `0x6583…d2De` |

## 5. Tests run (final, 2026-11-06)

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Lint | `npx next lint` | no warnings or errors |
| Unit / API | `npm test` | **56 / 56** pass |
| Live Sepolia | `npm run test:live` | **4 / 4** pass |
| Fork (Anvil, real Aqua bytecode) | `npm run test:fork` | **1 / 1** pass: approve → ship → dock, verified from receipts |
| E2E desktop (1440 px) + mobile (390 px touch) | `npx playwright test` | **15 / 15** pass |

The E2E suite covers, as named in `e2e/trace.spec.ts` and `e2e/ux.spec.ts`:
- **Basics:** the Sepolia indicator, wrong-network detection and switching, and the empty state for a wallet without positions.
- **Every screen on a real investigation:** the 3D terrain, details, hypothesis wording, the `/saved` redirect and compare, a real What If run, the report download, and the live compatibility check.
- **Workflow ticks** come only from real evidence.
- **Guided Execute** with a rejected approve that resumes, and no double send.
- **Refresh:** Investigate resets; every other page keeps `?inv=`.
- **Onboarding** shows once (Skip, Don't show again, Replay).
- **Navigation order**, desktop and mobile.
- **Glossary tooltips:** click, tap, keyboard, Escape; they stay inside the viewport.
- **Every page** has no console errors and no sideways overflow, desktop and mobile.
- **Terrain:** renders in 3D, and falls back to 2D without WebGL.

**Not run (needs the user):** a new MetaMask signature and ship. Two real ones were done earlier today; see section 1, row 6. 0G needs credentials or funds.

## 6. Still unavailable (external, reported honestly)

| Feature | Why | What unblocks it |
|---|---|---|
| 0G Private Computer inference | The API key is locked to "private" trust mode and no private provider exists (`no_provider_for_trust_mode`) | A key with a public trust mode, or a private provider |
| 0G Storage archive | Uploader `0xe8f9…754A` has 0 0G on Galileo | Fund it from the 0G faucet, then use "Try archiving again" on Reports |

None of these is faked. The deterministic baseline remains the primary strategy, and EIP-712 wallet authorization protects every execution. The UI says so in plain words.

## 7. Page-by-page UI changes

- **Navigation:** 7 items in journey order: Investigate, Positions, Strategy, Backtest, Execute, Reports, Activity. Strategy Versions became a tab. The top-bar integration pills use plain words with technical status in the tooltip. The sidebar shows "Getting started N of 6" and "Replay the tour".
- **Shared pieces:**
  - `<Term>` glossary tooltips: 28 plain definitions in `src/lib/glossary.ts`.
  - `Disclosure` ("Technical details").
  - `NextStep` (a "What happens next" card on every page).
  - `WelcomeCard`.
- **Investigate:** the wallet input comes first; then the example wallet, a disclosure of live suggested wallets, the 4-stage workflow with live status, summary cards, and a "Continue to Execute" link.
- **Positions / position detail:** the 3D terrain, plain cards (pair, in range, current/lower/upper, deposited, fees collected), and detail with ticks, NFT, liquidity and lifecycle under Technical details.
- **Strategy:** a hypothesis story, evidence with an Aqua status per rule, the confidence caveat, alternatives, limitations, a Versions tab with Compare.
- **Backtest:** comparison cards, a labelled chart, What If, and an advanced metrics table.
- **Execute:** the 8-step guided flow with plain transaction review and receipt.
- **Reports:** the plain summary, JSON download, plain integration status, and the 0G archive explanation.
- **Activity:** plain actions grouped by investigation.

## 8. First-time journey

1. A first visit to Investigate shows the welcome card. It explains what TRACE does, what address to paste and the four stages, and offers "Start with an example wallet", "I have an address", "Skip" (this session) and "Don't show again". Progress is stored only in this browser (`localStorage` `trace:onboarding:v1`).
2. The example wallet runs a real investigation. The workflow ticks Analyze, then Understand, from server status. Summary cards appear, each linking onward.
3. Each page ends with a **Next step** card: Positions → Strategy → Backtest → Execute → Reports → Activity. Each visit counts toward the sidebar's "Getting started" progress.
4. Every technical word on the main path is a `<Term>` with a plain explanation (hover, focus or tap). Raw values are always one "Technical details" click away and never deleted.
5. "Replay the tour" in the sidebar resets the progress and returns to the welcome card.

## 9. Screenshots

`docs/screenshots/` holds full-height captures of every page at **1440 px** and **390 px** (20 JPEGs), taken from the running stack with real data:
- `0x4797…eb4c`: Investigate results, Positions, position detail, Strategy, Versions, Backtest.
- The executed investigation of `0xae1D…31Cf`: Execute (8 of 8, real receipt), Reports.
- `0x6583…d2De`: Activity, showing the real approve and ship transactions.

No console errors were recorded on any capture.

## 10. Commits and files

| Commit | Phase |
|---|---|
| b32ef5f | 1: audit and backend fixes B1–B10 |
| e245b98 | 2: glossary, Term, Disclosure, NextStep, navigation, Investigate |
| 67644d7 | 3: Positions and the 3D terrain |
| 27ff830 | 4: Strategy, Versions, Compare, `GET /strategies/:id` |
| 3286681 | 5: Backtest and What If (`POST /investigations/:id/whatif`, engine options) |
| ad97fa4 | 6: guided Execute, Reports, Activity |
| 508feae | 7: onboarding |
| (this commit) | 8: QA (B12, B13), mobile E2E project, screenshots, this report |

**New files:**
- `src/lib/glossary.ts`, `src/lib/onboarding.ts`
- `src/components/term.tsx`, `disclosure.tsx`, `next-step.tsx`, `liquidity-terrain.tsx`, `liquidity-view.tsx`, `guided-execute.tsx`, `welcome.tsx`
- `e2e/ux.spec.ts`, `test/data/backtest-golden.json`, `test/worker.test.mjs`
- `docs/AUDIT.md`, `docs/screenshots/`

**Main changes:**
- Server: `server/src/api.ts`, `db.ts`, `pipeline.ts`, `worker.ts`, `integrations.ts`
- Packages: `packages/backtester/src/engine.ts`, `packages/strategy-ir/src/canonical.ts`, `packages/chain-data`
- Frontend: every page under `src/app/`, plus `src/components/app-shell.tsx`, `investigate.tsx`, `positions.tsx`, `case-file.tsx`

No feature was removed. `/saved` redirects, and the inline execution UI moved to `/execute`.

## 11. Dependencies (`npm audit`, pre-existing, not changed here)

`npm audit --omit=dev` reports 7 issues: 1 critical, 5 high, 1 moderate.

| Package | Severity | Type | Fix available |
|---|---|---|---|
| `next` | critical | direct | Next 16 (a major upgrade) |
| `postcss` | high | via `next` | via Next 16 |
| `@0gfoundation/0g-storage-ts-sdk` | high | direct | no upstream fix |
| `axios` | high | transitive | no upstream fix |
| `open-jsonrpc-provider` | high | transitive | no upstream fix |
| `ethers` | moderate | direct | `ethers@6.17` |
| `ws` | high | via `ethers` | via `ethers@6.17` |

The redesign's only new dependencies (`three`, `@react-three/fiber@8`, `@react-three/drei@9`) add no advisories. Upgrading Next across a major version is left as a separate, deliberate change.
