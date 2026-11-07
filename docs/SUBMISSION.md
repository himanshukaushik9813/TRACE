# TRACE: submission status

Status verified on **2026-11-07** against the live API (`trace-api-6ap0.onrender.com`), the
`redesign/phase-1` preview build, and Ethereum Sepolia directly. Every WORKING item below was
checked live; nothing is marked working from code reading alone.

- Live app: https://trace-eth.vercel.app
- API: https://trace-api-6ap0.onrender.com (`GET /health`, `GET /integrations`)
- Network: Ethereum **Sepolia** (chain 11155111) only

## Feature and integration status

Legend: **WORKING** = verified live end to end. **PARTIALLY WORKING** = works, with a stated gap.
**MOCKED** = simulated or fake data. **NOT IMPLEMENTED** = absent.

| Feature | Status | Evidence (2026-11-07) |
|---|---|---|
| Real Sepolia wallet investigation | **WORKING** | Fresh runs of `0x4797…eb4c` completed end to end (queued → fetching → reconstructing → inferring → backtesting → done). `/health`: database ok, queue BullMQ, chain 11155111. |
| Uniswap V3 position reconstruction | **WORKING** | 1 position (NFT #230171, pool `0x6418…`), 12 lifecycle events (INCREASE, COLLECT). Independently confirmed on a public Sepolia RPC: `ownerOf(230171)` = the investigated wallet; event tx `0x7be4…13a2` is in block 11,891,910 exactly as recorded. |
| Strategy inference with evidence | **PARTIALLY WORKING** | Evidence engine works: *passive concentrated liquidity*, 75% confidence, 24 transaction references, every rule linked to its transactions. The 0G AI hypothesis step is blocked (see 0G Compute), so results are labelled "from the evidence; the AI service is unavailable". |
| Historical backtesting | **WORKING** | 793 real pool swaps replayed (Oct 27 → Nov 6). Observed +37.52%, inferred +29.77%, passive LP +37.52%, buy and hold +36.17%; fee and capital breakdown; look-ahead guard. What-if replays on the same swaps. |
| 1inch Aqua compatibility check | **WORKING** | Live check run on the preview: partially compatible, 1 of 2 rules runnable on Aqua, 15 of 17 on-chain checks passed. The 2 unmet checks are real constraints (production router not on Sepolia; taker side needs the 1inch KycNFT). |
| 1inch Aqua execution (approve → ship) | **WORKING** (maker side) | `/integrations`: 7 ships recorded and verified. Ship `0xda66…3b13` independently confirmed: status 1, block 12,080,117, from the demo wallet to the Aqua registry `0xe802…139b`, 3 logs. Both approvals confirmed. |
| Aqua taker-side swap | **NOT IMPLEMENTED** (blocked) | Requires the 1inch KycNFT; shown as blocked in the app. |
| EIP-712 authorization | **WORKING** | 7 signatures verified server-side (signer, chain, expiry, single-use challenge, strategy version + plan hash); 108 unit tests include replay and scope tests. |
| 0G Compute (inference) | **PARTIALLY WORKING** (external block) | Real router calls are made and recorded with request IDs, but every call currently fails: `no_provider_for_trust_mode` (no provider for the key's private/TEE tier). The app shows this failure; it never invents an AI result. |
| 0G Storage archive | **PARTIALLY WORKING** (external block) | Upload code is implemented; the uploader `0xe8f9…754A` has a 0 balance on 0G Galileo, so 0 uploads. Reports shows "Not archived on 0G" with the reason and a retry. JSON download works. |
| Reports | **WORKING** | Summary, JSON download, live integration table, honest 0G archive state. |
| Activity | **WORKING** | Investigations and receipt-checked transactions per wallet; "Load more" verified (10 → 20 → 30 → 34 of 34, no duplicates). |
| Wallet connection (MetaMask, Sepolia guard) | **WORKING** | Used for the recorded ships; wrong-network banner. |
| Anything mocked in the product | **None** | No demo data, mock chain responses or simulated successes. Test doubles exist only in unit tests. |

## Fixes in this release (branch `redesign/phase-1`)

- Light theme per the brief (palette, Playfair Display titles, Inter body, 232 px sidebar).
- Investigate panels follow the real backend status; no "Running" or "Rebuilding…" for finished work.
- "Try again" on result errors re-reads the existing investigation (0 POST requests).
- "Try an example wallet" reopens a finished investigation instead of creating duplicates.
- Activity: "Load more" (10 at a time) plus optional, backward-compatible API paging.
- `/wallets/suggested`: a Sepolia RPC rate limit now returns the last good list or a 503 with
  Retry-After and a back-off, instead of a 500.

## Test results (2026-11-07)

| Check | Result |
|---|---|
| Typecheck (frontend, 9 packages, server) | Pass |
| Lint (`next lint`) | Pass, no warnings |
| Unit + API tests (`node --test`) | **108 / 108 pass** (12 new) |
| Production build | Pass (Vercel build of `a5fd83e`) |
| Manual journeys on the preview | Pass: all 7 pages at 1440 px and 390 px, no console errors, no horizontal overflow; retry, example reuse and Load more verified with request counting |
| Playwright E2E (`npm run test:e2e`) | **Not run.** The suite needs a local API (:4000) and web app (:3000); the build environment available here has no network access and the repo has no CI runner. Run locally before submitting if time allows. |

## Deployment

- Production (`main`) is unchanged until the release branch is merged.
- Merging `redesign/phase-1` deploys the frontend (Vercel) and the API (Render auto-deploy from `main`).
- Database: migration `0004_drop_human_verification.sql` is not yet applied in production. It only
  drops unused World ID columns; the app works with or without it. Apply with `npm run db:migrate`.
