/**
 * Deterministic, look-ahead-safe Uniswap V3 backtester on REAL pool history.
 *
 * Input: a PriceSeries built from the pool's actual Swap events (price, tick,
 * sqrtPriceX96, swap amounts, active liquidity), the strategy IR, and the
 * wallet's real positions/events.
 *
 * Split: the first ~60% of swaps is the train (inference) window, the rest is
 * the test window, with the test window starting strictly after the train
 * window's last block. Every decision at test point i uses only points < i.
 *
 * Valuation (canonical V3 concentrated-liquidity math, raw base units):
 *   x0 = √Pa, x1 = √Pb, x = √P
 *   P ≤ Pa : L·(1/x0 − 1/x1)·P          (all token0, valued in token1)
 *   P ≥ Pb : L·(x1 − x0)                (all token1)
 *   else   : L·(1/x − 1/x1)·P + L·(x − x0)
 *
 * Fees (stated model, real data): for every real swap while the run's range
 * contains the price, fee = |amountIn| × feeTier × L_run / (L_pool + L_run).
 * Gas: the observed run reports the wallet's real gas (ETH, from receipts);
 * counterfactual rebalances pay the stated slippage. Gas is reported in ETH
 * and not netted against token values (testnet ETH has no price).
 *
 * If the series is too short the result is `insufficient_data` — no numbers
 * are produced, nothing is filled in.
 */

import {
  validateBacktest,
  type BacktestResult,
  type BacktestRun,
  type PositionMeta,
  type PriceSeries,
  type StrategyIR,
  type V3Event,
} from "@trace/strategy-ir";

export const MIN_TRAIN_POINTS = 5;
export const MIN_TEST_POINTS = 10;

export type BacktestOptions = {
  /** Start capital in token1 human units (default 1000). */
  startCapital?: number;
  /** Share of points used for the train window (default 0.6). */
  trainFraction?: number;
  /** Slippage paid on each counterfactual rebalance, fraction (default 0.003). */
  slippagePct?: number;
};

type Pt = PriceSeries["points"][number] & { rawPrice: number };

const tickToRawPrice = (tick: number) => Math.pow(1.0001, tick);

/** Canonical V3 position value (any consistent units). */
export function positionValue(L: number, priceLo: number, priceHi: number, P: number): number {
  if (P <= 0 || priceLo <= 0 || priceHi <= 0 || priceLo >= priceHi) return 0;
  const x0 = Math.sqrt(priceLo);
  const x1 = Math.sqrt(priceHi);
  if (P <= priceLo) return L * (1 / x0 - 1 / x1) * P;
  if (P >= priceHi) return L * (x1 - x0);
  const x = Math.sqrt(P);
  return L * (1 / x - 1 / x1) * P + L * (x - x0);
}

/** Token amounts held by a V3 position at price P (raw units). */
function amountsAt(L: number, Pa: number, Pb: number, P: number): { a0: number; a1: number } {
  const x0 = Math.sqrt(Pa);
  const x1 = Math.sqrt(Pb);
  const x = Math.sqrt(P);
  if (P <= Pa) return { a0: L * (1 / x0 - 1 / x1), a1: 0 };
  if (P >= Pb) return { a0: 0, a1: L * (x1 - x0) };
  return { a0: L * (1 / x - 1 / x1), a1: L * (x - x0) };
}

/** The look-ahead invariant, defined once in the shared validator. */
export function assertNoLookAhead(split: BacktestResult["split"]): void {
  const r = validateBacktest({
    status: "completed",
    split,
    runs: [{}],
    assumptions: {},
  });
  if (!r.ok) throw new Error(`look-ahead guard violated: ${r.issues.map((i) => i.message).join("; ")}`);
}

type RangeFn = (i: number, history: Pt[], current: Pt) => { lo: number; hi: number } | null;

type SimOut = {
  values: number[];
  feesEarned: number;
  rebalances: number;
  inRange: number;
  outOfRangeSeconds: number;
  deployedPoints: number;
  lpValueNoFees: number;
  holdValueOfInitial: number;
};

/**
 * Simulate an LP run. `rangeAt(i, history)` returns the range to hold at test
 * point i using only `history` (strictly earlier points), or null (no position).
 */
function simulateLp(test: Pt[], train: Pt[], capitalRaw: number, feeTier: number, slippage: number, rangeAt: RangeFn): SimOut {
  const values: number[] = [];
  let L = 0;
  let lo = 0;
  let hi = 0;
  let cash = capitalRaw; // token1 raw units not deployed
  let fees = 0;
  let rebalances = 0;
  let inRange = 0;
  let outSec = 0;
  let deployed = 0;
  let initial: { a0: number; a1: number } | null = null;
  const history: Pt[] = [...train];

  for (let i = 0; i < test.length; i++) {
    const p = test[i];
    const want = rangeAt(i, history, p);
    const prevPrice = history[history.length - 1]?.rawPrice ?? p.rawPrice;
    if (want && (want.lo !== lo || want.hi !== hi)) {
      // (Re)deploy at the last OBSERVED price (no peeking at the current swap).
      const value = L > 0 ? positionValue(L, lo, hi, prevPrice) + cash : cash;
      const cost = L > 0 ? value * slippage : 0;
      if (L > 0) rebalances++;
      const unit = positionValue(1, want.lo, want.hi, prevPrice);
      L = unit > 0 ? (value - cost) / unit : 0;
      cash = unit > 0 ? 0 : value - cost;
      lo = want.lo;
      hi = want.hi;
      if (!initial && L > 0) initial = amountsAt(L, lo, hi, prevPrice);
    } else if (!want && L > 0) {
      cash += positionValue(L, lo, hi, prevPrice);
      L = 0;
    }

    const P = p.rawPrice;
    const isIn = L > 0 && P >= lo && P < hi;
    if (L > 0) deployed++;
    if (isIn) {
      inRange++;
      const a0 = BigInt(p.amount0);
      const a1 = BigInt(p.amount1);
      const poolL = Number(p.liquidity);
      const share = L / (poolL + L);
      const fee = feeTier / 1_000_000;
      // Positive amount = token into the pool (the swap input); fee charged on input.
      if (a0 > 0n) fees += Number(a0) * fee * share * P;
      else if (a1 > 0n) fees += Number(a1) * fee * share;
    } else if (i > 0) {
      outSec += Math.max(0, p.timestamp - test[i - 1].timestamp);
    }
    values.push((L > 0 ? positionValue(L, lo, hi, P) : 0) + cash + fees);
    history.push(p);
  }
  const last = test[test.length - 1].rawPrice;
  return {
    values,
    feesEarned: fees,
    rebalances,
    inRange,
    outOfRangeSeconds: outSec,
    deployedPoints: deployed,
    lpValueNoFees: (L > 0 ? positionValue(L, lo, hi, last) : 0) + cash,
    holdValueOfInitial: initial ? initial.a0 * last + initial.a1 : capitalRaw,
  };
}

function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.max(dd, (peak - v) / peak);
  }
  return dd;
}

export function runBacktest(input: {
  ir: StrategyIR;
  series: PriceSeries;
  /** The real position the strategy is based on (range + fee tier). */
  basis: PositionMeta;
  /** The wallet's real events (for the observed replay and real gas). */
  events: V3Event[];
  meta: Record<string, PositionMeta>;
  opts?: BacktestOptions;
}): BacktestResult {
  const { ir, series, basis, events, meta } = input;
  const startCapital = input.opts?.startCapital ?? 1_000;
  const slippage = input.opts?.slippagePct ?? 0.003;
  const trainFraction = input.opts?.trainFraction ?? 0.6;
  const pair = `${series.symbol0}/${series.symbol1}`;
  const dec1 = series.decimals1 ?? basis.decimals1;
  const assumptions = {
    valuationToken: series.symbol1,
    startCapital,
    feeModel: `Real swap flow: fee = |amountIn| × ${(basis.feeTier / 10_000).toFixed(2)}% × L_run/(L_pool+L_run) while in range`,
    gasModel: "Observed run: real gas from receipts (ETH, reported separately). Counterfactual rebalances: slippage only.",
    slippagePct: slippage,
    priceSource: `Uniswap V3 Swap events of pool ${series.pool} (Sepolia), blocks ${series.fromBlock}–${series.toBlock}${series.truncated ? " (sampled)" : ""}`,
  };
  const empty = (reason: string): BacktestResult => ({
    strategyId: ir.id,
    status: "insufficient_data",
    reason,
    pool: series.pool,
    pair,
    period: { fromBlock: series.fromBlock, toBlock: series.toBlock, fromTs: 0, toTs: 0 },
    split: { trainEndBlock: series.fromBlock, testStartBlock: series.fromBlock + 1, gapBlocks: 1, lookaheadGuard: "enforced" },
    assumptions,
    runs: [],
    series: { blocks: [], timestamps: [], prices: [], values: [] },
  });

  if (dec1 == null) return empty("token decimals are unknown for this pool, so values cannot be expressed in token units");
  const pts: Pt[] = series.points
    .filter((p) => Number(p.sqrtPriceX96) > 0)
    .map((p) => {
      const r = Number(p.sqrtPriceX96) / 2 ** 96;
      return { ...p, rawPrice: r * r };
    });
  if (pts.length < MIN_TRAIN_POINTS + MIN_TEST_POINTS) {
    return empty(`only ${pts.length} real swap(s) in the pool during the window; at least ${MIN_TRAIN_POINTS + MIN_TEST_POINTS} are needed for a train/test split`);
  }

  let cut = Math.max(MIN_TRAIN_POINTS, Math.floor(pts.length * trainFraction));
  const trainEndBlock = pts[cut - 1].block;
  while (cut < pts.length && pts[cut].block <= trainEndBlock) cut++; // test strictly after train
  const train = pts.slice(0, cut);
  const test = pts.slice(cut);
  if (test.length < MIN_TEST_POINTS) return empty(`test window has only ${test.length} swap(s) after the train window`);
  const split = { trainEndBlock, testStartBlock: test[0].block, gapBlocks: test[0].block - trainEndBlock, lookaheadGuard: "enforced" as const };
  assertNoLookAhead(split);

  const capitalRaw = startCapital * 10 ** dec1;
  const anchor = train[train.length - 1].rawPrice;
  const width = basis.tickUpper - basis.tickLower;
  const centered = (price: number) => {
    const t = Math.log(price) / Math.log(1.0001);
    return { lo: tickToRawPrice(t - width / 2), hi: tickToRawPrice(t + width / 2) };
  };
  const fixedRange = { lo: tickToRawPrice(basis.tickLower), hi: tickToRawPrice(basis.tickUpper) };
  const toHuman = (v: number) => v / 10 ** dec1;
  const hours = (s: number) => s / 3600;
  const ethGas = (evs: V3Event[]) =>
    [...new Map(evs.filter((e) => e.gasUsed && e.effectiveGasPrice).map((e) => [e.tx, (Number(e.gasUsed) * Number(e.effectiveGasPrice)) / 1e18])).values()].reduce((a, b) => a + b, 0);

  const runs: BacktestRun[] = [];
  const valueSeries: { label: string; points: number[] }[] = [];
  const pushLp = (label: string, kind: BacktestRun["kind"], sim: SimOut, gasCost: number) => {
    const values = sim.values.map(toHuman);
    const final = values[values.length - 1];
    runs.push({
      label,
      kind,
      net: (final - startCapital) / startCapital,
      maxDrawdown: maxDrawdown(values),
      finalValue: final,
      rangeOccupancy: test.length ? sim.inRange / test.length : null,
      outOfRangeHours: hours(sim.outOfRangeSeconds),
      rebalances: sim.rebalances,
      feesEarned: toHuman(sim.feesEarned),
      gasCost,
      impermanentLoss: sim.holdValueOfInitial > 0 ? sim.lpValueNoFees / sim.holdValueOfInitial - 1 : null,
      capitalUtilization: test.length ? sim.deployedPoints / test.length : null,
    });
    valueSeries.push({ label, points: values });
  };

  // 1) Observed wallet replay: hold exactly the ranges the wallet held, when it held them.
  const poolPositions = Object.values(meta).filter((m) => m.pool && m.pool.toLowerCase() === series.pool.toLowerCase());
  const lifeOf = (m: PositionMeta) => {
    const evs = events.filter((e) => e.tokenId === m.tokenId);
    const open = evs.find((e) => e.kind === "MINT" || e.kind === "INCREASE")?.block ?? (m.historyComplete ? Infinity : 0);
    const close = evs.find((e) => e.kind === "BURN")?.block ?? [...evs].reverse().find((e) => e.kind === "DECREASE" && m.currentLiquidity === "0")?.block ?? Infinity;
    return { open, close };
  };
  if (poolPositions.length) {
    const lives = poolPositions.map((m) => ({ m, ...lifeOf(m) }));
    const observed = simulateLp(test, train, capitalRaw, basis.feeTier, 0, (_i, history) => {
      const lastBlock = history[history.length - 1].block; // decide on what had happened by the previous swap
      const live = lives.filter((l) => l.open <= lastBlock && lastBlock < l.close).sort((a, b) => b.m.tokenId - a.m.tokenId)[0];
      return live ? { lo: tickToRawPrice(live.m.tickLower), hi: tickToRawPrice(live.m.tickUpper) } : null;
    });
    const testEvents = events.filter((e) => e.block >= split.testStartBlock && poolPositions.some((m) => m.tokenId === e.tokenId));
    pushLp("Observed wallet ranges (replay)", "observed", observed, ethGas(testEvents));
  }

  // 2) Inferred strategy, counterfactual: observed width, centred on the last train price;
  //    re-centres only if the IR has an adjustment rule and the PREVIOUS price left the range.
  const hasAdjust = ir.rules.some((r) => r.category === "adjustment");
  let cur = centered(anchor);
  const inferred = simulateLp(test, train, capitalRaw, basis.feeTier, slippage, (_i, history) => {
    const prev = history[history.length - 1].rawPrice;
    if (hasAdjust && (prev < cur.lo || prev >= cur.hi)) cur = centered(prev);
    return cur;
  });
  pushLp(`Inferred strategy (${hasAdjust ? "re-centre on exit" : "hold range"})`, "counterfactual", inferred, 0);

  // 3) Passive LP benchmark: the basis position's real range, held untouched.
  const passive = simulateLp(test, train, capitalRaw, basis.feeTier, 0, () => fixedRange);
  pushLp("Passive LP (basis range held)", "benchmark", passive, 0);

  // 4) Buy & hold: 50/50 by value at the start of the test window.
  const p0 = train[train.length - 1].rawPrice;
  const h0 = capitalRaw / 2 / p0;
  const h1 = capitalRaw / 2;
  const holdValues = test.map((p) => toHuman(h0 * p.rawPrice + h1));
  const holdFinal = holdValues[holdValues.length - 1];
  runs.push({
    label: "Buy & hold (50/50)",
    kind: "benchmark",
    net: (holdFinal - startCapital) / startCapital,
    maxDrawdown: maxDrawdown(holdValues),
    finalValue: holdFinal,
    rangeOccupancy: null,
    outOfRangeHours: null,
    rebalances: 0,
    feesEarned: 0,
    gasCost: 0,
    impermanentLoss: null,
    capitalUtilization: 1,
  });
  valueSeries.push({ label: "Buy & hold (50/50)", points: holdValues });

  const result: BacktestResult = {
    strategyId: ir.id,
    status: "completed",
    pool: series.pool,
    pair,
    period: { fromBlock: test[0].block, toBlock: test[test.length - 1].block, fromTs: test[0].timestamp, toTs: test[test.length - 1].timestamp },
    split,
    assumptions,
    runs,
    series: { blocks: test.map((p) => p.block), timestamps: test.map((p) => p.timestamp), prices: test.map((p) => p.price), values: valueSeries },
  };
  const v = validateBacktest(result);
  if (!v.ok) throw new Error(`backtest result failed validation: ${v.issues.map((i) => i.message).join("; ")}`);
  return result;
}
