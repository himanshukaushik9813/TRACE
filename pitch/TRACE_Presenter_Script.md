# TRACE: presenter script

Six slides, about 4 minutes in total. Each slide's script is also in the deck's speaker notes.

---

## 1 · Problem + Big Idea (~35 s)

Ethereum is transparent. Every liquidity move is public. But a list of transactions is not an explanation.

Look at an experienced Uniswap liquidity provider and you can see *what* they did, but not *why*: when they set a range, when they moved it, how they collected fees. Reconstructing that today means manual research across fragmented transactions.

**TRACE turns that public activity into strategy intelligence you can understand, with every claim linked to on-chain evidence.**

## 2 · Product + How It Works (~45 s)

This is the live product on the Sepolia testnet.

1. You paste a public wallet address.
2. TRACE rebuilds every Uniswap V3 position the wallet held: deposits, withdrawals, range changes and fee collections.
3. It proposes the strategy that best explains that behaviour. That is a hypothesis, shown with its evidence.
4. You backtest the rules on real historical swaps.
5. If the rules are supported, TRACE prepares them for 1inch Aqua. Nothing executes without your explicit authorization.

The screenshots are the real app. The inset shows the 3D liquidity terrain of a reconstructed position.

## 3 · Real Users + Real-World Use Case (~40 s)

Three groups need this:

- **New LPs**, who don't yet know how concentrated liquidity is managed.
- **Experienced LPs**, who spend hours researching other wallets.
- **Researchers and developers**, who need structured data, not raw transactions.

A simple example: someone has ten thousand dollars and wants to provide liquidity on ETH/USDC. They investigate a public LP wallet. TRACE rebuilds how that wallet managed liquidity. They look at its range changes and fee collection, backtest a candidate strategy, and make their own decision.

*This is illustrative. TRACE informs a decision; it does not promise returns.*

## 4 · Ecosystem + Technology Roles (~40 s)

TRACE is one intelligence layer on top of an open stack.

- **Uniswap** is the source: public V3 liquidity activity.
- **Ethereum** is the verifiable foundation. Every event TRACE reconstructs can be checked on-chain.
- **1inch Aqua** is the execution layer. We compile supported rules into an Aqua strategy, and ships are verified on Aqua's Sepolia test deployment.
- **0G** provides private AI inference and storage for investigation reports. That integration is built and is waiting on network access and funding.
- **Your wallet** approves every execution: the user signs an authorization bound to the exact plan, and the server verifies it before anything runs.

We show these honestly: green means working today, amber means integrated but pending access. These are technologies we build with, not claimed partnerships.

## 5 · Future Roadmap + Long-Term Vision (~45 s)

Our **immediate focus** is making Uniswap liquidity behaviour understandable and verifiable. That works today on Sepolia: reconstruction, evidence-linked hypotheses, backtests and Aqua compatibility checks.

**Next**, we want to make that intelligence personal for individual LPs: their own research, their risk preferences, comparisons and alerts.

**Then**, we want to expand controlled strategy automation through compatible execution infrastructure. That means condition-based actions and stronger human authorization.

**Long term**, we see TRACE as a reusable intelligence layer that helps people understand and manage liquidity across the broader DeFi ecosystem.

Everything to the right of "today" is planned, not shipped. We want to grow step by step, validating every capability before we expand.

## 6 · Differentiation + Final Closing (~35 s)

Wallet analytics tell you *what* happened: transactions, balances, positions.

TRACE tells you *how* a position was managed and *why* it might have been managed that way. It gives you:

- lifecycle reconstruction;
- behavioural strategy intelligence;
- evidence-linked hypotheses;
- backtests;
- a compatibility-aware path to execution.

Our vision is to make sophisticated liquidity management easier to understand, evaluate and learn from.

> **Uniswap made liquidity accessible. TRACE wants to make the intelligence behind that liquidity accessible too.**

Thank you.

---

### Honesty notes for Q&A

- **Live (Sepolia):** Uniswap V3 reconstruction, strategy hypotheses, backtests on historical swaps, Aqua compatibility checks.
- **Aqua:** approve/ship verified on Aqua's Sepolia test deployment. A fresh ship with the fixed price compiler is still pending.
- **0G:**
  - inference is integrated but blocked: the private-tier key returns `no_provider_for_trust_mode`;
  - Storage is integrated but blocked because the wallet is unfunded.
- **No partnership** with any listed project is claimed. The logos are the official brand files, unmodified.
