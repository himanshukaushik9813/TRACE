# Demo walkthrough (3–4 minutes)

Everything shown is real Sepolia data. Where an external service blocks a step, the app says
so; nothing is simulated.

**Before you start (2 minutes, off camera)**
- Open https://trace-eth.vercel.app once to wake the API (the free Render instance can take
  up to ~50 s to start after being idle).
- Investigate wallet: `0x4797a94741b2512c3236d61ca0195638c44deb4c` (one WETH/USDC position in an
  actively traded pool, so the backtest has real swaps).
- Signing wallet (for the optional live ship): the testnet demo wallet
  `0x5971…63F3`, imported in MetaMask, with Sepolia ETH, WETH and USDC.

## Script

**0:00–0:20 · The problem.** "LP strategies only exist on-chain as raw logs. TRACE turns a
wallet's Uniswap V3 history into an evidence-backed strategy, tests it on real swaps, and
lets you run the compatible part on 1inch Aqua from your own wallet."

**0:20–0:50 · Investigate.** Click **Try an example wallet** (or paste the address). The
four-step tracker shows Analyze → Understand → Verify → Execute with real statuses. Point
out the integration dots in the top bar: green is verified, red is honestly blocked.

**0:50–1:20 · Positions.** Open **Positions**. The 3D liquidity landscape: each block is a
real position (width = price range, height = liquidity), the bright line is the pool's real
price. Click through to the case study: every lifecycle event links to Sepolia Etherscan.

**1:20–1:55 · Strategy.** Open **Strategy**: *passive concentrated liquidity*, 75%
confidence, with "Why TRACE thinks this" and every rule linked to the transactions it came
from. Say it plainly: the 0G AI provider is unavailable for our key, so this is the
evidence-only analysis, and the app labels it that way.

**1:55–2:30 · Backtest.** Open **Backtest**: 793 real swaps replayed. Observed +37.52% vs
buy and hold +36.17%, with the fee and capital breakdown. Optionally move the **What if**
range width and run it (simulated, clearly labelled).

**2:30–3:20 · Execute.** Open **Execute**. Click **Run the check**: a live on-chain
compatibility check (1 of 2 rules runs on Aqua; the reasons for the rest are shown).
- *With time and the demo wallet connected:* enter small amounts, prepare, sign the free
  EIP-712 authorization, then approve and ship in MetaMask. Each step is confirmed from its
  Sepolia receipt.
- *Short version:* open **Activity** for `0x5971…63F3` to show the confirmed approvals and
  the ship, each linked to its receipt.

**3:20–3:50 · Reports.** Open **Reports**: the summary, **Download report (JSON)**, and the
live integration table. Note the 0G Storage card: "Not archived on 0G" with the exact reason
(uploader unfunded). TRACE never shows a storage reference it did not get.

**Close (10 s).** "Real data, real receipts, and honest labels wherever a dependency is
missing."

## If something goes wrong on stage

- **"API unreachable" or slow first load:** the API is waking up; wait 30–60 s and reload.
- **Result failed to load:** use **Try again** on the error; it re-reads the same
  investigation without starting a new one.
- **Sepolia RPC rate limit:** the suggested-wallet list hides itself; use the example wallet.
