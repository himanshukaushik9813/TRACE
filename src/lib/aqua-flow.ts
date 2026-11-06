"use client";

/**
 * Verify + Execute for the Investigate page, driven by SERVER state.
 *
 * Nothing about progress lives only in this tab. The current plan, its
 * authorizations and its transactions come from /investigations/:id/full, so a
 * refresh shows exactly what happened. The tab only remembers one thing locally:
 * a "send intent" written just before the wallet is asked to send a
 * transaction. If the page is reloaded while that prompt is open, the intent is
 * reconciled against Sepolia (POST /plans/:id/reconcile) before anything can be
 * sent again, so a transaction confirmed during the reload is recorded instead
 * of duplicated.
 *
 * Explicit user approvals, never automatic:
 *   verify()  → (check + compile if no plan yet) → EIP-712 wallet signature bound to this
 *               exact plan, strategy version, action and single-use challenge → the server
 *               verifies the signature and every binding.
 *   execute() → exact-amount approvals → ship, each confirmed by its receipt
 * A failure stops at that stage; calling the same action again resumes it
 * without repeating stages that already succeeded.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useSendTransaction, useSignTypedData } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "@trace/chain-config";
import { API_URL, ApiError, api, type AuthorizationRow, type Compatibility, type ExecutionPlan, type FullInvestigation, type TxRow } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Snapshot of the current plan, read from the server payload         */
/* ------------------------------------------------------------------ */

export type PlanRow = FullInvestigation["plans"][number];

export type ExecSnapshot = {
  plan: PlanRow | null;
  /** Latest validated, still-live ship authorization for the current plan. */
  auth: AuthorizationRow | null;
  /** A validated authorization exists but has expired (10 min) and nothing shipped. */
  expired: boolean;
  /** The latest attempt for this plan was rejected by the server. */
  rejected: AuthorizationRow | null;
  approvals: TxRow[];
  ship: TxRow | null;
  approveSteps: ExecutionPlan["steps"];
  shipStep: ExecutionPlan["steps"][number] | null;
};

const shipAuths = (full: FullInvestigation, planId: string) => (full.authorizations ?? []).filter((a) => a.planId === planId && a.action === "aqua:ship");

/** State of the most recent execution plan (the only one the UI acts on). */
export function snapshot(full: FullInvestigation | null | undefined): ExecSnapshot {
  const plan = full?.plans[0] ?? null;
  if (!full || !plan) return { plan: null, auth: null, expired: false, rejected: null, approvals: [], ship: null, approveSteps: [], shipStep: null };
  const auths = shipAuths(full, plan.id);
  const txs = (full.transactions ?? []).filter((t) => t.plan_id === plan.id);
  const ship = txs.find((t) => t.op === "ship" && t.status !== "reverted") ?? txs.find((t) => t.op === "ship") ?? null;
  const live = auths.find((a) => a.validated && a.live) ?? null;
  const anyValid = auths.some((a) => a.validated);
  return {
    plan,
    auth: live,
    expired: !live && anyValid && ship?.status !== "success" && ship?.status !== "submitted",
    rejected: auths[0] && !auths[0].validated ? auths[0] : null,
    approvals: txs.filter((t) => t.op === "approve"),
    ship,
    approveSteps: plan.plan.steps.filter((s) => s.op === "approve"),
    shipStep: plan.plan.steps.find((s) => s.op === "ship") ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Live (this tab) activity, overlaid on the server snapshot          */
/* ------------------------------------------------------------------ */

export type Busy =
  | null
  | { stage: "verify"; what: "check" | "compile" | "challenge" | "wallet" | "server" }
  | { stage: "execute"; what: "wallet" | "record" | "confirm"; op: "approve" | "ship" };

export type StageError = { stage: "verify" | "execute"; message: string } | null;

type PlanResponse = { planId: string; plan: ExecutionPlan; compatibility: Compatibility; simulation: Record<string, { ok: boolean; error?: string }> };
type Challenge = {
  typedData: { domain: { name: string; version: string; chainId: number }; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, string> };
  claims: Record<string, unknown>;
};

type Intent = { planId: string; op: "approve" | "ship"; stepIndex: number; fromBlock: number; nonce: number; at: number };
type Recovery = null | { state: "checking" } | { state: "pending"; detail: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const intentKey = (planId: string) => `trace:send-intent:${planId}`;

export const walletErr = (e: unknown) => {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e);
  return /user rejected|denied/i.test(m) ? "You rejected the request in your wallet. Press the button again to continue from this step." : m;
};

function readIntent(planId: string): Intent | null {
  try {
    const raw = window.localStorage.getItem(intentKey(planId));
    return raw ? (JSON.parse(raw) as Intent) : null;
  } catch {
    return null;
  }
}
function writeIntent(i: Intent | null, planId: string) {
  try {
    if (i) window.localStorage.setItem(intentKey(planId), JSON.stringify(i));
    else window.localStorage.removeItem(intentKey(planId));
  } catch {
    /* storage unavailable: the server-side duplicate guard still applies */
  }
}

export function useAquaExecution(full: FullInvestigation | null, invId: string | null) {
  const qc = useQueryClient();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { mutateAsync: signTypedData } = useSignTypedData();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<StageError>(null);
  const [recovery, setRecovery] = useState<Recovery>(null);
  const lock = useRef(false); // one wallet action at a time (double clicks, two buttons)

  const snap = snapshot(full);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["full", invId] }), [qc, invId]);

  /* After a refresh: keep watching transactions that are still pending on Sepolia. */
  const pendingHashes = full ? (full.transactions ?? []).filter((t) => t.status === "submitted").map((t) => t.tx_hash) : [];
  const pendingKey = pendingHashes.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    let stop = false;
    (async () => {
      while (!stop) {
        let changed = false;
        for (const h of pendingKey.split(",")) {
          const tx = await api<TxRow>(`/transactions/${h}`).catch(() => null);
          if (tx && tx.status !== "submitted") changed = true;
        }
        if (changed) {
          await refresh();
          return;
        }
        await sleep(5_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [pendingKey, refresh]);

  /* After a refresh: resolve a send that was waiting on the wallet when the page went away. */
  const planId = snap.plan?.id ?? null;
  const recordedHashes = full ? (full.transactions ?? []).map((t) => t.tx_hash).join(",") : "";
  useEffect(() => {
    if (!planId) return;
    const intent = readIntent(planId);
    if (!intent) return setRecovery(null);
    let stop = false;
    (async () => {
      setRecovery({ state: "checking" });
      while (!stop) {
        try {
          const r = await api<{ status: "recorded" | "not_sent" | "sent_not_found" | "found_unauthorized" }>(`/plans/${planId}/reconcile`, {
            method: "POST",
            body: { op: intent.op, stepIndex: intent.stepIndex, fromBlock: intent.fromBlock, nonce: intent.nonce },
          });
          if (r.status === "recorded" || r.status === "not_sent") {
            writeIntent(null, planId);
            setRecovery(null);
            await refresh();
            return;
          }
          setRecovery({ state: "pending", detail: r.status === "found_unauthorized" ? "A matching transaction was found but has no authorization on record." : "Your wallet sent a transaction that is not mined yet. Waiting for it before anything else is sent." });
        } catch (e) {
          setRecovery({ state: "pending", detail: `Could not check Sepolia yet: ${(e as Error).message}` });
        }
        await sleep(12_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [planId, recordedHashes, refresh]);

  /** Verify: compile a plan if needed, then sign the EIP-712 authorization. */
  const verify = useCallback(
    async (args: { strategyId: string; maker: string; tokenId: number; amount0?: bigint; amount1?: bigint; newPlan?: boolean }) => {
      if (lock.current) return;
      lock.current = true;
      setError(null);
      try {
        let pid = !args.newPlan && snap.plan && snap.plan.maker.toLowerCase() === args.maker.toLowerCase() ? snap.plan.id : null;
        if (!pid) {
          if (args.amount0 == null || args.amount1 == null || args.amount0 + args.amount1 === 0n) throw new Error("Enter an amount for at least one token.");
          setBusy({ stage: "verify", what: "check" });
          const c = await api<{ compatibility: Compatibility }>(`/strategies/${args.strategyId}/compatibility`, { method: "POST", body: { maker: args.maker } });
          if (c.compatibility.verdict === "INCOMPATIBLE") throw new Error("This strategy cannot be expressed as a 1inch Aqua order.");
          setBusy({ stage: "verify", what: "compile" });
          const plan = await api<PlanResponse>(`/strategies/${args.strategyId}/plan`, {
            method: "POST",
            body: { maker: args.maker, amount0: args.amount0.toString(), amount1: args.amount1.toString(), tokenId: args.tokenId },
          });
          const failed = Object.entries(plan.simulation).find(([, v]) => !v.ok);
          if (failed) throw new Error(`Simulation of ${failed[0].split(":")[0]} failed, so nothing was signed: ${failed[1].error ?? "reverted"}`);
          pid = plan.planId;
          await refresh();
        }
        setBusy({ stage: "verify", what: "challenge" });
        const ch = await api<Challenge>(`/plans/${pid}/challenge`, { method: "POST", body: { wallet: args.maker, action: "aqua:ship" } });
        // Wallet signature (EIP-712): proves control of the wallet and approves this exact plan.
        const m = ch.typedData.message;
        setBusy({ stage: "verify", what: "wallet" });
        const signature = await signTypedData({
          domain: ch.typedData.domain,
          types: ch.typedData.types,
          primaryType: "Authorization",
          message: { ...m, chainId: BigInt(m.chainId), expiresAt: BigInt(m.expiresAt) },
        } as never);
        setBusy({ stage: "verify", what: "server" });
        // 403 carries a verification report rather than an `error` field.
        const r = await fetch(`${API_URL}/authorizations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId: pid, claims: ch.claims, signature }),
        });
        const body = (await r.json()) as { validated?: boolean; error?: string; verification?: { notes?: string[] } };
        await refresh();
        if (!body.validated) throw new Error(body.error ?? `The server rejected the authorization: ${body.verification?.notes?.join("; ") || "verification failed"}`);
      } catch (e) {
        setError({ stage: "verify", message: walletErr(e) });
      } finally {
        setBusy(null);
        lock.current = false;
      }
    },
    [refresh, signTypedData, snap.plan],
  );

  /** Execute: approvals then ship. Requires a live authorization; skips steps already confirmed. */
  const execute = useCallback(async () => {
    if (lock.current || !snap.plan || !snap.auth || !publicClient) return;
    if (readIntent(snap.plan.id)) return; // an unresolved send from before a reload: reconcile first
    lock.current = true;
    setError(null);
    const plan = snap.plan;
    const authId = snap.auth.id;
    const send = async (op: "approve" | "ship", stepIndex: number, step: ExecutionPlan["steps"][number]) => {
      // Record where the chain and the wallet's nonce were before the prompt, so a
      // reload during the prompt can find the tx instead of sending it again.
      const [fromBlock, nonce] = await Promise.all([publicClient.getBlockNumber(), publicClient.getTransactionCount({ address: plan.maker as `0x${string}`, blockTag: "pending" })]);
      writeIntent({ planId: plan.id, op, stepIndex, fromBlock: Number(fromBlock), nonce, at: Date.now() }, plan.id);
      setBusy({ stage: "execute", what: "wallet", op });
      let hash: `0x${string}`;
      try {
        hash = await sendTransaction({ to: step.to as `0x${string}`, data: step.data as `0x${string}`, value: BigInt(step.value), chainId: SEPOLIA_CHAIN_ID });
      } catch (e) {
        writeIntent(null, plan.id); // the wallet returned without sending
        throw e;
      }
      setBusy({ stage: "execute", what: "record", op });
      try {
        await api(`/transactions`, { method: "POST", body: { authorizationId: authId, op, txHash: hash } });
      } finally {
        writeIntent(null, plan.id);
      }
      setBusy({ stage: "execute", what: "confirm", op });
      for (;;) {
        const tx = await api<TxRow>(`/transactions/${hash}`).catch(() => null);
        if (tx && tx.status === "success") break;
        if (tx && tx.status === "reverted") throw new Error(`The ${op} transaction reverted on Sepolia (${hash.slice(0, 10)}…).`);
        await sleep(4_000);
      }
      await refresh();
    };
    try {
      // Approvals: one per approve step; a confirmed approval for that token is never re-sent.
      const confirmedTokens = new Set(snap.approvals.filter((t) => t.status === "success" && t.to_addr).map((t) => t.to_addr!.toLowerCase()));
      if (snap.approvals.some((t) => t.status === "submitted")) throw new Error("An approval is still confirming on Sepolia. Wait for it, then continue.");
      for (let i = 0; i < snap.approveSteps.length; i++) {
        const s = snap.approveSteps[i];
        if (!confirmedTokens.has(s.to.toLowerCase())) await send("approve", i, s);
      }
      if (snap.ship?.status === "success") return;
      if (snap.ship?.status === "submitted") throw new Error("The ship transaction is already pending on Sepolia; it will not be sent twice.");
      if (!snap.shipStep) throw new Error("The compiled plan has no ship step.");
      await send("ship", 0, snap.shipStep);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 409 ? `Not sent twice: ${e.message}` : walletErr(e);
      setError({ stage: "execute", message: msg });
      await refresh();
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }, [publicClient, refresh, sendTransaction, snap]);

  return { snap, busy, error, recovery, verify, execute, clearError: () => setError(null) };
}

export type AquaExecution = ReturnType<typeof useAquaExecution>;
