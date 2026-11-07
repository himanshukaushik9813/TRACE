# TRACE — On-Chain Strategy Intelligence (Ethereum Sepolia)

> **Understand the strategy behind any wallet.** TRACE reconstructs real Uniswap V3 liquidity behaviour on Sepolia, infers the strategy from on-chain evidence, backtests it on real pool swaps, and ships the compatible rules to **1inch Aqua** as a strategy signed by your own wallet.

Built for ETHGlobal Mumbai 2026. **Testnet only** (Sepolia, 11155111). There are no demo data, mock chain responses or simulated successes anywhere in the product. Every integration is either live or labelled with exactly why it is not.

- **Live app:** https://trace-eth.vercel.app · **API:** https://trace-api-6ap0.onrender.com (`/health`, `/integrations`)
- **Submission status, evidence and test results:** [docs/SUBMISSION.md](docs/SUBMISSION.md)
- **3–4 minute demo:** [docs/DEMO_FLOW.md](docs/DEMO_FLOW.md) · **Screenshots:** [docs/screenshots/final](docs/screenshots/final)

```
INVESTIGATE → RECONSTRUCT → DISCOVER (Strategy DNA + 0G) → VALIDATE (backtest) → EXECUTE (Aqua)
```

## The problem
LP strategies are visible on-chain only as raw logs: mints, liquidity changes and collects across NFTs and pools. Copying "what a good LP does" today means guessing.

TRACE turns those logs into an evidence-backed, versioned **Strategy IR**. Every claim links to a transaction. The IR is tested on real pool history and compiled into an executable Aqua strategy. TRACE never pretends the Aqua strategy *is* the original NFT.

## Features
- **Real wallet connectivity.** MetaMask via wagmi + viem, Sepolia-only config, wrong-network detection and switching, account and chain change handling.
- **Real Uniswap V3 data.**
  - Sources: ERC-721 discovery, lifecycle logs, `positions()`, pool metadata, receipts (real gas), and pool `Swap` price history.
  - Addresses are verified against the official Uniswap docs and probed with `eth_getCode`.
- **Reconstruction.** Order-independent, with principal and fees strictly separate (V3 `Collect` = owed principal + fees, split correctly) and real token decimals.
- **Strategy DNA.** Range width, re-set frequency, duration, time in range, capital changes, fee cadence, withdraw → redeploy, gas.
- **0G Private Computer inference.**
  - Real 0G Router calls with `verify_tee`. The output is gated deterministically: tx-cited evidence only, capped confidence, `inconclusive` when evidence is thin.
  - Real request IDs are stored. Failures are shown as failures.
- **Strategy IR v2.** Immutable, content-addressed versions with entry / adjustment / exit / risk / fee rules, evidence references, alternatives and limitations.
- **Backtesting on real swaps.**
  - Runs: observed replay, inferred counterfactual, passive LP, buy & hold.
  - Uses canonical V3 math and a fee model built from the real swap flow.
  - The look-ahead guard is enforced in code *and* in the database.
- **1inch Aqua / SwapVM.**
  - Rule-by-rule compatibility with on-chain checks.
  - A deterministic SwapVM order compiled with the official SDKs.
  - Exact-amount approvals, ship and dock signed in MetaMask, and receipt and event verification.
- **Authorization.** An EIP-712 signature bound to the strategy version, plan hash, action, a single-use challenge and an expiry, verified server-side.
- **0G Storage.** Genuine Galileo uploads with Merkle-proof read-back. A reference is shown only after a successful upload.

## Integration status (verified 2026-11-07)
| | |
|---|---|
| Sepolia RPC, Uniswap V3 data | **WORKING**: verified on Sepolia (positions and events cross-checked on a public RPC) |
| Postgres (Supabase), BullMQ (Upstash Redis) | **WORKING** |
| 1inch Aqua compatibility + approve/ship (maker side) | **WORKING**: 7 ships verified from Sepolia receipts |
| EIP-712 authorization | **WORKING**: 7 signatures verified server-side |
| Aqua swap (taker) | **NOT AVAILABLE**: 1inch KycNFT required |
| 0G Compute (inference) | **BLOCKED (external)**: key fixed to *private* trust mode, no private providers; evidence-only analysis is shown and labelled |
| 0G Storage | **BLOCKED (external)**: uploader wallet needs testnet 0G; JSON download works |

Full matrix with evidence: [docs/SUBMISSION.md](docs/SUBMISSION.md).

Live status: `GET /integrations`, or the **Reports** screen. Details are in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Architecture
```
Next.js (wagmi, Sepolia) ──► Express API ──► BullMQ worker ──► chain-data (viem, Sepolia)
        │  wallet signs txs        │                │            uniswap-v3 · strategy-inference (+0G Router)
        ▼                          ▼                ▼            backtester · zero-g-storage (0G Galileo)
   Sepolia (Aqua, ERC-20)     Postgres (Supabase)  aqua-adapter (1inch SDKs) · authorization (EIP-712)
```
More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Stack:**
- Frontend: Next.js 14, React 18, Tailwind, wagmi 3, viem 2, TanStack Query.
- Backend: Express, BullMQ, ioredis, pg.
- Integrations: @1inch/aqua-sdk, @1inch/swap-vm-sdk, @0gfoundation/0g-storage-ts-sdk.
- Testing: Foundry (anvil), node:test, Playwright.

## Setup
```bash
npm install
cp .env.example .env.local     # see docs/TESTNET_SETUP.md for every variable
npm run db:migrate
npm run build:server && npm run start:server   # API + worker  → :4000
npm run build && npm run start                 # web app       → :3000
```

**Environment variables:**
- Required: `SEPOLIA_RPC_URL`, `DATABASE_URL`.
- Recommended: `REDIS_URL`.
- Optional (0G): `ZERO_G_ROUTER_URL`, `ZERO_G_API_KEY`, `ZERO_G_MODEL`, `OG_STORAGE_*`.

The full template is [.env.example](.env.example). The server validates its configuration at startup, prints which variables are set (never their values), and refuses a non-Sepolia setup.

## Using TRACE
1. **Connect your wallet.** Click **Connect wallet**. TRACE requests Sepolia and blocks signing on other networks.
2. **Run an investigation.** Enter an address, use your connected wallet, or pick a live-discovered LP. Choose a window and click **Investigate**.
3. **How inference works.** Deterministic Strategy DNA comes first. Then the 0G model proposes a hypothesis, and the gate keeps only rules that cite real transactions, with confidence capped at the deterministic support. If 0G is unavailable, the evidence-only analysis is shown and labelled as such.
4. **How backtesting works.** The pool's real Swap events are split into train and test windows; the test window starts strictly after training. Each decision uses only earlier swaps. Fees come from the real swap flow × fee tier × liquidity share. With too few swaps, the result is *insufficient data*.
5. **How Aqua works.**
   - Compatibility is checked rule by rule, alongside on-chain checks.
   - The supported rules compile into an `AquaXYCAmmStrategy.newConcentrate` order built from the position's real ticks and fee tier.
   - You sign an EIP-712 authorization, then approve (exact amounts), ship and, optionally, dock in MetaMask. Each transaction is verified from its receipt.

The step-by-step judge flow is in [docs/DEMO_FLOW.md](docs/DEMO_FLOW.md).

## Tests
```bash
npm run typecheck   # frontend + 9 packages + server
npm run lint
npm test            # 108 unit + API tests (incl. security, paging, rate-limit) on real captured Sepolia data
npm run test:live   # live Sepolia integration
npm run test:fork   # real 1inch Aqua contracts on an Anvil Sepolia fork: approve → ship → dock
npm run test:e2e    # Playwright against the running app
```

## Security
Sepolia-only enforcement, user-held keys only, server-verified EIP-712 with replay protection, exact approvals, simulation before signing, scrubbed secrets, CORS and rate limits, and immutable evidence in the database. See [docs/SECURITY.md](docs/SECURITY.md).

## Known limitations
See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). In short:
- The current 0G key has no available private-tier providers.
- The 0G Storage uploader needs faucet funds.
- Aqua's taker side needs the KycNFT.
- Aqua on Sepolia uses 1inch's documented test deployment.
- Free-tier RPC limits make large wallets slow.
- Many Sepolia pools have no swaps to backtest against.

## Design
Premium, minimal, light only: a warm `#F7F3EB` page with white cards and `#E9E2D6` hairlines, gold `#B68A42` accents, green `#278653` for verified states, Playfair Display page titles and Inter for everything else. Charts and the 3D liquidity landscape are drawn from real data only.
