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
/** A reconstructed Uniswap V3 lifecycle event, in strict chronological order. */
export type V3Event = ChainRef & {
    kind: V3EventKind;
    tokenId: number;
    owner: string;
    /** Liquidity delta in 1e12 units as reported on-chain (base units of liquidity). */
    liquidityDelta: bigint | number;
    /** Principal moved by the tx, per token, in token base units. 0 for COLLECT. */
    amount0: bigint | number;
    amount1: bigint | number;
    /** Fees collected by the tx, per token. 0 except for COLLECT. */
    fee0: bigint | number;
    fee1: bigint | number;
    tickLower: number;
    tickUpper: number;
    /** Human-readable summary; never used for computation. */
    note?: string;
};
/** A reconstructed Uniswap V3 position (state at end of the observation window). */
export type V3Position = {
    tokenId: number;
    pool: string;
    token0: string;
    token1: string;
    feeTier: number;
    tickLower: number;
    tickUpper: number;
    /** Human units; derived from base liquidity with the pool's sqrtP at snapshot time. */
    liquidity: number;
    status: "active" | "closed";
    openedBlock?: number;
    closedBlock?: number;
    lastActivityBlock?: number;
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
export type StrategyIR = {
    version: "1";
    /** Deterministic id = hash of canonical content (not the LLM's own claim). */
    id: string;
    wallet: string;
    family: "passive_concentrated" | "periodic_range_adjustment" | "active_range_management" | "capital_redeployment" | "unknown";
    /** 0..1; must be justified by rule evidence, not asserted by the model. */
    confidence: number;
    rules: StrategyRule[];
    alternatives: {
        label: string;
        family: StrategyIR["family"];
        score: number;
        why: string;
    }[];
    /** Every claim must cite deterministic evidence. */
    evidenceRefs: string[];
    limitations: string[];
    source: {
        model: string;
        provider: "0G_PRIVATE_COMPUTER" | "DETERMINISTIC_ONLY";
        requestRef?: string;
        schemaValid: boolean;
        attested: boolean;
        ts: number;
    };
};
export type StrategyRule = {
    rule: string;
    /** The observed evidence that supports it (deterministic, not model-invented). */
    evidence: string;
    confidence: number;
    /** A competing explanation the rule does not rule out. */
    alternative: string;
    uncertainty: string;
    /** Which compatibility capability this rule maps to, if any. */
    mapsTo?: "trigger" | "schedule" | "allocation" | "limit" | "action";
};
export type AquaCapability = "on_price_trigger" | "on_schedule" | "range_adjust" | "collect_fees" | "redeploy" | "stop_loss" | "tpo_swap" | "limit_orders" | "unlimited_token_approval";
export type CompatibilityAssessment = {
    strategyId: string;
    verdict: "FULL" | "PARTIAL" | "INCOMPATIBLE";
    /** Rule-by-rule: which strategy rules Aqua can express, with gaps. */
    rules: {
        rule: string;
        status: "supported" | "partial" | "unsupported";
        gap?: string;
    }[];
    capabilities: {
        name: AquaCapability;
        usable: boolean;
        note: string;
    }[];
    /** Approval scoping policy — TRACE never requests unlimited approvals by default. */
    approvals: {
        token: string;
        amount: string;
        unlimited: boolean;
        reason: string;
    }[];
    unsupportedNotes: string[];
};
/**
 * The compiled, deterministic execution plan. Produced by the Aqua adapter,
 * not by the LLM. Contains no raw bytecode — only structured intent.
 */
export type AquaProgram = {
    strategyId: string;
    programHash: string;
    format: "aqua_program_v1";
    steps: AquaStep[];
    approvals: {
        token: string;
        amount: string;
        unlimited: boolean;
    }[];
    assumptions: {
        slippageBps: number;
        gasGweiAssumption: number;
        minOutPct: number;
    };
    /** Deterministic; regenerating from the same inputs must yield the same hash. */
    deterministic: true;
};
export type AquaStep = {
    op: "observe";
    intervalMinutes: number;
    source: "pool_price" | "external_feed";
    ref: string;
} | {
    op: "adjust_range";
    when: TriggerExpr;
    newRange: {
        tickLower: number;
        tickUpper: number;
    };
    liquidityDelta?: number;
} | {
    op: "collect_fees";
    when: TriggerExpr;
} | {
    op: "redeploy";
    when: TriggerExpr;
    targetPool: string;
    allocationPct: number;
} | {
    op: "execute_swap";
    when: TriggerExpr;
    inToken: string;
    outToken: string;
    slippageBps: number;
} | {
    op: "stop";
    when: TriggerExpr;
    reason: string;
};
export type TriggerExpr = {
    kind: "schedule";
    everyMinutes: number;
} | {
    kind: "price_exit";
    side: "above" | "below";
    refTick: number;
    widthTicks: number;
} | {
    kind: "max_out_of_range_days";
    days: number;
} | {
    kind: "manual";
    note: string;
};
export type BacktestRun = {
    label: string;
    /** Net return, fraction. */
    net: number;
    maxDrawdown: number;
    sharpe?: number;
    finalEquity: number;
};
export type BacktestResult = {
    strategyId: string;
    period: {
        fromBlock: number;
        toBlock: number;
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
        startCapital: number;
        gasGwei: number;
        slippagePct: number;
        feeModel: string;
    };
    runs: BacktestRun[];
    /** Deterministic series for charting. */
    equitySeries: {
        label: string;
        points: number[];
    }[];
};
export type AgentPassClaims = {
    worldId: string;
    strategyId: string;
    strategyVersionHash: string;
    programHash: string;
    action: string;
    expiresAt: number;
    /** A fresh nonce per authorization request — replay protection. */
    challenge: string;
    issuedAt: number;
};
export type AgentPassProof = {
    claims: AgentPassClaims;
    /** Ed25519 signature over the canonical claims (mock in the hackathon path). */
    signature: string;
    validated: boolean;
    /** What the server-side validator checked and found. */
    validation: {
        signatureOk: boolean;
        notExpired: boolean;
        challengeUsed: boolean;
        strategyVersionMatches: boolean;
        programHashMatches: boolean;
        notes: string[];
    };
};
export type StorageRef = {
    ref: string;
    kind: string;
    contentHash: string;
    sizeBytes: number;
    ts: number;
    demo: boolean;
};
