/**
 * Real Sepolia reads for the Aqua compatibility checks and for verifying
 * execution outcomes. Server-side only (uses the server's RPC URL).
 */
import type { CompatibilityCheck, ExecutionPlan } from "@trace/strategy-ir";
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
};
