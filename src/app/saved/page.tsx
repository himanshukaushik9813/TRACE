"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { Page } from "@/components/page";
import { Card, EmptyState, ErrorState, LoadingState, Pill, SectionTitle, SourceBadge } from "@/components/ui";
import { FAMILY } from "@/components/case-file";
import { fmt } from "@/lib/format";
import { api, useCurrentInvestigationId, useInvestigationStatus, withInv } from "@/lib/api";

type Row = { id: string; irId: string; parentIrId: string | null; versionHash: string; family: string; confidence: string; provider: string; role: string; createdAt: string; investigation: string };

export default function SavedPage() {
  const [invId] = useCurrentInvestigationId();
  const inv = useInvestigationStatus(invId);
  const wallet = inv.data?.wallet;
  const q = useQuery({ queryKey: ["versions", wallet], queryFn: () => api<{ strategies: Row[] }>(`/strategies/by-wallet/${wallet}`), enabled: Boolean(wallet) });
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-[0.78rem] text-ink-600 flex items-center gap-2"><Bookmark size={15} className="text-gold" /> Strategy versions {wallet ? `· ${fmt.addr(wallet)}` : ""}</div>
        <SourceBadge label="Immutable versions · Postgres" />
      </div>
      <SectionTitle eyebrow="Content-addressed; a change always creates a new version" title="Version history" />
      {!invId && <EmptyState title="No investigation selected">Run an investigation first; its strategy versions are listed here.</EmptyState>}
      {(inv.isLoading || q.isLoading) && <LoadingState />}
      {inv.isError && <ErrorState message={(inv.error as Error).message} />}
      {q.isError && <ErrorState message={(q.error as Error).message} />}
      {q.data && q.data.strategies.length === 0 && <EmptyState title="No strategy versions for this wallet yet" />}
      {q.data && q.data.strategies.length > 0 && (
        <Card pad={false} className="divide-y divide-ink/8">
          {q.data.strategies.map((s) => (
            <Link key={s.id} href={withInv("/strategy", s.investigation)} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2 text-[0.82rem] hover:bg-ink/3">
              <span className="tabular text-ink md:w-[180px]">{s.irId}</span>
              <span className="flex-1 text-ink-600">
                {FAMILY[s.family] ?? s.family} · {fmt.frac(Number(s.confidence), 0)} · hash {s.versionHash}
                {s.parentIrId ? ` · derived from ${s.parentIrId}` : ""}
              </span>
              <Pill tone={s.role === "ai_hypothesis" ? "gold" : "neutral"}>{s.role === "ai_hypothesis" ? "0G hypothesis" : "evidence-only"}</Pill>
              <span className="tabular text-ink-600 text-[0.72rem]">{new Date(s.createdAt).toLocaleString("en-US")}</span>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  );
}
