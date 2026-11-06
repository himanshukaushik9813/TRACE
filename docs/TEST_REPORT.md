# TRACE — Verification & Feature Audit (2026-11-06)

Scope: the full codebase, the tests, and the **live deployment**
(web https://trace-eth.vercel.app → API https://trace-api-6ap0.onrender.com → Sepolia, Supabase, Upstash).

**Ground rule for this report:** something counts as *Working* only with **real evidence**: a live API
response, a real investigation, or an on-chain receipt checked independently of TRACE. Mocked
E2E tests are **never** counted as proof of real execution.

---

## 1. Status summary

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Sepolia wallet investigation (Analyze) | **Working** | Real run `02503ab3…` (wallet `0x4797…eb4c`): 27 live RPC calls, 12 events, done in ~21 s. Re-run via **Restart investigation** created `81bb6025…`, which also completed |
| 2 | Uniswap V3 NFT position reconstruction | **Working** | NFT #230171 USDC/WETH 1%, range, deposits and fees rebuilt from logs. Unit tests on captured Sepolia data pass |
| 3 | Position lifecycle and accounting | **Working** | Lifecycle events, principal vs fees, real decimals. Position-detail page renders |
| 4 | Strategy fingerprint (DNA) | **Working** | Deterministic metrics stored per investigation (`dna`) |
| 5 | 0G Private Computer inference | **Blocked** (external) | Called live in this session: HTTP 503 `no_provider_for_trust_mode`, request id `f1197eb1-ee0b-4e48-9ac5-36610bf9527f`, model `glm-4.7`. The API key itself is "private"-tier and the router has no private provider. TRACE sends no trust header, so this is a key setting, not a code bug |
| 6 | Evidence-backed strategy explanation (Understand) | **Partially working** | Works without AI: the deterministic engine produces rules, each with `evidenceRefs` (tx hashes), confidence, an alternative explanation, uncertainty and limitations. The UI says so plainly: *"from the evidence; the AI service is unavailable"*. The AI layer (row 5) is blocked |
| 7 | Historical backtesting | **Working** | 4 runs: observed replay, inferred strategy, passive LP, buy & hold. Train/test split with a 100-block gap, `lookaheadGuard: enforced`. Fee, gas, slippage, IL, out-of-range hours. What If returns 200, labelled "Simulation, not observed" |
| 8 | Strategy IR and versioning | **Working** | Content-addressed `ir_…` ids, version hash, parent id, Versions tab and Compare. `/saved` redirects to `/strategy?tab=versions` |
| 9 | 1inch Aqua compatibility and compilation | **Working** | Real read-only check run in this session: "Partly compatible", 7/7 on-chain checks, 1 of 2 rules runs on Aqua. Unsupported rule labelled ("Keeps price in range… does not run on Aqua") |
| 10a | Aqua **approve + ship** (Execute) | **Working (real, earlier sessions)** | 4 ships + 4 approves sent from the user's MetaMask `0x6583…d2De`, each **independently** confirmed `status 0x1` via a public Sepolia RPC: ship `0x48350bf8…0ae37` (blk 12074438), `0x4de0a62e…3818` (12074615), `0x789ce07d…1a4a` (12075216), `0xddd99195…9000` (12075231). Ship target = Aqua registry `0xe8026bf3…139b`. **Not re-executed in this session** (no wallet in the test browser) |
| 10b | Aqua **dock** | **Implemented, not verified live** | Covered only by `npm run test:fork` (Anvil fork); never run on Sepolia from the UI |
| 10c | Aqua **swap (taker)** | **Blocked** (external) | Requires the 1inch KycNFT |
| 11 | EIP-712 authorization (Verify) | **Working** | 4 validated authorizations in the DB, all signed by `0x6583…d2De`. Replay protection, expiry and plan binding are covered by unit tests |
| 11b | World ID v4 (staging) | **Blocked** (not configured) | `WORLD_RP_ID / WORLD_RP_SIGNING_KEY` not set. The code path exists and is optional |
| 11c | World **Agent Pass / AgentKit** | **Not implemented** | No AgentKit code. TRACE has no autonomous agent acting for a user today |
| 12 | 0G Storage archival | **Blocked** (external) | Uploader `0xe8f9…754A` has 0 balance on 0G Galileo (live RPC check). `storage: []` on new investigations; no root hash is shown, which is correct |
| 13 | Reports and Activity | **Working** | Live integration status and a JSON download. Activity for `0x6583…d2De` returns its 8 receipt-verified transactions |
| 14 | Onboarding | **Working** | Verified live: welcome shows on first visit; **Skip** hides it for the session (survives refresh); **Don't show again** persists into a new session; **Replay the tour** restores it |
| 15 | Responsive UI (1440 and 390) | **Working** (1 bug fixed) | All 7 pages + position detail: 0 sideways-overflow elements at both widths; 3D terrain renders; the mobile menu keeps `?inv=` on every link. Bug fixed: see section 3 |
| 16 | Tooltips (glossary) | **Working** | Verified with real input: click opens, real **Tab** focus opens, real **Escape** closes |
| 17 | Refresh / navigation | **Working** | Reload on Investigate → `/` at 0 of 4, nothing re-sent (by design). Plain navigation keeps the case. Opening a shipped case by link → 4 of 4, with the real Etherscan link |
| 18 | Postgres, BullMQ/Redis | **Working** | `/health`: database ok, queue bullmq (TLS) |

**Mocked (and only in tests):** the E2E suite injects a fake EIP-1193 wallet and intercepts the
plan, authorization and transaction API calls in tests #5 and #6. These tests prove UI state
handling only, **not** execution. Nothing in the production app returns mocked success.

**Broken:** nothing found beyond the two bugs fixed below.

---

## 2. Tests run

| Check | Where | Result |
|---|---|---|
| `npm run test:unit` (56 tests: reconstruction, backtester golden file, IR, authorization, Aqua compile, worker, API) | Claude VM (offline) | **56 / 56 pass** |
| `tsc` frontend (`tsconfig.typecheck.json`) | Claude VM | **0 errors** (also after the fixes) |
| `npm run build:packages` (strict per-package check + emit) | Claude VM | **ok**, output identical to the committed `dist/` |
| `tsc` server (`server/tsconfig.build.json`) | Claude VM | **0 errors** |
| `next lint` | Claude VM | **No warnings or errors** (also after the fixes) |
| Live integration probes and a real investigation | Through the deployed API (browser) | See section 1 |
| On-chain receipt cross-check | Public Sepolia RPC (publicnode) | 8 / 8 transactions `status 0x1` |
| Secret scan | git history, `.next/static` | No real secret in any commit or in the frontend bundle (pattern hits are `.env.example` placeholders and a test fixture). Only `.env.example` is tracked |
| `npm run test:live` | — | **Not run**: the Claude VM has no network. Equivalent live checks were done through the deployed API (chain id, contract bytecode, real reconstruction) |
| `npm run test:fork` (Aqua approve → ship → dock on Anvil) | — | **Not run**: needs network and Foundry `anvil` |
| `npm run test:e2e` (Playwright, 15 runs) | — | **Not run here**: no browser binary or network in the VM. Last recorded run: 15/15 (2026-11-06). Run on the Mac (`docs/E2E_TESTING.md`) |

---

## 3. Bugs fixed in this pass

1. **Logo invisible in the mobile menu.** `Mark` used a fixed SVG gradient id (`mark-g`) and renders
   twice (desktop sidebar + mobile drawer). On phones the sidebar is `display:none`, so `url(#mark-g)`
   resolved into the hidden copy and the drawer's star painted nothing. Fixed with a per-instance
   `useId()`. The same latent issue in the `RangeBand` chart (`id="band"`) got the same fix.
   Files: `src/components/app-shell.tsx`, `src/components/charts.tsx`.
2. **Misleading next-step text on Investigate.** Verify and Execute said "Sign the authorization
   *below*" and "Approve and ship *below*", but signing moved to the Execute page in Phase 6. They now
   say "…on the Execute page". File: `src/components/investigate.tsx`.

3. **Production jobs could run on a developer machine.** The BullMQ queue name was hard-coded, and the
   Render API and the local dev API share the same Upstash Redis. Any local API left running (with older
   code) competed for production investigations. Found after deploying `dad5f11`: three fresh production
   runs came back without the new DNA fields. The queue name is now `TRACE_QUEUE_NAME` (Render:
   `trace-investigations-prod`, set in `render.yaml`; local default `trace-investigations`). The worker
   now logs `[worker] investigation … finished (queue …)` so the processing instance is visible.
   Files: `server/src/{config,worker,index}.ts`, `render.yaml`, `.env.example`.

Fixes 1–2 pass typecheck and lint. They go live on Vercel after the next `git push`; they were
**not** visually re-verified on production yet.

---

## 4. Could not be verified (and why)

- A **new** real approve/ship/dock in this session: needs the user's MetaMask. The test browser has no wallet, and sending transactions on the user's behalf requires their action.
- API **restart recovery** (re-queue of an interrupted investigation) on Render: covered by unit tests 53–56. Not exercised live, because it would need a deliberate crash mid-investigation.
- Playwright E2E, `test:live`, `test:fork`: environment limits (see section 2).

## 5. External actions that unblock integrations

| Integration | Action (user) |
|---|---|
| 0G inference | Create a 0G Router key in **standard** (or verified) trust mode at pc.0g.ai, or confirm which models serve private mode (`GET /v1/models`). Update `ZERO_G_API_KEY` in `.env.local` and on Render |
| 0G Storage | Fund `0xe8f9c5bA6c8c196B72989193362f3A28638a754A` at https://faucet.0g.ai, then use **Retry archive** (`POST /investigations/:id/archive`) |
| World ID | Register the app at developer.world.org (World ID 4.0) and set `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`. For the **AgentKit / Agent Pass** track, confirm the Mumbai prize requirement first (see section 6) |
| Credentials | Rotate the DB password, Upstash token and 0G key that were pasted into chat |

---

## 6. Proposed implementation order (ETHGlobal upgrade brief)

Ordered by judge impact per hour, real integrations first. Nothing is faked; each step ships with tests.

1. **Unblock the real integrations** (user actions in section 5, then Claude verifies end to end):
   a 0G inference run that succeeds, and a 0G Storage upload with a read-back. Without these the 0G
   tracks can only show honest failure.
2. **0G inference made visible and necessary** (no credentials needed to build): on the Strategy page,
   show the stored model, request id, HTTP status, TEE-verification flag, trust mode and how many
   rules failed IR validation (`inferenceRuns` already stores these). Add a clear "AI vs evidence-only"
   comparison that shows what is lost without 0G.
3. **Evidence Explorer (the hero, Phase 2):** a per-rule view of *observed behaviour → inferred rule →
   linked tx hashes (Etherscan) → confidence → alternatives → missing evidence*. Add the DNA metrics
   the brief lists (range width, adjustment frequency, deployment duration, adds/removes, fee cadence,
   re-entry, response to price moves), with an explicit inconclusive state. Most of this data already
   exists in the IR and DNA, so this is mainly UI plus two new metrics (re-entry, price response).
4. **0G Storage evidence:** after funding, archive report, IR and backtest; show the root hash only
   after a verified read-back; add a test.
5. **World ID decision:** either finish World ID 4.0 (prove-human before ship, bound to plan hash,
   action and expiry, with a denied path), or build AgentKit if the Mumbai prize requires
   "human-backed agents". The latter needs a real agent role, such as a monitoring agent.
   **Needs your call.**
6. **Aqua evidence pack:** a reproducible script plus documented tx hashes for approve → ship →
   **dock** on Sepolia (dock is not yet demonstrated live), and the fork test documented.
7. **Judge docs (Phase 7):** README, ARCHITECTURE, INTEGRATIONS, SECURITY, DEMO_SCRIPT, FEEDBACK,
   `.env.example`, plus this TEST_REPORT kept current.
8. **Deferred:** saved-wallet monitoring. It needs a reliable scheduler, and Render's free tier sleeps,
   so it can't yet be done reliably.
