# TRACE — Phase 3: Strategy Reverse Engineering and Backtesting

**Status:** implemented and tested (81/81 unit and integration tests, 0 skipped; typecheck and lint clean).
`651dbf4` is **deployed and verified live**. `9e0e3dc` + `56a3fe3` (two evidence-accuracy fixes and a wording fix) are deployed too (Render: live at b879680) and were verified live (section D).

Builds on the Phase 2 case study (`docs/PHASE_2_CASE_STUDY.md`). Nothing here invents a rule or a result. Each number below is labelled as **real** (computed from on-chain data), **assumption** (a stated parameter) or **not reliable / not calculated**.

---

## A. Strategy reverse engineering

### Behavioural fingerprints (`packages/strategy-inference/src/fingerprints.ts` `computeFingerprints`)

| Fingerprint | Field(s) | Source | Status |
|---|---|---|---|
| Average range width | `avgRangeWidthTicks`, `avgRangeWidthPct`, `fullRangeShare` | `positions()` ticks | **Real.** Edge-reaching ranges count as full-range-like (`isFullRangeLike`) and never enter the concentrated average |
| Range adjustment frequency | `repositionCount`, `repositionsPerWeek` | Lifecycle events (new NFT in the same pool with a different range after reducing the previous one) | **Real** |
| Liquidity deployment duration | `medianPositionDurationHours`, `closedPositions` | MINT → BURN / last activity | **Real** for closed positions; open positions have no end yet |
| Liquidity additions and removals | `increaseCount`, `decreaseCount`, `maxLiquiditySwingPct` | IncreaseLiquidity / DecreaseLiquidity (BigInt liquidity) | **Real** |
| Fee collection frequency | `collectCount` (fee-bearing), `collectEventCount` (all), `collectCadenceDays` | Collect events split into fee and principal | **Real.** Only collects that carried fees count (`9e0e3dc`) |
| Re-entry behaviour | `withdrawRedeployCount`, `medianReentryHours` | Withdrawal → next deposit in the same pool | **Real** |
| Price sensitivity | `priceRangeExits`, `exitsAnsweredByAction`, `exitsAnsweredByReset`, `exitResponseRefs`, `medianResponseHours` | Real pool Swap prices against each open position's range, plus the wallet's events | **Real when the pool has swaps**; `null` without price data |
| Out-of-range behaviour | `timeInRangePct` (+ `timeInRangeSamples`), `outOfRangeHours` | Real pool Swap prices during each position's life | **Real with ≥ 15 swaps** (`MIN_PRICE_SAMPLES`); fewer are reported as "too few to be reliable" with the count (`9e0e3dc`) |
| Gas | `gasSpentEth` | Receipts (gasUsed × effectiveGasPrice) | **Real** |

### Candidate classifications (`infer.ts` `scoreFamilies`)
Every investigation scores all six and stores them, each with its reason, as `alternatives` in the IR.

| Classification | Family id | Scored from |
|---|---|---|
| Passive concentrated liquidity | `passive_concentrated` | Concentrated share, no re-sets, few withdrawals |
| Passive full-range | `passive_full_range` | Full-range or edge share, no re-sets |
| Periodic range adjustment | `periodic_range_adjustment` | Fee-bearing collect count and cadence |
| **Price-triggered repositioning** (new) | `price_triggered_repositioning` | Exits answered by a range re-set before the price returned: `0.35 + 0.35·(re-sets / exits) (+0.1 if ≥ 2)`, else 0.03. Without prices it is not claimed |
| Active liquidity management | `active_range_management` | Re-set count and rate, fast re-entry |
| Repeated deployment and withdrawal | `capital_redeployment` | Withdraw → redeploy cycles, liquidity swings, multiple pools |
| **INCONCLUSIVE** | `inconclusive` | Returned when events < minimum, no positions, no rules, or the top score < 0.3. It has **no rules** |

### Every inferred rule (`StrategyRule`, `packages/strategy-ir/src/types.ts`)

| Required | Field | Notes |
|---|---|---|
| Rule description | `rule`, `evidence` | Deterministic text built from the measured values |
| Supporting transactions | `evidenceRefs` | Must exist in the wallet's events (validator plus case-study check) |
| Observation window | `observationWindow` (new) | Block and time span of the rule's own cited events (`ruleWindow`), always inside the IR `evidencePeriod` |
| Confidence | `confidence` | Fit to evidence, not probability of intent (`CONFIDENCE_NOTE`) |
| Alternative explanations | `alternative` per rule; ranked `alternatives` per strategy | |
| Uncertainty | `uncertainty` | |
| Missing evidence | `missingEvidence` (new) | What the chain cannot show for that kind of rule, e.g. "the trigger of each re-set is not recorded on-chain" |

New rule: **"Moves to a new range after the price leaves the old one"**. It cites the exact reduce + mint transactions that followed each exit.

### 0G Private Computer
`runZeroGInference` is called on every investigation. When configured, its JSON goes through `gateProposal`:
- every rule must cite only transactions from the evidence pack, or it is dropped (`rulesRejected`);
- confidence is capped by the deterministic support;
- each AI rule gets an observation window computed from the cited pack events (timestamps added to the pack), plus a missing-evidence note that the model's reasoning is unchecked.

**Live status: blocked.** Every run returns HTTP 503 `no_provider_for_trust_mode` (private-tier key). The evidence-only engine is used, and the UI says so.

## B. Backtesting (`packages/backtester/src/engine.ts` `runBacktest`)

| Run | Kind | Meaning |
|---|---|---|
| Observed wallet ranges (replay) | `observed` | The wallet's real ranges, held only while they were open (from its events), on real swaps |
| Inferred strategy | `counterfactual` | What the inferred rules would have done on the same swaps |
| Passive LP (basis range held) | `benchmark` | The basis position's range, never moved |
| Buy & hold (50/50) | `benchmark` | Half in each token, no LP |

| Metric | Field | Status |
|---|---|---|
| Starting capital | `assumptions.startCapital` | **Derived from real data**: the wallet's basis deposit valued at the first observed price; 1 if no deposit is known |
| Ending capital | `finalValue` | **Real-data simulation** |
| Realized fees | `feesEarned` | **Model on real swaps**: `|amountIn| × fee tier × L_run / (L_pool + L_run)` while in range |
| Impermanent loss | `impermanentLoss` | **Real-data simulation**, LP value without fees vs holding the initial token amounts |
| Net return | `net` = (end − start) / start | **Real-data simulation** (checked by test) |
| Maximum drawdown | `maxDrawdown` | **Real-data simulation** |
| Range occupancy | `rangeOccupancy` | **Real**: share of test-window swaps inside the run's range |
| Out-of-range duration | `outOfRangeHours` | **Real**: time between swaps while outside |
| Rebalance frequency | `rebalances` | **Real-data simulation** (counterfactual moves) |
| Gas | `gasCost` | **Real** for the observed run (receipts in the test window); **not modelled** for simulations (shown as such) |
| Slippage | `slippageCost` (new) | **Assumption**: 0.3% of position value per counterfactual move (`assumptions.slippagePct`), not observed |

**UI** (`src/app/backtest/page.tsx`):
- four run cards (observed, inferred, passive, hold);
- a **fee and capital breakdown** (Start + Fees − Slippage ± Price and range effect = End, with gas in ETH separately);
- a value-over-time benchmark chart (observed solid, simulated dashed);
- the What If panel;
- under "Advanced metrics" (expandable): the full results table, the look-ahead badge and train/test blocks, the pool price chart, the **drawdown chart** and the methodology.

All charts plot the engine's computed series. The Strategy page (`src/app/strategy/page.tsx`) shows the fingerprint table, the plain-language reasons, and each rule with its window, all its transactions (Evidence trail), alternative, uncertainty and missing evidence.

## C. Technical correctness

| Requirement | How |
|---|---|
| Historical block-aligned data | Prices are the pool's own Swap events with block, timestamp and tick; positions open and close on the blocks of their events |
| No look-ahead | Each simulated decision at swap *i* uses only swaps strictly before *i* (`rangeAt(i, history)` deploys at the previous observed price); `assertNoLookAhead`; test: changing the last price changes no earlier decision |
| Separate inference and evaluation periods | Train ends at `split.trainEndBlock`, test starts at `split.testStartBlock`, with a gap; `lookaheadGuard: "enforced"`; fewer than 15 swaps → `insufficient_data` with the reason |
| Explicit assumptions | `assumptions` in every result (valuation token, start capital, fee, gas and slippage models, price source), shown under the breakdown and in Advanced |
| Missing prices / incomplete events | No price → `insufficient_data` (never estimated). Time in range needs ≥ 15 swaps. Positions opened before the window are flagged (`historyComplete`), and the observed replay opens them at the window start, not at an invented mint |
| Decimals and integer precision | Event amounts, liquidity and fees are kept as on-chain integers (BigInt) through reconstruction and the case study, with real decimals for display. **The backtest valuation uses float64 on decimal-normalised amounts**: accurate to about 15 significant digits, not bit-exact integer math (see limitations) |
| Immutable strategy versions | `bt.strategyId` = the IR's content-addressed id (`ir_…`); stored against that strategy row; the UI shows the id and version hash. Any change to the IR produces a new id and a new backtest (integration test) |

Profitability is never promised. The UI states that testnet prices are not market prices and that higher fees do not imply a better result.

## D. Live evidence (production, `651dbf4`)

**Investigation `ffe6e45a-b197-4fa7-8c4f-da30c1f6101e`** (wallet `0x4797…eb4c`, 30 days, USDC/WETH 1% pool `0x6418…7C47`):
- **Strategy:** *passive concentrated* (75%), version `ir_6c3534ede109e5d7` (hash `fnv1a:04e70b6897f7e08a`). Rules carry observation windows (e.g. blocks 11,891,910–12,059,872) and missing-evidence notes. All six families scored (price-triggered 3%: no exits occurred).
- **Backtest:** completed on **794 real swaps**; train ends at block 12,004,577, test starts at 12,005,048 (gap 471), look-ahead guard enforced; start capital 7.7393 WETH from the real deposit.

| Run | Start | + Fees | − Slippage | ± Price/range | = End | Net | Max DD | In range | Gas (ETH) |
|---|---|---|---|---|---|---|---|---|---|
| Observed replay | 7.7393 | 0.0995 | 0 | +2.8404 | 10.6792 | +37.99% | 24.0% | 100% | 0.001188 |
| Inferred (hold range) | 7.7393 | 0.0951 | 0 | +2.2426 | 10.0770 | +30.20% | 19.4% | 100% | not modelled |
| Passive LP | 7.7393 | 0.0995 | 0 | +2.8404 | 10.6792 | +37.99% | 24.0% | 100% | not modelled |
| Buy & hold | 7.7393 | 0 | 0 | +2.8095 | 10.5488 | +36.30% | 30.6% | — | not modelled |

These describe one thin Sepolia pool over one window, and are not a forecast. Observed equals passive here because this wallet never moved its range.

**Phase 2 case-study wallet `0x4A22…909e` (`d8f54fc4…`):** backtest **`insufficient_data`**: "only 1 real swap(s) in the pool during the window; at least 15 are needed". No numbers are shown.

**Re-run on the fixed code (`b879680`): `1deb2771-aa8d-4ab4-a8fd-aef61dabf0ca`** (same wallet, 90 days):
- The earlier rules "collects fees roughly every 0.3 hours" and "~100% in range" are **gone**.
- Time in range is withheld: "only 1 real swap(s) … too few to be reliable".
- All six families are scored:

| Family | Score |
|---|---|
| Capital redeployment | 0.55 |
| Active range management | 0.52 |
| Passive full range | 0.20 |
| Passive concentrated | 0.11 |
| Periodic range adjustment | 0.05 |
| Price-triggered repositioning | 0.03 |

- Every rule carries its observation window, for example blocks 12,060,037–12,061,512.

## E. Tests (`npm run test:unit`: **81 passed, 0 failed, 0 skipped**)

| Area | Tests |
|---|---|
| Reconstruction | `reconstruction.test.mjs` (5); `case-study.test.mjs` (8): ordering, NFT association, fees vs principal vs the ledger, incomplete history |
| Inference | `inference.test.mjs` (7); `strategy-phase3.test.mjs` (7): rule windows inside the evidence plus missing evidence; all five candidate classifications scored; **price-triggered repositioning** detected with its exact transactions (test-only positions over real captured prices); INCONCLUSIVE on thin evidence; fee cadence counts only fee-bearing collects (real wallet: 1 of 5); time in range withheld below 15 swaps |
| Simulation | `backtester.test.mjs` (8): canonical V3 math, look-ahead guard, real-swap run, determinism, the golden file **byte-identical on every pre-existing field**; `strategy-phase3.test.mjs`: slippage only on counterfactual moves, net = (end − start) / start |
| Integration | `pipeline-integration.test.mjs` (2): the real pipeline (`runStages`) on captured real data → reconstruction → DNA → strategy (0G unconfigured → honest) → backtest `insufficient_data` without prices → archive (no refs). The second scenario uses a labelled test-only mapping onto the pool with captured real swaps: the backtest completed (train/test gap 239 blocks, guard enforced), tied to the stored strategy version |
| Failure paths | `pipeline-failures.test.mjs` (3): RPC failure and rate limit, empty wallet |

Not executed in this environment: `npm run test:live`, `npm run test:fork`, `npm run test:e2e` (no network or browser in the VM; see `docs/PHASE_1_AUDIT.md`).

## Metrics that **cannot** be calculated reliably (and what TRACE does)

| Metric | Why | Behaviour |
|---|---|---|
| Anything on a pool with < 15 swaps in the window | Too few prices for a train/test split or occupancy | Backtest `insufficient_data` with the reason; time in range "too few to be reliable" |
| Gas for simulated runs | No transactions exist for strategies that were not executed | "not modelled", never invented |
| Slippage | Not observable for hypothetical moves | Stated assumption (0.3%), shown in the breakdown |
| Uncollected fees | Would need fee-growth accounting at every block | Not estimated; only collected fees are counted |
| Fee income in simulations | Approximated from swap flow and the run's share of pool liquidity at each swap | Labelled a model; testnet liquidity is thin |
| History before the window | Not read | Positions are flagged, totals marked partial, nothing invented |
| The exact moment of a price exit | Prices exist only at swaps | Exit timing and reaction delays are approximate, stated in `missingEvidence` |
| The owner's intent | Not on-chain | Every strategy is a hypothesis; confidence is fit to evidence |
| Market (USD) value | No oracle on Sepolia test tokens | Values are in the pool's token1 (e.g. WETH) |
| Bit-exact valuation | The backtest uses float64 | About 15 significant digits; event-level amounts stay exact integers |
