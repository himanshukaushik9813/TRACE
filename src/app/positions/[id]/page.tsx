"use client";

import { useState } from "react";
import {
  Layers,
  Minus,
  Plus,
  Coins,
  ArrowLeftRight,
  Flame,
  ExternalLink,
  ScanSearch,
  Box,
  Boxes,
  CircleDollarSign,
  Scale,
} from "lucide-react";
import { Page } from "@/components/page";
import { Card, Label, SectionTitle, Pill, DemoBadge, Stat, Drawer, Tabs } from "@/components/ui";
import { RangeBand } from "@/components/charts";
import { TokenPair } from "@/components/investigate";
import { POSITIONS, LIFECYCLE, ACCOUNTING, DEMO } from "@/lib/fixture";
import { art } from "@/lib/assets";
import { fmt } from "@/lib/format";

// Price series for the range-band chart (deterministic, labelled fixture).
function priceSeries(): number[] {
  const s: number[] = [];
  for (let i = 0; i < 140; i++) {
    // oscillate between ~2950 and ~3980 to cross the band edges
    const t = i / 140;
    const base = 3400 + Math.sin(t * Math.PI * 4.2) * 320 + Math.sin(t * Math.PI * 11) * 120;
    s.push(base);
  }
  return s;
}

export default function PositionPage({ params }: { params: { id: string } }) {
  const p = POSITIONS.find((x) => x.id === params.id) ?? POSITIONS[0];
  const [tab, setTab] = useState<"chart" | "lifecycle">("chart");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<(typeof LIFECYCLE)[number] | null>(null);

  const price = priceSeries();
  const events = LIFECYCLE.map((e, i) => ({ i: i * 20 }));

  return (
    <Page>
      <DemoBanner />

      {/* Position header */}
      <div className="flex flex-wrap items-center gap-4">
        <TokenPair a={p.tokens[0]} b={p.tokens[1]} colors={p.tokenColors} size={40} />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="serif text-2xl md:text-3xl text-ink">{p.tokenPair}</h1>
            <Pill tone={p.status === "Active" ? "sage" : "neutral"}>{p.status}</Pill>
          </div>
          <div className="text-[0.8rem] text-ink-600 tabular mt-1">
            NFT #{p.nftId} · {p.feeTier} · Pool {fmt.addr(p.pool)} · owner {fmt.addr(DEMO.wallet.address)}
          </div>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-2 text-[0.72rem] text-ink-600">
            <span className="tabular">Block range 21,834,102 → 22,201,777</span>
            <Pill tone="neutral">{fmt.block(21_834_102)}–{fmt.block(22_201_777)}</Pill>
          </div>
        </div>
      </div>

      {/* Main chart surface (dark) */}
      <div className="mt-6 grid lg:grid-cols-[1fr_260px] gap-5">
        <Card dark pad={false} className="p-5 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div>
              <Label onDark>Price · liquidity range</Label>
              <div className="serif text-lg text-cream mt-1">Range occupancy</div>
            </div>
            <Tabs
              onDark
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "chart", label: "Occupancy" },
                { id: "lifecycle", label: "Lifecycle" },
              ]}
            />
          </div>
          {tab === "chart" ? (
            <div className="rounded-md2 bg-charcoal-800/60 border border-cream/10 p-3">
              <RangeBand price={price} lo={p.rangeLo} hi={p.rangeHi} events={events} height={300} />
            </div>
          ) : (
            <LifecycleStrip p={p} onSelect={(e) => { setSel(e); setOpen(true); }} />
          )}
          <div className="mt-4 flex flex-wrap gap-6 pt-4 border-t border-cream/10">
            <Stat onDark label="Lower boundary" value={fmt.num(p.rangeLo, p.rangeLo < 100 ? 1 : 0)} />
            <Stat onDark label="Upper boundary" value={fmt.num(p.rangeHi, p.rangeHi < 100 ? 1 : 0)} />
            <Stat onDark label="Liquidity" value={p.status === "Active" ? fmt.num(p.liquidity) : "0"} sub={p.status === "Active" ? "in range" : "position closed"} />
            <Stat onDark label="Current price" value={fmt.num(p.lastPrice, p.lastPrice < 100 ? 2 : 0)} sub={p.inRange ? "in range" : "out of range"} />
          </div>
        </Card>

        {/* Accounting side */}
        <div className="space-y-5">
          <Card pad={false} className="p-5">
            <Label>Position accounting</Label>
            <div className="text-[0.72rem] text-ink-600 mt-1 mb-3">Principal and fees are kept distinct.</div>
            <div className="space-y-3">
              <AcctRow icon={Box} label="Deposited principal" value={fmt.usd(ACCOUNTING.deposited)} />
              <AcctRow icon={Boxes} label="Withdrawn principal" value={fmt.usd(ACCOUNTING.withdrawn)} tone="amber" />
              <AcctRow icon={Coins} label="Collected fees" value={"$" + ACCOUNTING.collectedFees.toLocaleString()} tone="sage" />
              <AcctRow icon={CircleDollarSign} label="Est. unrealised fees" value={"$" + ACCOUNTING.estimatedUnrealised.toLocaleString()} sub="estimated" />
              <AcctRow icon={Scale} label="Remaining liquidity" value={fmt.num(ACCOUNTING.remainingLiquidity)} />
            </div>
            <div className="mt-4 rounded-md2 bg-amber/8 border border-amber/20 p-2.5 text-[0.72rem] text-amber">
              Principal withdrawals are never relabelled as fees. Data marked “estimated” is an upper-bound estimate pending full gas modelling.
            </div>
          </Card>

          <Card dark pad={false} className="p-5 relative overflow-hidden">
            <img src={art.liquidityRange} alt="" aria-hidden className="absolute -right-4 -bottom-4 w-40 opacity-25 mix-blend-screen" />
            <div className="relative">
              <Label onDark>Range profile</Label>
              <div className="text-cream text-[0.82rem] mt-2 leading-relaxed">
                Wide 24% range (3,080–3,920). Moderate liquidity concentration, high persistence.
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Lifecycle timeline */}
      <Lifecycle p={p} onSelect={(e) => { setSel(e); setOpen(true); }} />

      {/* Evidence drawer */}
      <Drawer open={open} onClose={() => setOpen(false)} title="Transaction evidence">
        {sel ? (
          <EvidencePanel e={sel} p={p} />
        ) : (
          <div className="text-ink-600 text-sm">Select a lifecycle event to inspect its evidence.</div>
        )}
      </Drawer>
    </Page>
  );
}

function DemoBanner() {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-[0.78rem] text-ink-600 flex items-center gap-2">
        <ScanSearch size={15} className="text-gold" />
        Position reconstruction · <span className="text-ink font-medium">{DEMO.wallet.display}</span>
      </div>
      <DemoBadge />
    </div>
  );
}

function AcctRow({ icon: Icon, label, value, sub, tone = "neutral" }: { icon: any; label: string; value: string; sub?: string; tone?: "neutral" | "amber" | "sage" }) {
  const c = tone === "amber" ? "text-amber" : tone === "sage" ? "text-forest" : "text-ink";
  return (
    <div className="flex items-center gap-3">
      <Icon size={15} className="text-ink-600" />
      <span className="text-[0.8rem] text-ink-600 flex-1">{label}</span>
      <span className={`text-[0.9rem] font-semibold tabular ${c}`}>{value}</span>
      {sub && <span className="text-[0.62rem] text-ink-600/70 uppercase tracking-wide">{sub}</span>}
    </div>
  );
}

/* Lifecycle — full detail timeline */
const TYPE_ICON: Record<string, any> = { MINT: Plus, INCREASE: Layers, DECREASE: Minus, COLLECT: Coins, TRANSFER: ArrowLeftRight, BURN: Flame };

function Lifecycle({ p, onSelect }: { p: (typeof POSITIONS)[number]; onSelect: (e: (typeof LIFECYCLE)[number]) => void }) {
  return (
    <section className="mt-6">
      <SectionTitle eyebrow="Lifecycle timeline" title="Observed events only" action={<span className="text-[0.72rem] text-ink-600 tabular">{LIFECYCLE.length} of {p.status === "Active" ? "…" : "+BURN"}</span>} />
      <div className="rounded-panel border border-ink/10 bg-ivory-50 overflow-hidden">
        {/* lifecycle icon strip (generated asset, supporting artwork) */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-ivory border-b border-ink/8">
          <div className="flex items-center gap-2 text-[0.7rem] text-ink-600">
            <img src={art.lifecycle} alt="" className="h-9 opacity-90" />
            <span className="tabular tracking-wide2 uppercase text-[0.62rem]">Mint → Increase → Decrease → Collect → Transfer → Burn</span>
          </div>
          <span className="text-[0.66rem] text-ink-600/70">Only events that actually occurred are shown</span>
        </div>
        <div className="divide-y divide-ink/8">
          {LIFECYCLE.map((e, i) => {
            const Icon = TYPE_ICON[e.type];
            return (
              <button key={i} onClick={() => onSelect(e)} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-ivory text-left transition-colors">
                <div className="h-9 w-9 grid place-items-center rounded-md border border-ink/10 bg-ivory text-ink-600 shrink-0">
                  <Icon size={16} />
                </div>
                <div className="w-28 shrink-0">
                  <div className="text-[0.82rem] font-semibold text-ink">{e.type}</div>
                  <div className="text-[0.66rem] text-ink-600">{e.ts}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.85rem] text-ink">{e.note}</div>
                  {e.tokens && <div className="text-[0.72rem] text-ink-600 mt-0.5">{e.tokens}</div>}
                </div>
                <div className="text-right shrink-0 w-24 hidden sm:block">
                  <div className="text-[0.78rem] tabular text-ink font-medium">
                    {e.liquidityDelta > 0 ? "+" : ""}{e.liquidityDelta || "—"}
                  </div>
                  <div className="text-[0.62rem] text-ink-600">liquidity</div>
                </div>
                <div className="shrink-0 flex items-center gap-1 text-[0.68rem] text-gold font-medium">
                  {fmt.hash(e.tx)} <ExternalLink size={12} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Compact inline lifecycle for the tab view. */
function LifecycleStrip({ p, onSelect }: { p: (typeof POSITIONS)[number]; onSelect: (e: (typeof LIFECYCLE)[number]) => void }) {
  return (
    <div className="space-y-1.5">
      {LIFECYCLE.map((e, i) => {
        const Icon = TYPE_ICON[e.type];
        return (
          <button key={i} onClick={() => onSelect(e)} className="w-full flex items-center gap-3 rounded-md2 border border-cream/10 bg-charcoal-800/50 px-3 py-2.5 hover:border-gold/40 transition-colors text-left">
            <Icon size={15} className="text-gold-300 shrink-0" />
            <span className="text-cream text-[0.82rem] flex-1">{e.type} · {e.note}</span>
            <span className="text-[0.68rem] text-cream-muted tabular">{e.ts}</span>
          </button>
        );
      })}
    </div>
  );
}

function EvidencePanel({ e, p }: { e: (typeof LIFECYCLE)[number]; p: (typeof POSITIONS)[number] }) {
  const Icon = TYPE_ICON[e.type];
  const rows: [string, string][] = [
    ["Event", e.type],
    ["Transaction", e.tx],
    ["Block", e.block.toLocaleString()],
    ["Timestamp", e.ts],
    ["Position NFT", "#" + p.nftId],
    ["Pool", fmt.addr(p.pool)],
    ["Liquidity Δ", (e.liquidityDelta > 0 ? "+" : "") + (e.liquidityDelta || "0")],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 grid place-items-center rounded-md bg-gold/12 text-gold border border-gold/30"><Icon size={18} /></div>
        <div>
          <div className="serif text-lg text-ink">{e.type} event</div>
          <div className="text-[0.74rem] text-ink-600">{p.tokenPair} · NFT #{p.nftId}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-md2 bg-ivory border border-ink/8 p-3">
            <Label>{k}</Label>
            <div className="text-[0.86rem] text-ink font-medium mt-1 tabular break-all">{v}</div>
          </div>
        ))}
      </div>
      {e.tokens && (
        <div>
          <Label>Token amounts</Label>
          <div className="text-[0.85rem] text-ink mt-1">{e.tokens}</div>
        </div>
      )}
      <div className="rounded-md2 bg-forest/8 border border-forest/20 p-3 text-[0.76rem] text-forest">
        Data source: Uniswap V3 NonfungiblePositionManager event logs, decoded via viem. Amounts stored as integer base units.
      </div>
      <div className="flex gap-2">
        <a
          href={`https://etherscan.io/tx/${e.tx}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 flex items-center justify-center gap-2 rounded-md2 bg-charcoal text-ivory-50 py-2.5 text-[0.82rem] font-medium hover:bg-graphite"
        >
          View on Etherscan <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}
