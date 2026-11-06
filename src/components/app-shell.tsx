"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Search, Boxes, BrainCircuit, FlaskConical, Terminal, FileText, Activity, Bookmark, Circle, Globe, Menu, X } from "lucide-react";
import { SEPOLIA_CHAIN_ID } from "@trace/chain-config";
import { art } from "@/lib/assets";
import { useIntegrations, withInv } from "@/lib/api";
import { WalletButton, NetworkBanner } from "@/components/wallet";

const NAV = [
  { href: "/", label: "Investigate", icon: Search },
  { href: "/positions", label: "Positions", icon: Boxes },
  { href: "/strategy", label: "Strategy DNA", icon: BrainCircuit },
  { href: "/backtest", label: "Backtest", icon: FlaskConical },
  { href: "/execute", label: "Execute · Aqua", icon: Terminal },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/saved", label: "Strategy versions", icon: Bookmark },
];

/**
 * Carry the current investigation id across screens.
 *
 * Re-reads on every route change AND on "trace:last-investigation" (fired when
 * a new investigation is started on the Investigate screen), so the nav links
 * always carry the id the user just picked — not one captured at app load.
 * Without this, clicking "Positions" after a fresh investigation landed on a
 * *different, older* wallet's positions (stale ?inv= on the link).
 */
function useInvParam(): string | null {
  const path = usePathname();
  const [inv, setInv] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const u = new URLSearchParams(window.location.search).get("inv");
      let last: string | null = null;
      try {
        last = window.localStorage.getItem("trace:lastInvestigation");
      } catch {
        last = null;
      }
      setInv(u ?? last);
    };
    read();
    window.addEventListener("trace:last-investigation", read);
    return () => window.removeEventListener("trace:last-investigation", read);
  }, [path]);
  return inv;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const inv = useInvParam();
  return (
    <nav className="flex-1 px-3 space-y-0.5 mt-2">
      {NAV.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={withInv(item.href, inv)}
            onClick={onNavigate}
            className={`group flex items-center gap-3 rounded-md2 px-3 py-2.5 transition-all ${
              active ? "bg-ink text-ivory-50 shadow-soft" : "text-ink-600 hover:bg-ink/5 hover:text-ink"
            }`}
          >
            <Icon size={17} strokeWidth={1.6} className={active ? "text-gold-300" : "text-ink-600"} />
            <span className="text-[0.9rem] font-medium flex-1">{item.label}</span>
            {active && <span className="h-1.5 w-1.5 rounded-full bg-gold-300" />}
          </Link>
        );
      })}
    </nav>
  );
}

function ChainFooter() {
  const { data, isError } = useIntegrations();
  const ok = data?.chain.ok;
  return (
    <div className="relative mt-4 border-t border-ink/10 overflow-hidden">
      <img src={art.lg.mountain} alt="" aria-hidden className="w-full h-28 object-cover object-center opacity-70 mix-blend-multiply" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-t from-ivory via-ivory/40 to-transparent" />
      <div className="relative px-5 py-3 bg-ivory/70 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Circle size={7} className={ok ? "text-sage-600 animate-pulseSoft" : "text-brick"} />
          <span className="text-[0.7rem] font-medium text-ink-600">
            {isError ? "API unreachable" : ok ? `Sepolia at block ${data?.chain.latestBlock?.toLocaleString("en-US")}` : data ? "Sepolia RPC error" : "Checking Sepolia…"}
          </span>
        </div>
        <div className="text-[0.7rem] text-ink-600/80 mt-1">Built for ETHGlobal Mumbai 2026</div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 rounded-md2 bg-charcoal-900 grid place-items-center overflow-hidden">
        <img src={art.ethEmblem} alt="TRACE emblem" className="h-7 w-7 object-contain" />
      </div>
      <div>
        <div className="serif text-xl tracking-tight text-ink leading-none">TRACE</div>
        <div className="label mt-1.5 !text-[0.55rem]">On-Chain Strategy Intelligence</div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden lg:flex w-[264px] shrink-0 h-full flex-col bg-ivory hairline border-r border-ink/10 paper relative">
      <div className="px-5 pt-6 pb-4">
        <Brand />
      </div>
      <NavLinks />
      <ChainFooter />
    </aside>
  );
}

const DOT: Record<string, string> = {
  "VERIFIED LIVE": "bg-forest",
  "VERIFIED TESTNET": "bg-sage",
  "IMPLEMENTED BUT NOT VERIFIED": "bg-amber",
  "BLOCKED BY EXTERNAL DEPENDENCY": "bg-brick",
};

function IntegrationDots() {
  const { data } = useIntegrations();
  if (!data) return null;
  const pick = ["zerog_inference", "aqua", "zerog_storage", "world_id"];
  const short: Record<string, string> = { zerog_inference: "0G inference", aqua: "1inch Aqua", zerog_storage: "0G Storage", world_id: "World ID" };
  return (
    <Link href="/reports#integrations" className="hidden xl:flex items-center gap-2" title="Live integration status">
      {data.integrations
        .filter((i) => pick.includes(i.key))
        .map((i) => (
          <span key={i.key} className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ivory-50 px-2.5 py-1 text-[0.66rem] font-medium text-ink-600" title={`${i.status} — ${i.detail}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[i.status] ?? "bg-ink/30"}`} />
            {short[i.key]}
          </span>
        ))}
    </Link>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const title = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)))?.label ?? "TRACE";
  return (
    <header className="sticky top-0 z-30 bg-ivory/85 backdrop-blur-md hairline border-b border-ink/10">
      <div className="flex items-center gap-3 px-4 md:px-6 h-[60px]">
        <button onClick={onMenu} className="lg:hidden grid place-items-center h-9 w-9 rounded-md2 border border-ink/10 bg-ivory-50" aria-label="Open navigation">
          <Menu size={17} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={14} className="text-ink-600 shrink-0 hidden sm:block" />
          <div className="min-w-0">
            <div className="label !text-[0.52rem] !tracking-wide2 text-ink-600/70">TRACE</div>
            <div className="serif text-[1.02rem] text-ink leading-none truncate">{title}</div>
          </div>
        </div>
        <div className="flex-1" />
        <IntegrationDots />
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-md2 border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-[0.74rem] font-semibold text-gold whitespace-nowrap"
          title={`Ethereum Sepolia testnet, chain id ${SEPOLIA_CHAIN_ID}. TRACE never connects to mainnet.`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Sepolia testnet
        </span>
        <WalletButton />
      </div>
      <NetworkBanner />
    </header>
  );
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <div className={`lg:hidden fixed inset-0 z-40 bg-charcoal-900/40 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={onClose} />
      <aside className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[270px] max-w-[85vw] bg-ivory border-r border-ink/10 flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <Brand />
          <button onClick={onClose} aria-label="Close navigation" className="p-1.5 rounded-md2 hover:bg-ink/5">
            <X size={18} />
          </button>
        </div>
        <NavLinks onNavigate={onClose} />
        <ChainFooter />
      </aside>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-ivory">
      <Sidebar />
      <MobileNav open={menu} onClose={() => setMenu(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenu={() => setMenu(true)} />
        <main className="flex-1 overflow-y-auto dark-scroll bg-ivory-50">
          <div className="max-w-[1240px] mx-auto px-4 md:px-8 py-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
