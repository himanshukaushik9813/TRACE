# Judge demo flow (about 5 minutes)

Each step uses real Sepolia data. Where an external dependency blocks a step, the app says so; no success is shown without a real receipt.

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
