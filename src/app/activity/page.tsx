"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { isAddress } from "@trace/chain-config";
import { Page } from "@/components/page";
import { useSepoliaWallet } from "@/components/wallet";
import { Card, EmptyState, ErrorState, ExplorerLink, LoadingState, Pill, SectionTitle, SourceBadge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useInvestigationStatus, withInv, type TxRow } from "@/lib/api";
import Link from "next/link";

type ActivityResp = { investigations: { id: string; status: string; error: string | null; createdAt: string; counts: { positions: number; events: number } | null }[]; transactions: TxRow[] };

export default function ActivityPage() {
  const w = useSepoliaWallet();
  const [invId] = useCurrentInvestigationId();
  const inv = useInvestigationStatus(invId);
  const [wallet, setWallet] = useState<string>("");
  useEffect(() => {
    if (!wallet && (w.address || inv.data?.wallet)) setWallet(w.address ?? inv.data!.wallet);
  }, [w.address, inv.data, wallet]);
  const q = useQuery({ queryKey: ["activity", wallet], queryFn: () => api<ActivityResp>(`/activity/${wallet}`), enabled: isAddress(wallet), refetchInterval: 15_000 });

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2"><Activity size={15} className="text-gold" /> Activity</div>
        <SourceBadge label="Postgres + Sepolia receipts" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x… wallet" aria-label="Wallet" className="rounded-md2 border border-ink/15 bg-ivory-50 px-3 py-2 text-[0.85rem] tabular w-full sm:w-[440px]" />
        {w.address && <button onClick={() => setWallet(w.address!)} className="text-[0.76rem] underline text-ink-600">connected wallet</button>}
        {inv.data?.wallet && <button onClick={() => setWallet(inv.data!.wallet)} className="text-[0.76rem] underline text-ink-600">investigated wallet</button>}
      </div>
      {!isAddress(wallet) && <div className="mt-4"><EmptyState title="Choose a wallet">Connect your wallet or enter an address to see its investigations and TRACE-recorded transactions.</EmptyState></div>}
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState message={(q.error as Error).message} />}
      {q.data && (
        <>
          <SectionTitle eyebrow="Signed in your wallet, verified from receipts" title="Transactions" />
          {q.data.transactions.length === 0 ? (
            <EmptyState title="No transactions recorded">Transactions appear here after you approve / ship / dock from the Execute screen.</EmptyState>
          ) : (
            <Card pad={false} className="divide-y divide-ink/8">
              {q.data.transactions.map((t) => (
                <div key={t.tx_hash} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2 text-[0.8rem]">
                  <Pill tone={t.op === "ship" ? "gold" : "neutral"}>{t.op}</Pill>
                  <ExplorerLink kind="tx" value={t.tx_hash} />
                  <span className="text-ink-600 flex-1">{t.outcome ?? ""}</span>
                  <span className="text-ink-600 tabular">{t.block ? `block ${Number(t.block).toLocaleString("en-US")} · ${t.confirmations} conf.` : "pending"}</span>
                  <Pill tone={t.status === "success" ? "forest" : t.status === "reverted" ? "brick" : "amber"}>{t.status}</Pill>
                </div>
              ))}
            </Card>
          )}
          <SectionTitle eyebrow="Persisted" title="Investigations" />
          {q.data.investigations.length === 0 ? (
            <EmptyState title="No investigations for this wallet" />
          ) : (
            <Card pad={false} className="divide-y divide-ink/8">
              {q.data.investigations.map((i) => (
                <Link key={i.id} href={withInv("/reports", i.id)} className="px-5 py-3 flex items-center gap-3 text-[0.82rem] hover:bg-ink/3">
                  <span className="tabular text-ink-600">{new Date(i.createdAt).toLocaleString("en-US")}</span>
                  <span className="flex-1 text-ink">{i.counts ? `${i.counts.positions} positions · ${i.counts.events} events` : i.status === "no_positions" ? "No Uniswap V3 positions in the window" : (i.error ?? i.status).slice(0, 100)}</span>
                  <Pill tone={i.status === "done" ? "sage" : i.status === "failed" ? "brick" : i.status === "no_positions" ? "neutral" : "gold"}>{i.status === "no_positions" ? "no positions" : i.status}</Pill>
                </Link>
              ))}
            </Card>
          )}
          <div className="text-[0.7rem] text-ink-600 mt-3">Wallet <ExplorerLink kind="address" value={wallet}>{fmt.addr(wallet)}</ExplorerLink> on Sepolia Etherscan.</div>
        </>
      )}
    </Page>
  );
}
