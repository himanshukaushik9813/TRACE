# TRACE — Phase 2: Real Wallet Case Study

**Status:** built, deployed and verified on the live site (web https://trace-eth.vercel.app, API https://trace-api-6ap0.onrender.com).
Commits: `d2cd7c2` (engine, API, page, tests), `0b1ff8d` (page fixes found during live verification).

---

## 1. The wallet

| | |
|---|---|
| **Wallet** | `0x4A2268D5047E9A03c4C6A279d833337D9DD1909e` ([Sepolia Etherscan](https://sepolia.etherscan.io/address/0x4A2268D5047E9A03c4C6A279d833337D9DD1909e)) |
| **Network** | Ethereum Sepolia (11155111) |
| **Investigation** | `d8f54fc4-b6b7-4437-a5fa-067027eba1b1` (90-day window, blocks 11,430,327–12,078,327) |
| **Case study** | https://trace-eth.vercel.app/case-study?inv=d8f54fc4-b6b7-4437-a5fa-067027eba1b1 |
| **API** | `GET /investigations/d8f54fc4-b6b7-4437-a5fa-067027eba1b1/case-study` |

**How it was chosen (no invented address, no fixture):**
1. Candidates came from TRACE's live LP-wallet scan (`GET /wallets/suggested`: real Uniswap V3 mints in the last ~50,000 Sepolia blocks) and from completed investigations in the database.
2. Fresh 90-day investigations were run on production for the strongest candidates.
3. The one with the most complete lifecycle was chosen: 5 positions over 4 pools, with mint, increase, decrease, collect, a burn, and a range change. All history is inside the window.

| Candidate | Investigation | Result | Use |
|---|---|---|---|
| `0x4A22…909e` | `d8f54fc4…` | 5 positions, 4 pools, 16 events, all 6 lifecycle kinds except Transfer | **Main case study** |
| `0xDb54…45BC` | `2522c2db…`, re-run `ebe3fdaa…` | 8 positions, 8 pools, 22 events, 7 closed; ranges reach the tick edge | Exposed the range-width bug (section 5) |
| `0x4797…eb4c` | `c3ac5922…` | 1 position opened **before** the window, 20 increases, 20 collects | **Incomplete-history** example; completed backtest (Phase 3) |
| `0x7Fbe…ad8a` | `38bf58a6…` | Cancelled after 400+ RPC calls (very long history) | Not used |
| 15 other wallets | various | `no_positions` | Genuine empty results |

The wallet transacts in **Sepolia test tokens** (TV3B/TV3A), so prices and amounts have no market meaning. The on-chain behaviour is real and fully reconstructible.

---

## 2. Reconstructed positions

Source: NonfungiblePositionManager logs (`IncreaseLiquidity`, `DecreaseLiquidity`, `Collect`) and ERC-721 `Transfer`s (mint, burn, transfer), with `positions(tokenId)` metadata.
Events are sorted by (block, log index) and attached to their NFT. Amounts are base-unit integers (BigInt) with each token's real decimals (18/18).

| NFT | Fee | Range (ticks) | Lifecycle (chain order) | Status | Fees collected |
|---|---|---|---|---|---|
| #234012 | 0.30% | −600 … 600 | MINT | active | none |
| #234019 | 0.05% | −887270 … 887270 (full range) | MINT, INCREASE, COLLECT, DECREASE, COLLECT, DECREASE, COLLECT, BURN | closed (burned, blk 12,060,353) | 0.0005 TV3B in one fee-bearing collect |
| #234023 | 0.01% | −23028 … 0 | MINT, DECREASE, COLLECT | active (half withdrawn) | none (the collect returned principal) |
| #234050 | 0.01% | −10987 … −6932 | MINT, DECREASE, COLLECT | closed (emptied, not burned) | none (principal only) |
| #234052 | 1.00% | −887200 … 887200 (full range) | MINT | active | none |

- **Range change (1):** in pool `0xB20a…530b`, #234023 was reduced (DECREASE, block 12,060,538, tx `0x8a0abeb3…a370`). A new position #234050 with a different range was then minted (block 12,061,451, tx `0x1cf2051e…7653`).
- **Ownership:** every NFT was minted to the wallet (from the zero address); no transfers to other owners; #234019 was burned.
- **Fees vs principal:** 5 Collect events, of which **1** carried fees. The other 4 only returned principal already counted at the DecreaseLiquidity, and are not counted as fees.
- **First / last event:** block 12,060,037 (tx `0x7d2cd02d…0f6a`) to block 12,061,512 (tx `0xc2eb6c3d…5221`).

## 3. Evidence coverage (from the live case study)

| Measure | Value |
|---|---|
| Events with block timestamp | 16 of 16 |
| Events with gas receipt | 16 of 16 |
| Positions with full history (minted inside the window) | 5 of 5 |
| Positions with `positions()` metadata | 5 of 5 |
| Observations backed by events | 11 of 11 |
| Strategy citations found among the events | 26 of 26 |

Every observation in the Evidence Explorer lists its source events with event kind, log index, NFT, block, UTC time and transaction, each linked to Sepolia Etherscan.

## 4. Limitations

- Sepolia test tokens and thin pools: prices are not market prices. The basis pool had **1 real swap** in the window, so no backtest is possible (Phase 3 reports `insufficient_data` with that reason).
- 0G inference was unavailable (`no_provider_for_trust_mode`, request `dbc72627-4f7c-4cc2-9218-9c30f4c06ffe`), so the strategy is the evidence-only engine's hypothesis (*periodic range adjustment*, 55% fit). It is not the owner's stated intent.
- Two strategy statements for this wallet overstated the evidence and were fixed in Phase 3 (`9e0e3dc`): a fee cadence computed from principal-only collects, and an occupancy figure from about 1 swap. See `docs/PHASE_3_STRATEGY_BACKTEST.md`.
- The incomplete-history path is shown by `0x4797…eb4c` (`c3ac5922…`). Its position existed before the window, so the case study marks it "history before window missing" and lists it as a limitation, without inventing a mint.

## 5. What was built

| Piece | Where |
|---|---|
| Case-study engine (pure, BigInt-safe) | `packages/strategy-inference/src/case-study.ts` `buildCaseStudy`: lifecycle with liquidity after each event, ownership, range changes (same rule as `rangeResets`), fee-bearing collects, totals, observations with source events, coverage, limitations |
| API route | `GET /investigations/:id/case-study` in `server/src/api.ts` (404 for bad or unknown id, 409 while running, an honest empty report for `no_positions`) |
| Page | `src/app/case-study/page.tsx`: plain-English summary, key figures, interactive timeline (dot per real event; click for source event, block, time, amounts and links; filter by kind; zooms to the activity span), liquidity ranges per pool with the last real price, positions table, Evidence Explorer, coverage, limitations |
| Entry points | "Open the full case study" on Investigate (`src/components/investigate.tsx`) and a link on Positions. The 7-item nav is unchanged |
| Bug fixed during selection | Ranges reaching the tick edge (e.g. `[-207244, 887272]`) were averaged as "concentrated", producing "spanning 128,622,884,…× in price". `isFullRangeLike` now treats them as full-range-like; any multiple ≥ 10⁶ reads "effectively unbounded". Re-run `ebe3fdaa…` classifies `0xDb54…` as *passive full-range* (90%) |

## 6. Tests

| Case | Test | Result |
|---|---|---|
| Real wallet with LP positions | `test/case-study.test.mjs`: counts, chain order, NFT association, fees/principal/deposits match the reconstruction ledger, lifecycle and ownership, every observation cites real events | pass |
| Empty wallet | `case-study.test.mjs` (empty report) · `pipeline-failures.test.mjs` (NO_EVENTS → `no_positions`, nothing written) · `api.test.mjs` (200, empty) | pass |
| Invalid wallet / id | `api.test.mjs` "rejects invalid wallet addresses…" and the case-study route (404 for malformed and unknown ids, 409 while running) | pass |
| Incomplete history | `case-study.test.mjs`: position marked pre-window, no invented mint, limitation names the NFT | pass |
| RPC failure | `pipeline-failures.test.mjs`: RPC_UNREACHABLE and RATE_LIMITED end as `failed` with the code, the RPC key is scrubbed from the stored error, and nothing partial is written | pass |
| Range-edge bug | `case-study.test.mjs` | pass |
| E2E | `e2e/trace.spec.ts` "case study: … timeline event detail and Evidence Explorer rows link to the explorer"; `/case-study` added to the per-page checks in `e2e/ux.spec.ts` | **not executed here** (no browser in the audit VM); run with `npm run test:e2e` |

Suite at the Phase 2 commit: **72/72 pass, 0 skipped**; typecheck and lint clean.

**Live verification (browser pane, 2026-11-06/07):**
- Case study at 1440 and 390 px with 0 overflowing elements.
- Timeline, ranges, positions, Evidence Explorer, coverage and limitations all render from real data.
- Clicking a timeline dot shows its source event.
- The 409 shows while a run is in progress.
