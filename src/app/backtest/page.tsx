"use client";

import { ShieldCheck } from "lucide-react";
import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { LineChart, Drawdown } from "@/components/charts";
import { Card, EmptyState, ExplorerLink, Label, Pill, SectionTitle } from "@/components/ui";
import { fmt } from "@/lib/format";

const COLORS = ["#C6A66B", "#9AA88C", "#B7B0A2", "#D9C08F", "#78866B"];

export default function BacktestPage() {
  return (
    <Page>
      <InvestigationGate>
        {(full) => {
          const bt = full.backtest?.result;
          const btInfo = full.investigation.integrations.backtest;
          return (
            <>

              {!bt && (
                <div className="mt-4">
                  <EmptyState title="Backtest could not be completed">
                    {btInfo?.detail ?? "No pool with both a resolvable price history and token decimals was found for this wallet."} TRACE does not fill missing history.
                  </EmptyState>
                </div>
              )}

              {bt && bt.status === "insufficient_data" && (
                <div className="mt-4">
                  <EmptyState title="Insufficient real data for a backtest">
                    {bt.reason} Pool <ExplorerLink kind="address" value={bt.pool} /> ({bt.pair}). Many Sepolia test pools have little or no trading; positions in actively traded pools (e.g. WETH/USDC) backtest fully.
                  </EmptyState>
                </div>
              )}

              {bt && bt.status === "completed" && (
                <>
                  <Card className="mt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Label>Historical replay on real swaps</Label>
                        <div className="serif text-xl text-ink mt-1">
                          {bt.pair} · <ExplorerLink kind="address" value={bt.pool} />
                        </div>
                        <div className="text-[0.76rem] text-ink-600 mt-1">
                          Test window blocks {bt.period.fromBlock.toLocaleString("en-US")}–{bt.period.toBlock.toLocaleString("en-US")} ({fmt.tsSec(bt.period.fromTs)} → {fmt.tsSec(bt.period.toTs)}) · {bt.series.prices.length} swaps
                        </div>
                      </div>
                      <Pill tone="forest">
                        <ShieldCheck size={12} /> Look-ahead guard {bt.split.lookaheadGuard}
                      </Pill>
                    </div>
                    <div className="mt-3 text-[0.74rem] text-ink-600">
                      Train ends at block {bt.split.trainEndBlock.toLocaleString("en-US")}; test starts at {bt.split.testStartBlock.toLocaleString("en-US")} (gap {bt.split.gapBlocks} blocks). Each simulated decision uses only swaps strictly before it.
                    </div>
                  </Card>

                  <Card dark className="mt-5">
                    <SectionTitle onDark eyebrow={`Value in ${bt.assumptions.valuationToken} (start ${fmt.amt(bt.assumptions.startCapital)})`} title="Equity paths" />
                    <LineChart series={bt.series.values.map((v, i) => ({ name: v.label, data: v.points, color: COLORS[i % COLORS.length], area: i === 0 }))} />
                  </Card>

                  <Card dark className="mt-5">
                    <SectionTitle onDark eyebrow={`${bt.pair} — real swap prices (token1 per token0)`} title="Pool price" />
                    <LineChart legend={false} series={[{ name: "Price", data: bt.series.prices, color: "#B68A42", area: true }]} />
                  </Card>

                  <SectionTitle eyebrow="Observed activity vs simulated strategies, clearly separated" title="Results" />
                  <Card pad={false} className="overflow-x-auto">
                    <table className="w-full text-[0.8rem] min-w-[820px]">
                      <thead className="text-left">
                        <tr className="border-b border-ink/10">
                          {["Run", "Type", "Net", "Max DD", "Fees", "IL", "In range", "Out of range", "Rebalances", "Gas (ETH)"].map((h) => (
                            <th key={h} className="px-4 py-2.5 label font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bt.runs.map((r) => (
                          <tr key={r.label} className="border-b border-ink/6">
                            <td className="px-4 py-2.5 text-ink font-medium">{r.label}</td>
                            <td className="px-4 py-2.5"><Pill tone={r.kind === "observed" ? "sage" : r.kind === "counterfactual" ? "gold" : "neutral"}>{r.kind}</Pill></td>
                            <td className={`px-4 py-2.5 tabular ${r.net >= 0 ? "text-forest" : "text-brick"}`}>{fmt.pct(r.net * 100)}</td>
                            <td className="px-4 py-2.5 tabular">{fmt.frac(r.maxDrawdown, 2)}</td>
                            <td className="px-4 py-2.5 tabular">{fmt.amt(r.feesEarned)} {bt.assumptions.valuationToken}</td>
                            <td className="px-4 py-2.5 tabular">{r.impermanentLoss == null ? "—" : fmt.frac(r.impermanentLoss, 2)}</td>
                            <td className="px-4 py-2.5 tabular">{fmt.frac(r.rangeOccupancy, 0)}</td>
                            <td className="px-4 py-2.5 tabular">{r.outOfRangeHours == null ? "—" : `${r.outOfRangeHours.toFixed(1)} h`}</td>
                            <td className="px-4 py-2.5 tabular">{r.rebalances}</td>
                            <td className="px-4 py-2.5 tabular">{r.gasCost ? r.gasCost.toFixed(6) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>

                  {bt.series.values[0] && (
                    <Card dark className="mt-5">
                      <SectionTitle onDark eyebrow={bt.series.values[0].label} title="Drawdown" />
                      <Drawdown
                        data={(() => {
                          let peak = -Infinity;
                          return bt.series.values[0].points.map((v) => {
                            peak = Math.max(peak, v);
                            return peak > 0 ? -(peak - v) / peak : 0;
                          });
                        })()}
                      />
                    </Card>
                  )}

                  <SectionTitle eyebrow="Explicit assumptions" title="Methodology" />
                  <Card>
                    <ul className="text-[0.82rem] text-ink-600 space-y-1.5 list-disc pl-5 break-anywhere">
                      <li><span className="text-ink">Prices:</span> {bt.assumptions.priceSource}</li>
                      <li><span className="text-ink">Fees:</span> {bt.assumptions.feeModel}</li>
                      <li><span className="text-ink">Gas:</span> {bt.assumptions.gasModel}</li>
                      <li><span className="text-ink">Slippage on counterfactual rebalances:</span> {fmt.frac(bt.assumptions.slippagePct, 2)}</li>
                      <li><span className="text-ink">Start capital:</span> {fmt.amt(bt.assumptions.startCapital)} {bt.assumptions.valuationToken} (sized from the wallet&apos;s real deposit in the basis position)</li>
                      <li>Testnet prices and volumes are not representative of mainnet markets; results describe this Sepolia pool only.</li>
                    </ul>
                  </Card>
                </>
              )}
            </>
          );
        }}
      </InvestigationGate>
    </Page>
  );
}
