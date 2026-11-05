"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { useCurrentInvestigationId, useFullInvestigation, type FullInvestigation } from "@/lib/api";

/**
 * Loads the current investigation (?inv= or the last one run in this browser)
 * and renders children only with real data. No investigation → a genuine
 * empty state that sends the user to Investigate; never sample data.
 */
export function InvestigationGate({ children }: { children: (full: FullInvestigation, invId: string) => ReactNode }) {
  const [invId] = useCurrentInvestigationId();
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
  if (st === "failed")
    return (
      <ErrorState
        title={data.investigation.progress.errorCode === "NO_EVENTS" ? "No supported positions for this wallet" : "This investigation failed"}
        message={data.investigation.error ?? "unknown error"}
      />
    );
  if (st !== "done") return <LoadingState label={`Investigation in progress: ${data.investigation.progress.stage ?? st}…`} />;
  return <>{children(data, invId)}</>;
}
