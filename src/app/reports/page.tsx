"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {  } from "lucide-react";
import { ZERO_G_GALILEO } from "@trace/chain-config";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { Button, Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Pill, SectionTitle, Stat, StatusChip } from "@/components/ui";
import { fmt } from "@/lib/format";
import { api, useIntegrations, type FullInvestigation } from "@/lib/api";

function IntegrationTable() {
  const { data, isLoading, isError, error, refetch, isFetching } = useIntegrations();
  return (
    <section id="integrations" className="mt-8">
      <SectionTitle
        eyebrow="Probed live by the server"
        title="Integration status"
        action={<Button variant="ghost" onClick={() => api("/integrations?refresh=1").then(() => refetch())} disabled={isFetching}>{isFetching ? "Checking…" : "Re-check"}</Button>}
      />
      {isLoading && <LoadingState />}
      {isError && <ErrorState message={(error as Error).message} />}
      {data && (
        <>
          <Card pad={false} className="divide-y divide-ink/8">
            {data.integrations.map((i) => (
              <div key={i.key} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="md:w-[300px] text-[0.88rem] text-ink font-medium">{i.label}</div>
                <div className="md:w-[260px]"><StatusChip status={i.status} /></div>
                <div className="flex-1 text-[0.74rem] text-ink-600 break-words">{i.detail}</div>
              </div>
            ))}
          </Card>
          <SectionTitle eyebrow="eth_getCode on Sepolia" title="Contracts" />
          <Card pad={false} className="divide-y divide-ink/8">
            {data.contracts.map((c) => (
              <div key={c.key} className="px-5 py-2.5 flex flex-col md:flex-row md:items-center gap-2 text-[0.8rem]">
                <div className="md:w-[300px] text-ink">{c.label}</div>
                <div className="md:w-[260px]"><ExplorerLink kind="address" value={c.address} /></div>
                <div className="flex-1 text-ink-600">{c.hasCode == null ? "not probed" : c.hasCode ? `${c.bytes.toLocaleString("en-US")} bytes of code` : "NO CODE"} · <a href={c.source} target="_blank" rel="noopener noreferrer" className="underline">source</a></div>
              </div>
            ))}
          </Card>
          <div className="text-[0.7rem] text-ink-600 mt-2">Computed {new Date(data.computedAt).toLocaleString("en-US")}</div>
        </>
      )}
    </section>
  );
}

function Report({ full }: { full: FullInvestigation }) {
  const qc = useQueryClient();
  const [archiving, setArchiving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inv = full.investigation;
  const s = inv.summary!;
  const primary = full.strategies.find((x) => x.id === full.primaryStrategyId);
  const bt = full.backtest?.result;
  const storage = inv.integrations.storage;

  const retry = async () => {
    setArchiving(true);
    setMsg(null);
    try {
      const r = await api<{ status: string; errors: { kind: string; error: string }[] }>(`/investigations/${inv.id}/archive`, { method: "POST" });
      setMsg(r.status === "archived" ? "Archived and verified." : `${r.status}: ${r.errors.map((e) => e.error).join("; ")}`);
      await qc.invalidateQueries({ queryKey: ["full", inv.id] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <Card className="mt-3">
        <Label>Wallet</Label>
        <div className="serif text-xl text-ink mt-1 break-all"><ExplorerLink kind="address" value={inv.wallet}>{inv.wallet}</ExplorerLink></div>
        <div className="text-[0.78rem] text-ink-600 mt-1">Ethereum Sepolia · blocks {inv.fromBlock?.toLocaleString("en-US")}–{inv.toBlock?.toLocaleString("en-US")} · {fmt.tsSec(s.period.fromTs)} → {fmt.tsSec(s.period.toTs)}</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5">
          <Stat label="Positions" value={s.counts.positions} />
          <Stat label="Pools" value={s.counts.pools} />
          <Stat label="Events" value={s.counts.events} />
          <Stat label="Strategy" value={<span className="text-[0.95rem]">{primary ? primary.family.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—"}</span>} sub={primary ? `${primary.role === "ai_hypothesis" ? "0G hypothesis" : "evidence-only"} · ${fmt.frac(Number(primary.confidence), 0)}` : undefined} />
          <Stat label="Backtest" value={<span className="text-[0.95rem]">{bt ? bt.status.replace("_", " ") : "not run"}</span>} />
        </div>
        <div className="text-[0.7rem] text-ink-600 mt-4 break-all">Evidence fingerprint {s.eventsFingerprint} · strategy version {primary?.irId ?? "—"} ({primary?.versionHash ?? "—"})</div>
      </Card>

      <SectionTitle eyebrow={`${ZERO_G_GALILEO.name} — genuine uploads only`} title="0G Storage archive" action={<Button variant="ghost" onClick={retry} disabled={archiving}>{archiving ? "Uploading…" : "Retry archive"}</Button>} />
      {msg && <div className="mb-3 text-[0.78rem] text-ink-600">{msg}</div>}
      {full.storage.length > 0 ? (
        <Card pad={false} className="divide-y divide-ink/8">
          {full.storage.map((a) => (
            <div key={a.rootHash + a.kind} className="px-5 py-3 text-[0.8rem] flex flex-col md:flex-row md:items-center gap-2">
              <div className="md:w-[240px] text-ink">{a.kind}</div>
              <div className="flex-1 break-all text-ink-600">root {a.rootHash}</div>
              <a className="underline text-ink-600" href={`${ZERO_G_GALILEO.explorer}/tx/${a.txHash}`} target="_blank" rel="noopener noreferrer">tx {fmt.hash(a.txHash)}</a>
              <Pill tone={a.retrievable ? "forest" : "amber"}>{a.retrievable ? "downloaded + verified" : "uploaded"}</Pill>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState title="Not archived">
          {storage?.status === "not_configured"
            ? "0G Storage is not configured on the server."
            : storage?.errors?.length
              ? `Upload failed: ${storage.errors[0].error.split(" (transaction=")[0].slice(0, 240)}. The server's 0G Galileo uploader needs testnet 0G for gas and storage fees (faucet: ${ZERO_G_GALILEO.faucet}).`
              : "No 0G Storage reference exists for this investigation. TRACE shows a reference only after a successful upload."}
        </EmptyState>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Page>
      <InvestigationGate>{(full) => <Report full={full} />}</InvestigationGate>
      <IntegrationTable />
    </Page>
  );
}
