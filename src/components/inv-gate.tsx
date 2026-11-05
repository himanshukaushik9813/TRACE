"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useFullInvestigation, useSuggestedWallets, type FullInvestigation } from "@/lib/api";

/**
 * Loads the current investigation (?inv= or the last one run in this browser)
 * and renders children only with real data. No investigation → a genuine
 * empty state that sends the user to Investigate; never sample data.
 */
export function InvestigationGate({ children }: { children: (full: FullInvestigation, invId: string) => ReactNode }) {
  const [invId, setInvId] = useCurrentInvestigationId();
  const full = useFullInvestigation(invId);
  if (!invId)
    return (
      <EmptyState title="No investigation selected">
        Run an investigation on the <Link href="/" className="underline text-gold">Investigate</Link> screen first. Every screen here shows real Sepolia data for that investigation.
      </EmptyState>
    );
  if (full.isLoading) return <LoadingState label="Loading investigation from the TRACE API…" />;
  if (full.isError) return <ErrorState message={(full.error as Error).message} />;
  const data = full.data!;
  const st = data.investigation.status;
  if (st === "no_positions")
    return (
      <div className="space-y-3">
        <EmptyState title="No supported Uniswap V3 positions for this wallet">
          Sepolia was read successfully, but {data.investigation.wallet} has no Uniswap V3 positions in the last {data.investigation.windowDays} days, so there is nothing to analyse. TRACE shows nothing rather than sample data.
        </EmptyState>
        <SuggestedLpWallets onStarted={setInvId} />
      </div>
    );
  if (st === "failed") {
    const noEvents = data.investigation.progress.errorCode === "NO_EVENTS";
    return (
      <div className="space-y-3">
        <ErrorState
          title={noEvents ? "No supported positions for this wallet" : "This investigation failed"}
          message={data.investigation.error ?? "unknown error"}
        />
        {noEvents && <SuggestedLpWallets onStarted={setInvId} />}
      </div>
    );
  }
  if (st !== "done") return (
      <LoadingState
        label={`Investigation in progress: ${data.investigation.progress.stage ?? st}…${data.investigation.progress.liveRpcCalls != null ? ` (${data.investigation.progress.liveRpcCalls} RPC calls so far)` : ""}`}
      />
    );
  return <>{children(data, invId)}</>;
}

/**
 * Shown when a wallet has no Uniswap V3 history: real wallets that minted V3
 * positions on Sepolia recently (found by a live scan, never a fixed list),
 * each one click away from a fresh investigation.
 */
function SuggestedLpWallets({ onStarted }: { onStarted: (id: string) => void }) {
  const suggested = useSuggestedWallets();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = async (wallet: string) => {
    setBusy(wallet);
    setErr(null);
    try {
      const r = await api<{ investigationId: string }>("/investigations", { method: "POST", body: { wallet, days: 30 } });
      onStarted(r.investigationId);
      await qc.invalidateQueries({ queryKey: ["recent"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-panel border border-ink/10 bg-ivory-50 p-4">
      <div className="text-[0.9rem] font-medium text-ink">Investigate a wallet with real Sepolia LP history instead</div>
      <div className="text-[0.78rem] text-ink-600 mt-0.5">
        TRACE analyses the wallet you investigate, not the wallet you connect. You can still execute the inferred strategy from your own connected wallet.
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggested.isLoading && <span className="text-[0.78rem] text-ink-600">Scanning Sepolia for active V3 liquidity providers…</span>}
        {suggested.data?.wallets.map((w) => (
          <button
            key={w.wallet}
            onClick={() => start(w.wallet)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 px-3 py-1 text-[0.78rem] text-ink hover:bg-gold/10 disabled:opacity-50 tabular"
            title={`${w.mints} position mints, last at block ${w.lastBlock}; ${w.poolSwaps} real swaps in its pool in the last ~10k blocks`}
          >
            {busy === w.wallet ? "Queuing…" : `${fmt.addr(w.wallet)} · ${w.pair ?? `${w.mints} mints`}${w.poolSwaps > 0 ? ` · ${w.poolSwaps} swaps` : ""}`}
          </button>
        ))}
      </div>
      {suggested.data && <div className="text-[0.66rem] text-ink-600/80 mt-2">{suggested.data.source}</div>}
      {suggested.isError && <div className="text-[0.78rem] text-brick mt-2">Could not load suggestions: {(suggested.error as Error).message}</div>}
      {err && <div className="text-[0.78rem] text-brick mt-2">{err}</div>}
    </div>
  );
}
