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
| 7 | World ID (human authorization) | **Not available (blocked)** | — | labelled | — | partly | `WORLD_RP_ID` / `WORLD_RP_SIGNING_KEY` not configured. EIP-712 wallet authorization alone is used and labelled "World ID not configured on this server". The code path is unit-tested (`authorization.test.mjs` World signal binding). |
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

## 3. Integrations (live, `GET /integrations?refresh=1`, 2026-11-06)

| Key | Status | Detail |
|---|---|---|
| sepolia | VERIFIED TESTNET | chainId 11155111, live head block |
| uniswap | VERIFIED TESTNET | Factory / NPM / QuoterV2 / SwapRouter02 code present |
| aqua | VERIFIED TESTNET | 2 successful ship transactions verified from receipts |
| eip712 | VERIFIED TESTNET | 2 wallet signatures verified by the server |
| zerog_inference | BLOCKED BY EXTERNAL DEPENDENCY | `no_provider_for_trust_mode` (key locked to "private") |
| zerog_storage | BLOCKED BY EXTERNAL DEPENDENCY | uploader balance 0 0G on Galileo |
| world_id | BLOCKED BY EXTERNAL DEPENDENCY | RP id / signing key not configured |
| database | VERIFIED LIVE | migrations 0001–0003 |
| queue | VERIFIED LIVE | BullMQ on Upstash (TLS) |

_Sections 4 onward (UI changes, tested features, unavailable features,
first-time journey, desktop and mobile results, screenshots, files) are added as
each phase completes._
