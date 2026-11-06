"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Search, Boxes, BrainCircuit, FlaskConical, Terminal, FileText, Activity, Menu, X, ExternalLink, Zap, Cpu, Database, ScanFace } from "lucide-react";
import { SEPOLIA_CHAIN_ID, explorer } from "@trace/chain-config";
import { art } from "@/lib/assets";
import { useIntegrations, withInv, type IntegrationStatus } from "@/lib/api";
import { starPath } from "@/components/engine-mark";
import { WalletButton, NetworkBanner } from "@/components/wallet";
import { plainStatus } from "@/lib/status";

/**
 * Seven destinations, in the order a first investigation flows through them.
 * Strategy versions live inside Strategy (a tab); /saved redirects there.
 */
const NAV = [
  { href: "/", label: "Investigate", icon: Search, hint: "Start here: enter a wallet address" },
  { href: "/positions", label: "Positions", icon: Boxes, hint: "The wallet's liquidity positions" },
  { href: "/strategy", label: "Strategy", icon: BrainCircuit, hint: "What the wallet appears to be doing", also: ["/saved"] },
  { href: "/backtest", label: "Backtest", icon: FlaskConical, hint: "How it performed on real past trading" },
  { href: "/execute", label: "Execute", icon: Terminal, hint: "Recreate it on 1inch Aqua from your wallet" },
  { href: "/reports", label: "Reports", icon: FileText, hint: "Summary, integrations and downloads" },
  { href: "/activity", label: "Activity", icon: Activity, hint: "Investigations and transactions" },
];
const isActive = (item: (typeof NAV)[number], path: string) =>
  item.href === "/" ? path === "/" : path.startsWith(item.href) || (item.also ?? []).some((a) => path.startsWith(a));

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
        const active = isActive(item, path);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={withInv(item.href, inv)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={item.hint}
            className={`group flex items-center gap-3 rounded-md2 px-3 py-2.5 transition-colors ${
              active ? "bg-gold text-white shadow-glow" : "text-ink hover:bg-ivory-100"
            }`}
          >
            <Icon size={17} strokeWidth={1.6} className={active ? "text-white" : "text-ink-600 group-hover:text-ink"} />
            <span className="text-[0.9rem] font-medium flex-1">{item.label}</span>
            {active && <span className="h-1.5 w-1.5 rounded-full bg-white/90" />}
          </Link>
        );
      })}
    </nav>
  );
}

function ChainFooter() {
  const { data, isError } = useIntegrations();
  const ok = data?.chain.ok;
  const block = data?.chain.latestBlock ?? null;
  return (
    <div className="relative mt-4">
      <img src={art.lg.mountain} alt="" aria-hidden className="w-full h-24 object-cover object-top opacity-35 mix-blend-multiply pointer-events-none" style={{ maskImage: "linear-gradient(to bottom, transparent, #000 45%)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 45%)" }} loading="lazy" />
      <div className="px-4 pb-5 -mt-6 relative space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-ivory-50 px-3 py-1.5 text-[0.76rem] font-medium text-ink">
          <span className={`h-2 w-2 rounded-full ${isError || (data && !ok) ? "bg-brick" : ok ? "bg-forest" : "bg-ink/25"}`} />
          {isError ? "API unreachable" : data && !ok ? "Sepolia RPC error" : "Sepolia Testnet"}
        </div>
        {block != null && (
          <a
            href={explorer.block(block)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-md2 border border-line bg-ivory-50 px-3 py-2 text-[0.78rem] text-ink tabular hover:border-gold/40"
            title="Latest Sepolia block read by the TRACE API"
          >
            Block {block.toLocaleString("en-US")}
            <ExternalLink size={13} className="text-ink-600" />
          </a>
        )}
      </div>
    </div>
  );
}

/** The TRACE mark: a gold four-point star on an ivory tile. */
function Mark({ size = 36 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-md2 border border-gold/35 bg-ivory-50 shadow-soft shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} aria-hidden>
        <defs>
          <linearGradient id="mark-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#D8B46C" />
            <stop offset="1" stopColor="#A87C37" />
          </linearGradient>
        </defs>
        <path d={starPath(12, 12, 10)} fill="url(#mark-g)" />
      </svg>
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Mark />
      <div>
        <div className="serif text-[1.35rem] tracking-tight text-ink leading-none">TRACE</div>
        <div className="text-[0.62rem] text-ink-600 mt-1">On-Chain Strategy Intelligence</div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden lg:flex w-[248px] shrink-0 h-full flex-col bg-ivory border-r border-line relative">
      <div className="px-5 pt-6 pb-4">
        <Brand />
      </div>
      <NavLinks />
      <ChainFooter />
    </aside>
  );
}

/** Only a verified integration gets the green dot; anything else is shown as what it is. */
const DOT: Record<IntegrationStatus, string> = {
  "VERIFIED LIVE": "bg-forest",
  "VERIFIED TESTNET": "bg-forest",
  "IMPLEMENTED BUT NOT VERIFIED": "bg-amber",
  "BLOCKED BY EXTERNAL DEPENDENCY": "bg-brick",
  "NOT IMPLEMENTED": "bg-ink/25",
};

const INTEGRATIONS = [
  { key: "aqua", label: "1inch Aqua", icon: Zap },
  { key: "zerog_inference", label: "0G Inference", icon: Cpu },
  { key: "zerog_storage", label: "0G Storage", icon: Database },
  { key: "world_id", label: "World ID", icon: ScanFace },
];

function IntegrationStatuses() {
  const { data } = useIntegrations();
  if (!data) return null;
  return (
    <Link href="/reports#integrations" className="hidden xl:flex items-center gap-1.5" aria-label="Integration status, details in Reports">
      {INTEGRATIONS.map(({ key, label, icon: Icon }) => {
        const i = data.integrations.find((x) => x.key === key);
        if (!i) return null;
        const plain = plainStatus(i.status);
        return (
          <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ivory-50 px-2.5 h-8 text-[0.74rem] font-medium text-ink whitespace-nowrap" title={`${label}: ${plain.label}. ${i.detail}`}>
            <Icon size={13} strokeWidth={1.8} className="text-gold" />
            {label}
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[i.status] ?? "bg-ink/25"}`} aria-hidden />
            <span className="sr-only">: {plain.label}</span>
          </span>
        );
      })}
    </Link>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const title = NAV.find((n) => isActive(n, path))?.label ?? "TRACE";
  return (
    <header className="sticky top-0 z-30 bg-ivory/90 backdrop-blur-md border-b border-line">
      <div className="flex items-center gap-3 px-4 md:px-8 h-16">
        <button onClick={onMenu} className="lg:hidden grid place-items-center h-9 w-9 rounded-md2 border border-line bg-ivory-50" aria-label="Open navigation">
          <Menu size={17} />
        </button>
        <div className="min-w-0">
          <div className="text-[0.66rem] text-ink-600 leading-none">TRACE /</div>
          <div className="serif text-[1.15rem] text-ink leading-tight truncate">{title}</div>
        </div>
        <div className="flex-1" />
        <IntegrationStatuses />
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 h-8 text-[0.76rem] font-medium text-[#8A6528] whitespace-nowrap"
          title={`Ethereum Sepolia testnet, chain id ${SEPOLIA_CHAIN_ID}. TRACE never connects to mainnet.`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Sepolia Testnet
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
      <div className={`lg:hidden fixed inset-0 z-40 bg-ink/20 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={onClose} />
      <aside className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[270px] max-w-[85vw] bg-ivory border-r border-line flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <Brand />
          <button onClick={onClose} aria-label="Close navigation" className="p-1.5 rounded-md2 hover:bg-ivory-100">
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
        <main className="flex-1 overflow-y-auto dark-scroll bg-ivory">
          <div className="max-w-[1280px] mx-auto px-4 md:px-8 py-6 md:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
