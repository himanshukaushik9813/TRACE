"use client";

import { useEffect, useState } from "react";
import { useSendTransaction, useSignTypedData } from "wagmi";
import { parseUnits } from "viem";
import { Check, Loader2, Lock, Ship, X } from "lucide-react";
import { AQUA, AQUA_NOTES } from "@trace/chain-config";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { useSepoliaWallet } from "@/components/wallet";
import { Button, Card, EmptyState, ErrorState, ExplorerLink, Label, Pill, SectionTitle } from "@/components/ui";
import { fmt } from "@/lib/format";
import { api, type Compatibility, type ExecutionPlan, type FullInvestigation, type TxRow } from "@/lib/api";

type PlanResponse = { planId: string; plan: ExecutionPlan; compatibility: Compatibility; simulation: Record<string, { ok: boolean; error?: string }> };
type AuthResponse = { authorizationId: string; validated: boolean; signer: string | null; verification: Record<string, unknown> & { notes: string[] } };
type StepState = { status: "idle" | "signing" | "pending" | "success" | "reverted" | "error"; hash?: string; message?: string; tx?: TxRow };

const errMsg = (e: unknown) => {
  const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e);
  return /user rejected|denied/i.test(m) ? "You rejected the request in your wallet." : m;
};

function Verdict({ v }: { v: string }) {
  return <Pill tone={v === "FULL" ? "forest" : v === "PARTIAL" ? "amber" : "brick"}>{v === "PARTIAL" ? "PARTIALLY COMPATIBLE" : v === "FULL" ? "FULLY COMPATIBLE" : "INCOMPATIBLE"}</Pill>;
}

function CompatView({ c }: { c: Compatibility }) {
  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-5">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <SectionTitle eyebrow="Rule by rule" title="Strategy → Aqua" />
          <Verdict v={c.verdict} />
        </div>
        <div className="space-y-2">
          {c.rules.length === 0 && <div className="text-[0.84rem] text-ink-600">No rules to compile (inconclusive strategy).</div>}
          {c.rules.map((r) => (
            <div key={r.rule} className="rounded-md2 border border-ink/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.86rem] text-ink">{r.rule}</span>
                <Pill tone={r.status === "supported" ? "sage" : r.status === "partial" ? "amber" : "brick"}>{r.status}</Pill>
              </div>
              {r.gap && <div className="text-[0.72rem] text-ink-600 mt-1">{r.gap}</div>}
            </div>
          ))}
        </div>
        <ul className="mt-3 text-[0.72rem] text-ink-600 list-disc pl-4 space-y-1">
          {c.unsupportedNotes.slice(-1).map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>
      <Card>
        <SectionTitle eyebrow="Read from Sepolia just now" title="On-chain checks" />
        <div className="space-y-1.5">
          {c.checks.map((k) => (
            <div key={k.key} className="flex items-start gap-2 text-[0.8rem]">
              {k.ok ? <Check size={14} className="text-forest mt-0.5 shrink-0" /> : <X size={14} className="text-brick mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <div className="text-ink">{k.label}</div>
                <div className="text-[0.7rem] text-ink-600 break-all">{k.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ExecuteFlow({ full }: { full: FullInvestigation }) {
  const w = useSepoliaWallet();
  const { mutateAsync: signTypedData } = useSignTypedData();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const primary = full.strategies.find((s) => s.id === full.primaryStrategyId);
  const [compat, setCompat] = useState<Compatibility | null>(full.compatibility?.report ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [amt0, setAmt0] = useState("");
  const [amt1, setAmt1] = useState("");
  const [auth, setAuth] = useState<Record<string, AuthResponse | null>>({});
  const [steps, setSteps] = useState<Record<string, StepState>>({});

  const basisTokenId = compat?.basis?.tokenId;
  const basis = full.investigation.summary?.positions.find((p) => p.tokenId === basisTokenId) ?? null;
  const walletMatchesPlan = plan && w.address && plan.plan.maker.toLowerCase() === w.address.toLowerCase();
  const canSign = w.connected && w.onSepolia;

  // Re-check a submitted tx until it is final on Sepolia.
  useEffect(() => {
    const pending = Object.entries(steps).filter(([, s]) => s.status === "pending" && s.hash);
    if (!pending.length) return;
    const t = setInterval(async () => {
      for (const [k, s] of pending) {
        try {
          const tx = await api<TxRow>(`/transactions/${s.hash}`);
          if (tx.status !== "submitted") setSteps((prev) => ({ ...prev, [k]: { ...prev[k], status: tx.status === "success" ? "success" : "reverted", tx } }));
          else setSteps((prev) => ({ ...prev, [k]: { ...prev[k], tx } }));
        } catch {
          /* keep polling */
        }
      }
    }, 4_000);
    return () => clearInterval(t);
  }, [steps]);

  if (!primary) return <ErrorState message="No strategy version for this investigation." />;

  const runCompat = async () => {
    setErr(null);
    setBusy("compat");
    try {
      const r = await api<{ compatibility: Compatibility }>(`/strategies/${primary.id}/compatibility`, { method: "POST", body: { maker: w.address ?? undefined } });
      setCompat(r.compatibility);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const buildPlan = async () => {
    setErr(null);
    if (!w.address) return setErr("Connect your wallet: the plan is compiled for the wallet that will sign it.");
    if (!basis || basis.decimals0 == null || basis.decimals1 == null) return setErr("The basis position's token decimals are unknown.");
    let a0: bigint;
    let a1: bigint;
    try {
      a0 = amt0.trim() ? parseUnits(amt0.trim(), basis.decimals0) : 0n;
      a1 = amt1.trim() ? parseUnits(amt1.trim(), basis.decimals1) : 0n;
    } catch {
      return setErr("Amounts must be decimal numbers.");
    }
    if (a0 + a1 === 0n) return setErr("Enter an amount for at least one token.");
    setBusy("plan");
    try {
      const r = await api<PlanResponse>(`/strategies/${primary.id}/plan`, { method: "POST", body: { maker: w.address, amount0: a0.toString(), amount1: a1.toString(), tokenId: basis.tokenId } });
      setPlan(r);
      setCompat(r.compatibility);
      setAuth({});
      setSteps({});
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const authorize = async (action: "aqua:ship" | "aqua:dock") => {
    if (!plan || !w.address) return;
    setErr(null);
    setBusy(action);
    try {
      const ch = await api<{ typedData: { domain: { name: string; version: string; chainId: number }; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, string> }; claims: Record<string, unknown>; worldStatus: string }>(
        `/plans/${plan.planId}/challenge`,
        { method: "POST", body: { wallet: w.address, action } },
      );
      const m = ch.typedData.message;
      const signature = await signTypedData({
        domain: ch.typedData.domain,
        types: ch.typedData.types,
        primaryType: "Authorization",
        message: { ...m, chainId: BigInt(m.chainId), expiresAt: BigInt(m.expiresAt) },
      } as never);
      const r = await fetch(`${process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:4000"}/authorizations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan.planId, claims: ch.claims, signature }),
      });
      const body = (await r.json()) as AuthResponse & { error?: string };
      if (body.error) throw new Error(body.error);
      setAuth((p) => ({ ...p, [action]: body }));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async (key: string, op: "approve" | "ship" | "dock", step: ExecutionPlan["steps"][number], authorizationId: string) => {
    setErr(null);
    setSteps((p) => ({ ...p, [key]: { status: "signing" } }));
    try {
      const hash = await sendTransaction({ to: step.to as `0x${string}`, data: step.data as `0x${string}`, value: BigInt(step.value), chainId: 11155111 });
      setSteps((p) => ({ ...p, [key]: { status: "pending", hash } }));
      await api(`/transactions`, { method: "POST", body: { authorizationId, op, txHash: hash } });
    } catch (e) {
      setSteps((p) => ({ ...p, [key]: { ...(p[key] ?? {}), status: p[key]?.hash ? "pending" : "error", message: errMsg(e) } }));
    }
  };

  const StepRow = ({ k, op, step, authId, locked }: { k: string; op: "approve" | "ship" | "dock"; step: ExecutionPlan["steps"][number]; authId?: string; locked?: string }) => {
    const s = steps[k] ?? { status: "idle" as const };
    return (
      <div className="rounded-md2 border border-ink/10 p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Pill tone={op === "ship" ? "gold" : op === "dock" ? "neutral" : "sage"}>{op}</Pill>
            <span className="text-[0.84rem] text-ink">{step.description}</span>
          </div>
          <div className="text-[0.7rem] text-ink-600 mt-1 break-all">to <ExplorerLink kind="address" value={step.to} /> · calldata {step.data.slice(0, 18)}…</div>
          {s.hash && (
            <div className="text-[0.74rem] mt-1.5 flex flex-wrap gap-x-3">
              <ExplorerLink kind="tx" value={s.hash}>tx {fmt.hash(s.hash)}</ExplorerLink>
              {s.tx?.block && <span className="text-ink-600">block {Number(s.tx.block).toLocaleString("en-US")} · {s.tx.confirmations ?? 0} confirmations</span>}
              {s.tx?.matches_plan != null && <span className={s.tx.matches_plan ? "text-forest" : "text-brick"}>{s.tx.matches_plan ? "calldata matches the authorized plan" : "does NOT match the plan"}</span>}
            </div>
          )}
          {s.tx?.outcome && <div className="text-[0.72rem] text-ink-600 mt-1">{s.tx.outcome}</div>}
          {s.message && <div className="text-[0.72rem] text-brick mt-1">{s.message}</div>}
        </div>
        <div className="shrink-0">
          {s.status === "success" ? (
            <Pill tone="forest"><Check size={12} /> Confirmed on Sepolia</Pill>
          ) : s.status === "reverted" ? (
            <Pill tone="brick">Reverted</Pill>
          ) : s.status === "pending" ? (
            <Pill tone="gold"><Loader2 size={12} className="animate-spin" /> Pending receipt</Pill>
          ) : locked ? (
            <span className="inline-flex items-center gap-1 text-[0.72rem] text-ink-600"><Lock size={12} /> {locked}</span>
          ) : (
            <Button variant={op === "ship" ? "gold" : "primary"} disabled={!canSign || !authId || s.status === "signing" || !walletMatchesPlan} onClick={() => authId && send(k, op, step, authId)}>
              {s.status === "signing" ? "Confirm in wallet…" : `Sign ${op}`}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const shipAuth = auth["aqua:ship"];
  const dockAuth = auth["aqua:dock"];
  const approvals = plan?.plan.steps.filter((s) => s.op === "approve") ?? [];
  const ship = plan?.plan.steps.find((s) => s.op === "ship");
  const dock = plan?.plan.steps.find((s) => s.op === "dock");
  const approvalsDone = approvals.every((_, i) => steps[`approve-${i}`]?.status === "success");
  const shipped = steps["ship"]?.status === "success";
  const kyc = compat?.checks.find((c) => c.key === "taker.kyc");

  const rail = [
    { title: "Check", detail: "Live reads of the Aqua registry, router, tokens and your wallet", done: Boolean(compat) },
    { title: "Compile", detail: "A deterministic SwapVM order from the position's real range", done: Boolean(plan) },
    { title: "Authorize", detail: "One EIP-712 signature, verified by the server", done: Boolean(shipAuth?.validated) },
    { title: "Ship", detail: "Approve exact amounts and ship from MetaMask", done: shipped },
  ];
  const current = rail.findIndex((r) => !r.done);

  return (
    <>
      <ol className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-panel overflow-hidden border border-ink/10 bg-ink/10" aria-label="Execution progress">
        {rail.map((r, i) => (
          <li key={r.title} className={`min-w-0 p-4 ${i === current ? "bg-charcoal-900 text-cream" : "bg-ivory-50"}`} aria-current={i === current ? "step" : undefined}>
            <div className={`flex items-center gap-2 text-[0.8rem] ${i === current ? "text-gold-300" : r.done ? "text-forest" : "text-ink-600"}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[0.68rem] font-semibold tabular ${r.done ? "bg-forest text-ivory-50" : i === current ? "bg-gold text-charcoal-900" : "border border-ink/20"}`}>
                {r.done ? <Check size={11} /> : i + 1}
              </span>
              {r.title}
            </div>
            <p className={`mt-1.5 text-[0.76rem] leading-snug ${i === current ? "text-cream-muted" : "text-ink-600"}`}>{r.detail}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-md2 border border-ink/10 bg-ivory-50 p-4 flex gap-3 text-[0.82rem] text-ink-600 leading-relaxed">
        <Ship size={16} className="text-gold shrink-0 mt-0.5" />
        <p className="max-w-[90ch]">
          A Uniswap V3 position and an Aqua strategy are <strong className="text-ink">different instruments</strong>. TRACE does not move your position: it compiles the rules Aqua can express into a 1inch SwapVM concentrated-liquidity order and ships that from your wallet. {AQUA_NOTES.deployment}
        </p>
      </div>

      {err && <div className="mt-4"><ErrorState message={err} /></div>}

      <SectionTitle eyebrow="Step 1 of 4" title="Check compatibility" />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Button onClick={runCompat} disabled={busy === "compat"}>{busy === "compat" ? "Reading Sepolia…" : compat ? "Re-run on-chain checks" : "Run on-chain compatibility checks"}</Button>
        <span className="text-[0.74rem] text-ink-600">{w.address ? `Maker checks for ${fmt.addr(w.address)}` : "Connect a wallet to include maker balance/allowance checks"}</span>
      </div>
      {compat ? <CompatView c={compat} /> : <EmptyState title="Not assessed yet">Runs live reads against the Aqua registry, router, token contracts and your wallet.</EmptyState>}

      {compat && compat.verdict !== "INCOMPATIBLE" && basis && (
        <>
          <SectionTitle eyebrow="Step 2 of 4" title="Compile the execution plan" />
          <Card>
            <div className="text-[0.82rem] text-ink-600">
              Basis: real position #{basis.tokenId} ({basis.token0}/{basis.token1}, {fmt.feeTier(basis.feeTier)}, ticks {basis.tickLower} → {basis.tickUpper}). Choose how much of each token the Aqua strategy may use. Tokens stay in your wallet; Aqua pulls them only when a swap fills, so the approvals are exactly these amounts.
            </div>
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-4 items-end">
              <label className="text-[0.78rem]">
                <Label>{basis.token0} amount</Label>
                <input value={amt0} onChange={(e) => setAmt0(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-full rounded-md2 border border-ink/15 bg-ivory-50 px-3 py-2 tabular" />
              </label>
              <label className="text-[0.78rem]">
                <Label>{basis.token1} amount</Label>
                <input value={amt1} onChange={(e) => setAmt1(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-full rounded-md2 border border-ink/15 bg-ivory-50 px-3 py-2 tabular" />
              </label>
              <Button variant="dark" onClick={buildPlan} disabled={busy === "plan" || !w.address}>{busy === "plan" ? "Compiling + simulating…" : "Compile plan"}</Button>
            </div>
          </Card>
        </>
      )}

      {plan && (
        <>
          <Card dark className="mt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Label onDark>Deterministic SwapVM order (official 1inch SDK)</Label>
                <div className="text-cream text-[0.86rem] mt-2 tabular break-all">Plan hash {plan.plan.planHash}</div>
                <div className="text-cream-muted text-[0.74rem] mt-1 break-all">Aqua strategy hash {plan.plan.strategyHash}</div>
                <div className="text-cream-muted text-[0.74rem] mt-1">
                  Price range {plan.plan.params.priceHigh ? `${fmt.amt(plan.plan.params.priceLow, 8)} – ${fmt.amt(plan.plan.params.priceHigh, 8)}` : "full range"} · fee {plan.plan.params.feeBps} bps · order {(plan.plan.order.length - 2) / 2} bytes
                </div>
                <div className="text-cream-muted text-[0.74rem] mt-1">
                  Registry <ExplorerLink kind="address" value={AQUA.registry.address} className="text-cream-muted" /> · router <ExplorerLink kind="address" value={AQUA.swapVmRouter.address} className="text-cream-muted" />
                </div>
              </div>
              <div className="text-[0.72rem] text-cream-muted space-y-1">
                {Object.entries(plan.simulation).map(([k, v]) => (
                  <div key={k} className={v.ok ? "text-sage-300" : "text-gold-300"}>
                    simulate {k.split(":")[0]}: {v.ok ? "ok" : v.error}
                  </div>
                ))}
              </div>
            </div>
            {plan.plan.notCompiled.length > 0 && (
              <ul className="mt-3 text-[0.72rem] text-gold-300 list-disc pl-4">
                {plan.plan.notCompiled.map((n) => <li key={n}>Not compiled: {n}</li>)}
              </ul>
            )}
          </Card>

          {!walletMatchesPlan && <div className="mt-3"><ErrorState title="Wallet mismatch" message={`This plan was compiled for ${plan.plan.maker}; connect that wallet to sign.`} /></div>}

          <SectionTitle eyebrow="Step 3 of 4: bound to this exact plan and verified by the server" title="Authorize shipping" />
          <Card>
            {!shipAuth ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="gold" disabled={!canSign || !walletMatchesPlan || busy === "aqua:ship"} onClick={() => authorize("aqua:ship")}>
                  {busy === "aqua:ship" ? "Sign in your wallet…" : "Sign authorization (EIP-712)"}
                </Button>
                <span className="text-[0.74rem] text-ink-600">Binds wallet, Sepolia chain id, strategy version, plan hash, action and a single-use challenge (10 min expiry). No transaction, no gas.</span>
              </div>
            ) : (
              <AuthResult a={shipAuth} />
            )}
          </Card>

          {shipAuth?.validated && (
            <>
              <SectionTitle eyebrow="Step 4 of 4: each transaction is signed in your wallet and checked against its receipt" title="Ship on Sepolia" />
              <div className="space-y-2">
                {approvals.map((s, i) => <StepRow key={`approve-${i}`} k={`approve-${i}`} op="approve" step={s} authId={shipAuth.authorizationId} />)}
                {ship && <StepRow k="ship" op="ship" step={ship} authId={shipAuth.authorizationId} locked={approvalsDone ? undefined : "after approvals"} />}
              </div>
            </>
          )}

          {shipped && dock && (
            <>
              <SectionTitle eyebrow="Optional" title="Dock the strategy" />
              <Card>
                {!dockAuth ? (
                  <Button disabled={!canSign || busy === "aqua:dock"} onClick={() => authorize("aqua:dock")}>
                    {busy === "aqua:dock" ? "Sign in your wallet…" : "Authorize dock (EIP-712)"}
                  </Button>
                ) : (
                  <AuthResult a={dockAuth} />
                )}
                {dockAuth?.validated && <div className="mt-3"><StepRow k="dock" op="dock" step={dock} authId={dockAuth.authorizationId} /></div>}
              </Card>
            </>
          )}

          <SectionTitle eyebrow="Taker side" title="Swap against the shipped strategy" />
          <Card>
            <div className="flex items-center gap-2">
              <Pill tone={kyc?.ok ? "amber" : "brick"}>{kyc?.ok ? "IMPLEMENTED BUT NOT VERIFIED" : "BLOCKED BY EXTERNAL DEPENDENCY"}</Pill>
              <span className="text-[0.8rem] text-ink-600">{AQUA_NOTES.takerGate} {kyc?.detail ?? ""}</span>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function AuthResult({ a }: { a: AuthResponse }) {
  const v = a.verification as Record<string, unknown>;
  const keys = ["signatureOk", "signerMatches", "chainOk", "notExpired", "challengeFresh", "strategyVersionMatches", "planHashMatches"];
  return (
    <div>
      <div className="flex items-center gap-2">
        <Pill tone={a.validated ? "forest" : "brick"}>{a.validated ? "Authorized — verified by the server" : "Rejected by the server"}</Pill>
        <span className="text-[0.72rem] text-ink-600 tabular">id {a.authorizationId.slice(0, 8)} · signer {a.signer ? fmt.addr(a.signer) : "—"} · World ID: {String(v.worldId)}</span>
      </div>
      <div className="grid sm:grid-cols-4 gap-1.5 mt-3 text-[0.74rem]">
        {keys.map((k) => (
          <span key={k} className={`inline-flex items-center gap-1 ${v[k] ? "text-forest" : "text-brick"}`}>
            {v[k] ? <Check size={12} /> : <X size={12} />} {k}
          </span>
        ))}
      </div>
      {a.verification.notes.length > 0 && <div className="text-[0.72rem] text-brick mt-2">{a.verification.notes.join(" · ")}</div>}
    </div>
  );
}

export default function ExecutePage() {
  return (
    <Page>
      <InvestigationGate>{(full) => <ExecuteFlow full={full} />}</InvestigationGate>
    </Page>
  );
}
