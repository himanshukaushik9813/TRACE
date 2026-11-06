# TRACE — Phase 1: Complete Repository Audit

**Date:** 2026-11-06 · **Commit audited:** `1322700` (main; `a9a562b` is deployed)
**Scope:** the full repository plus the live deployment (web https://trace-eth.vercel.app → API https://trace-api-6ap0.onrender.com).
**Rules followed:** inspection only. No application code was changed for this audit. A feature is *Fully working* only with
real evidence (passing tests on real captured data, a live API response, or an on-chain receipt checked independently).
Skipped or unexecuted tests are **never** counted as passed. No secret value is reproduced here.

Status legend: **Fully working** · **Partially working** · **Mocked/demo only** · **Broken** · **Not implemented**

---

## 0. Checks run for this audit

| Check | Command | Result |
|---|---|---|
| Typecheck: frontend | `npx tsc -p tsconfig.typecheck.json` | **Pass** (exit 0, 0 errors) |
| Typecheck: packages + server | `npm run typecheck:server` (= `build:packages` strict per-package check + `tsc -p server/tsconfig.build.json --noEmit`) | **Pass** (exit 0); 9/9 packages emitted |
| Lint | `npx next lint` | **Pass**: no warnings or errors |
| Unit + API tests | `npm run test:unit` | **60 passed, 0 failed, 0 skipped**, 0 cancelled (11 files) |
| Integration: live Sepolia | `npm run test:live` (4 tests) | **NOT EXECUTED**: the audit machine (Claude's Linux VM) has no outbound network. The run hung and was stopped at 90 s with no results |
| Integration: Aqua fork | `npm run test:fork` (1 test) | **NOT EXECUTED**: Foundry `anvil` is not installed and there is no network |
| E2E (Playwright) | `npx playwright test` (15 tests: 11 desktop + 4 mobile, listed with `--list`) | **NOT EXECUTED**: all 15 failed at `browserType.launch: Executable doesn't exist` (no browser binary). The last recorded real run (memory.md) was 15/15 earlier on 2026-11-06, **not re-verified here** |
| Live behaviour (substitute for the above) | Deployed API + browser pane, 2026-11-06 | Real investigations, probes and an on-chain receipt cross-check (cited per module below) |

To run the non-executed suites, see `docs/E2E_TESTING.md`: run them on the Mac with the local stack, or against production with `TRACE_WEB_URL` / `TRACE_API_URL`.

---

## 1. Current architecture

```
Browser (Next.js 14 app, wagmi 3 + viem, Sepolia only) ── Vercel ── https://trace-eth.vercel.app
   │  REST (CORS: CORS_ORIGINS + local-dev origins)
   ▼
TRACE API + worker (Express + BullMQ, one process) ─────── Render ── https://trace-api-6ap0.onrender.com
   │  server/src: index.ts (boot) · api.ts (routes) · pipeline.ts (stages) · worker.ts (queue) · db.ts · config.ts · integrations.ts
   ├── Postgres (Supabase, session pooler; direct-host fallback) ── db/migrations 0001–0003, 16 tables
   ├── Redis (Upstash, TLS) ── BullMQ queue (TRACE_QUEUE_NAME; prod = trace-investigations-prod) + finalized-log cache
   ├── Ethereum Sepolia RPC (Infura + optional fallbacks) ── packages/chain-data
   ├── 0G Router (OpenAI-compatible inference) ── packages/strategy-inference/zero-g.ts
   └── 0G Storage (Galileo testnet, burner uploader) ── packages/zero-g-storage
User wallet (MetaMask) signs EIP-712 authorizations and sends approve/ship/dock itself; the server never holds a user key.
```

**Engine packages** (`packages/*`, built to committed `dist/` by `scripts/build-packages.mjs`):
`chain-config` (addresses, chain guard) → `strategy-ir` (types, canonical hashing, validators) → `uniswap-v3` (reconstruction)
→ `strategy-inference` (DNA, deterministic baseline, 0G client + gate) → `backtester` → `aqua-adapter` → `authorization` → `zero-g-storage` → `chain-data`.

**Pipeline** (`server/src/pipeline.ts` `runInvestigation` / `runStages`): fetch Sepolia history → reconstruct → pool price series
(real Swap events) → Strategy DNA + evidence-only baseline → 0G hypothesis (gated) → backtest → archive to 0G Storage → done.
Cancellation checkpoints between stages.

**Frontend:** `src/app/` pages `/` (Investigate), `/positions`, `/positions/[id]`, `/strategy`, `/backtest`, `/execute`, `/reports`,
`/activity`, `/saved` (redirect). Components in `src/components/` (notably `investigate.tsx`, `guided-execute.tsx`, `liquidity-terrain.tsx`,
`welcome.tsx`, `term.tsx`, `app-shell.tsx`). Client libraries: `src/lib/api.ts` (typed client + hooks), `aqua-flow.ts` (execution state machine),
`onboarding.ts`, `glossary.ts`, `wagmi.ts`.

---

## Module-by-module status (evidence for sections 2–9)

### 1. Ethereum / Sepolia integration: **Fully working**
- **Code:** `packages/chain-config/src/index.ts` (`SEPOLIA_CHAIN_ID`, `UNISWAP_V3`, `AQUA`, `PROBED_CONTRACTS`, `assertSupportedChain`, `explorer`).
  `packages/chain-data/src/client.ts` (`createTraceClient`: viem `fallback` transport, credit pacing via `TRACE_RPC_CREDITS_PER_SEC`, Multicall3,
  `setPersistentChainCache`, `makeChainError`, `scrubSecrets`). `server/src/config.ts` `loadConfig` refuses non-Sepolia chains and mainnet RPC URLs.
  Frontend: `src/lib/wagmi.ts`, `src/components/wallet.tsx` (`NetworkBanner`, explicit Switch to Sepolia).
- **Routes:** `GET /health`, `GET /integrations`.
- **Tests:** `reconstruction.test.mjs` "RPC provider keys are scrubbed from error text" (pass); `test/live/sepolia.test.mjs` ×4 (*not executed*);
  E2E "wrong network … switches to Sepolia explicitly" (*not executed*).
- **Live evidence:** `/integrations` → chainId 11155111, block 12,077,948; bytecode present for the Uniswap V3 Factory, NonfungiblePositionManager, QuoterV2 and SwapRouter02.

### 2. Uniswap V3 position reconstruction: **Fully working**
- **Code:** `packages/uniswap-v3/src/reconstruct.ts` (`reconstructPositions`, `reconstructSummary`, `rangeResets`, `toNumberEvents`); ERC-721 discovery and
  lifecycle logs in `chain-data`; persistence in `db.ts` (`insertEvents`, `insertPositions`, `saveReconstruction`).
- **Routes:** `GET /investigations/:id/positions/:tokenId`, `GET /investigations/:id/events`.
- **Tests:** `reconstruction.test.mjs` ×5 on real captured Sepolia data (order-independence, tx evidence on every event, fee-only collect accounting, real decimals) — all pass.
- **Live evidence:** NFT #230171 (USDC/WETH 1%) rebuilt with range, deposits and fees in investigation `02503ab3-cf49-4c7c-a78d-d10f60a1b61a`.

### 3. Wallet investigation: **Fully working**
- **Code:** `server/src/pipeline.ts` (`runInvestigation`, `runStages`); `server/src/api.ts` investigation routes; `src/app/page.tsx` + `src/components/investigate.tsx` (`stagesFor`, `Workflow`, `WorkflowNow`).
- **Routes:** `POST /investigations` (validates address and 1–365 days; `restart`, `supersedes`, reuse of an identical running job), `POST /investigations/:id/cancel`,
  `GET /investigations/recent`, `GET /investigations/:id`, `GET /investigations/:id/full`, `GET /wallets/suggested`.
- **Tests:** `api.test.mjs` "rejects invalid wallet addresses and windows", "malformed investigation ids are a 404" (pass); live + E2E empty-wallet test (*not executed*).
- **Live evidence (2026-11-06):** six production runs for `0x4797…eb4c` completed in roughly 20 s each (`02503ab3…`, `81bb6025…` via **Restart investigation**, `c1feddd0…`, `824a9197…`, `9bc7b12f…`, `baf7b5ca…`).

### 4. Strategy fingerprints (Strategy DNA): **Fully working**
- **Code:** `packages/strategy-inference/src/fingerprints.ts` (`computeFingerprints`, `computeTimeInRange`, `computePriceResponse`); stored by `db.saveDna` (`strategy_dna`);
  shown by `src/app/strategy/page.tsx` (`dnaRows`, `plainReasons`, `priceResponse`).
- **Metrics:** range width, adjustment frequency, position duration, time in range, liquidity in/out and swing, fee-collect cadence, withdraw→redeploy re-entry,
  **response to price moves** (exits / answered / median delay; added in `dad5f11`), gas.
- **Tests:** `inference.test.mjs` "fingerprints come from real events and positions()"; `price-response.test.mjs` ×4 (real captured swap prices) — all pass.
- **Note:** investigations run before `a9a562b` lack the price-response fields; the UI shows "computed for investigations run from now on". Live check: `baf7b5ca…` → exits 0, time in range 100%.

### 5. AI strategy inference: **Partially working**
- **Working part:** the deterministic evidence engine. `packages/strategy-inference/src/infer.ts` (`inferFromEvidence`, `scoreFamilies`, `familyLabel`) produces rules,
  each with `evidenceRefs` (tx hashes), confidence, alternative, uncertainty and limitations, and an *inconclusive* result when evidence is thin.
- **Gate:** `zero-g.ts` `gateProposal` rejects AI rules that cite transactions outside the evidence and caps confidence. `buildEvidencePack` builds the input.
- **Not working:** the AI layer itself (see module 10).
- **Tests:** `inference.test.mjs` ×7 (baseline schema-valid and every rule cites real txs; inconclusive on thin evidence; gate; not-configured is honest; provider error surfaces the request id; success path). The 0G error and success tests use a **controlled local HTTP stub**, which tests the client, not the live service.
- **UI honesty:** Investigate says "(from the evidence; the AI service is unavailable)"; Strategy says "AI was not used for this version".

### 6. Strategy IR and versioning: **Fully working**
- **Code:** `packages/strategy-ir/src/canonical.ts` (`canonicalString`, `contentHash`, `idHash`, `finalizeStrategyIR`, `strategyVersionHash`, `eventsFingerprint`),
  `validate.ts` (`validateStrategyIR`, `validateCompatibility`, `validateBacktest`, `validatePlan`); `db.insertStrategy` / `getStrategy`; UI `VersionsPanel`, `CompareView` in `src/app/strategy/page.tsx`.
- **Routes:** `GET /strategies/by-wallet/:wallet`, `GET /strategies/:id`; `/saved` → `/strategy?tab=versions`.
- **Tests:** `strategy-ir.test.mjs` ×8 (key-order-independent hashing, content-addressed ids, 64-bit ids, validators reject mainnet, missing evidence and 0G results without a request id) — all pass.

### 7. Historical backtesting: **Fully working**
- **Code:** `packages/backtester/src/engine.ts` (`runBacktest`, `assertNoLookAhead`, `positionValue`, `MIN_TRAIN_POINTS`, `MIN_TEST_POINTS`); persisted by `db.insertBacktest`.
- **Runs:** observed replay, inferred strategy (counterfactual), passive LP benchmark, buy & hold. Per run: fees, gas, impermanent loss, out-of-range hours,
  rebalances, drawdown, occupancy. Train/test split with a 100-block gap and `lookaheadGuard: "enforced"`.
- **Routes:** `POST /investigations/:id/whatif` (rate-limited, not persisted, labelled "Simulation, not observed"; returned 200 live).
- **Tests:** `backtester.test.mjs` ×8 (canonical V3 math, look-ahead guard, real-swap run, determinism, insufficient data, What-If golden equality) — all pass.
- **Limitation:** Sepolia liquidity and prices are not representative of mainnet (stated in the IR limitations).

### 8. 1inch Aqua compatibility and execution: **Partially working**
| Part | Status | Evidence |
|---|---|---|
| Compatibility (`aqua-adapter/src/compat.ts` `assessCompatibility`, `CAPABILITY_MODEL`; route `POST /strategies/:id/compatibility`) | **Fully working** | Live check 2026-11-06: "Partly compatible", 7/7 on-chain checks, unsupported rule labelled. `aqua.test.mjs` rule-by-rule test |
| Compile + simulate (`compile.ts` `compilePlan`, `sqrtPriceFromTick`, `feeBpsFromTier`; `chain.ts` `aquaClient().simulateStep`; route `POST /strategies/:id/plan`) | **Fully working** | `aqua.test.mjs`: deterministic plan hash; approvals are **exact amounts** to the registry |
| Approve + ship (user wallet; `src/lib/aqua-flow.ts`, `src/components/guided-execute.tsx`; routes `POST /transactions`, `GET /transactions/:hash`, `POST /plans/:id/reconcile`; receipt check `aquaClient().verifyTx`) | **Fully working (real)** | 4 ships and 4 approves from MetaMask `0x6583…d2De`, each independently re-checked `status 0x1` on a public Sepolia RPC. Ship target = Aqua registry `0xe8026bf3…139b`. Ship tx: `0x48350bf8…0ae37`, `0x4de0a62e…3818`, `0x789ce07d…1a4a`, `0xddd99195…9000`. **No new transaction was sent during this audit** |
| Dock (`DockPanel` in `guided-execute.tsx`, behind "Advanced") | **Partially working**: implemented; never executed on Sepolia | Only `test/fork/aqua-fork.test.mjs` (approve → ship → dock on Anvil), *not executed here* |
| Swap / taker side | **Blocked** (external) | Requires the 1inch KycNFT (`AQUA.kycNft`) |
| E2E Execute tests #5/#6 | **Mocked/demo only** (tests only) | They inject a fake EIP-1193 wallet and intercept plan, authorization and transaction routes. They prove UI state handling, **not** execution, and were not executed here |

### 9. Wallet authorization: **Fully working** (EIP-712)
- **EIP-712 authorization: Fully working.** `packages/authorization/src/index.ts` (`AUTH_DOMAIN`, `AUTH_TYPES`, `buildTypedData`, `newChallenge`, `verifyAuthorization`);
  routes `POST /plans/:id/challenge` (maker-only, single-use challenge, `AUTH_TTL_SECONDS = 600`), `POST /authorizations` (`db.consumeChallenge`).
  Tests: `authorization.test.mjs` ×8 and `api.test.mjs` ×4 (replay, wrong signer, expiry, tampered plan hash, non-Sepolia, scope gating) — all pass.
  Live: 4 validated authorizations by `0x6583…d2De`.

### 10. 0G Private Computer: **Blocked by an external dependency** (code complete)
- **Code:** `packages/strategy-inference/src/zero-g.ts` `runZeroGInference` (Bearer key, optional `X-0G-Provider-Trust-Mode`, `verify_tee`, `model_not_capable` retry, JSON parsing, `tee_verified` check)
  → `gateProposal`; persisted by `db.insertInferenceRun` (`inference_runs`); status in `server/src/integrations.ts`; UI `AiSource` in `src/app/strategy/page.tsx` (status, HTTP code, latency, model, request id, trust mode, TEE flag, provider, time).
- **Live evidence:** every run fails with `503 no_provider_for_trust_mode … tier=private` (latest request `d5665974-a42b-4685-ba6c-871556bac728`, model `glm-4.7`, 1018 ms).
  The configured key is a private-tier key and the router has no private provider. TRACE sends no trust header (`ZERO_G_TRUST_MODE` unset).
- **Needs:** a standard- or verified-mode key (user action).

### 11. 0G Storage: **Blocked by an external dependency** (code complete; never succeeded)
- **Code:** `packages/zero-g-storage/src/index.ts` `archive` (canonical JSON → Merkle tree → indexer upload → **download with proof and byte comparison**; a ref is returned only after a successful upload, and `retrievable` only after read-back),
  `storageAccount`, `storageConfigured`. Pipeline step 7 archives the investigation summary, DNA, inference run and strategy IR. Route `POST /investigations/:id/archive`; table `storage_artifacts`.
- **Tests:** `storage.test.mjs` ×1 (unconfigured → no fabricated refs). Pass.
- **Live evidence:** uploader `0xe8f9…754A` balance 0 on 0G Galileo; `storage: []` on new investigations; no root hash is shown, which is correct.
- **Incomplete:** backtest results are not in the archived artifact set.

### 12. Reports and Activity: **Fully working**
- **Code:** `src/app/reports/page.tsx` (live integration status, JSON download of `/full`), `src/app/activity/page.tsx`; `db.listTransactions`.
- **Routes:** `GET /integrations`, `GET /activity/:wallet`.
- **Live evidence:** Reports renders all 9 integrations with honest labels; Activity for `0x6583…d2De` returns 8 receipt-verified transactions.

### 13. Frontend onboarding and navigation: **Fully working**
- **Code:** `src/lib/onboarding.ts` (localStorage `trace:onboarding:v1`), `src/components/welcome.tsx` (`WelcomeCard`, `MarkStep`, `TourFooter`), `src/components/term.tsx` + `src/lib/glossary.ts`,
  `src/components/app-shell.tsx` (nav keeps `?inv=`; mobile drawer), `useCurrentInvestigationId({ resetOnReload })` in `src/lib/api.ts`, `liquidity-terrain.tsx` (3D with 2D fallback).
- **Tests:** E2E #7 and `ux.spec.ts` ×4 ×2 projects (*not executed here*).
- **Manual live verification (2026-11-06, browser pane):** Skip / Don't show again / Replay; tooltips on click, real Tab focus and Escape; refresh on Investigate resets to 0 of 4 by design; menu order and `?inv=` links;
  0 sideways-overflow elements on every page at 1440 and 390; mobile drawer logo fixed in `c2d205e`.

### 14. Database and background workers: **Fully working**
- **Code:** `db/migrations/0001_init.sql` (16 tables: wallets, investigations, raw_events, investigation_events, positions, strategy_dna, inference_runs, strategies, backtest_runs,
  compatibility_reports, execution_plans, challenges, authorizations, transactions, storage_artifacts), `0002_no_positions_status.sql`, `0003_cancel_and_tx_idempotency.sql`
  (one live ship per plan); `scripts/migrate.mjs`; `server/src/db.ts` (`Db`); `server/src/worker.ts` (`createBullQueue`: 15-min lock, `maxStalledCount 0`, per-deployment `TRACE_QUEUE_NAME`;
  `createInMemoryQueue` fallback; `requeueDecision`); `server/src/index.ts` (DB ping retry ×5 with `DATABASE_URL_DIRECT` fallback, `requeueInterrupted`, EADDRINUSE handling).
- **Tests:** `worker.test.mjs` ×4 (idempotent add, recovery decisions) — pass. Live: `/health` → database ok, queue bullmq.
- **Fixed today (`a9a562b`):** production and a dev machine shared one queue name on the same Redis; prod now uses `trace-investigations-prod` (confirmed in the Render logs).

### 15. Security and wallet transaction handling: **Fully working** controls, with **open risks** (section 7)
- **Controls present and tested:** exact-amount approvals (`validatePlan`, `aqua.test.mjs`); EIP-712 binds wallet, chain, plan hash, strategy version, action and expiry; single-use challenges;
  maker-only challenges; scope gating (`ACTIONS`); one live ship per plan (DB index plus 409 test); idempotent tx posting; success only from receipts (`verifyTx`); reconcile after reload instead of re-sending;
  input validation (`isAddress`, `isUuid`, day range, What-If bounds); `x-powered-by` disabled; 1 MB JSON limit; RPC keys scrubbed from errors; no private keys in the schema.
- **Secrets:** no real secret value in any git commit (pattern hits are `.env.example` placeholders and a test fixture); none in `.next/static`; only `.env.example` is tracked.

---

## 2. Working features
Sepolia integration · wallet investigation · Uniswap V3 reconstruction · Strategy DNA (incl. price response) · evidence-only strategy inference with inconclusive handling ·
evidence gate · Strategy IR, versions and compare · backtesting with look-ahead guard and What If · Aqua compatibility, compile and simulate · **real** approve + ship from the user's wallet
with receipt verification · EIP-712 authorization with replay protection · Reports (JSON download) · Activity · onboarding · tooltips · responsive layout · BullMQ worker with recovery ·
honest integration labels.

## 3. Incomplete features
- **0G inference:** code complete, never succeeded live (blocked; module 10).
- **0G Storage:** code complete, never uploaded; backtest not archived (module 11).
- **Aqua dock:** implemented, never executed on Sepolia. **Aqua swap:** blocked by the KycNFT.
- **Integration status labels** for Aqua and EIP-712 are derived from DB rows (`integrations.ts`). They are accurate today because all 8 rows were checked on-chain, but they do not re-check receipts.
- **Test coverage gaps in this environment:** live, fork and E2E suites not executed (section 0).

## 4. Mocked integrations
- **Production code:** none found. There is no demo transport, sample data or fake success path; the `inference.test.mjs` and `storage.test.mjs` cases confirm honest failure.
- **Tests only:** E2E #5 and #6 (fake EIP-1193 wallet plus intercepted plan, authorization and transaction routes); `inference.test.mjs` 0G error and success paths (local HTTP stub). These are not evidence of live behaviour.

## 5. Broken features
- **No user-facing feature is broken** on the live deployment as of `a9a562b`.
- **Production misbehaviour:** API rate limits are effectively global on Render (risk R1).
- **Fixed during this session (not open):** invisible mobile-drawer logo (`c2d205e`); stale "below" wording (`c2d205e`); shared dev/prod queue (`a9a562b`).

## 6. Missing credentials and infrastructure

Presence only; no values shown. Local = `.env.local` on the Mac; Render = the trace-api environment; Vercel = project env.

| Variable | Local | Render | Effect |
|---|---|---|---|
| `ZERO_G_API_KEY` | set | set | **Present but unusable:** private-tier key with no provider. Needs a standard or verified key |
| `ZERO_G_MODEL`, `ZERO_G_TRUST_MODE`, `ZERO_G_VERIFY_TEE` | missing | missing | Defaults: `glm-4.7`, key default, `verify_tee` on |
| `OG_STORAGE_PRIVATE_KEY` (+ RPC, indexer, address) | set | set | **Wallet unfunded:** needs testnet 0G from the faucet |
| `SEPOLIA_RPC_FALLBACK_URLS` | missing | missing | No RPC failover (single Infura key; 429 risk) |
| `TRACE_QUEUE_NAME` | missing (default) | set (`trace-investigations-prod`) | As intended |
| `CORS_ORIGINS` | missing (default localhost:3000) | set (both Vercel domains) | As intended |
| `PORT` | missing (default 4000) | set by Render | As intended |
| `NEXT_PUBLIC_SEPOLIA_PUBLIC_RPC` | missing | n/a (Vercel: missing) | Code default public RPC |
| `DATABASE_URL_DIRECT`, `TRACE_RPC_CREDITS_PER_SEC` | — | — | Read by code but **not documented** in `.env.example` |

**Infrastructure gaps:** dev and prod share one Supabase database and one Upstash Redis. There is no paid always-on API (Render free tier sleeps after about 15 minutes; the first request takes about 50 s, and interrupted investigations are re-queued on boot). No CI runs the test suites. Foundry `anvil` is needed for the fork test.

## 7. Security risks

| # | Risk | Severity | Where |
|---|---|---|---|
| R1 | **Rate limiter keyed by `req.ip` without `trust proxy`**: on Render every request comes from the proxy, so per-IP limits (10/min investigations, 5/min archive, 20/min plans…) are shared by **all** users. Easy to exhaust; legitimate users get 429s | Medium | `server/src/api.ts` `limiter()`; no `app.set("trust proxy", …)` |
| R2 | **No authentication on write routes**: anyone can start investigations (spends the Infura budget), compile plans, or trigger `/archive` (will spend the storage burner's 0G once funded) | Medium | `server/src/api.ts` |
| R3 | **Shared dev/prod data stores**: local runs and scripts write to the production DB; local boot `requeueInterrupted` can pick up production investigations into the local queue | Medium | `server/src/index.ts`, env |
| R4 | **Credentials exposed in chat on 2026-11-06** (DB password, Upstash token, 0G key, storage key): rotate | High until rotated | Supabase, Upstash, 0G, Render and `.env.local` |
| R6 | **CORS accepts any private-network / `.local` origin in production** (`isLocalDevOrigin` is not environment-gated) | Low | `server/src/api.ts` |
| R7 | **Plaintext testnet private key on disk**: `.demo-wallet.local.json` (gitignored and not in history; testnet only) | Low | repo root |
| R8 | **Dependency advisory**: Next 14.2.15 has a known critical `npm audit` finding whose fix is a major upgrade (recorded in memory.md; not re-checked here because there is no network) | Medium | `package.json` |
| R9 | **Reads are unauthenticated**: all investigations, plans and activity are public by id or wallet (mostly public chain data, but plans reveal intended amounts) | Low | `server/src/api.ts` |

## 8. Recommended implementation order (for the next phases; nothing implemented here)
1. **Hardening quick wins (small, testable):** `app.set("trust proxy", 1)` with a limiter test (R1); environment-gate the local-dev CORS rule (R6); document `DATABASE_URL_DIRECT` and `TRACE_RPC_CREDITS_PER_SEC`; rotate credentials (R4, user).
2. **Separate dev from prod data** (R3): a dev Supabase project or schema and a dev Redis, or at minimum a guard that stops local boot from re-queuing production rows.
3. **0G inference unblock:** a new standard or verified key (user) → one live run → record the request id, model and TEE flag as evidence.
4. **0G Storage unblock:** fund the burner (user) → one archive with read-back → show the root hash; add the backtest artifact; consider auth or limits on `/archive` (R2).
6. **Aqua evidence pack:** run dock on Sepolia from the UI; run `test:fork` on the Mac; document the tx hashes.
7. **Run the full suites on the Mac:** `test:live`, `test:fork`, `test:e2e`; record the results in `docs/TEST_REPORT.md`.
8. **Judge-facing docs** (README, ARCHITECTURE, INTEGRATIONS, SECURITY, DEMO_SCRIPT, FEEDBACK).
9. **Separately scoped:** the Next.js major upgrade for R8 (risky; needs a full regression).

## 9. Existing functionality that must be preserved
- **Product rule:** no demo data, no mocks in production paths, no simulated success; honest integration labels (`integrations.ts`, Reports, `AiSource`).
- **Evidence discipline:** every rule cites real tx hashes; `gateProposal` rejects uncited AI rules; *inconclusive* instead of invention; confidence wording ("not the chance the owner meant this").
- **Backtest integrity:** `assertNoLookAhead`, the train/test gap, the golden test (`test/data/backtest-golden.json`), What-If defaults byte-identical, observed vs simulated labelling.
- **Execution safety:** exact approvals; EIP-712 claims binding; single-use challenges; maker-only; the one-live-ship DB index (0003); idempotent `POST /transactions`; receipt-only success; reconcile-not-resend after reload; refresh on Investigate starts fresh without re-sending.
- **Real-transaction history:** the 4 approve + 4 ship rows (keep them; they are the Aqua and EIP-712 evidence).
- **Reliability:** BullMQ settings (15-min lock, `maxStalledCount 0`), per-deployment `TRACE_QUEUE_NAME`, boot DB retry and fallback, interrupted-job re-queue, Redis log cache, RPC credit pacing.
- **UX:** light theme tokens, the 4-step workflow strip with real stage status, the 8-step guided Execute, onboarding (Skip / Don't show again / Replay), glossary tooltips (click, focus, Escape), the 3D terrain with 2D fallback, mobile drawer, `?inv=` propagation.
- **Deployment:** `render.yaml` blueprint, Vercel project `trace` (domains `trace-eth.vercel.app`, `trace-lake-iota.vercel.app`), `CORS_ORIGINS` listing both.
- **Repo conventions:** committed package `dist/`; commits authored as himanshukaushik9813 with no Claude trailer (per memory.md).
