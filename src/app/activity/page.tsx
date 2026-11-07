"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { useSepoliaWallet } from "@/components/wallet";
import { Card, EmptyState, ErrorState, ExplorerLink, LoadingState, Pill, SectionTitle } from "@/components/ui";
import { FAMILY } from "@/components/case-file";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useInvestigationStatus, withInv, type TxRow } from "@/lib/api";

type ActivityTx = TxRow & { investigation?: string; family?: string; investigated_wallet?: string; plan_tokens?: { address: string; symbol: string }[] | null };
type ActivityResp = { investigations: { id: string; status: string; error: string | null; createdAt: string; counts: { positions: number; events: number } | null }[]; transactions: ActivityTx[] };

/** "Approved WETH", "Strategy sent to Aqua": what each transaction did, in plain words. */
function plainOp(t: ActivityTx): string {
  if (t.op === "approve") {
    const sym = t.plan_tokens?.find((k) => t.to_addr && k.address.toLowerCase() === t.to_addr.toLowerCase())?.symbol;
    return `Approved ${sym ?? "a token"} for Aqua`;
  }
  if (t.op === "ship") return "Strategy sent to Aqua";
  if (t.op === "dock") return "Strategy removed from Aqua";
  return t.op;
}
const plainTxStatus = (s: TxRow["status"]) => (s === "success" ? { label: "Confirmed", tone: "forest" as const } : s === "reverted" ? { label: "Failed", tone: "brick" as const } : { label: "Waiting for confirmation", tone: "amber" as const });
const plainInvStatus: Record<string, string> = { done: "Complete", failed: "Failed", no_positions: "No positions found", cancelled: "Cancelled", queued: "Waiting to start" };

export default function ActivityPage() {
  const w = useSepoliaWallet();
  const [invId] = useCurrentInvestigationId();
  const inv = useInvestigationStatus(invId);
  const [wallet, setWallet] = useState<string>("");
  useEffect(() => {
    if (!wallet && (w.address || inv.data?.wallet)) setWallet(w.address ?? inv.data!.wallet);
  }, [w.address, inv.data, wallet]);
  const q = useQuery({ queryKey: ["activity", wallet], queryFn: () => api<ActivityResp>(`/activity/${wallet}`), enabled: isAddress(wallet), refetchInterval: 15_000 });

  // Transactions grouped by the investigation whose strategy they executed.
  const groups = new Map<string, ActivityTx[]>();
  for (const t of q.data?.transactions ?? []) {
    const k = t.investigation ?? "unknown";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  return (
    <Page>
      <header className="mb-3">
        <div className="label">Activity</div>
        <h1 className="serif text-2xl md:text-3xl text-ink mt-1">Your activity</h1>
        <p className="text-[0.86rem] text-ink-600 mt-1 max-w-[70ch]">Transactions sent from a wallet through TRACE, each checked against its Sepolia receipt, and the investigations run on it.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x… wallet address" aria-label="Wallet address" className="rounded-md2 border border-line bg-white px-3 h-10 text-[0.85rem] tabular w-full sm:w-[440px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40" />
        {w.address && <button onClick={() => setWallet(w.address!)} className="text-[0.78rem] underline text-ink-600 hover:text-ink">Use my connected wallet</button>}
        {inv.data?.wallet && <button onClick={() => setWallet(inv.data!.wallet)} className="text-[0.78rem] underline text-ink-600 hover:text-ink">Use the investigated wallet</button>}
      </div>
      {!isAddress(wallet) && <div className="mt-4"><EmptyState title="Choose a wallet">Connect your wallet or enter an address to see its transactions and investigations.</EmptyState></div>}
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState message={(q.error as Error).message} />}
      {q.data && (
        <>
          <SectionTitle eyebrow="Signed in this wallet, confirmed from Sepolia receipts" title="Transactions" />
          {q.data.transactions.length === 0 ? (
            <EmptyState title="No transactions yet">They appear here after you approve and ship a strategy on the Execute screen.</EmptyState>
          ) : (
            <div className="space-y-4">
              {[...groups.entries()].map(([invKey, txs]) => (
                <Card key={invKey} pad={false}>
                  <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[0.86rem] text-ink">
                      <span className="font-medium">{txs[0].family ? FAMILY[txs[0].family] ?? txs[0].family : "Strategy"}</span>
                      {txs[0].investigated_wallet && <span className="text-ink-600"> learned from {fmt.addr(txs[0].investigated_wallet)}</span>}
                    </div>
                    {invKey !== "unknown" && <Link href={withInv("/reports", invKey)} className="text-[0.76rem] text-gold-700 hover:text-ink underline-offset-2 hover:underline">Open report</Link>}
                  </div>
                  <ul className="divide-y divide-ink/8">
                    {txs.map((t) => {
                      const st = plainTxStatus(t.status);
                      return (
                        <li key={t.tx_hash} className="px-5 py-3 text-[0.84rem]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-ink font-medium flex-1 min-w-[180px]">{plainOp(t)}</span>
                            <span className="text-[0.74rem] text-ink-600 tabular">{new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </div>
                          <details className="mt-1 text-[0.76rem] text-ink-600">
                            <summary className="cursor-pointer w-fit hover:text-ink">Receipt</summary>
                            <div className="mt-1 space-y-0.5 break-all">
                              <div>Transaction <ExplorerLink kind="tx" value={t.tx_hash} /></div>
                              <div>{t.block ? `Block ${Number(t.block).toLocaleString("en-US")}, ${t.confirmations ?? 0} confirmations` : "Not mined yet"}</div>
                              {t.matches_plan != null && <div className={t.matches_plan ? "text-forest" : "text-brick"}>{t.matches_plan ? "Matches the authorized plan" : "Does not match the authorized plan"}</div>}
                              {t.outcome && <div>{t.outcome}</div>}
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
            </div>
          )}
          <SectionTitle eyebrow="Investigations run on this wallet" title="Investigations" />
          {q.data.investigations.length === 0 ? (
            <EmptyState title="No investigations of this wallet" />
          ) : (
            <Card pad={false} className="divide-y divide-ink/8">
              {q.data.investigations.map((i) => (
                <Link key={i.id} href={withInv("/reports", i.id)} className="px-5 py-3 flex flex-wrap items-center gap-3 text-[0.84rem] hover:bg-ink/3">
                  <span className="tabular text-ink-600 whitespace-nowrap">{new Date(i.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="flex-1 text-ink">{i.counts ? `${fmt.count(i.counts.positions, "position")}, ${fmt.count(i.counts.events, "event")}` : i.status === "no_positions" ? "No Uniswap V3 positions in the window" : (i.error ?? plainInvStatus[i.status] ?? i.status).slice(0, 100)}</span>
                  <Pill tone={i.status === "done" ? "sage" : i.status === "failed" ? "brick" : i.status === "no_positions" ? "neutral" : "gold"}>{plainInvStatus[i.status] ?? "In progress"}</Pill>
                </Link>
              ))}
            </Card>
          )}
          <div className="text-[0.72rem] text-ink-600 mt-3">Wallet <ExplorerLink kind="address" value={wallet}>{fmt.addr(wallet)}</ExplorerLink> on Sepolia Etherscan.</div>
        </>
      )}
    </Page>
  );
}
