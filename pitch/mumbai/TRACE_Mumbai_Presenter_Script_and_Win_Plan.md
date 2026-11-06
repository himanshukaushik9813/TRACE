# TRACE at ETHGlobal Mumbai 2026: presenter script + win plan

This file has three parts: the win plan (§1), the pitch script (§2) and judge Q&A prep (§3). The speaker notes in the deck carry the same script, with timings.

---

## 1. Win plan: do these before judging (highest impact first)

ETHGlobal judges score five things: **Technicality, Originality, Practicality, Usability and WOW**. Each sponsor prize also has **hard qualification rules**. A project that misses a rule is skipped, however good the pitch.

### A. Make every integration green where you can (today)

| Prize (Mumbai page) | Hard requirement | TRACE status | Action |
|---|---|---|---|
| **Uniswap Foundation**: Build with Uniswap, $10k (4 places) | Public repo, a `FEEDBACK.md`, the Uniswap Developer Feedback Form submitted with a link to it, and a README pointing to the exact contracts and lines of code | Integration live; FEEDBACK.md missing | Write `FEEDBACK.md`. Submit the form. Add a "Where Uniswap is used" section to the README with file and line links (TickMath port, position reconstruction). |
| **1inch**: Build an Aqua App, $5k | Official Aqua/SwapVM contracts; **on-chain token transfers shown in the final demo (local forks are OK)**; proper git history | Ship verified on Sepolia; fresh ship with the fixed compiler pending | Run `npm run test:fork` and do one live USDC/WETH ship. **Show the token transfer on screen in the demo.** Do not claim SwapVM unless you use it. |
| **0G**: Build with 0G Private Computer, $5k | Inference on 0G in the main flow **with request IDs**; a working app a judge can try; **one sentence on what breaks if 0G is removed** | Integrated; blocked on the private-tier key and an unfunded wallet | The page says **every team gets 0G compute credits**: claim them at the 0G booth now. Show request IDs in the strategy panel. Your sentence: *"Without 0G, TRACE can't produce private, verifiable strategy hypotheses: the evidence-to-strategy step disappears."* |

If an integration is still amber at pitch time, **leave it amber on slide 4**. Judges reward honesty and audit claims.

### B. Demo choreography (most of the score is the live demo)

1. Slides 1 → 2 (about 60 s), then **switch to the live app**.
2. Paste a **pre-loaded, known-good wallet**. Have the investigation cached so nothing waits on RPC.
3. Positions → the 3D terrain (WOW) → strategy hypothesis with evidence links (Originality) → backtest (Practicality).
4. Aqua: show the compatibility check and its "Checked on Sepolia" panel, then the **on-chain transfer** (the 1inch rule).
5. Authorization: sign in MetaMask and ship; also show one rejected signature where nothing executes.
6. Back to slides 4 → 5 → 6. Finish on the closing line.
7. Keep a screen recording of the full flow as a fallback. Never debug live: switch to the video within 10 seconds.

### C. Polish that moves scores

- Open the app with `?intro=none` during judging so the 3D intro doesn't use up your time (show it once at the start if you want the WOW moment).
- The README's first screen should hold a one-line pitch, the live link, a 2–3 minute demo video, an architecture diagram and the contract addresses.
- Git history: commit often and descriptively. 1inch checks for "no single-commit entries on the final day".

---

## 2. Pitch script (about 4 minutes plus the demo)

**1 · Problem + Big Idea (~35 s).** Ethereum is transparent: every liquidity move is public. But a list of transactions is not an explanation. Look at an experienced Uniswap LP and you can see *what* they did, not *why*. Reconstructing that today is manual research across fragmented transactions. **TRACE turns public liquidity activity into strategy intelligence you can understand, with every claim linked to on-chain evidence.** Let me show you.

**2 · Product (~45 s, then the live demo).** Here is the live product on Sepolia:
- Paste a public wallet. TRACE rebuilds every Uniswap V3 position: deposits, withdrawals, range changes and fee collections.
- It proposes the strategy that best explains that behaviour, as a hypothesis with its evidence.
- You backtest it on real historical swaps.
- If the strategy is supported, TRACE prepares it for 1inch Aqua. Nothing executes without explicit human authorization.

*→ Demo.*

**3 · Users (~40 s).**
- **New LPs**, who don't yet know how concentrated liquidity is managed.
- **Experienced LPs**, who spend hours researching other wallets.
- **Researchers**, who need structured data, not raw transactions.

The scenario: someone has $10,000 for ETH/USDC. They study a public LP wallet, see its ranges and fee collection, backtest a candidate strategy, and make their own decision. *Illustrative: TRACE informs a decision; it doesn't promise returns.*

**4 · Ecosystem (~40 s).** TRACE is one intelligence layer on an open stack:
- **Uniswap** is the source: V3 positions rebuilt with Uniswap's exact tick math.
- **Ethereum** is the verifiable foundation: every finding links to its transaction.
- **1inch Aqua** is the execution layer: we verify the order hash, approvals and price bounds before anyone signs.
- **0G** handles private inference and storage.
- **Your wallet signature** gates execution: it is bound to this exact plan, verified on our server, and can't be replayed.

Green works today; amber is built and waiting on access.

**5 · Roadmap (~40 s).**
- **Immediate focus:** make Uniswap liquidity behaviour understandable and verifiable. That works today.
- **Next:** personalized intelligence for individual LPs.
- **Then:** controlled automation through compatible execution infrastructure, always with human authorization.
- **Long term:** a reusable intelligence layer for DeFi.

Everything right of "today" is planned. We grow step by step, validating every capability.

**6 · Close (~35 s).** Wallet analytics tell you *what* happened. TRACE tells you *how* a position was managed and *why*: lifecycle reconstruction, behavioural intelligence, evidence-linked hypotheses, backtests and a compatibility-aware path to execution. **Uniswap made liquidity accessible. TRACE wants to make the intelligence behind that liquidity accessible too.** Thank you.

---

## 3. Judge Q&A prep

- **"Isn't this just a portfolio tracker?"** No. Trackers show balances and history. TRACE reconstructs each position's *lifecycle* and infers the *strategy*, with evidence for every claim, then validates it with a backtest.
- **"How do you know the AI is right?"** We don't claim it is. Every hypothesis is labelled as one and linked to the on-chain events behind it, and the backtest tests it against real swaps.
- **"Why Aqua?"** Aqua lets a strategy run from the user's own wallet without depositing into a pool contract. That matches TRACE's "you stay in control" principle. We verify the compiled order before anyone signs.
- **"How is execution protected?"** Strategy execution moves real funds, so nothing runs without the user's own EIP-712 signature, bound to the exact plan, strategy version, action and a single-use challenge, and verified on our server.
- **"What's live vs planned?"** Live on Sepolia: reconstruction, hypotheses, backtests, Aqua checks and ships. Pending access: the 0G network. Roadmap items are clearly marked as planned.
- **"Business model?"** Free research for individuals; developer APIs and research tooling later (roadmap phase 04). Don't over-claim; it's a hackathon.
