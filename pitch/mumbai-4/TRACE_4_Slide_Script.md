# TRACE: 4-slide pitch script (about 3½ minutes + live demo)

The same words are in each slide's speaker notes.

---

## Slide 1 · The problem (~45 s)

**Say:** "Ethereum is transparent: every liquidity move is public. But a list of transactions is not an explanation. You can see *what* an experienced Uniswap LP did, but not *why*: when they set a range, when they moved it, how they collected fees. Today, working that out is manual research.

**TRACE turns public liquidity activity into strategy intelligence you can understand, with every claim linked to on-chain evidence.**

It's for new LPs learning how concentrated liquidity is managed, experienced LPs who research other wallets by hand, and DeFi researchers who need structured data."

**Point at:** the red italic question, then the TRACE line at the bottom.

## Slide 2 · How it works (~60 s, then the live demo)

**Say:** "Example: someone with $10,000 wants to provide ETH/USDC liquidity and finds an experienced LP wallet.

1. **Investigate:** paste the public wallet.
2. **Reconstruct:** TRACE rebuilds every Uniswap V3 position: deposits, range changes, fee collections.
3. **Understand:** AI suggests the strategy behind it, as a hypothesis with its on-chain evidence.
4. **Validate:** backtest that strategy on real historical swaps.
5. **Execute:** if it's supported, prepare it for 1inch Aqua. Nothing runs without explicit human approval.

This is the live product on Sepolia. Let me show you."

**→ Switch to the demo:** wallet → positions + 3D terrain → strategy with evidence → backtest → Aqua check → sign the authorization in MetaMask → approve + ship on Sepolia (show one rejected signature: nothing runs).

## Slide 3 · Technology stack (~45 s)

**Say:** "TRACE is one intelligence layer on an open Web3 stack:

- **Uniswap** is the data: V3 positions rebuilt with Uniswap's exact tick math.
- **Ethereum** is the proof: every finding links to its transaction.
- **1inch Aqua** is execution: we verify the order hash, approvals and price bounds before anyone signs.
- **0G** handles private AI inference and report storage.
- **Your wallet signature** approves execution: it is bound to this exact plan, verified on our server, and can't be replayed.

Green works today; amber is built and waiting on access."

*(Update the 0G pill first if it comes online.)*

## Slide 4 · Why TRACE + what's next (~60 s)

**Say:** "Traditional analytics show transactions, balances and positions: *what* happened. TRACE shows *how* a position was managed and *why*. It does this through lifecycle reconstruction, strategy intelligence, evidence-linked AI hypotheses, backtesting and a compatibility-aware path to execution.

What's next: today it works on Sepolia.
- Next, deeper intelligence and personalized insights for each LP.
- Then controlled automation, always with human approval.
- Long term, a reusable intelligence layer for DeFi.

We grow step by step, validating every capability.

**Uniswap made liquidity accessible. TRACE wants to make the intelligence behind that liquidity accessible too.** Thank you."
