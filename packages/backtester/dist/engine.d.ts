/**
 * Deterministic, look-ahead-safe Uniswap V3 backtest engine.
 *
 * The integrity rule encoded here: a strategy action at block B may only
 * observe price history with block < B. The engine is driven by a block-time
 * aligned price series; the train (inference) window ends strictly before the
 * test (backtest) window begins, and the guard is *enforced*, not assumed.
 *
 * Position value uses the canonical Uniswap V3 concentrated-liquidity
 * formula (not a fabricated approximation):
 *
 *   Let x0 = sqrt(priceLo), x1 = sqrt(priceHi), x = sqrt(P), L = liquidity.
 *   - P <= priceLo : value = L*(1/x0 - 1/x1) * P            (all base token)
 *   - P >= priceHi : value = L*(x1 - x0)                    (all quote token)
 *   - else         : value = L*(1/x - 1/x1)*P + L*(x - x0)
 *
 * Fee income is modelled from a *stated* assumption (annual notional fee
 * yield × in-range time share), because the on-chain fee stream is not part
 * of the price series. The assumption is recorded on the result so no
 * unlabelled precision is implied.
 */
import { type BacktestResult } from "@trace/strategy-ir";
export type PricePoint = {
    block: number;
    price: number;
};
export type BacktestConfig = {
    startBlock: number;
    endBlock: number;
    startCapital: number;
    /** Liquidity in base-unit terms (drives the IL/fee math, not $ value). */
    liquidity: number;
    tickLower: number;
    tickUpper: number;
    priceLo: number;
    priceHi: number;
    feeTier: number;
    /** Stated assumption: annual fee yield on notional, as a fraction. */
    annualFeeYieldAssumption: number;
    /** Stated assumption: gas cost per trade, in quote units. */
    gasPerTradeQuote: number;
    slippagePct: number;
    gasGwei: number;
    /** Look-ahead split — the inference (train) window ends here. */
    trainEndBlock: number;
    testStartBlock: number;
    gapBlocks: number;
};
export type StrategyRunner = (ctx: {
    /** All price points with block < current.block (the runner may never look ahead). */
    history: PricePoint[];
    current: PricePoint;
    /** The train window's last observed price — the only forward-looking anchor allowed. */
    trainAnchor: PricePoint | null;
}) => {
    /** Adjust the range: new bounds; leave out of range to keep current. */
    newRange?: {
        priceLo: number;
        priceHi: number;
    };
    /** Reallocate liquidity between two pools, as a 0..1 share of pool A. */
    reallocation?: number;
    /** Whether to execute a fee sweep this step. */
    collectFees?: boolean;
    /** Trade count for this step (drives the stated gas assumption). */
    trades: number;
};
/**
 * Enforce the look-ahead guard. A BacktestConfig is only valid if the test
 * window starts strictly after the train window ends, with a positive gap.
 */
export declare function assertNoLookAhead(cfg: BacktestConfig): void;
export type SimResult = {
    equity: PricePoint[];
    finalEquity: number;
    net: number;
    maxDrawdown: number;
};
/** Simulate one strategy run over the price series. Pure + deterministic. */
export declare function simulateRun(cfg: BacktestConfig, prices: PricePoint[], runner: StrategyRunner): SimResult;
/** Canonical Uniswap V3 concentrated-liquidity position value. */
export declare function positionValue(L: number, priceLo: number, priceHi: number, P: number): number;
/** Static passive V3 LP: hold the range, no adjustments. */
export declare function passiveRunner(cfg: BacktestConfig): StrategyRunner;
/** Buy-and-hold the notional (no IL, no fees — a pure price benchmark). */
export declare function buyHoldRunner(cfg: BacktestConfig): StrategyRunner;
/**
 * The observed-wallet replay: re-set the range to track the train anchor's
 * band, re-deploy on exit, sweep fees on a cadence. Deterministic from the
 * runner inputs.
 */
export declare function observedReplayRunner(cfg: BacktestConfig, observed: PricePoint[]): StrategyRunner;
export declare function buildBacktestResult(opts: {
    strategyId: string;
    cfg: BacktestConfig;
    runs: {
        label: string;
        sim: SimResult;
    }[];
}): BacktestResult;
