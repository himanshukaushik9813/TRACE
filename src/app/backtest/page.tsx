"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { LineChart, Drawdown } from "@/components/charts";
import { Card, EmptyState, ErrorState, ExplorerLink, Label, Pill, SectionTitle } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { NextStep } from "@/components/next-step";
import { MarkStep } from "@/components/welcome";
import { Term } from "@/components/term";
import { fmt } from "@/lib/format";
import { api, withInv, type BacktestResult, type BacktestRun } from "@/lib/api";

const COLORS = ["#C6A66B", "#9AA88C", "#B7B0A2", "#D9C08F", "#78866B"];
const WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

const isPassive = (r: BacktestRun) => r.kind === "benchmark" && r.label.startsWith("Passive LP");
const isHold = (r: BacktestRun) => r.kind === "benchmark" && r.label.startsWith("Buy & hold");
const pct = (v: number) => fmt.pct(v * 100);

/** One headline comparison card: return first, then fees, drawdown, utilization. */
function RunCard({ title, plain, run, token, observed }: { title: React.ReactNode; plain: string; run: BacktestRun; token: string; observed: boolean }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[0.95rem] font-semibold text-ink">{title}</div>
        {observed ? (
          <Pill tone="sage"><Term k="observed">Observed</Term></Pill>
        ) : (
          <Pill tone="neutral"><Term k="simulated">Simulated</Term></Pill>
        )}
      </div>
      <p className="text-[0.76rem] text-ink-600 mt-1 leading-snug">{plain}</p>
      <div className={`mt-3 text-[2rem] leading-none font-semibold tabular ${run.net >= 0 ? "text-forest" : "text-[#B4553D]"}`}>{pct(run.net)}</div>
      <div className="text-[0.72rem] text-ink-600 mt-1">net return over the test period</div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[0.76rem] border-t border-line pt-3">
        <div>
          <dt className="text-ink-600"><Term k="feesCollected">Fees</Term></dt>
          <dd className="tabular text-ink font-medium mt-0.5">{run.feesEarned ? `${fmt.amt(run.feesEarned)} ${token}` : "none"}</dd>
        </div>
        <div>
          <dt className="text-ink-600"><Term k="drawdown">Max drop</Term></dt>
          <dd className="tabular text-ink font-medium mt-0.5">{fmt.frac(run.maxDrawdown, 1)}</dd>
        </div>
        <div>
          <dt className="text-ink-600"><Term k="capitalUtilization">Money at work</Term></dt>
          <dd className="tabular text-ink font-medium mt-0.5">{fmt.frac(run.capitalUtilization, 0)}</dd>
        </div>
      </dl>
    </Card>
  );
}

type WhatIfResponse = { simulation: true; label: string; inputs: { startCapital: number; slippagePct: number; widthMultiplier: number; recentre: boolean | null }; baseline: BacktestResult; whatIf: BacktestResult };

function WhatIf({ inv, bt }: { inv: string; bt: BacktestResult }) {
  const token = bt.assumptions.valuationToken;
  const cfBase = bt.runs.find((r) => r.kind === "counterfactual");
  const defaultRecentre = cfBase?.label.includes("re-centre") ?? false;
  const [capital, setCapital] = useState(String(Number(bt.assumptions.startCapital.toPrecision(6))));
  const [widthIdx, setWidthIdx] = useState(WIDTHS.indexOf(1));
  const [recentre, setRecentre] = useState(defaultRecentre);
  const [slip, setSlip] = useState(String(+(bt.assumptions.slippagePct * 100).toFixed(3)));
  const m = useMutation({
    mutationFn: () =>
      api<WhatIfResponse>(`/investigations/${inv}/whatif`, {
        method: "POST",
        body: { startCapital: Number(capital), slippagePct: Number(slip) / 100, widthMultiplier: WIDTHS[widthIdx], recentre },
      }),
  });
  const capOk = Number(capital) > 0;
  const slipOk = slip !== "" && Number(slip) >= 0 && Number(slip) <= 10;
  const w = WIDTHS[widthIdx];
  const cf = (r: BacktestResult) => r.runs.find((x) => x.kind === "counterfactual");
  const series = (r: BacktestResult) => r.series.values.find((v) => v.label === cf(r)?.label)?.points ?? [];

  return (
    <Card className="mt-5" aria-labelledby="whatif-title">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical size={17} className="text-gold" aria-hidden />
        <h2 id="whatif-title" className="serif text-[1.35rem] text-ink">What if…?</h2>
        <Pill tone="amber">Simulation, not observed</Pill>
      </div>
      <p className="text-[0.84rem] text-ink-600 mt-1.5 max-w-[72ch] leading-relaxed">
        Change the strategy&apos;s settings and replay it on the same real swaps. Only the strategy run changes; nothing here happened on-chain, and nothing is saved.
      </p>

      <form
        className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (capOk && slipOk) m.mutate();
        }}
      >
        <label className="text-[0.8rem] text-ink-600">
          Starting money ({token})
          <input type="number" inputMode="decimal" min="0" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} className="mt-1 h-10 w-full rounded-md2 border border-line bg-white px-3 text-[0.9rem] text-ink tabular focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40" aria-invalid={!capOk} />
        </label>
        <label className="text-[0.8rem] text-ink-600">
          <Term k="priceRange">Range width</Term>: <span className="text-ink font-medium tabular">{w}×</span> {w === 1 ? "(the wallet's own)" : w < 1 ? "(narrower)" : "(wider)"}
          <input type="range" min={0} max={WIDTHS.length - 1} step={1} value={widthIdx} onChange={(e) => setWidthIdx(Number(e.target.value))} className="mt-3 w-full accent-[#B68A42]" aria-valuetext={`${w} times the wallet's width`} />
          <span className="flex justify-between text-[0.68rem] text-ink-600"><span>0.25×</span><span>8×</span></span>
        </label>
        <label className="text-[0.8rem] text-ink-600">
          Cost per range move (%)
          <input type="number" inputMode="decimal" min="0" max="10" step="0.05" value={slip} onChange={(e) => setSlip(e.target.value)} className="mt-1 h-10 w-full rounded-md2 border border-line bg-white px-3 text-[0.9rem] text-ink tabular focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40" aria-invalid={!slipOk} />
          <span className="text-[0.68rem]">slippage paid each time the range is moved</span>
        </label>
        <div className="text-[0.8rem] text-ink-600">
          <label className="flex items-center gap-2 mt-6 cursor-pointer">
            <input type="checkbox" checked={recentre} onChange={(e) => setRecentre(e.target.checked)} className="h-4 w-4 accent-[#B68A42]" />
            Move the range back around the price when it leaves
          </label>
          <span className="text-[0.68rem] block mt-1">The inferred strategy {defaultRecentre ? "does this" : "does not do this"}.</span>
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!capOk || !slipOk || m.isPending} className="inline-flex items-center gap-2 rounded-md2 bg-gold text-white px-4 h-10 text-[0.86rem] font-medium hover:bg-[#A67C38] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50">
            {m.isPending && <Loader2 size={15} className="animate-spin" />} Run simulation
          </button>
          <button
            type="button"
            className="text-[0.8rem] text-ink-600 hover:text-ink underline-offset-2 hover:underline"
            onClick={() => {
              setCapital(String(Number(bt.assumptions.startCapital.toPrecision(6))));
              setWidthIdx(WIDTHS.indexOf(1));
              setRecentre(defaultRecentre);
              setSlip(String(+(bt.assumptions.slippagePct * 100).toFixed(3)));
              m.reset();
            }}
          >
            Reset to the strategy&apos;s settings
          </button>
          {!capOk && <span className="text-[0.76rem] text-[#B4553D]">Enter a starting amount above 0.</span>}
          {!slipOk && <span className="text-[0.76rem] text-[#B4553D]">Cost must be between 0 and 10 %.</span>}
        </div>
      </form>

      {m.isError && <div className="mt-4"><ErrorState message={(m.error as Error).message} /></div>}
      {m.data && (() => {
        const a = cf(m.data.baseline);
        const b = cf(m.data.whatIf);
        if (m.data.whatIf.status !== "completed" || !a || !b) return <div className="mt-4"><EmptyState title="The simulation could not run">{m.data.whatIf.reason ?? "Not enough real swaps in the window."}</EmptyState></div>;
        const rows: { label: React.ReactNode; a: string; b: string; better: boolean | null }[] = [
          { label: "Net return", a: pct(a.net), b: pct(b.net), better: b.net === a.net ? null : b.net > a.net },
          { label: <Term k="feesCollected">Fees earned</Term>, a: `${fmt.amt(a.feesEarned)} ${token}`, b: `${fmt.amt(b.feesEarned)} ${token}`, better: b.feesEarned === a.feesEarned ? null : b.feesEarned > a.feesEarned },
          { label: <Term k="drawdown">Max drop</Term>, a: fmt.frac(a.maxDrawdown, 1), b: fmt.frac(b.maxDrawdown, 1), better: b.maxDrawdown === a.maxDrawdown ? null : b.maxDrawdown < a.maxDrawdown },
          { label: <Term k="inRange">Time in range</Term>, a: fmt.frac(a.rangeOccupancy, 0), b: fmt.frac(b.rangeOccupancy, 0), better: (b.rangeOccupancy ?? 0) === (a.rangeOccupancy ?? 0) ? null : (b.rangeOccupancy ?? 0) > (a.rangeOccupancy ?? 0) },
          { label: "Range moves", a: String(a.rebalances), b: String(b.rebalances), better: null },
          { label: <Term k="capitalUtilization">Money at work</Term>, a: fmt.frac(a.capitalUtilization, 0), b: fmt.frac(b.capitalUtilization, 0), better: null },
        ];
        return (
          <div className="mt-5" aria-live="polite">
            <div className="rounded-md2 border border-amber/30 bg-amber/5 px-3.5 py-2 text-[0.78rem] text-ink">
              {m.data.label}. Both columns replay the same {m.data.whatIf.series.prices.length} real swaps with {fmt.amt(m.data.inputs.startCapital)} {token} and {fmt.frac(m.data.inputs.slippagePct, 2)} cost per move.
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[0.86rem] min-w-[460px]">
                <thead>
                  <tr className="text-left text-ink-600 border-b border-ink/10">
                    <th className="py-2 pr-3 font-medium">&nbsp;</th>
                    <th className="py-2 pr-3 font-medium">Strategy as inferred</th>
                    <th className="py-2 font-medium">Your settings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-ink/6">
                      <td className="py-2 pr-3 text-ink-600">{r.label}</td>
                      <td className="py-2 pr-3 tabular text-ink">{r.a}</td>
                      <td className={`py-2 tabular font-semibold ${r.better == null ? "text-ink" : r.better ? "text-forest" : "text-[#B4553D]"}`}>{r.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <LineChart
                series={[
                  { name: "Strategy as inferred (simulated)", data: series(m.data.baseline), color: "#B7B0A2" },
                  { name: "Your settings (simulated)", data: series(m.data.whatIf), color: "#B68A42", area: true },
                ]}
                height={200}
              />
            </div>
          </div>
        );
      })()}
    </Card>
  );
}

export default function BacktestPage() {
  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => {
          const bt = full.backtest?.result;
          const btInfo = full.investigation.integrations.backtest;
          const token = bt?.assumptions.valuationToken ?? "";
          const observed = bt?.runs.find((r) => r.kind === "observed");
          const passive = bt?.runs.find(isPassive);
          const hold = bt?.runs.find(isHold);
          const inferred = bt?.runs.find((r) => r.kind === "counterfactual");
          const primary = full.strategies.find((x) => x.id === full.primaryStrategyId);
          return (
            <>
              <header className="mb-4">
                <div className="label"><Term k="backtest">Backtest</Term></div>
                <h1 className="serif text-2xl md:text-3xl text-ink mt-1">How did this strategy perform?</h1>
              </header>

              {!bt && (
                <EmptyState title="Backtest could not be completed">
                  {btInfo?.detail ?? "No pool with both a resolvable price history and token decimals was found for this wallet."} TRACE does not fill missing history.
                </EmptyState>
              )}

              {bt && bt.status === "insufficient_data" && (
                <EmptyState title="Insufficient real data for a backtest">
                  {bt.reason} Pool <ExplorerLink kind="address" value={bt.pool} /> ({bt.pair}). Many Sepolia test pools have little or no trading; positions in actively traded pools (e.g. WETH/USDC) backtest fully.
                </EmptyState>
              )}

              {bt && bt.status === "completed" && (
                <>
                  <p className="text-[0.9rem] text-ink-600 max-w-[74ch] leading-relaxed">
                    TRACE replayed {bt.series.prices.length} real swaps in the {bt.pair} pool on Sepolia, from {fmt.tsSec(bt.period.fromTs)} to {fmt.tsSec(bt.period.toTs)}. Each line starts with the same{" "}
                    {fmt.amt(bt.assumptions.startCapital)} {token}, sized from the wallet&apos;s real deposit. Only prices known at each moment are used.
                  </p>

                  <div className="mt-5 grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {observed && <RunCard title="This wallet" plain="The wallet's own price ranges, held when it held them." run={observed} token={token} observed />}
                    {inferred && <RunCard title="Inferred strategy" plain="What the inferred rules would have done on the same swaps (simulated)." run={inferred} token={token} observed={false} />}
                    {passive && <RunCard title={<Term k="passiveLp">Passive LP</Term>} plain="The wallet's starting range, never touched." run={passive} token={token} observed={false} />}
                    {hold && <RunCard title={<Term k="buyHold">Buy and hold</Term>} plain="Half in each token, no liquidity provided." run={hold} token={token} observed={false} />}
                  </div>
                  <p className="text-[0.76rem] text-ink-600 mt-2.5 max-w-[80ch]">
                    More fees do not always mean a better result: when the price moves, the tokens inside a position change value too (<Term k="impermanentLoss">impermanent loss</Term>). Testnet prices are not mainnet prices; these results describe this Sepolia pool only.
                  </p>

                  <Card className="mt-5">
                    <SectionTitle eyebrow={`Value in ${token}, from the same starting capital`} title="Fee and capital breakdown" />
                    <div className="overflow-x-auto">
                      <table className="w-full text-[0.8rem] min-w-[760px]">
                        <thead className="text-left text-ink-600">
                          <tr>
                            {["Run", "Start", "+ Fees earned", "− Slippage", "± Price and range effect", "= End", "Net", "Gas (ETH, separate)"].map((h) => (
                              <th key={h} className="px-3 py-2 font-normal">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bt.runs.map((r) => {
                            const start = bt.assumptions.startCapital;
                            const slip = r.slippageCost;
                            // Residual: everything the fees and slippage do not explain (price moves, impermanent loss, time out of range).
                            const effect = slip == null ? null : r.finalValue - start - r.feesEarned + slip;
                            return (
                              <tr key={r.label} className="border-t border-line">
                                <td className="px-3 py-2 text-ink">{r.label}<div className="text-[0.7rem] text-ink-600">{r.kind === "observed" ? "observed replay" : r.kind === "counterfactual" ? "simulation" : "benchmark"}</div></td>
                                <td className="px-3 py-2 tabular">{fmt.amt(start)}</td>
                                <td className="px-3 py-2 tabular">{fmt.amt(r.feesEarned)}</td>
                                <td className="px-3 py-2 tabular">{slip == null ? "not recorded" : fmt.amt(slip)}</td>
                                <td className={`px-3 py-2 tabular ${effect == null ? "" : effect >= 0 ? "text-forest" : "text-brick"}`}>{effect == null ? "—" : `${effect >= 0 ? "+" : "−"}${fmt.amt(Math.abs(effect))}`}</td>
                                <td className="px-3 py-2 tabular text-ink">{fmt.amt(r.finalValue)}</td>
                                <td className={`px-3 py-2 tabular ${r.net >= 0 ? "text-forest" : "text-brick"}`}>{pct(r.net)}</td>
                                <td className="px-3 py-2 tabular">{r.gasCost ? r.gasCost.toFixed(6) : r.kind === "observed" ? "none in test window" : "not modelled"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[0.72rem] text-ink-600 mt-3 max-w-[85ch]">
                      End = Start + Fees − Slippage ± Price and range effect. The ± column is what fees and slippage do not explain: price moves, impermanent loss and time out of range.
                      Gas is paid in ETH, so it is shown separately and not deducted. Results belong to strategy version <span className="tabular text-ink">{bt.strategyId}</span>
                      {primary ? ` (hash ${primary.versionHash})` : ""}; a changed strategy gets a new version and a new backtest.
                    </p>
                  </Card>

                  <Card className="mt-5">
                    <SectionTitle eyebrow={`Value in ${token}; the solid line is observed, dashed lines are simulated`} title="Value over time" />
                    <LineChart
                      series={bt.series.values.map((v, i) => {
                        const run = bt.runs.find((r) => r.label === v.label);
                        return { name: `${run?.kind === "observed" ? "Observed" : "Simulated"} · ${v.label}`, data: v.points, color: COLORS[i % COLORS.length], area: run?.kind === "observed", dashed: run?.kind !== "observed" };
                      })}
                    />
                  </Card>

                  <WhatIf inv={inv} bt={bt} />

                  <Disclosure className="mt-5" title="Advanced metrics" hint="full results table, train/test split, pool price, drawdown, methodology">
                    <div className="space-y-5">
                      <div className="overflow-x-auto rounded-md2 border border-line bg-white">
                        <table className="w-full text-[0.8rem] min-w-[900px]">
                          <thead className="text-left">
                            <tr className="border-b border-ink/10">
                              {["Run", "Type", "Net", "Max DD", "Fees", "IL", "In range", "Out of range", "Capital utilization", "Rebalances", "Gas (ETH)"].map((h) => (
                                <th key={h} className="px-3 py-2.5 label font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {bt.runs.map((r) => (
                              <tr key={r.label} className="border-b border-ink/6">
                                <td className="px-3 py-2.5 text-ink font-medium">{r.label}</td>
                                <td className="px-3 py-2.5"><Pill tone={r.kind === "observed" ? "sage" : r.kind === "counterfactual" ? "gold" : "neutral"}>{r.kind === "observed" ? "observed" : r.kind === "counterfactual" ? "simulation" : "benchmark"}</Pill></td>
                                <td className={`px-3 py-2.5 tabular ${r.net >= 0 ? "text-forest" : "text-brick"}`}>{pct(r.net)}</td>
                                <td className="px-3 py-2.5 tabular">{fmt.frac(r.maxDrawdown, 2)}</td>
                                <td className="px-3 py-2.5 tabular">{fmt.amt(r.feesEarned)} {token}</td>
                                <td className="px-3 py-2.5 tabular">{r.impermanentLoss == null ? "—" : fmt.frac(r.impermanentLoss, 2)}</td>
                                <td className="px-3 py-2.5 tabular">{fmt.frac(r.rangeOccupancy, 0)}</td>
                                <td className="px-3 py-2.5 tabular">{r.outOfRangeHours == null ? "—" : `${r.outOfRangeHours.toFixed(1)} h`}</td>
                                <td className="px-3 py-2.5 tabular">{fmt.frac(r.capitalUtilization, 0)}</td>
                                <td className="px-3 py-2.5 tabular">{r.rebalances}</td>
                                <td className="px-3 py-2.5 tabular">{r.gasCost ? r.gasCost.toFixed(6) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-wrap items-start gap-3 text-[0.78rem] text-ink-600">
                        <Pill tone="forest"><ShieldCheck size={12} /> Look-ahead guard {bt.split.lookaheadGuard}</Pill>
                        <span>
                          Train ends at block {bt.split.trainEndBlock.toLocaleString("en-US")}; test starts at {bt.split.testStartBlock.toLocaleString("en-US")} (gap {bt.split.gapBlocks} blocks). Each simulated decision uses only swaps strictly before it. Pool <ExplorerLink kind="address" value={bt.pool} />, test blocks {bt.period.fromBlock.toLocaleString("en-US")}–{bt.period.toBlock.toLocaleString("en-US")}.
                        </span>
                      </div>

                      <div>
                        <Label>{bt.pair}: real swap prices (token1 per token0)</Label>
                        <LineChart legend={false} height={180} series={[{ name: "Price", data: bt.series.prices, color: "#B68A42", area: true }]} />
                      </div>

                      {bt.series.values[0] && (
                        <div>
                          <Label>Drawdown: {bt.series.values[0].label}</Label>
                          <Drawdown
                            data={(() => {
                              let peak = -Infinity;
                              return bt.series.values[0].points.map((v) => {
                                peak = Math.max(peak, v);
                                return peak > 0 ? -(peak - v) / peak : 0;
                              });
                            })()}
                          />
                        </div>
                      )}

                      <div>
                        <Label>Methodology and assumptions</Label>
                        <ul className="mt-1.5 text-[0.8rem] text-ink-600 space-y-1.5 list-disc pl-5 break-anywhere">
                          <li><span className="text-ink">Prices:</span> {bt.assumptions.priceSource}</li>
                          <li><span className="text-ink">Fees:</span> {bt.assumptions.feeModel}</li>
                          <li><span className="text-ink">Gas:</span> {bt.assumptions.gasModel}</li>
                          <li><span className="text-ink">Slippage on simulated rebalances:</span> {fmt.frac(bt.assumptions.slippagePct, 2)}</li>
                          <li><span className="text-ink">Start capital:</span> {fmt.amt(bt.assumptions.startCapital)} {token} (sized from the wallet&apos;s real deposit in the basis position)</li>
                          <li><span className="text-ink">Simulated strategy:</span> {bt.runs.find((r) => r.kind === "counterfactual")?.label ?? "—"}, centred on the last training price.</li>
                        </ul>
                      </div>
                    </div>
                  </Disclosure>
                </>
              )}
              <MarkStep step="viewedBacktest" />
              <NextStep href={withInv("/execute", inv)} title="Run this strategy on 1inch Aqua" label="Open Execute">
                A guided, step-by-step flow: check compatibility, review the exact transactions, then approve each one in your own wallet.
              </NextStep>
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
