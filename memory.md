# TRACE — Project Memory

> Running log of what TRACE is, what has been built, and what's in progress.
> Updated after every work session so anyone (or any AI tool) can pick up where we left off.
> Last updated: 2026-11-05

---

## 1. What TRACE is

**On-Chain Strategy Intelligence** — built for **ETHGlobal Mumbai 2026**.

Enter a wallet → TRACE rebuilds its Uniswap V3 liquidity history → works out the
strategy behind it → backtests it → compiles the compatible rules into an
executable **1inch Aqua** program, released only with human approval.

```
INVESTIGATE → RECONSTRUCT → DISCOVER → VALIDATE → EXECUTE
```

### Core concepts
| Concept | Meaning |
|---|---|
| Reconstruction | Replay on-chain Uniswap V3 position events into a ledger; principal withdrawals kept separate from fees |
| Behavioural fingerprints | Deterministic stats computed from events (range width, rebalance timing, etc.) |
| Rule mining / family scoring | Find recurring rules and match them to strategy "families" |
| Strategy IR | Shared structured format describing a strategy (`packages/strategy-ir`) |
| 0G inference gate | An LLM on 0G only *proposes* a Strategy IR; it is schema-validated and checked against real evidence before being trusted |
| Look-ahead-safe backtest | Learn on a train window, test on a later window; no future data. Enforced in engine, IR validator, and a DB trigger |
| Aqua compile | Check compatibility with 1inch Aqua, compile deterministically (same input → same program hash). No unlimited approvals |
| World Agent Pass | Human authorization proof bound to user + strategy version + plan + action + expiry + one-time challenge; server-verified, replay-protected (currently demo HMAC key) |
| 0G Storage | Archives results; refs marked `demo: true` when no endpoint is configured |
| Honesty rule | **No fake data shown as real.** Demo data always has a DEMO DATA badge; failed live steps are marked `degraded` with reasons |

---

## 2. Architecture

```
src/                 Next.js 14 App Router web app (8 pages)
  app/               investigate · positions/[id] · strategy · backtest · execute · reports · activity · saved
  components/        app-shell, ui, charts, investigate
  lib/fixture.ts     labelled demo data
  lib/live.ts        API data layer (queue/poll, live↔demo badge)

packages/            Engine (zero-runtime-dependency TypeScript)
  strategy-ir        data contract, canonical hashing, schema gates
  uniswap-v3         events → position ledger + accounting
  strategy-inference fingerprints, rule mining, 0G gate
  backtester         look-ahead-safe simulation
  aqua-adapter       NFT→Aqua compatibility + deterministic compile
  world-auth         Agent Pass sign/verify
  zero-g-storage     archiving client
  chain-data         viem client: reads Uniswap V3 NPM logs from chain
  chain-config       NEW (uncommitted) — single source of chain/explorer/contract config
  types/             offline type stubs

server/              Express API (:4000) + BullMQ worker + Postgres
  src/pipeline.ts    runPipeline: reconstruct → infer → backtest → compile → archive
  src/worker.ts      job runner; fetches live events or falls back to fixture
db/schema.sql        Postgres schema (includes no-look-ahead trigger)
test/                node:test suite (64 tests)
scripts/build-packages.mjs   builds each package to dist/
```

### Commands
```bash
npm install && npm run dev        # demo at http://localhost:3000 (offline, fixture data)
npm run typecheck                 # frontend + packages + server
npm test                          # build packages + run 64 tests

# full stack
createdb trace && psql trace -f db/schema.sql
npm run build:packages && npm run build:server
DATABASE_URL=postgres://postgres:postgres@localhost:5432/trace REDIS_URL=redis://localhost:6379 npm run start:server
# then set NEXT_PUBLIC_TRACE_API_URL=http://localhost:4000 in .env.local and npm run dev
```

### Env vars
`DATABASE_URL`, `REDIS_URL`, `PORT`, `ZERO_G_ENDPOINT`/`ZERO_G_API_KEY`,
`ZERO_G_STORAGE_ENDPOINT`/`ZERO_G_STORAGE_KEY`, `WORLD_DEMO_ID`/`WORLD_DEMO_KEY`,
`NEXT_PUBLIC_TRACE_API_URL`, and (new) `TRACE_RPC_URL`, `TRACE_V3_NPM`.

### Design system
Editorial luxury fintech look: ivory `#F3EBDD` / paper `#FAF7F0`, charcoal `#171714`,
antique gold `#B68A42`, sage `#78866B`, forest `#344C3A`. Playfair Display + Inter,
tabular numerals, Lucide icons, SVG charts.

---

## 3. Status / history

### Committed
- `3a11c81` Initial commit: full TRACE monorepo (all of the above, demo runs offline).

### In progress (uncommitted as of 2026-11-05): Mainnet → Sepolia migration
- **`packages/chain-config/`** (new): Sepolia (chainId 11155111) is the only supported chain.
  Public RPC fallback `https://ethereum-sepolia.publicnode.com`, explorer `https://sepolia.etherscan.io`.
  Candidate Uniswap V3 Sepolia addresses (ship as `verified: false`):
  - NPM `0x03a5b0Cc65d1319D0811b8c75f5b397638b5Df25`
  - Factory `0xE73a04317494A4B0360C7EEC8871c26d0f46A45B`
  - Quoter `0x881124ca20841843Bf05C8A1BCDE91F78Fc9a5F5`
  - Router `0x2648054f82274Cf4738C466fD18331739905b087`
- **`packages/chain-data/src/client.ts`**: default chain 1 → 11155111; new `probeNpmDeployment()`
  (eth_getCode check); `npmAddress` / `npmVerified` config; new error `UNVERIFIED_DEPLOYMENT`;
  client returns `chainId` and `npmIsVerified`.
- **`packages/chain-data/src/abis.ts`, `index.ts`**: registry + `npmDeploymentNote` helper.
- **`server/src/pipeline.ts`**: `ChainIdentity` passed through instead of hardcoded "Ethereum Mainnet".
- **`server/src/worker.ts`**: job accepts `chainId` / `npmAddress`; reads `TRACE_V3_NPM` env.
- `scripts/build-packages.mjs`, `packages/tsconfig.check.json`: chain-config added to the build.
- `packages/strategy-ir/tsconfig.check.json` deleted; `.gitignore` modified.

### TODO / loose ends
- [ ] `docs/TESTNET_SETUP.md` and `docs/KNOWN_LIMITATIONS.md` are referenced in chain-config but `docs/` doesn't exist.
- [ ] `@trace/chain-config` is built but **imported nowhere** (not by chain-data, server, or frontend).
- [ ] Server startup `eth_getCode` probe that flips `verified: true` + reports on `/health` is not wired yet.
- [ ] `chain-data/abis.ts` still says Sepolia has no known NPM address (conflicts with chain-config's candidate address).
- [ ] DB still defaults to mainnet: `db/schema.sql` `chain_id default 1`, `server/src/db.ts` `insertInvestigation` uses `chainId ?? 1`.
- [ ] README and `.env.example` still describe mainnet (`TRACE_RPC_URL` example is an eth-mainnet URL); add `TRACE_V3_NPM`.
- [ ] Verify the Sepolia addresses on Sepolia Etherscan.
- [ ] Frontend: testnet indicator + Sepolia explorer links from chain-config.

---

## 4. Full code review findings (2026-11-05)

### Current build/test status
- `npm run typecheck` **fails** (frontend):
  - `src/app/page.tsx` imports `toDisplayPositions` and `fixtureEvents` from `src/lib/live.ts`, which **don't exist** → clicking "Investigate Wallet" throws at runtime.
  - `queueInvestigation(wallet, { events })` — `events` no longer accepted by `live.ts`.
  - `ArrowLeftRight` icon not exported by installed lucide-react (backtest + positions pages).
  - `live.ts:346-360` uses `r` typed `unknown` in `getEvents`.
- `npm test` **fails at build step**: `packages/chain-data/src/client.ts:144` calls `client.getBytecode`, which the offline viem stub (`packages/types/viem.d.ts`) doesn't declare. (viem installed: 2.57.16.)
- Running tests on the old dist (`npm run test:engines`): **60/64 pass**; the 4 failing are frontend tests expecting the removed demo helpers in `live.ts`.
- Root cause: `live.ts` was rewritten to "real data only, no fixtures", but `page.tsx`, `execute/page.tsx`, and `test/frontend.test.mjs` still expect the old demo-path behaviour.

### Frontend reality
- Only `/` (investigate) and `/execute` call the API. **strategy, backtest, positions, reports, activity, saved are 100% hardcoded fixture data** (`src/lib/fixture.ts`) even when the API is live. The `live.ts` store/`getFullInvestigation` exists but no page renders from it.
- `DemoBadge` is driven by a constant `DEMO_MODE = true` (`src/lib/assets.ts`), not by the data source.
- Wire-type mismatch: `live.ts` `BacktestRunSummary` = `{label, result:{netReturnPct…}}`, but server sends `{label, net, maxDrawdown, finalEquity}`.
- Fixture says "Ethereum Mainnet", chainId 1.
- `/execute` "approve" button: the **server signs the proof itself** (`POST /authorizations` issues + signs + verifies in one call) — no actual human/World ID step. After approve, `shipped` is set by a `setTimeout` (fake ship).

### Live chain reader (`packages/chain-data`) — will not work against real Uniswap V3
The ABI doesn't match the real NonfungiblePositionManager:
- Real NPM has **no `Mint` or `PositionInitialized` event** (Mint is a pool event) and no `TransferSingle` (that's ERC-1155).
- Real `IncreaseLiquidity/DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)` and `Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)` have **no indexed sender** — so wallet-topic filtering on topic[2] returns nothing / decode mismatches.
- Real NPM has no `getPool(tokenId)`; it's `positions(tokenId)` → (nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, …). Pools expose `token0()`/`token1()`, not `tokens()`.
- Burn detection (`liquidity == max uint128`) is not how burns work (`burn()` emits Transfer to 0x0).
- Correct approach: find tokenIds via ERC-721 `Transfer` (to/from wallet, both indexed), then fetch Increase/Decrease/Collect logs filtered by `tokenId` topic, and read `positions(tokenId)` for ticks/tokens/fee.

### Other engine/server issues spotted
- `events` table uses `bigint` for amounts/liquidity → overflows for 18-decimal tokens above ~9.2 tokens (should be `numeric`).
- `mergeBacktestConfig` ignores the reconstruction (`void r`) — backtest uses hardcoded mainnet-ish params (blocks 21M–23M, ETH price 3080–3920, capital 1.2M).
- `observedReplayRunner` reads `observed[observed.length-1]` = last price of the whole series (look-ahead into the test window, contradicting the guarantee). `withinTestCount` is hardcoded to 4. Operator precedence bug in `newRange` condition.
- `buyHoldRunner` returns a V3 LP (no trades) — it's the same as passive, not real buy & hold.
- `fingerprints.ts`: `exposure` is always 1 for active positions (lastActivityBlock is always set); `poolCount` uses `t.pool` which is always undefined → counts tokenIds.
- `aqua-adapter` approvals are hardcoded WETH/USDC regardless of the strategy's tokens.
- `world-auth` `verifyProof` ignores `expectedAction`.
- `_w.mjs` in repo root imports from a stale sandbox path (`/sessions/...`) — junk file.
- `positions`, `fingerprints` DB tables are defined but never written.

### What genuinely works well
- strategy-ir: types, validators, canonical hashing (FNV-1a 128), deterministic ids.
- uniswap-v3 reconstruction (given correct events), principal vs fees separation.
- 0G gate (schema + evidence audit + fallback), deterministic Aqua compile with stable program hash, World proof sign/verify with replay protection, 0G storage demo/live labelling.
- Express API + BullMQ worker + in-memory queue fallback + Postgres persistence, CORS, `/health`.
- 60 engine/server/API tests pass.

---

## 4b. Testnet migration — implementation progress (2026-11-06)
Plan: `~/.claude/plans/linear-gathering-starlight.md` (from user brief `~/Downloads/TRACE_Claude_Final_Testnet_Implementation_Prompt.md`).

**Verified facts**
- Sepolia RPC = Infura (`SEPOLIA_RPC_URL`). Infura caps eth_getLogs at 10,000 blocks/request and throttles bursts → chunked scans + client rate limiter (120ms) + backoff. viem errors embed the RPC URL (with key) → all chain errors pass through `scrubSecrets`.
- Uniswap V3 Sepolia (official): Factory 0x0227628f3F023bb0B980b67D528571c95c6DaC1c, NPM 0x1238536071E1c677A632429e3655c799b22cDA52 (deploy block 3518286), QuoterV2 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3, SwapRouter02 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E. The OLD chain-config addresses had no code anywhere (fabricated).
- 1inch Aqua Sepolia (docs, legacy test pair): registry 0xe8026bf31e58b738647319362581ab11be92139b, AquaSwapVMRouter 0x016b417bc933370f5eacc40b1d58b015ac72b070, KycNFT 0x26FFc7D378E8e49Be2c483295A3e3E511F96a468. approve+ship SIMULATE OK from owner wallet. swap needs KycNFT (owner has none).
- @1inch/swap-vm-sdk@0.5.0 ESM build is broken (extensionless import) → load both 1inch SDKs via createRequire (CJS).
- 0G Router key (`sk-`) is a MAINNET router key locked to trust mode "private"; currently NO model has a private (TEE) provider → every call fails `no_provider_for_trust_mode`; other trust modes → `trust_mode_mismatch`. BLOCKED until 0G adds private providers or user makes a key with standard/verified trust mode at pc.0g.ai.
- 0G Storage burner (Galileo 16602): 0xe8f9c5bA6c8c196B72989193362f3A28638a754A — key in .env.local only; balance 0 → user must fund at faucet.0g.ai.
- Supabase direct host is IPv6-only (no IPv6 route on this Mac) → DATABASE_URL uses session pooler aws-0-ap-northeast-1.pooler.supabase.com:5432 (user postgres.<ref>). Migrations applied (db/migrations/0001_init.sql via scripts/migrate.mjs).
- Upstash Redis (rediss://) works with ioredis full-URL (PONG).
- Owner wallet 0x5971… has 0.12 Sepolia ETH, 0 V3 positions. Real active Sepolia LPs exist (found live via findActiveLpWallets).
- World ID: no creds; "World Agent Pass" isn't a product → EIP-712 wallet signature + optional World ID v4 staging layer.

**Status (2026-11-06): implementation COMPLETE.** All layers rewritten for real Sepolia data; fixtures/demo removed (src/lib/fixture.ts, live.ts, DEMO_MODE, offline type stubs deleted).
- Server: config.ts (startup validation, refuses non-Sepolia), integrations.ts (live probes → honest labels, GET /integrations), db.ts (new schema), pipeline.ts, worker.ts (BullMQ over TLS ioredis; lockDuration 15m, maxStalledCount 0 — short lock caused duplicate runs), api.ts (all routes; EIP-712 auth gating).
- Frontend: wagmi 3 (import `injected` from "wagmi" root — "wagmi/connectors" barrel breaks Next build with optional peers), providers.tsx, wallet.tsx (connect/disconnect/NetworkBanner), every screen reads real API data via ?inv= (InvestigationGate). Positions list page /positions added.
- Package exports fixed (invalid ".types" key broke webpack).
- Results: typecheck ✓; `npm test` 45/45; `npm run test:live` 4/4; `npm run test:fork` 1/1 (real Aqua approve→ship→dock on anvil fork, events + rawBalances verified); `npm run test:e2e` 4/4; `next build` ✓.
- Docs: README + docs/{ARCHITECTURE,TESTNET_SETUP,INTEGRATIONS,SECURITY,DEMO_FLOW,KNOWN_LIMITATIONS}.md; .env.example complete.
- Remaining user actions: fund 0G burner 0xe8f9c5bA6c8c196B72989193362f3A28638a754A at faucet.0g.ai; new 0G Router key with standard/verified trust mode (or wait for private providers); create WETH/USDC positions on Sepolia from 0x5971… and do a real MetaMask ship; optional World ID staging creds.
- Run: `npm run start:server` (API :4000) + `npm run build && npm run start` (web :3000).

## 5. Session log
- **2026-11-05** — Reviewed project (README + uncommitted diff). Created this memory.md.
- **2026-11-05** — Read entire codebase end to end (~11k lines). Ran typecheck (fails) and tests (build fails; 60/64 pass on old dist). Recorded findings in section 4. No code changed.
- **2026-11-06** — Implemented the full Sepolia migration plan (see 4b): real chain data, 0G Router client, real backtests, Aqua SDK compile + fork-verified ship/dock, EIP-712 auth, 0G Storage SDK, Supabase migrations, wagmi frontend, tests, docs.
