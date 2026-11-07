"use client";

/**
 * Execute, as an 8-step guided flow for people new to DeFi.
 *
 *   1 Review strategy        5 Transaction review
 *   2 Aqua compatibility     6 Wallet authorization (EIP-712 signature)
 *   3 What will not run      7 Wallet confirmation (approve + ship)
 *   4 Capital and limits     8 Receipt
 *
 * All progress comes from the server (useAquaExecution reads the plan, its
 * authorizations and its transactions from /investigations/:id/full), so a
 * refresh resumes at the right step and a send interrupted by a reload is
 * reconciled against Sepolia before anything can be sent again. Every wallet
 * action needs its own click and its own wallet confirmation; nothing here is
 * automatic, and nothing is shown as done unless the server says so.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReadContracts, useSendTransaction, useSignTypedData } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { Check, ExternalLink, Loader2, Lock, X } from "lucide-react";
import { AQUA, AQUA_NOTES, SEPOLIA_CHAIN_ID, explorer } from "@trace/chain-config";
import { useSepoliaWallet } from "@/components/wallet";
import { Disclosure } from "@/components/disclosure";
import { Term } from "@/components/term";
import { ExplorerLink, Pill } from "@/components/ui";
import { FAMILY, FAMILY_PLAIN } from "@/components/case-file";
import { pickPosition } from "@/components/investigate";
import { rangeLabel } from "@/components/positions";
import { fmt } from "@/lib/format";
import { API_URL, api, useIntegrations, withInv, type Compatibility, type ExecutionPlan, type FullInvestigation, type StrategyState, type TxRow } from "@/lib/api";
import { useAquaExecution, walletErr } from "@/lib/aqua-flow";

type State = "done" | "current" | "upcoming" | "blocked";
type PlanResponse = { planId: string; plan: ExecutionPlan; compatibility: Compatibility; simulation: Record<string, { ok: boolean; error?: string }> };

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-md2 bg-gold-700 text-white px-5 h-10 text-[0.88rem] font-medium hover:bg-gold-800 disabled:bg-ivory-100 disabled:text-ink-600 disabled:border disabled:border-line disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50";
const BTN_QUIET =
  "inline-flex items-center justify-center gap-2 rounded-md2 border border-line bg-white text-ink px-4 h-10 text-[0.86rem] font-medium hover:border-gold/50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40";

/** One step of the guided flow. */
function Step({ n, title, state, summary, children }: { n: number; title: string; state: State; summary?: React.ReactNode; children?: React.ReactNode }) {
  const open = state === "current" || state === "blocked";
  return (
    <li className={`rounded-card border bg-white p-4 md:p-5 transition-colors ${state === "current" ? "border-gold/60 shadow-lift" : state === "blocked" ? "border-brick/30" : "border-line"}`} aria-current={state === "current" ? "step" : undefined}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.78rem] font-semibold tabular ${
            state === "done" ? "bg-forest text-white" : state === "current" ? "bg-gold-700 text-white" : state === "blocked" ? "bg-brick/10 text-brick border border-brick/30" : "border border-line text-ink-600"
          }`}
          aria-hidden
        >
          {state === "done" ? <Check size={14} strokeWidth={3} /> : state === "blocked" ? <X size={14} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className={`text-[0.98rem] font-semibold ${state === "upcoming" ? "text-ink-600" : "text-ink"}`}>
              <span className="sr-only">Step {n}, {state === "done" ? "complete" : state === "current" ? "current" : state === "blocked" ? "blocked" : "not started"}: </span>
              {title}
            </h3>
            {state === "done" && <span className="text-[0.72rem] text-forest font-medium">Done</span>}
          </div>
          {summary && <div className="text-[0.82rem] text-ink-600 mt-1 leading-relaxed">{summary}</div>}
          {(open || state === "done") && children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </li>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mt-3 rounded-md2 border border-brick/25 bg-brick/5 px-3 py-2 text-[0.8rem] text-brick break-anywhere">{children}</p>;
}

function TxLine({ label, tx, state }: { label: string; tx?: TxRow | null; state: "done" | "active" | "failed" | "pending" }) {
  return (
    <li className="flex flex-wrap items-center gap-2.5 text-[0.84rem]">
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          state === "done" ? "bg-forest text-white" : state === "failed" ? "bg-brick text-white" : state === "active" ? "border border-gold/60 text-gold-700" : "border border-line"
        }`}
        aria-hidden
      >
        {state === "done" ? <Check size={12} strokeWidth={3} /> : state === "failed" ? <X size={12} strokeWidth={3} /> : state === "active" ? <Loader2 size={12} className="animate-spin" /> : null}
      </span>
      <span className={state === "pending" ? "text-ink-600" : "text-ink"}>{label}</span>
      {tx && (
        <a href={explorer.tx(tx.tx_hash)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[0.74rem] text-ink-600 hover:text-gold-700 tabular">
          {fmt.hash(tx.tx_hash)} <ExternalLink size={11} />
        </a>
      )}
    </li>
  );
}
const txState = (t?: TxRow | null): "done" | "active" | "failed" | "pending" => (!t ? "pending" : t.status === "success" ? "done" : t.status === "reverted" ? "failed" : "active");

const CHECK_PLAIN: Record<string, string> = {
  "ir.conclusive": "The strategy is clear enough to run",
  "basis.position": "A real Uniswap position sets the price range",
  "basis.decimals": "The tokens' decimals can be read",
  "aqua.registry": "The Aqua registry exists on Sepolia",
  "aqua.router": "The Aqua swap router exists on Sepolia",
};

export function GuidedExecute({ full, invId }: { full: FullInvestigation; invId: string }) {
  const w = useSepoliaWallet();
  const qc = useQueryClient();
  const exec = useAquaExecution(full, invId);
  const { snap, busy, error, recovery } = exec;
  const integ = useIntegrations();
  const aqua = integ.data?.integrations.find((i) => i.key === "aqua");
  const aquaBlocked = aqua?.status === "BLOCKED BY EXTERNAL DEPENDENCY" || aqua?.status === "NOT IMPLEMENTED";

  const primary = full.strategies.find((s) => s.id === full.primaryStrategyId) ?? null;
  const p = pickPosition(full);
  const [compatLocal, setCompatLocal] = useState<Compatibility | null>(null);
  const compat = compatLocal ?? full.compatibility?.report ?? null;
  const [checking, setChecking] = useState(false);
  const [compatErr, setCompatErr] = useState<string | null>(null);
  const [a0, setA0] = useState("");
  const [a1, setA1] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<PlanResponse["simulation"] | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  const t0 = (p?.token0Address ?? compat?.basis?.token0) as `0x${string}` | undefined;
  const t1 = (p?.token1Address ?? compat?.basis?.token1) as `0x${string}` | undefined;
  const bal = useReadContracts({
    contracts:
      w.address && t0 && t1
        ? [
            { address: t0, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`] },
            { address: t1, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`] },
          ]
        : [],
    query: { enabled: Boolean(w.address && t0 && t1) },
  });
  const balance = (i: 0 | 1) => {
    const r = bal.data?.[i];
    const d = i === 0 ? p?.decimals0 : p?.decimals1;
    return r?.status === "success" && d != null ? Number(formatUnits(r.result as bigint, d)) : null;
  };

  const plan = snap.plan;
  const mine = Boolean(plan && w.address && plan.maker.toLowerCase() === w.address.toLowerCase());
  const shipped = snap.ship?.status === "success";
  const signed = Boolean(snap.auth) || shipped;
  const walletBlock = !w.connected ? "Connect your wallet (top right) to continue." : !w.onSepolia ? "Switch your wallet to the Sepolia test network to continue." : null;
  const working = Boolean(busy) || Boolean(recovery) || compiling;
  const pending = snap.ship?.status === "submitted" || snap.approvals.some((t) => t.status === "submitted");
  const unsupported = compat?.rules.filter((r) => r.status !== "supported") ?? [];
  const supported = compat?.rules.filter((r) => r.status === "supported") ?? [];
  const planAmounts = plan?.plan.tokens?.filter((t) => t.amount !== "0").map((t) => `${fmt.amt(Number(formatUnits(BigInt(t.amount), t.decimals)))} ${t.symbol}`) ?? [];

  /* ---------- step states ---------- */
  const inconclusive = !primary || primary.family === "inconclusive";
  const s1: State = inconclusive ? "blocked" : "done";
  const s2: State = aquaBlocked || compat?.verdict === "INCOMPATIBLE" ? "blocked" : compat ? "done" : "current";
  const s3: State = compat && compat.verdict !== "INCOMPATIBLE" ? "done" : "upcoming";
  const havePlan = Boolean(plan && mine && !editing);
  const s4: State = havePlan || signed ? "done" : "current";
  const s5: State = signed || (havePlan && reviewed) ? "done" : "current";
  const s6: State = signed ? "done" : "current";
  const s7: State = shipped ? "done" : "current";
  const s8: State = shipped ? "done" : "current";
  const raw = [s1, s2, s3, s4, s5, s6, s7, s8];
  // Only the first unfinished step is "current"; later ones wait.
  const firstOpen = raw.findIndex((s) => s !== "done");
  const states: State[] = raw.map((s, i) => (firstOpen === -1 || i <= firstOpen ? s : s === "blocked" ? "blocked" : "upcoming"));
  const stopped = states.some((s) => s === "blocked");

  /* ---------- actions ---------- */
  const runCompat = async () => {
    if (!primary) return;
    setCompatErr(null);
    setChecking(true);
    try {
      const r = await api<{ compatibility: Compatibility }>(`/strategies/${primary.id}/compatibility`, { method: "POST", body: { maker: w.address ?? undefined } });
      setCompatLocal(r.compatibility);
      await qc.invalidateQueries({ queryKey: ["full", invId] });
    } catch (e) {
      setCompatErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const compile = async () => {
    setPlanErr(null);
    if (!primary || !p || !w.address) return;
    if (p.decimals0 == null || p.decimals1 == null) return setPlanErr("This position's token decimals are unknown, so amounts cannot be encoded.");
    let x0: bigint, x1: bigint;
    try {
      x0 = a0.trim() ? parseUnits(a0.trim(), p.decimals0) : 0n;
      x1 = a1.trim() ? parseUnits(a1.trim(), p.decimals1) : 0n;
    } catch {
      return setPlanErr("Amounts must be plain decimal numbers, like 0.01.");
    }
    if (x0 + x1 === 0n) return setPlanErr(`Enter how much ${p.token0} or ${p.token1} the Aqua order may use.`);
    setCompiling(true);
    try {
      const r = await api<PlanResponse>(`/strategies/${primary.id}/plan`, { method: "POST", body: { maker: w.address, amount0: x0.toString(), amount1: x1.toString(), tokenId: p.tokenId } });
      setCompatLocal(r.compatibility);
      setSimulation(r.simulation);
      const failed = Object.entries(r.simulation).find(([, v]) => !v.ok);
      if (failed) setPlanErr(`A dry run of the ${failed[0].split(":")[0]} transaction failed, so nothing should be signed yet: ${failed[1].error ?? "reverted"}`);
      setReviewed(false);
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["full", invId] });
    } catch (e) {
      setPlanErr((e as Error).message);
    } finally {
      setCompiling(false);
    }
  };

  const short = (i: 0 | 1, amt: string) => {
    const b = balance(i);
    const want = Number(amt);
    return b != null && amt.trim() !== "" && Number.isFinite(want) && want > b;
  };
  const expiresAt = snap.auth ? new Date(snap.auth.expiresAt) : null;
  const tokenOf = (addr: string) => plan?.plan.tokens?.find((t) => t.address.toLowerCase() === addr.toLowerCase());

  return (
    <div>
      <header className="mb-4">
        <div className="label">Execute</div>
        <h1 className="serif text-2xl md:text-3xl text-ink mt-1">Run this strategy on 1inch Aqua</h1>
        <p className="text-[0.88rem] text-ink-600 mt-1.5 max-w-[74ch] leading-relaxed">
          Eight short steps. TRACE never moves your Uniswap position and never sends anything on its own: you review every transaction and confirm each one in your wallet. This runs on the Sepolia test network, so the tokens have no real value.
        </p>
      </header>

      {recovery && (
        <p role="status" className="mb-4 rounded-md2 border border-gold/30 bg-gold/8 px-3 py-2 text-[0.8rem] text-gold-700 flex items-start gap-2">
          <Loader2 size={14} className="animate-spin mt-0.5 shrink-0" />
          {recovery.state === "checking" ? "The page reloaded while your wallet was asked to send a transaction. Checking Sepolia so it is never sent twice…" : recovery.detail}
        </p>
      )}

      <ol className="space-y-3" aria-label={`Execution steps: ${states.filter((s) => s === "done").length} of 8 complete`}>
        {/* 1 */}
        <Step
          n={1}
          title="Review the strategy"
          state={states[0]}
          summary={
            inconclusive ? (
              "The evidence is inconclusive, so TRACE does not recommend running a strategy for this wallet."
            ) : (
              <>
                <span className="text-ink font-medium">{FAMILY[primary!.family] ?? primary!.family}</span>, {fmt.frac(Number(primary!.confidence), 0)} <Term k="confidence">confidence</Term>. {FAMILY_PLAIN[primary!.family] ?? ""}{" "}
                <Link href={withInv("/strategy", invId)} className="underline text-gold-700">See the evidence</Link>
              </>
            )
          }
        />

        {/* 2 */}
        <Step
          n={2}
          title="Check that 1inch Aqua can run it"
          state={states[1]}
          summary={
            aquaBlocked ? (
              <>1inch Aqua is unavailable right now: {aqua?.detail}</>
            ) : compat ? (
              compat.verdict === "FULL" ? (
                <><span className="font-medium text-ink">Fully compatible within supported scope:</span> every rule can run on Aqua.</>
              ) : compat.verdict === "PARTIAL" ? (
                <><Term k="aquaCompatibility">Partially compatible</Term>: {supported.length} of {compat.rules.length} rules can run on Aqua; the rest stay manual.</>
              ) : (
                <><span className="font-medium text-ink">Incompatible:</span> this strategy cannot be expressed as an Aqua order. {compat.checks.filter((c) => !c.ok && !/^(maker|taker|info)\./.test(c.key)).map((c) => c.label).join(", ") || compat.unsupportedNotes[compat.unsupportedNotes.length - 1] || ""}</>
              )
            ) : (
              "TRACE reads the Aqua contracts, the tokens and your wallet on Sepolia right now to see which parts of the strategy Aqua can run."
            )
          }
        >
          {!aquaBlocked && (
            <div className="flex flex-wrap items-center gap-3">
              <button className={compat ? BTN_QUIET : BTN} onClick={runCompat} disabled={checking || inconclusive}>
                {checking && <Loader2 size={15} className="animate-spin" />}
                {checking ? "Reading Sepolia…" : compat ? "Check again" : "Run the check"}
              </button>
              <span className="text-[0.74rem] text-ink-600">{w.address ? `Includes your wallet ${fmt.addr(w.address)}.` : "Connect your wallet to include its balances."}</span>
            </div>
          )}
          {compatErr && <Alert>{compatErr}</Alert>}
          {compat && compat.checks.length > 0 && (
            <Disclosure className="mt-3" title="What was checked" hint={`${compat.checks.filter((c) => c.ok).length} of ${compat.checks.length} checks passed`}>
              <ul className="space-y-1.5">
                {compat.checks.map((k) => (
                  <li key={k.key} className="flex items-start gap-2 text-[0.8rem]">
                    {k.ok ? <Check size={14} className="text-forest mt-0.5 shrink-0" /> : <X size={14} className="text-brick mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-ink">{CHECK_PLAIN[k.key] ?? k.label}</div>
                      <div className="text-[0.7rem] text-ink-600 break-all">{k.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Step>

        {/* 3 */}
        <Step
          n={3}
          title="What will not run on Aqua"
          state={states[2]}
          summary={
            !compat
              ? "Shown after the check."
              : unsupported.length === 0
                ? "Nothing: every rule of this strategy can run on Aqua."
                : `${unsupported.length === 1 ? "One part" : `${unsupported.length} parts`} of the strategy will not be carried over. Aqua runs the rest.`
          }
        >
          {compat && (unsupported.length > 0 || supported.length > 0) && (
            <ul className="space-y-2">
              {supported.map((r) => (
                <li key={r.rule} className="flex items-start gap-2 text-[0.84rem]">
                  <Check size={15} className="text-forest mt-0.5 shrink-0" aria-hidden />
                  <span><span className="text-ink">{r.rule}</span> <span className="text-ink-600">runs on Aqua.</span></span>
                </li>
              ))}
              {unsupported.map((r) => (
                <li key={r.rule} className="flex items-start gap-2 text-[0.84rem]">
                  <X size={15} className="text-brick mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="text-ink">{r.rule}</span> <span className="text-ink-600">{r.status === "partial" ? "only partly runs on Aqua." : "does not run on Aqua."} {r.gap}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Step>

        {/* 4 */}
        <Step
          n={4}
          title="Choose how much to commit"
          state={states[3]}
          summary={
            havePlan || signed
              ? <>Committed: {planAmounts.join(" and ") || "your amounts"}{plan?.plan.allocation ? <>, sized to the pool price at block {plan.plan.allocation.spot.block.toLocaleString("en-US")}</> : null}.{" "}{!signed && <button className="underline text-gold-700" onClick={() => setEditing(true)} disabled={working}>Change amounts</button>}</>
              : "Set the most the Aqua order may use. Tokens stay in your wallet; Aqua takes them only when a trade fills."
          }
        >
          {!(havePlan || signed) && p && (
            <>
              <div className="grid sm:grid-cols-2 gap-3 max-w-[560px]">
                {([0, 1] as const).map((i) => {
                  const sym = i === 0 ? p.token0 : p.token1;
                  const b = balance(i);
                  return (
                    <label key={i} className="min-w-0 text-[0.78rem] text-ink-600">
                      {sym} to commit
                      <input
                        value={i === 0 ? a0 : a1}
                        onChange={(e) => (i === 0 ? setA0 : setA1)(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.0"
                        disabled={working}
                        className="mt-1 w-full rounded-md2 border border-line bg-ivory-50 px-3 h-10 text-[0.9rem] text-ink tabular outline-none focus:border-gold/60 disabled:opacity-60"
                      />
                      <span className="mt-1 block text-[0.7rem] tabular">{b != null ? `Your wallet holds ${fmt.amt(b)} ${sym}` : " "}</span>
                    </label>
                  );
                })}
              </div>
              {(short(0, a0) || short(1, a1)) && (
                <p className="mt-2 text-[0.76rem] text-gold-700 leading-relaxed max-w-[72ch]">
                  Your wallet holds less than this. The order can still be sent, but trades will only fill once the tokens are in your wallet.
                </p>
              )}
              <p className="mt-2 text-[0.76rem] text-ink-600 max-w-[72ch]">
                <span className="text-ink font-medium">Limit:</span> these are maximums. TRACE sizes the order to the pool&apos;s current price (read from Sepolia), so it may use less of one token, never more. The approvals you sign are for exactly the amounts used.
              </p>
              {plan && !mine && <p className="mt-2 text-[0.76rem] text-ink-600">The last plan was prepared for {fmt.addr(plan.maker)}. Continuing prepares a new one for your connected wallet.</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button className={BTN} onClick={compile} disabled={Boolean(walletBlock) || working || stopped}>
                  {compiling && <Loader2 size={15} className="animate-spin" />}
                  {compiling ? "Preparing and testing…" : "Prepare the transactions"}
                </button>
                {walletBlock && <span className="text-[0.76rem] text-ink-600">{walletBlock}</span>}
              </div>
              {planErr && <Alert>{planErr}</Alert>}
            </>
          )}
        </Step>

        {/* 5 */}
        <Step
          n={5}
          title="Review the transactions"
          state={states[4]}
          summary={plan && (havePlan || signed) ? `${snap.approveSteps.length + (snap.shipStep ? 1 : 0)} transactions, each confirmed separately in your wallet.` : "Shown once the transactions are prepared."}
        >
          {plan && (havePlan || signed) && (
            <>
              <ol className="space-y-2.5">
                {snap.approveSteps.map((st, i) => {
                  const tok = tokenOf(st.approval?.token ?? st.to);
                  const amt = tok ? `${fmt.amt(Number(formatUnits(BigInt(st.approval?.amount ?? tok.amount), tok.decimals)))} ${tok.symbol}` : "the committed amount";
                  return (
                    <li key={i} className="rounded-md2 border border-line bg-ivory-50 px-3.5 py-3">
                      <div className="text-[0.86rem] text-ink font-medium"><Term k="approve">Approve</Term>: allow Aqua to use exactly {amt}</div>
                      <div className="text-[0.74rem] text-ink-600 mt-0.5">
                        Sent to the {tok?.symbol ?? "token"} contract <ExplorerLink kind="address" value={st.to} />. No tokens move yet.
                      </div>
                    </li>
                  );
                })}
                {snap.shipStep && (
                  <li className="rounded-md2 border border-line bg-ivory-50 px-3.5 py-3">
                    <div className="text-[0.86rem] text-ink font-medium"><Term k="ship">Ship</Term>: publish the strategy order to Aqua</div>
                    <div className="text-[0.74rem] text-ink-600 mt-0.5">
                      Sent to the Aqua registry <ExplorerLink kind="address" value={snap.shipStep.to} />. Price range {plan.plan.params.priceHigh ? `${fmt.price(plan.plan.params.priceLow)} – ${fmt.price(plan.plan.params.priceHigh)}` : "full range"}{p ? ` ${p.token1}/${p.token0}` : ""} (the wallet&apos;s range: {p ? rangeLabel(p) : "—"}).
                    </div>
                  </li>
                )}
              </ol>
              {plan.plan.allocation && (
                <p className="mt-2 text-[0.76rem] text-ink-600 max-w-[78ch]">
                  <span className="text-ink font-medium">Sizing:</span> {plan.plan.allocation.note}. Pool price {fmt.price(plan.plan.allocation.spot.price)} {p ? `${p.token1}/${p.token0}` : ""} at block {plan.plan.allocation.spot.block.toLocaleString("en-US")}; you offered {plan.plan.allocation.requested.map((a, i) => `${fmt.amt(Number(formatUnits(BigInt(a), plan.plan.tokens[i].decimals)))} ${plan.plan.tokens[i].symbol}`).join(" and ")}.
                </p>
              )}
              {plan.plan.notCompiled.length > 0 && (
                <ul className="mt-2 text-[0.76rem] text-gold-700 list-disc pl-5">
                  {plan.plan.notCompiled.map((n) => <li key={n}>Not included: {n}</li>)}
                </ul>
              )}
              <p className="mt-2 text-[0.74rem] text-ink-600">Each transaction costs a little Sepolia ETH for <Term k="gas">gas</Term>.</p>
              <Disclosure className="mt-3" title="Technical details" hint="plan hash, order, calldata and dry-run results">
                <div className="text-[0.74rem] text-ink-600 space-y-1 break-all">
                  <div>Plan hash {plan.planHash}</div>
                  <div>Aqua strategy hash {plan.plan.strategyHash}</div>
                  <div>Order {plan.plan.order ? (plan.plan.order.length - 2) / 2 : 0} bytes · fee {plan.plan.params.feeBps} bps · registry <ExplorerLink kind="address" value={AQUA.registry.address} /> · router <ExplorerLink kind="address" value={AQUA.swapVmRouter.address} /></div>
                  {plan.plan.steps.map((st, i) => <div key={i}>{st.op}: to {st.to} · calldata {st.data.slice(0, 26)}…</div>)}
                  {simulation && Object.entries(simulation).map(([k, v]) => <div key={k} className={v.ok ? "text-forest" : "text-brick"}>dry run {k.split(":")[0]}: {v.ok ? "ok" : v.error}</div>)}
                  {plan.plan.source && <div>Compiled from strategy {plan.plan.source.strategyId}{plan.plan.source.strategyVersionHash ? ` (version ${plan.plan.source.strategyVersionHash})` : ""} by {plan.plan.source.compiler}</div>}
                  {plan.plan.validation?.map((v) => <div key={v.key} className={v.ok ? "text-forest" : "text-brick"}>check {v.key}: {v.ok ? "ok" : "FAILED"} · {v.detail}</div>)}
                  <div>{AQUA_NOTES.deployment}</div>
                </div>
              </Disclosure>
              {!signed && (
                <label className="mt-3 flex items-center gap-2 text-[0.84rem] text-ink cursor-pointer">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="h-4 w-4 accent-[#B68A42]" />
                  I have reviewed these transactions
                </label>
              )}
            </>
          )}
        </Step>

        {/* 6 */}
        <Step
          n={6}
          title="Authorize it yourself"
          state={states[5]}
          summary={
            signed
              ? <>Authorized by your wallet signature, bound to this plan and strategy version.{expiresAt && !shipped ? ` Valid until ${expiresAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.` : ""}</>
              : snap.expired
                ? "Your earlier authorization expired (they last 10 minutes). Authorize again to continue."
                : <>No gas: your wallet signs the <Term k="authorization">authorization</Term> for this exact plan. Nothing can be sent without it.</>
          }
        >
          {!signed && (
            <>
              <div className="rounded-md2 border border-line bg-ivory-50 px-3.5 py-3 max-w-[760px]">
                <div className="text-[0.86rem] text-ink font-medium">Sign with your wallet</div>
                <p className="text-[0.74rem] text-ink-600 mt-1">An EIP-712 message (free) proving you control {w.address ? fmt.addr(w.address) : "the wallet"} and approve this exact plan. It moves no tokens.</p>
              </div>
              {plan && (
                <p className="mt-2 text-[0.74rem] text-ink-600 break-all max-w-[78ch]">
                  It is bound to strategy {primary?.irId ?? "—"} version <span className="tabular">{primary?.versionHash ?? "—"}</span>, plan <span className="tabular">{plan.planHash.slice(0, 18)}…</span>, action <span className="tabular">aqua:ship</span>, a single-use challenge and a 10-minute expiry. Changing any of them invalidates the authorization.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  className={BTN}
                  onClick={() => w.address && primary && p && exec.verify({ strategyId: primary.id, maker: w.address, tokenId: p.tokenId })}
                  disabled={Boolean(walletBlock) || working || !havePlan || !reviewed || stopped}
                >
                  {busy?.stage === "verify" && <Loader2 size={15} className="animate-spin" />}
                  {busy?.stage === "verify"
                    ? busy.what === "wallet"
                      ? "Waiting for your signature…"
                      : "Checking…"
                    : error?.stage === "verify"
                      ? "Try again"
                      : "Sign authorization"}
                </button>
                <span className="text-[0.74rem] text-ink-600">{walletBlock ?? (!havePlan ? "Prepare the transactions first." : !reviewed ? "Tick “I have reviewed these transactions” first." : "Nothing is sent until step 7.")}</span>
              </div>
              {error?.stage === "verify" && <Alert>{error.message}</Alert>}
            </>
          )}
          {signed && snap.auth && (
            <p className="text-[0.74rem] text-ink-600 break-all">
              Bound to version {snap.auth.strategyVersionHash ?? "—"} · plan {snap.auth.planHash?.slice(0, 18) ?? "—"}…
            </p>
          )}
        </Step>

        {/* 7 */}
        <Step
          n={7}
          title="Confirm in your wallet"
          state={states[6]}
          summary={shipped ? "Approvals and ship confirmed on Sepolia." : "Approve, then ship. Your wallet asks you to confirm each one; a confirmed step is never sent twice."}
        >
          {plan && (signed || pending) && (
            <ul className="space-y-1.5">
              {snap.approveSteps.map((st, i) => {
                const tx = snap.approvals.find((t) => t.to_addr?.toLowerCase() === st.to.toLowerCase() && t.status !== "reverted") ?? snap.approvals.filter((t) => !t.to_addr)[i] ?? null;
                const sym = tokenOf(st.approval?.token ?? st.to)?.symbol ?? "token";
                const active = busy?.stage === "execute" && busy.op === "approve" && !tx;
                return <TxLine key={i} label={`Approve exact ${sym} amount`} tx={tx} state={active ? "active" : txState(tx)} />;
              })}
              <TxLine label="Ship the order to Aqua" tx={snap.ship} state={busy?.stage === "execute" && busy.op === "ship" && !snap.ship ? "active" : txState(snap.ship)} />
            </ul>
          )}
          {!shipped && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button className={BTN} onClick={() => exec.execute()} disabled={!signed || !mine || Boolean(walletBlock) || working || pending}>
                  {(busy?.stage === "execute" || pending) && <Loader2 size={15} className="animate-spin" />}
                  {busy?.stage === "execute" ? (busy.what === "wallet" ? "Confirm in your wallet…" : "Waiting for Sepolia…") : pending ? "Confirming on Sepolia…" : error?.stage === "execute" ? "Retry execution" : "Approve and ship"}
                </button>
                <span className="text-[0.74rem] text-ink-600">{!signed ? "Available after you authorize it." : pending ? "Waiting for the pending transaction; nothing is sent twice." : walletBlock ?? "Tokens stay in your wallet until a trade fills."}</span>
              </div>
              {error?.stage === "execute" && <Alert>{error.message}</Alert>}
            </>
          )}
        </Step>

        {/* 8 */}
        <Step n={8} title="Receipt" state={states[7]} summary={shipped ? "Your strategy is live on 1inch Aqua (Sepolia)." : "Shown when the ship transaction is confirmed."}>
          {snap.ship && <Receipt tx={snap.ship} approvals={snap.approvals} />}
          {shipped && plan && <OnChainState planId={plan.id} />}
        </Step>
      </ol>

      <Disclosure className="mt-5" title="Advanced" hint="remove the strategy (dock) and the taker side">
        <div className="space-y-4">
          {shipped && plan && plan.plan.steps.some((s) => s.op === "dock") ? (
            <DockPanel planId={plan.id} step={plan.plan.steps.find((s) => s.op === "dock")!} invId={invId} disabled={Boolean(walletBlock) || !mine} />
          ) : (
            <p className="text-[0.8rem] text-ink-600"><span className="text-ink font-medium">Dock (remove the strategy):</span> available after the strategy has been shipped.</p>
          )}
          <p className="text-[0.8rem] text-ink-600">
            <span className="text-ink font-medium">Swapping against the strategy (taker side):</span> {AQUA_NOTES.takerGate} {compat?.checks.find((c) => c.key === "taker.kyc")?.detail ?? ""}
          </p>
        </div>
      </Disclosure>
    </div>
  );
}

function Receipt({ tx, approvals }: { tx: TxRow; approvals: TxRow[] }) {
  return (
    <div className="rounded-md2 border border-line bg-ivory-50 p-3.5 text-[0.82rem]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tx.status === "success" ? "forest" : tx.status === "reverted" ? "brick" : "gold"}>
          {tx.status === "success" ? "Confirmed on Sepolia" : tx.status === "reverted" ? "Reverted" : "Waiting for confirmation"}
        </Pill>
        {tx.matches_plan != null && (
          <span className={tx.matches_plan ? "text-forest" : "text-brick"}>{tx.matches_plan ? "Matches the plan you authorized" : "Does NOT match the authorized plan"}</span>
        )}
      </div>
      <dl className="mt-2 grid sm:grid-cols-3 gap-2 text-[0.78rem]">
        <div><dt className="text-ink-600">Ship transaction</dt><dd><ExplorerLink kind="tx" value={tx.tx_hash}>{fmt.hash(tx.tx_hash)}</ExplorerLink></dd></div>
        <div><dt className="text-ink-600">Block</dt><dd className="tabular text-ink">{tx.block ? Number(tx.block).toLocaleString("en-US") : "—"}</dd></div>
        <div><dt className="text-ink-600">Confirmations</dt><dd className="tabular text-ink">{tx.confirmations ?? 0}</dd></div>
      </dl>
      {tx.outcome && <div className="text-[0.74rem] text-ink-600 mt-2">{tx.outcome}</div>}
      {approvals.length > 0 && (
        <div className="text-[0.74rem] text-ink-600 mt-2 flex flex-wrap gap-x-3">
          Approvals:
          {approvals.map((a) => <ExplorerLink key={a.tx_hash} kind="tx" value={a.tx_hash}>{fmt.hash(a.tx_hash)}</ExplorerLink>)}
        </div>
      )}
    </div>
  );
}

/**
 * Step 10 of the brief: read the strategy back from Sepolia, independently of the
 * receipt. Registry virtual balances per token, plus a read-only router quote that
 * must price THIS order (same hash) inside its range. Reads only; nothing is sent.
 */
function OnChainState({ planId }: { planId: string }) {
  const q = useQuery({ queryKey: ["plan-state", planId], queryFn: () => api<StrategyState>(`/plans/${planId}/state`), staleTime: 30_000, retry: 1 });
  const s = q.data;
  const label = { active: "Active on Aqua", docked: "Docked (removed)", partly_filled: "Active, balances moved by swaps", not_shipped: "Not found on Aqua" } as const;
  return (
    <div className="mt-3 rounded-md2 border border-line bg-white p-3.5 text-[0.8rem]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink font-medium">Checked on Sepolia</span>
        {q.isLoading && <Loader2 size={14} className="animate-spin" />}
        {s && <Pill tone={s.status === "active" || s.status === "partly_filled" ? "forest" : s.status === "docked" ? "gold" : "brick"}>{label[s.status]}</Pill>}
        {s && <span className="text-ink-600 text-[0.74rem]">block {s.block.toLocaleString("en-US")}</span>}
        <button className={`${BTN_QUIET} ml-auto`} onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Reading…" : "Check again"}</button>
      </div>
      {q.error && <Alert>Could not read the strategy from Sepolia: {(q.error as Error).message}</Alert>}
      {s && (
        <ul className="mt-2 space-y-1 text-[0.76rem]">
          {s.checks.map((c) => (
            <li key={c.key} className="flex gap-2">
              <span className={c.ok ? "text-forest" : "text-brick"}>{c.ok ? <Check size={13} strokeWidth={3} className="mt-0.5" /> : <X size={13} className="mt-0.5" />}</span>
              <span className="text-ink-600 break-words min-w-0">{c.detail}</span>
            </li>
          ))}
          <li className="text-ink-600">Registry <ExplorerLink kind="address" value={s.registry} /> · router <ExplorerLink kind="address" value={s.app} /> · strategy hash <span className="break-all">{s.strategyHash}</span></li>
        </ul>
      )}
    </div>
  );
}

/**
 * Optional dock (withdraw the shipped strategy), behind its own EIP-712
 * authorization and wallet confirmation, recorded and re-verified by the server.
 */
function DockPanel({ planId, step, invId, disabled }: { planId: string; step: ExecutionPlan["steps"][number]; invId: string; disabled: boolean }) {
  const w = useSepoliaWallet();
  const qc = useQueryClient();
  const { mutateAsync: signTypedData } = useSignTypedData();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const [authId, setAuthId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "signing" | "sending" | "pending" | "done" | "reverted">("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const authorize = async () => {
    if (!w.address) return;
    setErr(null);
    setState("signing");
    try {
      const ch = await api<{ typedData: { domain: { name: string; version: string; chainId: number }; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, string> }; claims: Record<string, unknown> }>(
        `/plans/${planId}/challenge`,
        { method: "POST", body: { wallet: w.address, action: "aqua:dock" } },
      );
      const m = ch.typedData.message;
      const signature = await signTypedData({ domain: ch.typedData.domain, types: ch.typedData.types, primaryType: "Authorization", message: { ...m, chainId: BigInt(m.chainId), expiresAt: BigInt(m.expiresAt) } } as never);
      const r = await fetch(`${API_URL}/authorizations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId, claims: ch.claims, signature }) });
      const body = (await r.json()) as { authorizationId?: string; validated?: boolean; error?: string; verification?: { notes?: string[] } };
      if (!body.validated || !body.authorizationId) throw new Error(body.error ?? `The server rejected the authorization: ${body.verification?.notes?.join("; ") || "verification failed"}`);
      setAuthId(body.authorizationId);
      setState("idle");
    } catch (e) {
      setErr(walletErr(e));
      setState("idle");
    }
  };

  const dock = async () => {
    if (!authId) return;
    setErr(null);
    setState("sending");
    try {
      const h = await sendTransaction({ to: step.to as `0x${string}`, data: step.data as `0x${string}`, value: BigInt(step.value), chainId: SEPOLIA_CHAIN_ID });
      setHash(h);
      setState("pending");
      await api(`/transactions`, { method: "POST", body: { authorizationId: authId, op: "dock", txHash: h } });
      for (;;) {
        const tx = await api<TxRow>(`/transactions/${h}`).catch(() => null);
        if (tx && tx.status !== "submitted") {
          setState(tx.status === "success" ? "done" : "reverted");
          break;
        }
        await new Promise((r) => setTimeout(r, 4_000));
      }
      await qc.invalidateQueries({ queryKey: ["full", invId] });
    } catch (e) {
      setErr(walletErr(e));
      setState(hash ? "pending" : "idle");
    }
  };

  return (
    <div className="text-[0.8rem] text-ink-600">
      <div><span className="text-ink font-medium">Dock (remove the strategy from Aqua):</span> {step.description}</div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {state === "done" ? (
          <Pill tone="forest"><Check size={12} /> Docked</Pill>
        ) : !authId ? (
          <button className={BTN_QUIET} onClick={authorize} disabled={disabled || state === "signing"}>
            {state === "signing" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} {state === "signing" ? "Sign in your wallet…" : "Authorize dock"}
          </button>
        ) : (
          <button className={BTN_QUIET} onClick={dock} disabled={disabled || state === "sending" || state === "pending"}>
            {(state === "sending" || state === "pending") && <Loader2 size={14} className="animate-spin" />}
            {state === "sending" ? "Confirm in your wallet…" : state === "pending" ? "Waiting for Sepolia…" : "Dock now"}
          </button>
        )}
        {hash && <ExplorerLink kind="tx" value={hash}>{fmt.hash(hash)}</ExplorerLink>}
        {state === "reverted" && <span className="text-brick">The dock transaction reverted.</span>}
      </div>
      {err && <Alert>{err}</Alert>}
    </div>
  );
}
