# TRACE — End-to-End (E2E) Testing Guide

This guide explains what TRACE's end-to-end tests check, how to run them (locally or
against the live deployment), how to read the results, and how to walk through the
same journey by hand.

---

## 1. What the E2E tests do

The E2E suite drives a **real Chromium browser** with [Playwright](https://playwright.dev)
through the TRACE web app. The app talks to the **real TRACE API**, which reads
**real Ethereum Sepolia data**, Supabase (Postgres) and Upstash (Redis):

```
Playwright (Chromium) ──► Web app (Next.js) ──► TRACE API + worker ──► Sepolia RPC / Supabase / Redis
```

It checks what a user would actually see: pages load, real data shows up, the
workflow ticks only when a step is really done, the network banner works, there are
no console errors, and nothing overflows on a phone.

### What is real and what is simulated

| Part | In the E2E tests |
|---|---|
| Web app, API, database, Sepolia reads | **Real**: the tests use whatever stack you point them at |
| Wallet (MetaMask) | **Simulated**: a test-only EIP-1193 provider is injected into the page. It has no private keys and can't sign or send anything real |
| Signing and shipping in the Execute flow | **Mocked**: the tests intercept the plan, authorization and transaction API calls, so **no transaction is ever sent and no fake rows are written** |
| Investigation data on screen | **Real**: tests reuse a completed investigation already in the database |

The **only** test that writes to the database is the empty-wallet test (#3). It runs
a real 7-day investigation of a random address that has no positions.

### The tests

Files: `e2e/trace.spec.ts` (core journey) and `e2e/ux.spec.ts` (usability).
Config: `playwright.config.ts`.

| # | Test | What it proves |
|---|---|---|
| 1 | Home shows the Sepolia testnet indicator and no demo or mainnet labels | The app is clearly testnet-only and never claims demo data or mainnet |
| 2 | Wrong network is detected and the user switches to Sepolia explicitly | Connecting a wallet on mainnet shows the "TRACE only runs on…" banner. **Switch to Sepolia** clears it, and switching back inside the wallet brings it back |
| 3 | A wallet with no Uniswap positions gets a genuine empty state | A **real** investigation of a random address ends with "No supported Uniswap V3 positions found" (can take up to ~3 min) |
| 4 | A completed investigation renders real data on every screen | Positions (3D terrain or its 2D fallback), position details, lifecycle events, Strategy, Backtest, Reports, and so on show real data |
| 5 | Workflow ticks only completed steps; all four tick together after a confirmed ship | Analyze and Understand tick from real data. Verify and Execute tick only after a validated signature and a confirmed ship (mocked) |
| 6 | Guided Execute: review → sign → a rejected approve resumes → ship | The 8-step Execute flow survives a rejected wallet prompt, records exactly one approve and one ship, then Investigate shows 4 of 4. A browser refresh starts fresh and re-sends nothing |
| 7 | First-visit welcome shows once | **Skip** hides it for the session, **Don't show again** hides it for good, **Replay the tour** brings it back |
| 8 | Navigation follows the journey | Sidebar order: Investigate → Positions → Strategy → Backtest → Execute → Reports → Activity |
| 9 | Glossary terms explain themselves | Tooltips open on tap/click and on keyboard focus, and **Escape** closes them |
| 10 | Every page renders a real investigation with no console errors and no sideways overflow, and keeps it on refresh | Covers every screen at desktop and phone widths |
| 11 | The liquidity terrain renders in 3D, with an honest 2D fallback without WebGL | Covers the WebGL path and the no-WebGL path |

**Two projects** (from `playwright.config.ts`):

- **desktop**: all 11 tests at 1440 × 900.
- **mobile**: tests 8–11 (`ux.spec.ts`) at 390 × 844 with touch, like a phone.

That is **15 test runs** in total. The last full run (2026-11-06) passed 15/15.

### Tests that skip themselves

Tests 4, 5, 6, 10 and 11 need data. If the database has **no completed
investigation** (or none with an executable strategy for 5 and 6), they show as
**skipped**, not failed. Run one real investigation in the app first (see section 6)
and run the suite again.

---

## 2. One-time setup

On the Mac, from the project folder:

```bash
cd ~/Desktop/TRACE
npm install                          # project dependencies (includes @playwright/test 1.64)
npx playwright install chromium      # downloads the test browser (~150 MB, once)
```

You also need `.env.local` filled in (see `.env.example`). The API reads it.

---

## 3. Run the tests locally (recommended)

The tests run against a **running** app. Use three terminal windows.

**Terminal 1: API + worker (port 4000)**

```bash
cd ~/Desktop/TRACE
npm run build:server
npm run start:server
# wait for: [trace] API listening on :4000 — Ethereum Sepolia (11155111)
```

**Terminal 2: web app (port 3000)**

```bash
cd ~/Desktop/TRACE
npm run build        # IMPORTANT: `next start` serves the last build, so rebuild after UI changes
npm run start
# wait for: ready on http://localhost:3000
```

**Terminal 3: the tests**

```bash
cd ~/Desktop/TRACE
npm run test:e2e                     # everything: desktop + mobile (15 runs)
```

### Useful variations

```bash
npx playwright test --project=desktop          # desktop only
npx playwright test --project=mobile           # phone-size UX checks only
npx playwright test e2e/ux.spec.ts             # one file
npx playwright test -g "wrong network"         # tests whose title matches the text
npx playwright test --headed                   # watch the browser while it runs
npx playwright test --ui                       # interactive UI: pick tests, time-travel through each step
npx playwright test --reporter=html && npx playwright show-report   # clickable HTML report
```

---

## 4. Run the tests against the live deployment

The same suite can test the deployed site. Point it at the live URLs with two
environment variables:

| Variable | Default | Live value |
|---|---|---|
| `TRACE_WEB_URL` | `http://localhost:3000` | `https://trace-eth.vercel.app` |
| `TRACE_API_URL` | `http://localhost:4000` | `https://trace-api-6ap0.onrender.com` |

```bash
# 1. Wake the free-tier API first (it sleeps after ~15 min idle; the first hit takes ~50 s)
curl https://trace-api-6ap0.onrender.com/health
#    → {"ok":true,"chainId":11155111,...,"database":"ok","queue":"bullmq"}

# 2. Run the suite against production
TRACE_WEB_URL=https://trace-eth.vercel.app \
TRACE_API_URL=https://trace-api-6ap0.onrender.com \
npx playwright test
```

Notes:

- Production and local share the **same** Supabase database. Test #3 adds one small
  empty-wallet investigation there, as it does locally.
- No local servers are needed for this mode.

---

## 5. Reading the results

The default reporter prints one line per test:

```
✓  [desktop] › trace.spec.ts:50:5 › home shows the Sepolia testnet indicator …   (2.1s)
-  [desktop] › trace.spec.ts:83:5 › a completed investigation renders real data … (skipped)
✘  [mobile]  › ux.spec.ts:80:5  › every page renders a real investigation …      (31.0s)
```

- `✓` passed · `-` skipped (usually missing data; see section 1) · `✘` failed.
- On a failure, Playwright keeps a **trace** (screenshots, DOM, network and console
  for every step) in `test-results/`. Open it with:

  ```bash
  npx playwright show-trace test-results/<failed-test-folder>/trace.zip
  ```

- Settings: each test may take up to **240 s**, each check waits up to **30 s**, tests
  run **one at a time** (`workers: 1`), and there are **no automatic retries**, so a
  failure is a real signal.
- `test-results/` and `playwright-report/` are gitignored.

---

## 6. Manual end-to-end walkthrough (using the app)

The same journey by hand, on https://trace-eth.vercel.app (or http://localhost:3000).
You need MetaMask with a little **Sepolia ETH** for steps 6–7 only.

1. **Open the app.** You should see "Sepolia testnet" and four pending steps:
   *Analyze → Understand → Verify → Execute*. On a first visit a welcome card
   appears; try **Skip** and **Don't show again**.
2. **Investigate.** Paste a Sepolia wallet that provides Uniswap V3 liquidity, or
   click **Try an example wallet**. Choose a look-back period and press
   **Investigate**. The engine graphic glows while it reads the chain, which can
   take a few minutes for busy wallets.
   ✔ *Analyze* ticks when the chain read finishes. ✔ *Understand* ticks when a
   strategy is identified.
3. **Positions.** Check the 3D liquidity terrain (drag to rotate). Open
   **View details** on a card and expand **Technical details** to see NFT ids and
   lifecycle events.
4. **Strategy.** Read the plain-language strategy story. Under **Versions**, open
   **Compare** for two versions side by side.
5. **Backtest.** Compare *Observed* vs *Simulated*, then use **What If** to change
   the range width and see the simulated result (labelled "Simulation, not observed").
6. **Execute: Verify.** Connect MetaMask and accept **Switch to Sepolia** if
   prompted. Enter an amount, review, and press **Sign authorization**. The server
   checks the EIP-712 signature. ✔ *Verify* ticks.
7. **Execute: ship.** Press **Approve and ship** and confirm the two MetaMask
   prompts (token approval, then Aqua ship). ✔ *Execute* ticks once the ship
   receipt confirms on Sepolia, and Investigate shows **All four steps complete**
   with the transaction link.
8. **Reports and Activity.** Reports shows live integration status and a JSON
   download. Activity lists what happened, grouped by investigation.
9. **Refresh.** Reloading Investigate starts empty (0 of 4) on purpose. Reopen
   the case from **Recent investigations** to see its saved progress. Nothing is
   re-sent.

Expected "blocked" items on Reports (external dependencies, not bugs): 0G inference
(the key is in private trust mode with no providers), 0G Storage (the uploader
wallet is unfunded) and World ID (no credentials).

---

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Many tests fail with "API unreachable" | The API isn't running. Start `npm run start:server`, or wake Render with `curl …/health` |
| A UI change "didn't work" in tests | Stale web build. Run `npm run build`, then restart `npm run start` |
| `EADDRINUSE :4000` | An old API is still running: `lsof -ti :4000 \| xargs kill`, then start again |
| Tests 4, 5, 6, 10, 11 skipped | There's no completed investigation yet. Run one in the app (section 6, step 2) |
| Test #3 times out | Sepolia RPC is slow or rate-limited (Infura 429). Don't run ad-hoc RPC scripts at the same time; re-run later |
| CORS errors against production | The site's origin must be in Render's `CORS_ORIGINS` (currently both `trace-eth` and `trace-lake-iota` vercel.app domains) |
| `browserType.launch: Executable doesn't exist` | Run `npx playwright install chromium` |

---

## 8. Other test layers (not browser-based)

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Unit and API tests (`test/*.test.mjs`) on real captured Sepolia data: reconstruction, backtester golden file, strategy IR, authorization, Aqua compile, worker | Nothing external |
| `npm run test:live` | Live Sepolia checks (`test/live/`): correct chain, every contract has code, finds and reconstructs a real LP wallet | `SEPOLIA_RPC_URL` in `.env.local` |
| `npm run test:fork` | Real 1inch Aqua approve → ship → dock on a local **Anvil fork** of Sepolia (`test/fork/`) | `SEPOLIA_RPC_URL` and Foundry's `anvil` |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint | Nothing external |

A full pre-demo check:

```bash
npm run typecheck && npm run lint && npm test && npm run test:e2e
```
