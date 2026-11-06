"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ZERO_G_GALILEO } from "@trace/chain-config";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { Button, Card, EmptyState, ErrorState, ExplorerLink, Label, LoadingState, Pill, SectionTitle } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { NextStep } from "@/components/next-step";
import { Term } from "@/components/term";
import { FAMILY, FAMILY_PLAIN } from "@/components/case-file";
import { fmt } from "@/lib/format";
import { plainStatus } from "@/lib/status";
import { api, useCurrentInvestigationId, useIntegrations, withInv, type FullInvestigation } from "@/lib/api";

/** Why an unavailable integration is unavailable, in plain words. The technical detail stays one click away. */
const UNAVAILABLE_PLAIN: Record<string, string> = {
  zerog_inference: "The 0G AI network has no provider for TRACE's private (TEE) mode right now, so TRACE uses its evidence-only analysis instead. Nothing is faked.",
  zerog_storage: "The server's 0G archive account has no 0G test tokens to pay for storage, so reports are not archived on 0G yet.",
  world_id: "World ID needs app credentials on the server. Every execution is still protected by your own wallet signature.",
};

function IntegrationTable() {
  const { data, isLoading, isError, error, refetch, isFetching } = useIntegrations();
  return (
    <section id="integrations" className="mt-8">
      <SectionTitle
        eyebrow="Checked live by the server"
        title="Integration status"
        action={<Button variant="ghost" onClick={() => api("/integrations?refresh=1").then(() => refetch())} disabled={isFetching}>{isFetching ? "Checking…" : "Check again"}</Button>}
      />
      {isLoading && <LoadingState />}
      {isError && <ErrorState message={(error as Error).message} />}
      {data && (
        <>
          <Card pad={false} className="divide-y divide-ink/8">
            {data.integrations.map((i) => {
              const plain = plainStatus(i.status);
              return (
                <div key={i.key} className="px-5 py-3 flex flex-col md:flex-row md:items-start gap-2">
                  <div className="md:w-[260px] text-[0.88rem] text-ink font-medium">{i.label}</div>
                  <div className="md:w-[230px]" title={i.status}>
                    <Pill tone={plain.tone === "good" ? "forest" : plain.tone === "warn" ? "amber" : plain.tone === "bad" ? "brick" : "neutral"}>{plain.label}</Pill>
                    <span className="sr-only"> (technical status: {i.status})</span>
                  </div>
                  <div className="flex-1 text-[0.78rem] text-ink-600 break-words">
                    {plain.tone === "bad" && UNAVAILABLE_PLAIN[i.key] ? UNAVAILABLE_PLAIN[i.key] : i.detail}
                    {plain.tone === "bad" && UNAVAILABLE_PLAIN[i.key] && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[0.72rem] text-ink hover:text-gold w-fit">Technical detail</summary>
                        <div className="text-[0.72rem] mt-0.5 break-all">{i.status}: {i.detail}</div>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
          <Disclosure className="mt-3" title="Contracts checked on Sepolia" hint="eth_getCode for every contract TRACE uses">
            <div className="divide-y divide-ink/8">
              {data.contracts.map((c) => (
                <div key={c.key} className="py-2 flex flex-col md:flex-row md:items-center gap-2 text-[0.78rem]">
                  <div className="md:w-[280px] text-ink">{c.label}</div>
                  <div className="md:w-[240px]"><ExplorerLink kind="address" value={c.address} /></div>
                  <div className="flex-1 text-ink-600">{c.hasCode == null ? "not probed" : c.hasCode ? `${c.bytes.toLocaleString("en-US")} bytes of code` : "NO CODE"} · <a href={c.source} target="_blank" rel="noopener noreferrer" className="underline">source</a></div>
                </div>
              ))}
            </div>
            <div className="text-[0.7rem] text-ink-600 mt-2">Checked {new Date(data.computedAt).toLocaleString("en-US")}. Hover a status to see its technical label.</div>
          </Disclosure>
        </>
      )}
    </section>
  );
}

function Report({ full, invId }: { full: FullInvestigation; invId: string }) {
  const qc = useQueryClient();
  const [archiving, setArchiving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inv = full.investigation;
  const s = inv.summary!;
  const primary = full.strategies.find((x) => x.id === full.primaryStrategyId);
  const bt = full.backtest?.result;
  const observed = bt?.runs.find((r) => r.kind === "observed");
  const hold = bt?.runs.find((r) => r.kind === "benchmark" && r.label.startsWith("Buy & hold"));
  const ships = (full.transactions ?? []).filter((t) => t.op === "ship");
  const shipped = ships.filter((t) => t.status === "success");
  const storage = inv.integrations.storage;

  const download = () => {
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-report-${inv.wallet.slice(0, 10)}-${invId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="label">Report</div>
          <h1 className="serif text-2xl md:text-3xl text-ink mt-1">What TRACE found</h1>
          <div className="text-[0.82rem] text-ink-600 mt-1 break-all">
            Wallet <ExplorerLink kind="address" value={inv.wallet}>{fmt.addr(inv.wallet)}</ExplorerLink> on Sepolia, last {inv.windowDays} days ({fmt.tsSec(s.period.fromTs)} → {fmt.tsSec(s.period.toTs)})
          </div>
        </div>
        <button onClick={download} className="inline-flex items-center gap-2 rounded-md2 border border-line bg-white text-ink px-4 h-10 text-[0.86rem] font-medium hover:border-gold/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
          <Download size={15} /> Download report (JSON)
        </button>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <Label>What was found</Label>
          <p className="text-[0.92rem] text-ink mt-1.5 leading-relaxed">
            {fmt.count(s.counts.positions, "liquidity position")} in {fmt.count(s.counts.pools, "pool")}, rebuilt from {fmt.count(s.counts.events, "on-chain event")}.
          </p>
        </Card>
        <Card>
          <Label>The strategy</Label>
          {primary ? (
            <p className="text-[0.92rem] text-ink mt-1.5 leading-relaxed">
              <span className="font-medium">{FAMILY[primary.family] ?? primary.family}</span> ({fmt.frac(Number(primary.confidence), 0)} <Term k="confidence">confidence</Term>). {FAMILY_PLAIN[primary.family] ?? ""}
            </p>
          ) : (
            <p className="text-[0.92rem] text-ink-600 mt-1.5">No strategy was inferred.</p>
          )}
        </Card>
        <Card>
          <Label>How it performed</Label>
          <p className="text-[0.92rem] text-ink mt-1.5 leading-relaxed">
            {bt?.status === "completed" && observed
              ? <>The wallet&apos;s own ranges returned <span className="font-medium tabular">{fmt.pct(observed.net * 100)}</span> over the test period{hold ? <>, against <span className="tabular">{fmt.pct(hold.net * 100)}</span> for simply holding the tokens</> : null}.</>
              : bt?.status === "insufficient_data"
                ? `Not enough real trading in the pool to test it: ${bt.reason}`
                : "No backtest result."}
          </p>
        </Card>
        <Card>
          <Label>What was executed</Label>
          <p className="text-[0.92rem] text-ink mt-1.5 leading-relaxed">
            {shipped.length ? (
              <>
                The strategy was sent to 1inch Aqua {shipped.length === 1 ? "once" : `${shipped.length} times`} from your wallet:{" "}
                {shipped.map((t) => <ExplorerLink key={t.tx_hash} kind="tx" value={t.tx_hash}>{fmt.hash(t.tx_hash)}</ExplorerLink>)}
              </>
            ) : ships.length ? (
              "A ship transaction was sent but is not confirmed."
            ) : (
              "Nothing has been executed for this investigation."
            )}
          </p>
        </Card>
      </div>

      <Disclosure className="mt-4" title="Technical details" hint="blocks, evidence fingerprint, strategy version">
        <div className="text-[0.76rem] text-ink-600 space-y-1 break-all">
          <div>Wallet {inv.wallet}</div>
          <div>Sepolia blocks {inv.fromBlock != null ? Number(inv.fromBlock).toLocaleString("en-US") : "—"}–{inv.toBlock != null ? Number(inv.toBlock).toLocaleString("en-US") : "—"}</div>
          <div>Evidence fingerprint {s.eventsFingerprint}</div>
          <div>Strategy version {primary?.irId ?? "—"} ({primary?.versionHash ?? "—"}), {primary ? (primary.role === "ai_hypothesis" ? "0G hypothesis" : "evidence-only") : ""}</div>
          <div>Backtest {bt ? bt.status.replace("_", " ") : "not run"}</div>
        </div>
      </Disclosure>

      <SectionTitle eyebrow={`${ZERO_G_GALILEO.name}: real uploads only`} title="0G Storage archive" action={<Button variant="ghost" onClick={retry} disabled={archiving}>{archiving ? "Uploading…" : "Try archiving again"}</Button>} />
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
        <EmptyState title="Not archived on 0G">
          {storage?.status === "not_configured"
            ? "0G Storage is not configured on this server."
            : storage?.errors?.length
              ? `${UNAVAILABLE_PLAIN.zerog_storage} Last error: ${storage.errors[0].error.split(" (transaction=")[0].slice(0, 200)}. Faucet: ${ZERO_G_GALILEO.faucet}.`
              : "No 0G Storage reference exists for this investigation. TRACE shows one only after a real, verified upload."}{" "}
          You can still download the full report as JSON above.
        </EmptyState>
      )}
    </>
  );
}

export default function ReportsPage() {
  const [inv] = useCurrentInvestigationId();
  return (
    <Page>
      <InvestigationGate>{(full, id) => <Report full={full} invId={id} />}</InvestigationGate>
      <IntegrationTable />
      {inv && (
        <NextStep href={withInv("/activity", inv)} title="See every transaction you sent" label="Open Activity">
          Approvals and ships from your wallet, grouped by investigation, each with its Sepolia receipt.
        </NextStep>
      )}
    </Page>
  );
}
