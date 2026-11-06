"use client";

/**
 * One-click Aqua execution, driven from the Investigate page.
 *
 * Runs the same real pipeline as the step-by-step Execute screen, in order:
 *   check  → live compatibility reads for the connected wallet
 *   compile→ deterministic SwapVM plan + simulation of every pre-ship step
 *   sign   → EIP-712 authorization bound to this plan, verified by the server (Verify)
 *   approve→ exact-amount ERC-20 approvals, each confirmed by its receipt
 *   ship   → the Aqua ship transaction, confirmed by its receipt (Execute)
 *
 * Every wallet action is an explicit MetaMask prompt; nothing is signed or
 * sent on the user's behalf. Progress survives a retry: a failed or rejected
 * step resumes from where it stopped instead of compiling a new plan.
 */

import { useCallback, useRef, useState } from "react";
import { useSendTransaction, useSignTypedData } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "@trace/chain-config";
import { API_URL, api, type Compatibility, type ExecutionPlan, type TxRow } from "@/lib/api";

export type FlowPhase = "idle" | "check" | "compile" | "sign" | "approve" | "ship" | "done" | "error";

type PlanResponse = { planId: string; plan: ExecutionPlan; compatibility: Compatibility; simulation: Record<string, { ok: boolean; error?: string }> };
type Challenge = {
  typedData: { domain: { name: string; version: string; chainId: number }; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, string> };
  claims: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const walletErr = (e: unknown) => {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e);
  return /user rejected|denied/i.test(m) ? "You rejected the request in your wallet. Press the button again to continue from this step." : m;
};

/** Poll the server's receipt check until the tx is final on Sepolia. */
async function waitForReceipt(hash: string, timeoutMs = 6 * 60_000): Promise<TxRow> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const tx = await api<TxRow>(`/transactions/${hash}`);
      if (tx.status !== "submitted") return tx;
    } catch {
      /* not indexed yet — keep polling */
    }
    await sleep(4_000);
  }
  throw new Error(`No receipt for ${hash.slice(0, 10)}… after 6 minutes. It may still confirm; check Activity.`);
}

export function useAquaExecution(onProgress: () => void) {
  const { mutateAsync: signTypedData } = useSignTypedData();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const [phase, setPhase] = useState<FlowPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shipHash, setShipHash] = useState<string | null>(null);
  // Resumable context: kept across retries for the same inputs.
  const ctx = useRef<{ key: string; plan?: PlanResponse; authId?: string; confirmed: Set<string> } | null>(null);

  const run = useCallback(
    async (args: { strategyId: string; maker: string; tokenId: number; amount0: bigint; amount1: bigint }) => {
      const key = `${args.strategyId}:${args.maker}:${args.tokenId}:${args.amount0}:${args.amount1}`;
      if (ctx.current?.key !== key) ctx.current = { key, confirmed: new Set() };
      const c = ctx.current;
      setError(null);
      try {
        if (!c.plan) {
          setPhase("check");
          const compat = await api<{ compatibility: Compatibility }>(`/strategies/${args.strategyId}/compatibility`, { method: "POST", body: { maker: args.maker } });
          if (compat.compatibility.verdict === "INCOMPATIBLE") throw new Error("This strategy cannot be expressed as a 1inch Aqua order.");

          setPhase("compile");
          const plan = await api<PlanResponse>(`/strategies/${args.strategyId}/plan`, {
            method: "POST",
            body: { maker: args.maker, amount0: args.amount0.toString(), amount1: args.amount1.toString(), tokenId: args.tokenId },
          });
          const failed = Object.entries(plan.simulation).find(([, v]) => !v.ok);
          if (failed) throw new Error(`Simulation of ${failed[0].split(":")[0]} failed before signing: ${failed[1].error ?? "reverted"}`);
          c.plan = plan;
          onProgress();
        }
        const plan = c.plan;

        if (!c.authId) {
          setPhase("sign");
          const ch = await api<Challenge>(`/plans/${plan.planId}/challenge`, { method: "POST", body: { wallet: args.maker, action: "aqua:ship" } });
          const m = ch.typedData.message;
          const signature = await signTypedData({
            domain: ch.typedData.domain,
            types: ch.typedData.types,
            primaryType: "Authorization",
            message: { ...m, chainId: BigInt(m.chainId), expiresAt: BigInt(m.expiresAt) },
          } as never);
          // /authorizations answers 403 with a verification report (not an `error` field) when it rejects.
          const r = await fetch(`${API_URL}/authorizations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ planId: plan.planId, claims: ch.claims, signature }),
          });
          const body = (await r.json()) as { authorizationId?: string; validated?: boolean; error?: string; verification?: { notes?: string[] } };
          if (!body.validated || !body.authorizationId) throw new Error(body.error ?? `The server rejected the authorization: ${body.verification?.notes?.join("; ") || "verification failed"}`);
          c.authId = body.authorizationId;
          onProgress();
        }

        const send = async (step: ExecutionPlan["steps"][number], stepKey: string) => {
          if (c.confirmed.has(stepKey)) return;
          const hash = await sendTransaction({ to: step.to as `0x${string}`, data: step.data as `0x${string}`, value: BigInt(step.value), chainId: SEPOLIA_CHAIN_ID });
          if (step.op === "ship") setShipHash(hash);
          await api(`/transactions`, { method: "POST", body: { authorizationId: c.authId, op: step.op, txHash: hash } });
          onProgress();
          const tx = await waitForReceipt(hash);
          if (tx.status !== "success") throw new Error(`${step.op} transaction reverted on Sepolia (${hash.slice(0, 10)}…).`);
          c.confirmed.add(stepKey);
          onProgress();
        };

        setPhase("approve");
        const approvals = plan.plan.steps.filter((s) => s.op === "approve");
        for (let i = 0; i < approvals.length; i++) await send(approvals[i], `approve-${i}`);

        setPhase("ship");
        const ship = plan.plan.steps.find((s) => s.op === "ship");
        if (!ship) throw new Error("The compiled plan has no ship step.");
        await send(ship, "ship");

        setPhase("done");
      } catch (e) {
        setError(walletErr(e));
        setPhase("error");
      }
    },
    [onProgress, sendTransaction, signTypedData],
  );

  /** Which phase failed, so the UI can mark it. */
  const failedAt = useRef<FlowPhase>("idle");
  if (phase !== "error" && phase !== "idle") failedAt.current = phase;

  return { phase, error, failedAt: failedAt.current, shipHash, run, busy: !["idle", "done", "error"].includes(phase) };
}
