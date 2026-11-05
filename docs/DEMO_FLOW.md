# Judge demo flow (about 5 minutes)

Each step uses real Sepolia data. Where an external dependency blocks a step, the app says so; no success is shown without a real receipt.

## Before the demo

TRACE analyses the wallet you **investigate**; you **execute** from the wallet you **connect**. They do not have to be the same wallet.

- **Investigate target with good data:** a wallet whose positions sit in an actively traded pool, so the backtest has real swaps to replay.
  - `0x4797a94741b2512c3236d61ca0195638c44deb4c` was verified 2026-11-06: one WETH/USDC 1% position, 14 lifecycle events, *passive concentrated*, and a completed 4-run backtest.
  - Alternatively, click a suggested wallet. Suggestions are ranked by real swap activity in each wallet's pool.
- **Demo wallet for signing:** `scripts/demo-wallet.mjs` manages a dedicated testnet-only wallet. Its key is in `.demo-wallet.local.json`, which is gitignored and must never be committed.
  1. `node --env-file=.env.local scripts/demo-wallet.mjs create` makes the wallet (done once).
  2. Send it about 0.06 Sepolia ETH.
  3. `… seed` wraps ETH, swaps half to USDC, and mints a WETH/USDC 1% position. These are real transactions.
  4. A few minutes later, `… collect` and `… rerange` add real lifecycle history (collect, withdraw, re-mint).
  5. `… status` shows balances and positions.
  6. Import the private key into MetaMask (*Add account → Import account*). The wallet can now investigate itself (**Use connected wallet**) and approve/ship to Aqua.

1. **Open TRACE** at http://localhost:3000. The top bar shows **Testnet · Sepolia**, and the sidebar footer shows the live Sepolia block.
2. **Connect a wallet.** Click **Connect wallet** (MetaMask). TRACE requests Sepolia. If you change network inside MetaMask, a banner blocks signing and offers **Switch to Sepolia**.
3. **Enter a wallet.**
   - Use **Use connected wallet**, paste any Sepolia address, or click one of the **suggested wallets**. These are found live by scanning recent Uniswap V3 position mints on Sepolia.
   - Choose a window (7–180 days) and click **Investigate**.
4. **Watch the pipeline.** The stages are Read Sepolia → Reconstruct → Strategy DNA + 0G → Backtest → Archive.
   - Progress shows real event, position and RPC-call counts.
   - A wallet without positions gets a genuine empty state.
5. **Positions.** These are the real NFT positions: ranges from `positions()`, deposits, withdrawals and fees split correctly, and every lifecycle event linked to Sepolia Etherscan. Each position page charts its range against real pool swap prices.
6. **Strategy DNA.**
   - Shows deterministic metrics (range width, re-set frequency, duration, time in range, fee cadence, redeploy cycles, gas).
   - Shows the 0G inference card: either the gated hypothesis with its router request ID, or the real error. The current key is blocked by `no_provider_for_trust_mode`.
   - Rules are grouped as entry / adjustment / exit / fee / risk, and every rule links to the transactions it was drawn from.
7. **Backtest.**
   - For actively traded pools it shows the observed replay, the inferred counterfactual, the passive LP and buy & hold, computed on real swaps. The look-ahead guard is enforced, and assumptions are stated.
   - For untraded test pools it shows **Insufficient real data**.
8. **Execute · Aqua.**
   1. Run the on-chain compatibility checks. They read the registry, router, token contracts, your balances and allowances, and the KycNFT.
   2. Enter amounts and **Compile plan**. This produces a deterministic SwapVM order and strategy hash, and simulates approve and ship from your wallet.
   3. **Sign authorization (EIP-712).** The server verifies every binding; the checklist shows the result.
   4. Sign **approve**, then **ship**, in MetaMask. Each transaction is verified from its receipt, including the `Shipped` event and the virtual balances, and links to Etherscan.
   5. Optionally authorize and sign **dock**.
   6. Swap is labelled **blocked** without a KycNFT.
9. **Reports.** The investigation dossier, the 0G Storage archive (references appear only after a verified upload; **Retry archive** once the uploader is funded), and the live **Integration status** table with contract bytecode probes.
10. **Activity and Strategy versions.** Your recorded transactions, past investigations, and the immutable strategy versions.
