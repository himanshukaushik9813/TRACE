# Known limitations

These are stated plainly. Nothing below is hidden behind demo data.

## External dependencies (blocking)
1. **0G Compute (inference).**
   - The configured Router key is fixed to *private* (TEE) trust mode, and no model currently has a private provider (`no_provider_for_trust_mode`).
   - Every investigation records the real failed request (with its router request ID) and shows the evidence-only analysis instead.
   - To fix, create a key with *standard* or *verified* trust mode at [pc.0g.ai](https://pc.0g.ai).
2. **0G Storage.** The dedicated Galileo uploader has a zero balance. Fund it at [faucet.0g.ai](https://faucet.0g.ai) (0.1 0G per day), then press **Try archiving again** on the Reports screen.
3. **Aqua swap (taker).** 1inch gates takers behind the KycNFT, so the swap leg is reported as blocked. Approve, ship and dock (the maker side) are unaffected and verified on Sepolia.
4. **Aqua on Sepolia.** 1inch documents Sepolia as outside the production chain set. TRACE uses the documented test pair (registry `0xe802…139b`, router `0x016b…b070`); the current production router is not on Sepolia.

## Data and infrastructure
- **RPC limits.** Infura's free tier caps `eth_getLogs` at 10,000 blocks per request and throttles bursts.
  - TRACE chunks every scan, shares one rate limiter per RPC endpoint and retries with back-off.
  - Wallets with many positions over long windows take minutes, and a heavily throttled run fails honestly with `RATE_LIMITED`.
  - The live "suggested wallets" scan is cached for 10 minutes. Under a rate limit it serves the last good list or hides itself (HTTP 503 with Retry-After) rather than failing the page.
  - The window is limited to 365 days, and the default is 30.
- **Cold starts.** The API runs on Render's free tier and sleeps when idle; the first request after a pause can take up to ~50 s.
- **Partial history.** Positions opened before the window are marked *partial history*, and their earlier events are not included. The fee/principal split of a `Collect` assumes the related decreases happened inside the window.
- **Testnet markets.**
  - Many Sepolia pools hold test tokens and have **no swaps**. For those, the backtest returns `insufficient_data` and time-in-range is "not measured".
  - Actively traded pools (e.g. WETH/USDC) backtest fully. Testnet prices and volumes are not representative of mainnet.
- **Timestamps.** Event timestamps are exact. Price-series timestamps between sampled anchor blocks are linearly interpolated, and the UI notes this.
- **Uncollected fees** are never estimated; they are always reported as 0.
- **Gas** in backtests is reported in Sepolia ETH and is not netted against token values, because testnet ETH has no price.
- **Supabase over IPv4.** Supabase's direct database host is IPv6-only, so `DATABASE_URL` uses the session pooler.
- **Pending migration.** `0004_drop_human_verification.sql` (drops unused World ID columns) is not yet applied in production. The app does not read those columns, so it works either way.

## Product scope
- An Aqua strategy is a *compatible implementation* of the supported rules, not a migration of the Uniswap NFT. Triggers, schedules and stop-losses cannot be expressed in Aqua and are listed as "stay manual".
- Confidence values measure how well the evidence fits a hypothesis. They are **not** probabilities that the strategy is correct.
- The deterministic engines (reconstruction, fingerprints, backtester, compiler) are heuristics over on-chain behaviour and cannot see an LP's intent or off-chain signals.

## Interface
- The 3D liquidity landscape (Positions) loads lazily and can take a few seconds to draw on first view, especially on mobile; the legend and position list are available immediately.
- Secondary text (#77736A) and success green (#278653) are the brief's exact colours. They pass WCAG AA on white cards (4.7:1, 4.5:1) but are slightly below AA for small text on the cream page background (4.3:1, 4.1:1).

## Testing
- The Playwright E2E suite (`npm run test:e2e`) runs against a local API and web app. It was not run for this release because the available build environment has no network access and the repository has no CI runner. Typecheck, lint, 108 unit/API tests and a production build pass, and the main journeys were checked by hand on the deployed preview.
