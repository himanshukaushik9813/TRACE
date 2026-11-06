/**
 * TRACE — Strategy IR v1 (shared data contract).
 *
 * This module is the single source of truth for the shapes that flow through
 * the pipeline: chain-data → reconstruction → inference → backtest →
 * compatibility/compile → proof claims. Zero runtime dependencies: it must
 * run unchanged in the browser, the Express API, and the BullMQ worker.
 *
 * Integrity rules encoded here:
 *  - Every event carries a tx reference (blockchain evidence is first-class).
 *  - Accounting keeps principal withdrawals strictly distinct from fees.
 *  - Strategy proposals are hypotheses with evidence refs, not claims.
 *  - Backtests carry their train/test split and assumptions.
 *  - Proofs are bound to (user, strategy version, plan hash, action, expiry,
 *    challenge) and are validated server-side.
 */
export type ChainRef = {
    tx: string;
    block: number;
    logIndex: number;
    timestamp: number;
};
export type V3EventKind = "MINT" | "INCREASE" | "DECREASE" | "COLLECT" | "TRANSFER" | "BURN";
/**
 * A reconstructed Uniswap V3 lifecycle event, in strict chronological order.
 *
 * Mapping from the real NonfungiblePositionManager logs:
 *   MINT      = ERC-721 Transfer(from 0x0) merged with the IncreaseLiquidity of the same tx
 *   INCREASE  = IncreaseLiquidity
 *   DECREASE  = DecreaseLiquidity (principal is credited to tokensOwed, not yet transferred)
 *   COLLECT   = Collect, split into the principal portion (amount0/1, already counted at
 *               DECREASE) and the fee portion (fee0/1 = collected − principal owed)
 *   BURN      = ERC-721 Transfer(to 0x0)
 *   TRANSFER  = any other ERC-721 Transfer of the position NFT
 */
export type V3Event = ChainRef & {
    kind: V3EventKind;
    tokenId: number;
    owner: string;
    /** Liquidity delta (uint128 base units of liquidity) as reported on-chain. */
    liquidityDelta: bigint | number;
    /** Principal moved by the tx, per token, in token base units. */
    amount0: bigint | number;
    amount1: bigint | number;
    /** Fees collected by the tx, per token base units. 0 except for COLLECT. */
    fee0: bigint | number;
    fee1: bigint | number;
    /** Position range (constant per NFT in V3; read from positions(tokenId)). */
    tickLower: number;
    tickUpper: number;
    /** Pool address the position lives in, when resolved. */
    pool?: string;
    /** ERC-721 transfer endpoints for MINT/BURN/TRANSFER. */
    from?: string;
    to?: string;
    /** Real gas paid by the tx (from its receipt), as decimal strings. */
    gasUsed?: string;
    effectiveGasPrice?: string;
    /** Human-readable summary; never used for computation. */
    note?: string;
};
/** Real per-position metadata read from the chain (positions(), factory, ERC-20). */
export type PositionMeta = {
    tokenId: number;
    pool: string | null;
    token0: string;
    token1: string;
    symbol0: string;
    symbol1: string;
    /** null when the token does not expose ERC-20 metadata (amounts stay in base units). */
    decimals0: number | null;
    decimals1: number | null;
    /** Fee tier in hundredths of a bip (500 = 0.05%, 3000 = 0.3%). */
    feeTier: number;
    tickLower: number;
    tickUpper: number;
    /** Liquidity currently in the position (0 when closed/burned). */
    currentLiquidity: string;
    burned: boolean;
    /** False when the position existed before the observation window (partial history). */
    historyComplete: boolean;
};
/** Real pool price history derived from Swap events (price = token1 per token0). */
export type PriceSeries = {
    pool: string;
    symbol0: string;
    symbol1: string;
    fromBlock: number;
    toBlock: number;
    /**
     * One point per Swap event. price = token1 per token0 in human units;
     * sqrtPriceX96 / amount0 / amount1 / liquidity are the raw on-chain values
     * (decimal strings; amounts are signed from the pool's perspective).
     */
    points: {
        block: number;
        timestamp: number;
        price: number;
        tick: number;
        sqrtPriceX96: string;
        amount0: string;
        amount1: string;
        liquidity: string;
    }[];
    /** Pool fee tier (hundredths of a bip) and token decimals used for the price. */
    feeTier?: number;
    decimals0?: number | null;
    decimals1?: number | null;
    /** Timestamps between sampled anchor blocks are linearly interpolated. */
    timestampsInterpolated: boolean;
    /** True when the swap count hit the configured cap (series truncated). */
    truncated: boolean;
};
/** A reconstructed Uniswap V3 position (state at end of the observation window). */
export type V3Position = {
    tokenId: number;
    /** Pool address, or "unresolved" when it could not be read from the factory. */
    pool: string;
    /** Token symbols (or the address when the token has no readable symbol). */
    token0: string;
    token1: string;
    token0Address?: string;
    token1Address?: string;
    decimals0?: number | null;
    decimals1?: number | null;
    /** Fee tier in hundredths of a bip (500 = 0.05%, 3000 = 0.3%); 0 = unresolved. */
    feeTier: number;
    tickLower: number;
    tickUpper: number;
    /** Liquidity (uint128 units) at the end of the window, from replayed events. */
    liquidity: number;
    status: "active" | "closed";
    openedBlock?: number;
    closedBlock?: number;
    lastActivityBlock?: number;
    /** False when the position was opened before the observation window. */
    historyComplete?: boolean;
};
/** Principal vs fees kept strictly distinct. Human units, not base units. */
export type PositionAccounting = {
    tokenId: number;
    deposited: {
        token0: number;
        token1: number;
    };
    withdrawn: {
        token0: number;
        token1: number;
    };
    feesCollected: {
        token0: number;
        token1: number;
    };
    feesUncollected: {
        token0: number;
        token1: number;
    };
    netPosition: {
        token0: number;
        token1: number;
    };
};
export type ReconstructionSummary = {
    wallet: string;
    chainId: number;
    network: string;
    /** Deterministic fingerprint of the event set — the evidence anchor. */
    eventsFingerprint: string;
    period: {
        fromTs: number;
        toTs: number;
    };
    counts: {
        events: number;
        positions: number;
        pools: number;
        closed: number;
    };
    positions: V3Position[];
    accounting: PositionAccounting[];
};
export type StrategyFamily = "passive_concentrated" | "passive_full_range" | "periodic_range_adjustment" | "price_triggered_repositioning" | "active_range_management" | "capital_redeployment"
/** Evidence is insufficient to support any hypothesis — never padded with a guess. */
 | "inconclusive";
/**
 * Strategy IR v2 — a versioned, immutable, evidence-anchored hypothesis.
 *
 * `id` is a content hash: any change produces a new id (a new version). A
 * revision records `parentId`. The IR is never edited in place.
 */
export type StrategyIR = {
    version: "2";
    /** Deterministic id = hash of canonical content (not the model's own claim). */
    id: string;
    parentId?: string;
    wallet: string;
    chainId: number;
    sourceProtocol: "uniswap-v3";
    /** The on-chain window the evidence was drawn from. */
    evidencePeriod: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    };
    family: StrategyFamily;
    /**
     * 0..1 heuristic/model confidence that the hypothesis fits the observed
     * evidence. NOT the probability that the strategy is objectively correct.
     */
    confidence: number;
    confidenceNote: string;
    /** Rules grouped by `category` (entry / adjustment / exit / risk / fee). */
    rules: StrategyRule[];
    alternatives: {
        label: string;
        family: StrategyFamily;
        score: number;
        why: string;
    }[];
    /** Every claim must cite deterministic evidence (tx hashes). */
    evidenceRefs: string[];
    limitations: string[];
    source: {
        model: string;
        provider: "0G_ROUTER" | "DETERMINISTIC_ONLY";
        /** Real 0G Router request id (x_0g_trace.request_id) when the model was called. */
        requestRef?: string;
        schemaValid: boolean;
        /** True only when the 0G Router reported tee_verified=true for this response. */
        attested: boolean;
        ts: number;
    };
};
export type StrategyRuleCategory = "entry" | "adjustment" | "exit" | "risk" | "fee";
export type StrategyRule = {
    category: StrategyRuleCategory;
    rule: string;
    /** The observed evidence that supports it (deterministic, not model-invented). */
    evidence: string;
    /** Tx hashes the rule is drawn from — every one must exist in the evidence set. */
    evidenceRefs: string[];
    confidence: number;
    /** A competing explanation the rule does not rule out. */
    alternative: string;
    uncertainty: string;
    /** Which execution capability this rule maps to, if any. */
    mapsTo?: "trigger" | "schedule" | "allocation" | "limit" | "action";
    /** Machine-readable parameters observed on-chain (e.g. range width in ticks). */
    params?: Record<string, number | string>;
    /** Span of the rule's own cited events (block + time), within the IR's evidencePeriod. */
    observationWindow?: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    };
    /** What the chain data cannot show for this rule (stated, never filled in). */
    missingEvidence?: string[];
};
export type AquaCapability = "concentrated_range" | "fee_on_input" | "on_price_trigger" | "scheduled_rebalance" | "fee_collection" | "redeploy_after_exit" | "stop_loss" | "unlimited_token_approval";
export type CompatibilityCheck = {
    key: string;
    label: string;
    ok: boolean;
    detail: string;
    /** Where the fact came from: an on-chain read, the strategy IR, or the protocol docs. */
    source: "chain" | "ir" | "docs";
};
export type CompatibilityAssessment = {
    strategyId: string;
    verdict: "FULL" | "PARTIAL" | "INCOMPATIBLE";
    /** Plain label: "Fully compatible within supported scope" | "Partially compatible" | "Incompatible". */
    verdictLabel?: string;
    /** Rule-by-rule: which strategy rules Aqua can express, with gaps. */
    rules: {
        rule: string;
        category: string;
        status: "supported" | "partial" | "unsupported";
        gap?: string;
    }[];
    capabilities: {
        name: AquaCapability;
        usable: boolean;
        note: string;
    }[];
    /** On-chain / structural checks performed for this assessment. */
    checks: CompatibilityCheck[];
    /** The Uniswap position the Aqua strategy is derived from (never claimed identical). */
    basis?: {
        tokenId: number;
        pool: string;
        token0: string;
        token1: string;
        tickLower: number;
        tickUpper: number;
        feeTier: number;
    };
    unsupportedNotes: string[];
    assessedAt: number;
};
/** One transaction the user's wallet will be asked to sign, in order. */
export type ExecutionStep = {
    op: "approve" | "ship" | "dock" | "swap";
    description: string;
    to: string;
    data: string;
    value: string;
    /** Approvals are always exact amounts — never unlimited. */
    approval?: {
        token: string;
        spender: string;
        amount: string;
    };
};
/**
 * The deterministic execution plan: a 1inch SwapVM order (program built with
 * the official AquaProgramBuilder) plus the exact transactions to ship and
 * later dock it on Aqua. Produced by the compiler, never by a model; no
 * free-form bytecode — the program comes only from typed SDK builders.
 */
export type ExecutionPlan = {
    strategyId: string;
    /** Hash of the canonical plan content — authorizations pin this. */
    planHash: string;
    format: "aqua_swapvm_order_v1";
    chainId: number;
    maker: string;
    registry: string;
    app: string;
    tokens: {
        address: string;
        symbol: string;
        decimals: number;
        amount: string;
    }[];
    /** SwapVM order bytes (shipped as the Aqua strategy) and its keccak256. */
    order: string;
    strategyHash: string;
    params: {
        priceLow: number;
        priceHigh: number;
        sqrtPriceMin: string;
        sqrtPriceMax: string;
        feeBps: number;
        salt: string;
    };
    steps: ExecutionStep[];
    /** Strategy rules that could not be compiled (kept visible, never silently dropped). */
    notCompiled: string[];
    deterministic: true;
    /** The immutable strategy version this plan was compiled from, and the compiler that did it. */
    source?: {
        strategyId: string;
        strategyVersionHash?: string;
        compiler: string;
    };
    /**
     * How the shipped amounts were sized: the user's maximums, the real pool spot price
     * they were sized against (read on-chain), and the amounts actually committed.
     */
    allocation?: {
        requested: [string, string];
        shipped: [string, string];
        spot: {
            sqrtPriceX96: string;
            tick: number;
            block: number;
            pool: string;
            sqrtPrice1e18: string;
            price: number;
        };
        position: "in_range" | "below_range" | "above_range" | "full_range";
        /** sqrt(P) the shipped balances imply on-chain (SDK computeLiquidityAndPrice), 1e18 fixed-point. */
        impliedSqrtPrice1e18?: string;
        note: string;
    };
    /** Checks run on the compiled output (decoded back with the SDKs) before it was accepted. */
    validation?: {
        key: string;
        ok: boolean;
        detail: string;
    }[];
};
export type BacktestRun = {
    label: string;
    kind: "observed" | "counterfactual" | "benchmark";
    /** Net return, fraction (under the stated assumptions). */
    net: number;
    maxDrawdown: number;
    finalValue: number;
    /** Fraction of test points where the price was inside the run's range. */
    rangeOccupancy: number | null;
    outOfRangeHours: number | null;
    rebalances: number;
    feesEarned: number;
    gasCost: number;
    impermanentLoss: number | null;
    capitalUtilization: number | null;
    /** Slippage paid on range moves (valuation token). Counterfactual runs only; 0 for observed/benchmarks. */
    slippageCost?: number;
};
export type BacktestResult = {
    strategyId: string;
    status: "completed" | "insufficient_data";
    /** Why the backtest could not run (when status = insufficient_data). */
    reason?: string;
    pool: string;
    pair: string;
    period: {
        fromBlock: number;
        toBlock: number;
        fromTs: number;
        toTs: number;
    };
    /**
     * The integrity guarantee: inference (train) window is strictly before the
     * backtest (test) window. The backtester refuses to run otherwise.
     */
    split: {
        trainEndBlock: number;
        testStartBlock: number;
        gapBlocks: number;
        lookaheadGuard: "enforced" | "waived";
        waiveReason?: string;
    };
    assumptions: {
        valuationToken: string;
        startCapital: number;
        feeModel: string;
        gasModel: string;
        slippagePct: number;
        priceSource: string;
    };
    runs: BacktestRun[];
    /** Real price points (test window) and each run's value path, aligned by index. */
    series: {
        blocks: number[];
        timestamps: number[];
        prices: number[];
        values: {
            label: string;
            points: number[];
        }[];
    };
};
/** The exact claims the user's wallet signs (EIP-712 typed data). */
export type AuthorizationClaims = {
    wallet: string;
    chainId: number;
    strategyId: string;
    strategyVersionHash: string;
    planHash: string;
    action: string;
    challenge: string;
    expiresAt: number;
};
export type AuthorizationVerification = {
    signatureOk: boolean;
    signerMatches: boolean;
    chainOk: boolean;
    notExpired: boolean;
    challengeFresh: boolean;
    strategyVersionMatches: boolean;
    planHashMatches: boolean;
    /**
     * Human verification outcome (World ID 4.0), separate from the wallet signature.
     * verified · rejected (invalid proof / wrong signal, action, environment or request) ·
     * expired (World ID request past its expiry) · replayed (proof already used) ·
     * required (protected action, no proof given, e.g. cancelled) · unavailable (protected
     * action but World ID is not registered on this server) · not_required (action not protected).
     * "not_configured" | "failed" | "skipped" are kept for authorizations recorded before Phase 5.
     */
    worldId: "verified" | "rejected" | "expired" | "replayed" | "required" | "unavailable" | "not_required" | "not_configured" | "failed" | "skipped";
    /** Anonymous, action-scoped World ID nullifier: the identity reference of the verified human. */
    worldNullifier?: string | null;
    notes: string[];
};
/** A genuine 0G Storage upload (only ever created after a successful upload). */
export type StorageRef = {
    rootHash: string;
    txHash: string;
    kind: string;
    contentHash: string;
    sizeBytes: number;
    ts: number;
    network: "0g-galileo-testnet";
    /** True once the object was downloaded back with Merkle-proof verification. */
    retrievable: boolean;
};
