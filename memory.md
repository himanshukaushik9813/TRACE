# TRACE — Project Memory

> Running log of what TRACE is, what has been built, and where things stand.
> Updated after every work session so anyone (or any AI tool) can pick up where we left off.
> **Last updated: 2026-11-06** · Latest pushed commit: `a9a562b` · **Live:** web https://trace-eth.vercel.app · API https://trace-api-6ap0.onrender.com

---

## 1. What TRACE is

**On-Chain Strategy Intelligence on Ethereum Sepolia** — built for ETHGlobal Mumbai 2026.

TRACE takes a wallet and runs it through these stages:
1. Reads its real Uniswap V3 liquidity history on Sepolia.
2. Rebuilds every position.
3. Computes deterministic behaviour metrics (Strategy DNA).
4. Infers the strategy, with 0G AI proposing it and a deterministic gate checking it against the evidence.
5. Backtests it on real pool swaps.
6. Compiles the compatible rules into a **1inch Aqua** strategy that the user ships from their own MetaMask, after signing a server-verified authorization.
7. Archives the results to 0G Storage.

```
INVESTIGATE → RECONSTRUCT → DISCOVER (DNA + 0G) → VALIDATE (backtest) → EXECUTE (Aqua)
```

**Product rule:** no demo data, no mocks, no simulated success. Every integration is either live or labelled with why it isn't. Status labels: VERIFIED LIVE / VERIFIED TESTNET / IMPLEMENTED BUT NOT VERIFIED / BLOCKED BY EXTERNAL DEPENDENCY / NOT IMPLEMENTED.

---

## 2. Architecture

```
src/                     Next.js 14 app (wagmi 3 + viem, Sepolia only)
  app/                   / (investigate) · positions · positions/[id] · strategy · backtest
                         execute · reports · activity · saved · providers.tsx
  components/            app-shell, wallet (connect + NetworkBanner), inv-gate, positions, ui, charts
  lib/                   api.ts (typed API client + hooks), wagmi.ts, format.ts, assets.ts

packages/                Engine (TypeScript, built to dist/ by scripts/build-packages.mjs)
  chain-config           single source of truth: Sepolia, verified contract addresses, explorer, status labels
  strategy-ir            IR v2 types, validators, canonical hashing, content-addressed strategy ids
  chain-data             viem Sepolia reader: ERC-721 discovery, lifecycle logs, Multicall3, Swap price series
  uniswap-v3             order-independent reconstruction, principal vs fees, real decimals
  strategy-inference     fingerprints (Strategy DNA), deterministic baseline, 0G Router client + gate
  backtester             real-swap backtest, canonical V3 math, enforced look-ahead guard
  aqua-adapter           compatibility + on-chain checks, SwapVM compile (1inch SDKs), simulate, verify receipts
  world-auth             EIP-712 authorization + optional World ID v4
  zero-g-storage         0G Galileo uploads + Merkle-proof read-back

server/src               config.ts · integrations.ts · db.ts · pipeline.ts · worker.ts · api.ts · index.ts
db/migrations/           0001_init.sql (applied by scripts/migrate.mjs)
test/                    unit + API tests (real captured Sepolia data in test/data), live/, fork/
e2e/                     Playwright
docs/                    ARCHITECTURE, TESTNET_SETUP, INTEGRATIONS, SECURITY, DEMO_FLOW, KNOWN_LIMITATIONS
```

### Commands
```bash
npm install
npm run db:migrate                         # apply db/migrations to Supabase
npm run build:server && npm run start:server   # API + worker :4000 (node --env-file=.env.local)
npm run build && npm run start             # web :3000   (or npm run dev)
npm run typecheck                          # frontend + packages + server
npm test                                   # 45 unit + API tests
npm run test:live                          # live Sepolia (4)
npm run test:fork                          # real Aqua approve→ship→dock on anvil Sepolia fork (1)
npm run test:e2e                           # Playwright against the running app (4)
```

### Env vars (`.env.local`, gitignored; documented in `.env.example`)
- **Chain:** `TRACE_CHAIN_ID=11155111`, `SEPOLIA_RPC_URL` (Infura), `SEPOLIA_RPC_FALLBACK_URLS`, `TRACE_OWNER_WALLET` (public address).
- **Persistence:** `DATABASE_URL` (Supabase **session pooler**), `DATABASE_URL_DIRECT`, `DATABASE_SSL`, `REDIS_URL` (Upstash `rediss://`), `PORT`, `CORS_ORIGINS`.
- **0G inference:** `ZERO_G_ROUTER_URL`, `ZERO_G_API_KEY`, `ZERO_G_MODEL` (default glm-4.7), `ZERO_G_TRUST_MODE`, `ZERO_G_VERIFY_TEE`.
- **0G Storage:** `OG_STORAGE_RPC_URL`, `OG_STORAGE_INDEXER_URL`, `OG_STORAGE_PRIVATE_KEY` (burner), `OG_STORAGE_ADDRESS`.
- **World ID:** `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ACTION`, `WORLD_ENVIRONMENT`.
- **Frontend:** `NEXT_PUBLIC_TRACE_API_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_SEPOLIA_PUBLIC_RPC`.

### Design system (minimal premium light theme, 2026-11-06)
Source brief: `TRACE_Claude_Minimal_Light_Theme_Reference_Pack.zip` (spec .md + reference PNG, in ~/Downloads). **Light theme only**: no dark cards, hero or sidebar anywhere.
- Tokens (`tailwind.config.js`): `ivory` #F7F3EB (canvas), `ivory-50` #FFFFFF (cards), `ivory-100` #F3EBDD (secondary), `ink` #171714, `ink-600` #77736A, `gold` #B68A42 / `gold-300` #C6A66B, `forest` #278653 (success), `line` #E9E2D6 (borders), `rounded-card` 14px, `shadow-lift`. Type: Playfair Display (headings, lining numerals forced in globals.css) + Inter.
- `Card dark` / `onDark` props still exist for call-site compatibility but render light.
- Investigate (`src/app/page.tsx` + `src/components/investigate.tsx`) has exactly five sections: (1) search hero + `EngineMark` (pure-SVG isometric ivory/gold engine, `src/components/engine-mark.tsx`; its seams glow only while an investigation runs); (2) the `Workflow` of Analyze → Understand → Verify → Execute, with *real* stage status — Analyze = chain read finished; Understand = a non-inconclusive primary strategy; **Verify = a server-validated EIP-712 authorization** (World ID noted when verified); **Execute = the Aqua `ship` tx confirmed by its receipt**. `GET /investigations/:id/full` now returns `authorizations` and `transactions` for the investigation's plans (server/src/api.ts), and `useFullInvestigation` keeps polling every 10 s while a plan exists without a successful ship. A completed step's icon flips in 3D to a green tick (`StepBadge`, `.flip*` CSS in globals.css) with a ring pulse; a green progress rail fills under the strip; when all four are done the ticks pulse together once and an "All four steps complete" note (with the ship tx link) swings in (`.all-done`, `.complete-in`); (3) `WalletOverview` + `PositionPanel` (basis position, last real swap price, in/out of range); (4) `PerformancePanel` (backtest observed replay vs buy & hold, source/assumptions in a `<details>`, honest empty state); (5) `BestExecution` (gold-bordered card; **runs Verify + Execute inline** via `ExecutePanel` + `useAquaExecution` in `src/lib/aqua-flow.ts`: amounts → compatibility → compile + simulate → EIP-712 sign (server-verified) → exact approvals → ship, each tx confirmed through `GET /transactions/:hash`, resumable after a rejection, and it invalidates `["full", invId]` so the workflow ticks live; the `/execute` page stays as the step-by-step view; recommended Aqua range = the basis position's own ticks, because that is what `aqua-adapter/compile.ts` compiles; the button is disabled with a stated reason when there is no investigation, Aqua is blocked, the strategy is inconclusive, or the verdict is INCOMPATIBLE). Recent investigations and notes live in collapsed `<details>`.
- The case file is now only the compact band above investigation screens (`InvestigationGate`).
- Charts: hand-built SVG from real data only; light by default (`LineChart` `onDark` defaults to false; per-series `width`).

### Deployment (live since 2026-11-06)
- **Web:** Vercel project `trace` (team "him's projects", Hobby) → **https://trace-eth.vercel.app** (custom `*.vercel.app` alias added 2026-11-06; the auto-assigned https://trace-lake-iota.vercel.app still works). Imported from GitHub `himanshukaushik9813/TRACE`, `main`, root `./`, Next.js preset, default build. Env: `NEXT_PUBLIC_TRACE_API_URL=https://trace-api-6ap0.onrender.com`, `NEXT_PUBLIC_CHAIN_ID=11155111` (`NEXT_PUBLIC_SEPOLIA_PUBLIC_RPC` unset → code default). Auto-deploys on every push to `main`. `NEXT_PUBLIC_*` are inlined at build time, so changing them needs a Vercel redeploy.
- **API + worker:** Render Blueprint `trace` (from `render.yaml`) → web service `trace-api` (`srv-dbmvtoijnfac73bjqul0`, free plan, Singapore) → **https://trace-api-6ap0.onrender.com** (`/health` → `{"ok":true,...,"database":"ok","queue":"bullmq"}`). Build `npm ci && npm run build:server`; start `node server/dist/index.js` (env comes from Render, not `--env-file`); `NODE_VERSION=22`. Auto-deploys on push to `main`. Secrets were pasted into Render by the user (sync:false keys); public values by Claude. `CORS_ORIGINS=https://trace-eth.vercel.app,https://trace-lake-iota.vercel.app` (add more origins comma-separated; local dev origins are always allowed by api.ts).
- **Free-tier caveat:** Render spins the API down after ~15 min idle; the first request then takes ~50 s ("SERVICE WAKING UP" page / 503). Investigations interrupted by a spin-down are re-queued on boot (BullMQ on Upstash).
- Supabase (DB) and Upstash (Redis) are the same instances the local setup uses, so local and hosted share data.
- Render's GitHub App now has access to `blog-app` + `TRACE` (changed 2026-11-06).

---

## 3. Verified facts (checked 2026-11-05/06)

- **Sepolia RPC: Infura.**
  - eth_getLogs is capped at 10,000 blocks per request (verified: "range 50000 exceeds limit of 10000").
  - **Measured throughput of this free key: about 1 eth_getLogs per second sustained**, which is roughly 250 credits/s, not the documented 500. A getLogs costs 255 credits and most reads cost 80. Calls spaced 700ms apart still get about 35% 429s; at 1s they get none.
  - The fix (2026-11-06) is a process-wide token-bucket **credit limiter** in `chain-data`: 240 credits/s by default, overridable with `TRACE_RPC_CREDITS_PER_SEC`, FIFO-serialized. On a 429 it drains the bucket and backs off linearly for 0.6–6s instead of 2–20s exponentially.
  - viem errors embed the RPC URL including the key, so every chain error passes through `scrubSecrets`.
  - No free public fallback works: publicnode has pruned history, dRPC free doesn't serve Sepolia, and 1rpc allows 50 blocks.
- **Uniswap V3 Sepolia (official):**
  - Factory `0x0227628f3F023bb0B980b67D528571c95c6DaC1c`
  - NPM `0x1238536071E1c677A632429e3655c799b22cDA52` (deploy block 3,518,286)
  - QuoterV2 `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3`
  - SwapRouter02 `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`
- **Real NPM events.** In IncreaseLiquidity, DecreaseLiquidity and Collect, only `tokenId` is indexed, so wallets are found via ERC-721 Transfer. `Collect` returns owed principal + fees, and TRACE splits them.
- **Actively traded Sepolia pools:** WETH/USDC 1% `0x6418EEC70f50913ff0d756B48d32Ce7C02b47C47` (~1,279 swaps in 30k blocks), 0.05% `0x3289680d…`, 0.3% `0x6Ce0896e…`.
  - WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
  - USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
  - Most other test pools have ~0 swaps, so the backtest returns `insufficient_data`.
- **1inch Aqua Sepolia (documented legacy test pair):**
  - Registry `0xe8026bf31e58b738647319362581ab11be92139b`
  - AquaSwapVMRouter `0x016b417bc933370f5eacc40b1d58b015ac72b070`
  - KycNFT `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468`
  - approve + ship simulate OK on Sepolia, and the full approve → ship → dock passes on an anvil fork.
  - Swap (taker) needs the KycNFT, which the owner doesn't have.
- **1inch SDK bug.** `@1inch/swap-vm-sdk@0.5.0` has a broken ESM build, so both 1inch SDKs are loaded via `createRequire` (CJS).
- **0G inference.** The `sk-` key is a MAINNET router key locked to trust mode "private".
  - No model currently has a private (TEE) provider, so every call returns `no_provider_for_trust_mode`. Other trust modes return `trust_mode_mismatch`.
  - **BLOCKED** until 0G adds private providers or the user creates a key with standard/verified trust at pc.0g.ai.
- **0G Storage.** Burner uploader on Galileo (chainId 16602): `0xe8f9c5bA6c8c196B72989193362f3A28638a754A`. Its key is in `.env.local` only, and its balance is 0. **BLOCKED** until funded at faucet.0g.ai.
- **Supabase.** The direct host is IPv6-only and this Mac has no IPv6 route, so `DATABASE_URL` uses the session pooler `aws-0-ap-northeast-1.pooler.supabase.com:5432` (user `postgres.<ref>`).
- **Upstash Redis** works with ioredis built from the full `rediss://` URL.
- **Owner wallet `0x5971…`:** 0.12 Sepolia ETH, 0 V3 positions. The MetaMask wallet `0x6583…d2De` also has 0 V3 positions. Investigating either one ends in NO_EVENTS, which is correct behaviour, not a bug.
- **Real active LP wallets** are found live through `findActiveLpWallets` (`GET /wallets/suggested`).
  - Since 2026-11-06 they are ranked by real Swap count in each wallet's latest pool over the last ~10k blocks, and each result carries `pair`, `pool` and `poolSwaps`.
  - Before that, a bot (`0xC01F…3042`) with 34 junk-pool positions ranked first, and its backtest was `insufficient_data`.
- **Best demo investigate target:** `0x4797a94741b2512c3236d61ca0195638c44deb4c`.
  - It holds WETH/USDC 1% position #230171 (pool `0x6418…`, ~3,900 swaps in 200k blocks), with 14 events.
  - Inferred family: `passive_concentrated` (collects about every 4.1 days, 100% in range).
  - The backtest completed with 4 runs. Aqua compatibility is PARTIAL, and the plan compiles to approve, approve, ship, dock with all simulations OK.
- **Demo signing wallet:** `0x9245B8eB7d1a2964b896607dfBe1Da30b3E10200`.
  - Created by `scripts/demo-wallet.mjs create`. Its key is in `.demo-wallet.local.json` (gitignored, chmod 600), TESTNET ONLY.
  - It needs about 0.06 Sepolia ETH, then `seed` (wrap, swap, mint WETH/USDC 1%), then `collect` and `rerange` a few minutes later.
- **Investigation speed (2026-11-06):**
  - Before: 252–319s per investigation and 199 RPC calls for 14 events.
  - After: a cold, never-seen wallet takes **~88s (63 calls)**. A repeat takes **~14s (11 calls)**.
  - How:
    - The credit limiter, so requests are never rejected and there are no back-off stalls.
    - **Aligned log chunks:** chunks are aligned to multiples of 10k blocks; finalized ones (≥64 blocks behind head) are cached in memory **and Redis** (`setPersistentChainCache`, wired in `server/src/index.ts`, 30-day TTL).
    - Block timestamps are cached in Redis too.
    - Price-series timestamp anchors sit at fixed 10k-block boundaries, so they're shared across pools and runs.
    - Process-wide token/timestamp/receipt caches.
    - `tokenOfOwnerByIndex` batched through Multicall3.
    - 0G archive preflights the uploader balance and fails fast when it's 0 (this used to burn ~12s).
    - `POST /investigations` re-attaches to an already-running job for the same wallet+days (`reused: true`). Previously, two duplicate jobs saturated the key.
    - The pipeline heartbeat writes `progress.liveRpcCalls` every 2.5s, and the UI shows "N RPC calls so far".
  - On a free key, the first run for a brand-new wallet is RPC-bound. For a demo, run the wallet once beforehand; the cache then makes it fast for 30 days.
- **Aqua ship needs only ETH for gas plus exact approvals.** The maker's token balances are not required to ship; Aqua pulls tokens only when swaps fill, and the fork test sets only ETH.
- **World ID.** No credentials. "World Agent Pass" isn't an official product. Authorization is an EIP-712 wallet signature, with an optional World ID v4 staging layer.

---

## 4. Status

### Integration status (live via `GET /integrations` / Reports screen)
| Integration | Status |
|---|---|
| Sepolia RPC, Uniswap V3 data | VERIFIED TESTNET |
| Supabase, BullMQ/Redis | VERIFIED LIVE |
| Aqua ship/dock | ship VERIFIED on Sepolia with real MetaMask 2026-11-06 (tx 0x48350bf8…); dock not yet run; UI label still static |
| Aqua swap | BLOCKED (KycNFT) |
| 0G inference | BLOCKED (key trust mode "private", no providers) |
| 0G Storage | BLOCKED (burner unfunded) |
| EIP-712 auth | VERIFIED with real MetaMask on Sepolia 2026-11-06 (auth 91c46c2e…) |
| World ID | BLOCKED (no creds) |

### Test results (last run 2026-11-06, after the speed work)
- typecheck ✓ · `next build` ✓
- `npm test` 45/45 (live/fork/e2e were not re-run after the speed work) · `test:live` 4/4 · `test:fork` 1/1 · `test:e2e` 4/4 (the wallet test was re-run after the MetaMask fix: 2/2 ✓)
- 2026-11-06 (after the resilience batch, commit ca51f2b): server tsc ✓, `node --check server/dist/*.js` ✓, `npm test` 45/45 ✓; every fix verified live on the user's Mac (Supabase pooler + Upstash BullMQ, all pages on :3000).

### Remaining user actions
0. **Demo:** send ~0.06 Sepolia ETH to the demo wallet `0x9245B8eB7d1a2964b896607dfBe1Da30b3E10200`, then run `node --env-file=.env.local scripts/demo-wallet.mjs seed`. Import the key from `.demo-wallet.local.json` into MetaMask. See docs/DEMO_FLOW.md, section "Before the demo".
1. Fund the 0G burner `0xe8f9c5bA6c8c196B72989193362f3A28638a754A` at faucet.0g.ai, then press **Retry archive** on Reports.
2. Create a new 0G Router key with standard/verified trust mode (or wait for private providers).
3. From wallet `0x5971…`, create WETH/USDC positions on Sepolia (app.uniswap.org), investigate the wallet, and do a real MetaMask approve → ship. That moves Aqua to VERIFIED TESTNET.
4. Optional: World ID staging credentials.
5. Optional: rotate the Infura key. It once appeared in a local RPC error during development, and also briefly in a test file; that was replaced with a dummy before any commit.

### Resilience batch delivered 2026-11-06 (commit ca51f2b)
Boot DB retry + `DATABASE_URL_DIRECT` fallback, EADDRINUSE handling, CORS for local dev origins, interrupted-investigation auto re-queue on boot (`db.requeueInterrupted`, idempotent BullMQ add), one-click "Re-run the interrupted investigation" button in `inv-gate.tsx`, and the frontend unreachable-error wording. All confirmed live on the user's Mac; frontend now on :3000 with Supabase + Upstash.

---

## 5. Gotchas learned (don't repeat)
- **BullMQ:** the default 30s job lock let long RPC jobs be marked "stalled" and run twice. Fixed with `lockDuration` 15 min and `maxStalledCount` 0.
- **viem multicall** with `allowFailure:true` turns RPC 429s into per-item "failure" results, which look like reverts. The `multicall()` wrapper re-throws transport errors so they get retried.
- **wagmi 3:** import `injected` from the `"wagmi"` root. The `"wagmi/connectors"` barrel pulls optional peers (mppx, safe) and breaks the Next build.
- **MetaMask:** chaining a chain switch into connect (`connect({chainId})`) crashed MetaMask's popup with "Cannot read properties of undefined (reading 'origin')". Connect now only requests accounts, using MetaMask's EIP-6963 connector `io.metamask` first. The NetworkBanner handles the explicit Switch to Sepolia.
- **Package exports:** an invalid `".types"` key in package.json exports broke webpack. All packages now use a proper `exports["."]`.
- **@types/express v5** types `req.params` as `string | string[]`. Use the `P(req, k)` helper in api.ts.
- **Git:** this Mac has **no GitHub SSH key**. Push over HTTPS: `git push https://github.com/himanshukaushik9813/TRACE.git main`. `origin` is SSH.
- **Infura burst limit:** ad-hoc scripts running parallel `getLogs` calls (or running alongside the worker) get 429. Run them sequentially with about 400ms gaps. This is a burst limit, not the daily quota; a single call right after succeeds.
- **Duplicate investigations** of the same wallet (double click, two tabs) used to split the RPC budget; the API now reuses the running job.
- **Don't run ad-hoc RPC scripts while the API is investigating.** They share the same Infura key, and the limiter is only process-wide.
- **The web server runs `next start` (production).** UI changes need `npm run build` and a restart. API changes need `npm run build:server` and a restart of `node --env-file=.env.local server/dist/index.js`.
- **Git authorship:** the user wants commits under **himanshukaushik9813 only — no Claude `Co-Authored-By` trailer**, ever.
- **Supabase pooler DNS flaps (`EAI_AGAIN`)** used to kill the API at boot (one failed ping → exit → "API unreachable"). `index.ts` now retries 5× with backoff on `DATABASE_URL`, then falls back to `DATABASE_URL_DIRECT` (config.ts `databaseUrlFallback`); schema errors abort immediately.
- **Port 4000 squatters**: a stale `node server/dist` process left running causes unhandled `EADDRINUSE`. `index.ts` now catches listen errors and prints the kill command. Habit: `lsof -ti :4000 | xargs kill` before restarting.
- **CORS "API unreachable"**: opening the app on a non-:3000 port or a LAN/`.local` URL made the browser block every call and show "unreachable". `api.ts` now allows any local dev origin (localhost/127.0.0.1/IPv6-loopback/`.local`/RFC-1918, any port); external origins stay blocked.
- **Stale `?inv=` on nav links**: sidebar links captured the investigation id once (app load), so "Positions" after a fresh investigation showed the *previous* wallet. Fixed via the `trace:last-investigation` window event (`useCurrentInvestigationId().set` dispatches it; `useInvParam` in `app-shell.tsx` listens). Symptom "a different wallet's positions" = check the URL's `?inv=` first — the data source is never hardcoded (verified: zero wallet literals in `src/`).
- **Stale web build = "UI change didn't work"**: `next start` serves the last `.next` build, so editing `src/` changes nothing until `npx next build` + restart. Check: `ps -o lstart -p $(lsof -ti :3000 -sTCP:LISTEN)` and `.next/BUILD_ID` mtime vs the edited files, or grep `.next/static/chunks/app/page-*.js` for a new string.
- **Shared queue (fixed 2026-11-06):** local dev and Render use the same Upstash Redis. With a hard-coded BullMQ queue name, a local API left running stole production jobs and ran them with old code. The queue name is now `TRACE_QUEUE_NAME` (Render `trace-investigations-prod` via render.yaml; local default `trace-investigations`). After pushing server changes, also restart (or stop) the local `npm run start:server`.
- **Pasting env values into Render:** copying a value out of `.env.local` with a drag-select can take the next line with it (REDIS_URL got a trailing `\nPORT=4000`) → `new IORedis(url)` throws `[trace] fatal: Invalid URL` right after `database ok`. Check each pasted value is a single line.
- **Pushing:** the Mac has no SSH key and the Claude VM can't reach GitHub; the user pushes from Terminal over HTTPS (git prompts for username + a personal access token, saved in Keychain). `git push <url> main` doesn't update `origin/main`; run `git fetch origin` afterwards (or `git update-ref`).
- **`server/dist` is the real runtime**: `npm run start:server` runs the compiled output. After editing `server/src/*.ts`, rebuild with `tsc -p server/tsconfig.build.json` (the `build:packages` step hits the connected-folder no-delete EPERM; the tsc step alone suffices), then `node --check server/dist/index.js`.

---

## 6. History of the original audit (2026-11-05) — all resolved by the migration
The original repo had these problems:
- the build was broken
- the chain reader used a non-existent Uniswap ABI (`Mint` / `getPool` / `TransferSingle` on the NPM)
- six of eight screens were hardcoded fixtures
- the World "Agent Pass" proof was self-signed HMAC by the server
- `chain-config` had addresses with no code
- Redis TLS and password were dropped
- the backtest had a look-ahead bug and hardcoded mainnet parameters
- DB amounts were `bigint`, which overflows
- unlimited/hardcoded WETH/USDC approvals

All of these were replaced in the 2026-11-06 migration.

---

## 7. Session log
- **2026-11-05** — Reviewed the project (README + uncommitted diff) and created this memory.md.
- **2026-11-05** — Read the entire codebase end to end (~11k lines). Typecheck failed; tests failed at the build step (60/64 on the old dist). Findings went to section 6.
- **2026-11-06** — Implemented the full Sepolia migration plan (`~/.claude/plans/linear-gathering-starlight.md`, from the brief `~/Downloads/TRACE_Claude_Final_Testnet_Implementation_Prompt.md`). Covered: real chain data, 0G Router client, real backtests, Aqua SDK compile + fork-verified ship/dock, EIP-712 auth, 0G Storage SDK, Supabase migrations, wagmi frontend, tests, docs.
- **2026-11-06** — Pushed to GitHub `main` over HTTPS. At the user's request, rewrote history to remove the Claude co-author trailer (force-push) and deleted the temporary branch `sepolia-testnet-migration`. History on GitHub has authors = himanshukaushik9813 only. The GitHub Contributors sidebar may still show "claude" until GitHub's cache refreshes (or support rebuilds it).
- **2026-11-06** — Fixed the MetaMask connect crash ("reading 'origin'"): connect requests accounts only, and the switch to Sepolia is explicit. Committed `564d3f6` and pushed.
- **2026-11-06** — Rewrote this memory.md to reflect the current state.
- **2026-11-06** — `d7f6166` and `c3f2391`: MetaMask network-switch fixes. Connect requests the Sepolia permitted-chains permission up front.
- **2026-11-06 (demo prep)** — The user's wallets showed "No supported positions"; this is correct, since neither wallet has V3 positions.
  - Positions/Strategy/etc. now offer one-click investigation of live LP wallets when a wallet has none (`SuggestedLpWallets` in `inv-gate.tsx`).
  - Suggestions are ranked by pool swap activity and show the pair and swap count.
  - Added `scripts/demo-wallet.mjs` and created demo wallet `0x9245…0200` (awaiting funding).
  - Verified the full pipeline on `0x4797…`.
  - Added a "Before the demo" section to docs/DEMO_FLOW.md.
  - Tests 45/45, typecheck ✓, build ✓. Not committed yet.
  - A parallel session (sepolia-testnet-migration) added a terminal investigation status `no_positions`.
    - A wallet without V3 positions is now a completed result, not "failed".
    - Migration `db/migrations/0002_no_positions_status.sql` is applied to Supabase; 17 old NO_EVENTS rows were migrated.
  - The API now warms `/wallets/suggested` at startup.
  - On restart, jobs left in a non-terminal state are marked failed with "INTERRUPTED".
- **2026-11-06 (speed)** — The user reported that investigations took minutes.
  - Root cause: Infura's real limit is about 1 getLogs/s; burst requests got 429s and then slept in exponential back-off.
  - Added the credit limiter, Redis chunk/timestamp cache, fixed anchors, multicall batching, the fast-fail archive, job reuse and the live RPC progress display (details in section 3).
  - Result: cold 319s → 88s, repeat → 14s. Tests 45/45, typecheck ✓, build ✓.
  - Testing in Chrome was not done: the user declined the browser connection prompt.
  - Committed and pushed under himanshukaushik9813 (no Claude trailer) together with the parallel session's `no_positions` work.
  - The untracked `scripts/find-v3-wallets.mjs` uses a wrong NPM address and a non-existent Mint event. It is superseded by `/wallets/suggested` and `demo-wallet.mjs`, so delete it rather than commit it.
- **2026-11-06 (INTERRUPTED fix)** — Every sub-page (Positions, Strategy DNA, Backtest, Execute·Aqua) showed "INTERRUPTED: the server restarted while this investigation was running" and offered no way out. Root cause: on boot `server/src/index.ts` marked any non-terminal investigation `failed/INTERRUPTED`; with the in-memory queue (no Redis) a restart genuinely loses in-flight work, leaving terminal `failed` rows that all screens read from `?inv=`.
  - **Fix 1 (server self-heal):** `db.requeueInterrupted()` now resets non-terminal rows to `queued` (progress `errorCode=REQUEUED`, error "Re-running: the previous run was cut off by a server restart — retrying automatically") instead of `failed`. `index.ts` re-queues them on boot. In the BullMQ path `queue.add` is now idempotent (`getJob` first) so jobs still in Redis are not double-run; in the in-memory path the work was lost, so re-queueing completes it. All pipeline ingestion is idempotent, so a re-run finishes cleanly.
  - **Fix 2 (frontend recovery):** `inv-gate.tsx` failed state now shows a one-click "Re-run the interrupted investigation" `RerunButton` (POST /investigations with the same wallet+window → new row → `onStarted` → poller picks up live progress). Works from every sub-page since they share `?inv=`.
  - Rebuilt `server/dist` via `tsc -p server/tsconfig.build.json` (the `npm run build:packages` step still hits the folder's no-delete EPERM, so build the server tsc step directly). 45/45 tests pass; the only typecheck error is the pre-existing `layout.tsx` CSS side-effect import (sandbox artifact, untouched).
- **2026-11-06 (DB boot resilience)** — API was intermittently unreachable ("TRACE API unreachable at http://localhost:4000") because `index.ts` exited on the *first* failed Supabase ping (transient `getaddrinfo EAI_AGAIN`). Now: boot tries `DATABASE_URL` (pooler) with 5 retries + backoff, then `DATABASE_URL_DIRECT` (direct host, previously unused) with the same; schema errors abort early instead of retrying. `dist` rebuilt. Frontend: `inv-gate.tsx` also gained the INTERRUPTED re-run button (same session as the re-queue fix above).
- **2026-11-06 (EADDRINUSE + Supabase verified)** — Confirmed working on user's Mac: `database ok (pooler; migrations: 0001, 0002)`, `queue backend: bullmq` (Upstash reachable). Boot crashed with unhandled `EADDRINUSE :4000` when an old server process was still holding the port. `index.ts` now catches listen errors: clear "port in use — stop the old server" message + clean exit(1) instead of a raw stack trace. Recurring gotcha: kill stale `node server/dist` processes (lsof -ti :4000 | xargs kill) before restarting.
- **2026-11-06 (CORS + final working state)** — Frontend was running on :3001 (a stale `next dev` squatting :3000), and the API only allowed origins on :3000, so every browser→:4000 call was CORS-blocked and reported as "API unreachable". `server/src/api.ts` now allows *any* local dev origin (localhost/127.0.0.1/IPv6-loopback/`.local`/private-RFC1918, any port) in addition to CORS_ORIGINS, while external origins stay blocked (verified with a unit test of the host classifier). `src/lib/api.ts` error text now distinguishes "server down" from "origin blocked". All pages green on :3000 (kill the stale PIDs 70747 etc., restart both `npm run start:server` + `npm run dev`). Uncommitted changes: server/src/{index,db,worker,config,api}.ts, src/components/inv-gate.tsx, src/lib/api.ts, server/dist/*.
- **2026-11-06 (Positions showed a different wallet's positions)** — Not hardcoded data (all position data comes from `GET /investigations/:id/full`). The bug: sidebar nav links in `src/components/app-shell.tsx` built their `?inv=` param from a value captured *once* (app load / last route change), so after investigating wallet A on the Investigate page, clicking "Positions" carried the *previous* investigation B's id. Fix: `useCurrentInvestigationId().set` (in `src/lib/api.ts`) now dispatches a `trace:last-investigation` window event whenever an investigation is started; `useInvParam` in `app-shell.tsx` subscribes to it and re-reads `?inv=`/localStorage so nav links always carry the id the user just picked. Investigate page's "Recent investigations" clicks go through the same setter, so they sync too.
  - How to verify: investigate wallet A, immediately click sidebar "Positions" — the URL must read `?inv=<A's id>` and the header "Positions · 0x…(A)". Click "Recent investigations" rows the same way. Hard refresh (Cmd+Shift+R) once so the running `next dev` picks up the new `api.ts`/`app-shell.tsx` (frontend-only change; no server restart needed).

- **2026-11-06 (commit ca51f2b)** — Committed the resilience batch: server/src/{index,db,worker,config,api}.ts, src/components/inv-gate.tsx, src/lib/api.ts, server/dist/*, memory.md. Stale-`?inv=` positions fix + memory.md batch to be committed as the next commit.- **2026-11-06 (frontend polish for judging)** — Read memory.md (there is no summary.md; the user meant this file). Audited every screen with Playwright at 1440/1024/390px: screenshots plus an overflow detector (text leaving its card/pill/cell, or the viewport). Fixed:
  - Overflow: 19-digit liquidity (`fmt.big` → 1.66 × 10¹⁵); max-tick ranges printing 340,256,…,000 (`fmt.price` + "no upper bound"); token-disc labels overlapping; long pool address in the backtest methodology; Stat values now wrap (`break-anywhere`).
  - Charts: they now measure their container with ResizeObserver (no letterboxing, full width at every size); the y-axis margin is sized to the labels; the in-range shading path was missing its `M` command, so it never drew (a console error since day one).
  - Design: added the case-file signature element; the hero collapses to "Investigate another wallet" once a case is open; Strategy DNA is a ruled ledger panel instead of 8 identical cards; the 0G notice is short, with "Why 0G was unavailable" collapsible; Execute has a real 4-step progress rail (Check → Compile → Authorize → Ship); labels are sentence case; the source badge reads "Live on Sepolia, block N"; a `.section-title` spacing rule; recent investigations are deduped per wallet; pluralisation via `fmt.count`; a reduced-motion guard plus one orchestrated case-file reveal.
  - Engine wording: very wide ranges read "spanning 86.5× in price" instead of "8547% wide" (infer.ts; applies to new runs).
  - Verified: typecheck ✓, lint ✓, `npm run test:unit` 45/45, `next build` ✓, Playwright E2E 4/4, the strict overflow audit is clean on all 13 views × 3 widths, and there are no console errors.
- **2026-11-06 (minimal light theme redesign)** — Applied the reference pack (see Design system). Changed: tailwind.config.js, globals.css, app-shell.tsx (ivory sidebar, gold active item, star mark, restrained mountain + Sepolia/block footer; top bar with breadcrumb, 4 integration pills whose dots are green only when VERIFIED, Sepolia pill, light wallet button), ui.tsx, charts.tsx, case-file.tsx, wallet.tsx, page.tsx; new investigate.tsx and engine-mark.tsx; dark cards removed from backtest/execute/strategy/positions/[id]. Verified: typecheck (frontend + server) ✓, `npm test` 45/45, `next build` ✓, Playwright E2E 4/4, screenshots checked at 1672/1440/390px. Gotcha: never run `next dev` while `next start` serves :3000 (both use `.next`); rebuild with `npx next build` and restart `npx next start -p 3000`. Not committed yet.
- **2026-11-06 (workflow ticks + completion animation)** — Checked the four steps against the DB: across all 28 completed investigations there are **0 plans, 0 authorizations, 0 transactions**, so Verify/Execute have never run; the "Awaiting your signature / Not executed yet" states were correct. Fixed a real gap: Verify only went green after an on-chain tx, so a valid signature alone never showed; it now reads the stored authorizations. Added green-tick 3D flip per step, progress rail, all-done pulse + completion note. New E2E test #5 checks the real 2-of-4 state, then (with a test-only mocked /full) the 4-of-4 completion. Verified: typecheck (frontend + server) ✓, lint ✓, unit 45/45, E2E 5/5, `server/dist` rebuilt and API restarted, `next build` + `next start` restarted on :3000. **To see all four ticks for real:** on Execute, run the compatibility checks → compile a plan (needs token balances) → sign the EIP-712 authorization → approve + ship (needs Sepolia ETH). Not committed yet.
- **2026-11-06 (Verify + Execute never ran → inline execution)** — User report: Verify/Execute stay grey. Root cause: not a backend bug. Those steps only happened through the manual 4-stage flow on `/execute`, which had never been started (0 compat/plans/auths/txs for `0xe784…`); the Investigate button only linked there. Verified the backend end to end for the user's wallet `0x658355B109fe8b0c98bEb0fC66D71acae8e4d2De` (0.05 Sepolia ETH, **0 tUNI, 0 WETH**): compatibility PARTIAL; plan compiles; approve + ship simulate OK (Aqua pulls tokens only when swaps fill, so 0 balance does not block shipping, but the order cannot fill until funded); EIP-712 authorization with a throwaway key → `validated: true`, all 7 checks. The two test plans and that authorization were deleted from the DB afterwards (the strategy is back to 0 plans). Fix: Best Execution now runs the whole flow inline (see Design system). E2E test #6 drives it with a mocked API + test wallet (signs, then rejects approve → "Continue execution"). Verified: typecheck ✓, lint ✓, unit 45/45, E2E 6/6, `next build` + restart on :3000.

- **2026-11-06 (pushed)** — Pushed to origin/main over HTTPS: b1861d0 (light theme, workflow ticks, inline Aqua execution) and fad7f51 (scripts/find-v3-wallets.mjs, no secrets; RPC key comes from TRACE_RPC_URL).
- **2026-11-06 (Verify/Execute stuck — diagnosed, fix pending)** — User report: on Investigate the last two workflow steps never get their green tick ("3. Verify · Human authorization" and "4. Execute · Via 1inch Aqua"), and after a refresh "the last step just keeps going". Confirmed facts from the user:
  - The ship transaction **did confirm on Sepolia** (user checked Etherscan), yet after refresh Execute shows grey / "Approve and ship below" (or "After verification") and Verify shows amber "Awaiting your signature" / "Your signature expired; sign again" — i.e. the UI is not linking the confirmed tx back to the plan it is showing.
  - Traced end to end: `stagesFor()` in `src/components/investigate.tsx`, `snapshot()` + `useAquaExecution()` in `src/lib/aqua-flow.ts`, and the server's `/investigations/:id/full` (auths + txs for the plan), `GET /transactions/:hash` re-verify, and `POST /plans/:id/reconcile`.
  - Root-cause ranking (UNCONFIRMED — the VM cannot reach Supabase to read the rows; all three are plausible from code reading):
    1. **`snapshot()` only ever reads `full.plans[0]` (the newest plan).** "Change amounts → Sign authorization" always compiles a *new* plan (`newPlan: Boolean(plan)` in `doVerify`), and a sign from a different connected wallet does too. A ship that confirmed on the *older* plan then becomes invisible: Verify/Execute (and the "All four steps complete" banner) evaluate only plans[0], so both stay non-green even though the on-chain ship succeeded. Most consistent with "confirmed on Etherscan + grey after refresh".
    2. **10-minute auth TTL** (`AUTH_TTL_SECONDS = 600`; `live = expires_at > now()`): reloading more than 10 min after signing → `snap.auth` null, `expired = true` → Verify "signature expired; sign again", Execute grey "After verification".
    3. **Reconcile "sent_not_found" infinite loop**: if the page reloaded while the ship prompt was open, the recovery effect polls `POST /plans/:id/reconcile` every 12 s; the server scans `max(fromBlock, latest - 150)` blocks, so a tx that confirmed *before* that window is never found (same for `found_unauthorized`) → "Checking Sepolia for a transaction sent during a reload…" spins forever. Matches "the last step just keeps going".
  - Next: read the affected investigation's `execution_plans` / `authorizations` / `transactions` rows from Supabase (psql or `node --env-file=.env.local .q.mjs '<sql>'`) to confirm which plan the shipped tx belongs to, then fix — prefer (a): pick the plan with a successful ship or a live validated auth, not just the newest; plus (b) the reconcile scan-range/unauthorized fixes. **No code was changed this session**; server/dist and src are as left by the earlier 2026-11-06 batches.

- **2026-11-06 (Verify/Execute "Awaiting your signature / Not executed yet" — stale build)** — User still saw grey Verify/Execute. Root causes: (1) **the web app on :3000 was a stale `next start` build (08:04)**: the 08:22 rewrite of `src/lib/aqua-flow.ts` + `ExecutePanel` (server-state-driven Verify → Execute with two explicit buttons, "Sign authorization" then "Approve and ship", send-intent reconcile, `cancelled` status, one-live-ship DB guard from migration 0003, which is applied) was never built. The strings "Awaiting your signature" / "Not executed yet" exist only in the old bundle, so seeing them means the page is stale. (2) The DB had **0 challenges, 0 authorizations, 0 transactions**: no signature or ship has ever been sent, so the ticks were correct. Verified the real backend Verify path on the user's latest investigation `85ddb2a1…` (wallet `0x89D0…35D0`, passive full-range tETH/HORIZON): compatibility PARTIAL, plan compiles approve → ship → dock, both simulations OK, throwaway-key EIP-712 → `validated: true`, shows in `/full` as live. The test plan was deleted afterwards (that compatibility report remains; it is a real check result). Fixes: rebuilt (`npx next build`) and restarted `next start -p 3000`; rewrote E2E #6 into a stateful mocked-API test: sign → Verify ticks (3/4) → first approve rejected → "Retry execution" → approve + ship confirm → 4/4 + "All four steps complete", with exactly one approve and one ship recorded. Verified: typecheck (frontend + server) ✓, lint ✓, unit 45/45, E2E 6/6. **For real green ticks the user must:** connect MetaMask `0x6583…` (has ~0.05 Sepolia ETH) on Sepolia → Best Execution → enter an amount → **Sign authorization** (Verify ticks) → **Approve and ship** (Execute ticks once the ship receipt confirms; there are two MetaMask tx prompts). Not committed; `.q.mjs` / `.verify-test.mjs` are untracked scratch scripts from the previous session (the latter writes fake tx rows, so don't run it against a real investigation).

- **2026-11-06 (first REAL Aqua execution + refresh starts fresh)** — The user ran the full flow from MetaMask `0x658355B1…d2De` on investigation `94b71fa1…` (wallet `0xae1D…31Cf`): plan `7adbbae6…`, server-validated EIP-712 authorization, approve `0x04b632a8…` and **ship `0x48350bf84602ae70e3193a80de39359debf8395a6e973e47b4a1dbdf4fa0ae37` both `success` on Sepolia**. So Aqua ship and EIP-712 auth are now proven with real MetaMask on Sepolia. The integration labels are still static (`IMPLEMENTED BUT NOT VERIFIED`); update them in `server/src/integrations.ts` if wanted. User then reported "on refresh the steps get executed automatically". Nothing re-executed (exactly 1 approve + 1 ship in the DB); the page *restored* the investigation from `?inv=` / localStorage and redrew the server's 4-of-4 state. The user wants a refresh to start from the beginning. Fix: `useCurrentInvestigationId({ resetOnReload: true })` (used only by the Investigate page, `src/app/page.tsx`): when the document was loaded by a browser reload (`PerformanceNavigationTiming.type === "reload"`, consumed once per document so later sidebar navigation back to Investigate still shows the current case), it drops `?inv=` and `trace:lastInvestigation`, so the page opens empty (0 of 4). Exception: a pending `trace:send-intent:*` (refresh while MetaMask was sending) keeps the investigation open so the send is reconciled, never repeated. Opening an investigation by link, Recent investigations or the sidebar still shows its saved progress. E2E #5 now uses `goto` instead of `reload`; E2E #6 ends with reload → no `?inv=`, 0 of 4, nothing re-sent. Verified: frontend typecheck ✓, lint ✓, unit 45/45, E2E 6/6, rebuilt + restarted :3000, and against the real shipped investigation: link → 4 of 4, refresh → `/` with 0 of 4. Not committed.

- **2026-11-06 (audit + beginner redesign, complete: all 8 phases committed, not pushed)** — Working the pasted "Complete Feature Audit, Testing & Beginner-Friendly UI Redesign" brief. The plan is at `~/.claude/plans/pasted-content-id-68fd-trace-quiet-backus.md`. User decisions: real three.js 3D, What If backtest + version compare, phased commits on main with no Claude trailer.
  - b32ef5f Phase 1: `docs/AUDIT.md` and backend fixes B1–B10.
  - e245b98 Phase 2: glossary + `<Term>`, Disclosure, NextStep, 7-item nav, beginner Investigate.
  - 67644d7 Phase 3: `/positions` has a 3D liquidity terrain (`src/components/liquidity-terrain.tsx` + `liquidity-view.tsx`; r3f 8 / drei 9 / three 0.169; WebGL fallback to the 2D RangeBand; wheel-zoom and touch-rotate off so the page still scrolls); plain position cards; `/positions/[id]` technical details collapsed.
  - Gotcha (AUDIT B11): `investigation.fromBlock/toBlock` arrive as strings (Postgres bigint), so coerce with `Number()`.
  - 27ff830 Phase 4: `/strategy` is a plain-language story (hypothesis, not confirmed intent) with a Versions tab and Compare (two versions side by side). New `GET /strategies/:id` (uuid-validated). `/saved` now redirects to `/strategy?tab=versions`.
  - 3286681 Phase 5: `/backtest` has plain cards (Observed vs Simulated) and an interactive What If. New `POST /investigations/:id/whatif` (rate-limited, not persisted, labelled "Simulation, not observed"). The engine gained opt-in `widthMultiplier`/`recentre`; its defaults are byte-identical to before (golden test `test/data/backtest-golden.json`).
  - ad97fa4 Phase 6: `/execute` is an 8-step guided flow (`src/components/guided-execute.tsx`) on the single `useAquaExecution` hook. The inline ExecutePanel was removed from Investigate, which now links to Execute. Reports are plain, with a JSON download. Activity is plain and grouped by investigation.
  - 508feae Phase 7: onboarding. `src/lib/onboarding.ts` stores progress in localStorage `trace:onboarding:v1`, with steps seenIntro, investigated, viewedPositions/Strategy/Backtest/Execute. `src/components/welcome.tsx` provides:
    - WelcomeCard on Investigate: "Skip" hides it for the session (sessionStorage); "Don't show again" sets `hidden`.
    - MarkStep, rendered on each page.
    - TourFooter in the sidebar: "Getting started N of 6" plus "Replay the tour".
    - E2E: 7/7 pass.
  - Gotchas:
    - `api()` JSON-stringifies `body` itself, so never pass a pre-stringified body.
    - jsonb reorders keys, so compare stored JSON deep-equal.
  - 23b3001 Phase 8 (QA):
    - `playwright.config.ts` now has a "desktop" (1440) and a "mobile" (390 touch, runs `e2e/ux.spec.ts` only) project. 15/15 pass. Other suites: unit 56/56, live 4/4, fork 1/1.
    - Fixed B12: a `<Term>` tap never showed its tooltip, because the emulated mouseenter opened it and the click toggled it shut.
    - Fixed B13: terrain edge labels ran off the canvas at 390.
    - Screenshots of every page at 1440/390 are in `docs/screenshots/`.
    - `docs/AUDIT.md` is final, with sections 1–11.
  - Push status: see the next entry.
  - Screenshot gotcha: the app scrolls inside `<main>` in a `h-[100dvh] overflow-hidden` shell. To get full-page shots, inject CSS that unclips both; see `docs/AUDIT.md` §9.
  - Pre-existing `npm audit`: `next` is critical and needs Next 16, a major upgrade; left alone deliberately.

- **2026-11-06 21:20 IST (deploy + push request)** — The user asked to deploy, commit, push and update this file. The work ran from Claude's VM on the Mac, which shares the folder but not the Mac's processes, network or credentials.
  - **Deploy:** nothing to rebuild. `.next/BUILD_ID` (07:43 UTC) is newer than every file in `src/` and `packages/*/src`, and `server/dist/index.js` (07:08 UTC) is newer than every file in `server/src`. The only commit after the builds (efe85cc) touched memory.md only. So the production builds already match HEAD. There is no hosting config (no `.vercel`, `vercel.json`, Netlify, Fly or Dockerfile); "deploy" here means the local `next start -p 3000` plus `node --env-file=.env.local server/dist/index.js` on :4000. The VM cannot restart processes on the Mac, so if either server is not already running the latest build, restart it on the Mac.
  - VM limits (gotchas): the VM's `node_modules` has only `@next/swc-darwin-arm64`, so `next build` cannot run from the Linux VM. The VM proxy returns 403 for github.com, and `add_repo` failed because no GitHub account is linked to Claude, so **pushing has to be done from the Mac's own terminal**.
  - Committed this memory.md update on main (no Claude trailer). The user then pushed everything from the Mac (origin/main = 845ae01).
  - `.q.mjs`, `.shot.mjs` and `.verify-test.mjs` are still untracked scratch scripts and were deliberately left out of the commit.

- **2026-11-06 22:00 IST (DEPLOYED: Vercel + Render)** — The user asked for a real deployment and chose Vercel (web) + Render (API + worker), with Claude driving the browser pane.
  - 845ae01 added `render.yaml`, a Blueprint for `trace-api` with 17 env keys, secrets as `sync:false`.
  - The user pushed from the Mac; the redesign phases are now on GitHub too.
  - Render: Claude added TRACE to the Render GitHub App (the user did GitHub's sudo email check), created the Blueprint, and filled the public env values. The user pasted the 6 secrets.
  - The first deploy built fine but exited with `fatal: Invalid URL`: the pasted REDIS_URL had a trailing `PORT=4000` line. After the user fixed it, `/health` reported ok with database ok and the bullmq queue.
  - Vercel: Claude imported the repo with the 2 `NEXT_PUBLIC_*` vars → https://trace-lake-iota.vercel.app (home page renders). Claude then set Render `CORS_ORIGINS` to the Vercel URL and redeployed.
  - Credentials hygiene: the user pasted the real DB password, Upstash token, 0G key and storage key into the chat. Advised rotating them after the hackathon (Supabase password, Upstash token, 0G key; the storage key is a testnet burner). After rotating, update `.env.local` and the Render env.
- **2026-11-06 22:20 IST (nicer URL)** — The user wanted a URL like trace.vercel.com. `*.vercel.com` belongs to Vercel; `trace.vercel.app`, `trace-app`, `tracefi`, `usetrace`, `gettrace` and `trace-lp` were taken. The user picked **trace-eth.vercel.app**, added under Vercel → Settings → Domains (type the name, press Enter, then Add Domain). Render `CORS_ORIGINS` now lists both Vercel domains; redeployed.
- **2026-11-06 22:30 IST (E2E guide)** — Added `docs/E2E_TESTING.md`. It covers what the 11 Playwright tests check (15 runs across the desktop and mobile projects) and what is real vs mocked: an injected test wallet; Execute API calls mocked; only test #3 writes a real empty-wallet investigation. It also covers how to run locally (3 terminals) or against production with `TRACE_WEB_URL` / `TRACE_API_URL` (wake Render first), reading results and traces, a manual walkthrough, troubleshooting, and the unit/live/fork layers. Not run from the Claude VM (no network/browser there); the last real run was 15/15 on 2026-11-06.
- **2026-11-06 22:55 IST (verification pass + audit, docs/TEST_REPORT.md)** — Offline checks in the VM: unit 56/56, frontend/server/packages typecheck clean, lint clean (before and after the fixes). Live checks through the deployed API and browser pane:
  - Real investigations `02503ab3…` and `81bb6025…` (restart) of wallet 0x4797…eb4c ran end to end.
  - 0G inference failed live: 503 `no_provider_for_trust_mode`, request `f1197eb1…`. The key is private-tier.
  - 0G Storage: uploader balance is 0. World ID is unconfigured.
  - Aqua compatibility PARTIAL, 7/7 checks.
  - All 8 recorded approve/ship txs were re-verified `status 0x1` via the publicnode Sepolia RPC. All were sent from 0x6583…d2De; ships go to the Aqua registry.
  - Onboarding, tooltips (real Tab/Escape), refresh and navigation work; 0 overflow at 1440 and 390.
  - The secret scan of git history and `.next/static` is clean.

  Fixed: (1) the mobile-drawer logo was invisible (duplicate SVG gradient id `mark-g`; now `useId`; same fix for RangeBand `band`); (2) Investigate said "Sign/Approve… below", now "…on the Execute page".
  - Not run: E2E, test:live, test:fork (no network or browser in the VM).
  - The user then sent a bigger ETHGlobal "winning-level audit & upgrade" brief (phases 1–7). TEST_REPORT.md §6 holds the proposed order; waiting for the user's go-ahead and decisions (0G key, faucet, World ID 4.0 vs AgentKit).
- **2026-11-06 23:10 IST (deployed dad5f11; queue fix)** — The user pushed; Vercel and Render both deployed dad5f11. Three fresh production investigations (c1feddd0…, 824a9197…, 9bc7b12f…) had no `priceRangeExits` in their DNA, so the jobs were processed by an older worker. The only other worker on the same Upstash queue is a local API on the Mac. Fix: a per-deployment `TRACE_QUEUE_NAME` (see Gotchas), plus a `finished` log line. Needs a push; then check the Render logs for `queue "trace-investigations-prod"` and re-run one investigation to confirm the new metric.
- **2026-11-06 23:15 IST (a9a562b live, verified)** — Pushed by the user. Render's blueprint sync added `TRACE_QUEUE_NAME=trace-investigations-prod` after that deploy had already started, so the first instance still logged the default queue. Claude ran Manual Deploy → Restart service, and the logs now show `queue "trace-investigations-prod"`. Gotcha: a new blueprint env var needs a restart if the deploy raced the sync.
  - Fresh production investigation `baf7b5ca-220d-4c76-8fcf-deca84fc9c21` has the new DNA fields (priceRangeExits 0, answered 0, median null; time in range 100%). This confirms the earlier missing fields came from an old worker on the shared queue.
  - Live Strategy page (desktop): "All 6 supporting transactions" lists each with event type, NFT #230171, block and UTC time. The 0G panel shows the real failed run (HTTP 503, 1018 ms, glm-4.7, request d5665974-a42b-4685-ba6c-871556bac728, trust mode "key default"). The DNA row reads "price never left a range".
  - At 390 px: no overflow, no duplicate ids, and the drawer logo star is visible (mark-g-<useId>).
