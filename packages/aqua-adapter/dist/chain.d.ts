/**
 * Real Sepolia reads for the Aqua compatibility checks and for verifying
 * execution outcomes. Server-side only (uses the server's RPC URL).
 */
import type { CompatibilityCheck, ExecutionPlan } from "@trace/strategy-ir";
export type StrategyState = {
    checkedAt: number;
    block: number;
    registry: string;
    app: string;
    strategyHash: string;
    tokens: {
        symbol: string;
        address: string;
        planned: string;
        balance: string;
        registered: boolean;
    }[];
    /** "active": balances as shipped; "docked": all zero; "partly_filled": balances moved by swaps; "not_shipped". */
    status: "active" | "docked" | "partly_filled" | "not_shipped";
    quotes: {
        direction: string;
        amountIn: string;
        amountOut: string;
        orderHashMatches: boolean;
        price: number | null;
        insideRange: boolean | null;
        error?: string;
    }[];
    checks: {
        key: string;
        ok: boolean;
        detail: string;
    }[];
};
export declare function aquaClient(rpcUrl: string): {
    hasCode: (a: string) => Promise<boolean>;
    makerChecks: (maker: string | null, tokens: {
        address: string;
        symbol: string;
        amount?: bigint;
    }[]) => Promise<CompatibilityCheck[]>;
    simulateStep: (from: string, step: {
        to: string;
        data: string;
        value: string;
    }) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    verifyTx: (hash: string, plan: ExecutionPlan, op: "approve" | "ship" | "dock" | "swap") => Promise<{
        status: "success" | "reverted";
        blockNumber: number;
        confirmations: number;
        from: `0x${string}`;
        to: `0x${string}` | null;
        gasUsed: string;
        effectiveGasPrice: string;
        matchesPlan: boolean;
        outcome: string;
    }>;
    poolSpot: (pool: string) => Promise<{
        sqrtPriceX96: string;
        tick: number;
        block: number;
    }>;
    strategyState: (plan: ExecutionPlan) => Promise<StrategyState>;
};
