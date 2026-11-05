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
import { type BacktestResult, type PositionMeta, type PriceSeries, type StrategyIR, type V3Event } from "@trace/strategy-ir";
export declare const MIN_TRAIN_POINTS = 5;
export declare const MIN_TEST_POINTS = 10;
export type BacktestOptions = {
    /** Start capital in token1 human units (default 1000). */
    startCapital?: number;
    /** Share of points used for the train window (default 0.6). */
    trainFraction?: number;
    /** Slippage paid on each counterfactual rebalance, fraction (default 0.003). */
    slippagePct?: number;
};
/** Canonical V3 position value (any consistent units). */
export declare function positionValue(L: number, priceLo: number, priceHi: number, P: number): number;
/** The look-ahead invariant, defined once in the shared validator. */
export declare function assertNoLookAhead(split: BacktestResult["split"]): void;
export declare function runBacktest(input: {
    ir: StrategyIR;
    series: PriceSeries;
    /** The real position the strategy is based on (range + fee tier). */
    basis: PositionMeta;
    /** The wallet's real events (for the observed replay and real gas). */
    events: V3Event[];
    meta: Record<string, PositionMeta>;
    opts?: BacktestOptions;
}): BacktestResult;
