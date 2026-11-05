"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Search,
  Boxes,
  BrainCircuit,
  FlaskConical,
  Terminal,
  FileText,
  Activity,
  Bookmark,
  Bell,
  Wallet,
  ChevronDown,
  Circle,
  Globe,
} from "lucide-react";
import { art } from "@/lib/assets";

const NAV = [
  { href: "/", label: "Investigate", icon: Search, hint: "Wallet command center" },
  { href: "/positions/pos-eth-usdc", label: "Positions", icon: Boxes, hint: "Blockchain evidence" },
  { href: "/strategy", label: "Strategy Intelligence", icon: BrainCircuit, hint: "Reverse-engineering" },
  { href: "/backtest", label: "Strategy Lab", icon: FlaskConical, hint: "Backtest & replay" },
  { href: "/execute", label: "Execute · Aqua", icon: Terminal, hint: "1inch Aqua console" },
  { href: "/reports", label: "Reports", icon: FileText, hint: "Investigation dossier" },
  { href: "/activity", label: "Activity", icon: Activity, hint: "Event timeline" },
  { href: "/saved", label: "Saved Strategies", icon: Bookmark, hint: "Versioned strategies" },
];

function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden lg:flex w-[264px] shrink-0 h-full flex-col bg-ivory hairline border-r border-ink/10 paper relative">
      {/* Brand */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md2 bg-charcoal-900 grid place-items-center overflow-hidden">
            <img src={art.ethEmblem} alt="TRACE emblem" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <div className="serif text-xl tracking-tight text-ink leading-none">TRACE</div>
            <div className="label mt-1.5 !text-[0.55rem]">On-Chain Strategy Intelligence</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 mt-2">
        {NAV.map((item) => {
          const active = item.href === path || (item.href.startsWith("/positions") && path.startsWith("/positions"));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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

      {/* Mountain engraving footer — signature illustration */}
      <div className="relative mt-4 border-t border-ink/10 overflow-hidden">
        <img
          src={art.lg.mountain}
          alt=""
          aria-hidden
          className="w-full h-28 object-cover object-center opacity-70 mix-blend-multiply"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ivory via-ivory/40 to-transparent" />
        <div className="relative px-5 py-3 bg-ivory/70 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Circle size={7} className="text-sage-600 animate-pulseSoft" />
            <span className="text-[0.7rem] font-medium text-ink-600">Ethereum Mainnet · synced</span>
          </div>
          <div className="text-[0.64rem] text-ink-600/70 mt-1">ETHGlobal Mumbai 2026 · demo build</div>
        </div>
      </div>
    </aside>
  );
}

function IntegrationDot({ label, ok = true }: { label: string; ok?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ivory-50 px-2.5 py-1 text-[0.66rem] font-medium text-ink-600"
      title={`${label} — ${ok ? "connected (demo)" : "not connected"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-sage-600" : "bg-brick"}`} />
      {label}
    </div>
  );
}

function Topbar() {
  const path = usePathname();
  const title = NAV.find((n) => (n.href === path || (n.href.startsWith("/positions") && path.startsWith("/positions"))))?.label ?? "Investigate";
  return (
    <header className="sticky top-0 z-30 bg-ivory/85 backdrop-blur-md hairline border-b border-ink/10">
      <div className="flex items-center gap-3 px-4 md:px-6 h-[60px]">
        {/* Page eyebrow */}
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={14} className="text-ink-600 shrink-0" />
          <div className="min-w-0">
            <div className="label !text-[0.52rem] !tracking-wide2 text-ink-600/70">TRACE</div>
            <div className="serif text-[1.02rem] text-ink leading-none truncate">{title}</div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Partner integrations — visible but subtle */}
        <div className="hidden md:flex items-center gap-2">
          <IntegrationDot label="0G Private Computer" />
          <IntegrationDot label="1inch Aqua" />
          <IntegrationDot label="World Agent Pass" />
        </div>

        <div className="hidden sm:flex items-center rounded-md2 border border-ink/10 bg-ivory-50 px-2.5 py-1.5 text-[0.72rem] text-ink-600">
          <Globe size={13} className="text-gold mr-1.5" />
          Ethereum Mainnet
          <ChevronDown size={13} className="ml-1.5 text-ink-600" />
        </div>

        <button className="relative grid place-items-center h-9 w-9 rounded-md2 border border-ink/10 bg-ivory-50 hover:bg-ink/5" aria-label="Notifications">
          <Bell size={16} className="text-ink-600" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-gold" />
        </button>

        <div className="flex items-center gap-2 rounded-md2 border border-ink/10 bg-ivory-50 pl-1.5 pr-2.5 py-1.5">
          <Wallet size={15} className="text-ink-600" />
          <span className="text-[0.78rem] font-medium text-ink tabular">0x7B…4A1F</span>
          <ChevronDown size={13} className="text-ink-600" />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-ivory">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto dark-scroll bg-ivory-50">
          <div className="max-w-[1240px] mx-auto px-4 md:px-8 py-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
