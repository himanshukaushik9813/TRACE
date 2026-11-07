import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, Inbox, Loader2, X } from "lucide-react";
import { explorer } from "@trace/chain-config";

/**
 * Card surface. The app is light-theme only: `dark` is kept for call-site
 * compatibility but renders the same white card.
 */
export function Card({
  children,
  className = "",
  pad = true,
}: {
  children: ReactNode;
  dark?: boolean;
  className?: string;
  pad?: boolean;
}) {
  return <div className={`bg-ivory-50 border border-line rounded-card shadow-lift ${pad ? "p-5" : ""} ${className}`}>{children}</div>;
}

/** Quiet sentence-case field label. */
export function Label({ children }: { children: ReactNode; onDark?: boolean }) {
  return <div className="label">{children}</div>;
}

/** Section title with a hairline rule. */
export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  onDark?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="section-title flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-4">
      <div>
        {eyebrow && <Label>{eyebrow}</Label>}
        <h2 className="text-[1.125rem] md:text-[1.25rem] leading-snug mt-1 text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** Status pill. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "sage" | "amber" | "brick" | "forest";
}) {
  const map: Record<string, string> = {
    neutral: "bg-ink/5 text-ink-600 border-ink/10",
    gold: "bg-gold/12 text-gold-700 border-gold/30",
    sage: "bg-sage/14 text-sage-600 border-sage/30",
    amber: "bg-amber/12 text-amber border-amber/30",
    brick: "bg-brick/12 text-brick border-brick/30",
    forest: "bg-forest/12 text-forest border-forest/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-medium border whitespace-nowrap ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Data-source badge. TRACE has no demo mode: every figure comes from a live
 * Sepolia read through the API, and this badge says so (with the block).
 */
export function SourceBadge({ block, label }: { onDark?: boolean; block?: number | null; label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[0.7rem] font-medium border whitespace-nowrap border-forest/25 bg-forest/8 text-forest"
      title="Read live from Ethereum Sepolia through the TRACE API"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-forest" />
      {label ?? "Live on Sepolia"}
      {block ? `, block ${block.toLocaleString("en-US")}` : ""}
    </span>
  );
}

const STATUS_TONE: Record<string, "forest" | "sage" | "amber" | "brick" | "neutral"> = {
  "VERIFIED LIVE": "forest",
  "VERIFIED TESTNET": "sage",
  "IMPLEMENTED BUT NOT VERIFIED": "amber",
  "BLOCKED BY EXTERNAL DEPENDENCY": "brick",
  "NOT IMPLEMENTED": "neutral",
};

/** Honest integration status label. */
export function StatusChip({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? "neutral"}>{status}</Pill>;
}

/** Sepolia Etherscan link for a tx / address / block / token / NFT. */
export function ExplorerLink({
  kind,
  value,
  children,
  className = "",
}: {
  kind: "tx" | "address" | "block" | "token" | "nft";
  value: string | number;
  children?: ReactNode;
  className?: string;
}) {
  const href =
    kind === "tx" ? explorer.tx(String(value))
    : kind === "address" ? explorer.address(String(value))
    : kind === "block" ? explorer.block(Number(value))
    : kind === "token" ? explorer.token(String(value))
    : explorer.nft(String(value));
  const text = children ?? (typeof value === "string" && value.startsWith("0x") ? `${value.slice(0, 6)}…${value.slice(-4)}` : `#${value}`);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 tabular underline decoration-gold/40 underline-offset-2 hover:text-gold-700 ${className}`}>
      {text}
      <ExternalLink size={11} className="opacity-60" />
    </a>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[0.85rem] py-6 text-ink-600">
      <Loader2 size={16} className="animate-spin text-gold" /> {label}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-ink/15 bg-ivory-50 p-5 flex gap-4 items-start min-w-0">
      <div className="h-9 w-9 grid place-items-center rounded-md2 bg-ink/5 text-ink-600 shrink-0">{icon ?? <Inbox size={17} />}</div>
      <div className="min-w-0">
        <div className="text-ink font-medium">{title}</div>
        {children && <div className="text-[0.84rem] text-ink-600 mt-1 leading-relaxed break-words [overflow-wrap:anywhere]">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  detail,
  action,
}: {
  title?: string;
  message: string;
  /** Technical detail (e.g. the server's error text), folded away under the message. */
  detail?: string;
  /** Optional recovery control, e.g. a "Try again" button. */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-brick/30 bg-brick/5 p-4 flex gap-3 items-start" role="alert">
      <AlertTriangle size={17} className="text-brick shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-brick font-medium text-[0.9rem]">{title}</div>
        <div className="text-[0.82rem] text-brick/90 mt-0.5 break-words">{message}</div>
        {detail && detail !== message && (
          <details className="mt-1.5 text-[0.76rem] text-ink-600">
            <summary className="w-fit hover:text-ink">Technical detail</summary>
            <div className="mt-1 break-words [overflow-wrap:anywhere]">{detail}</div>
          </details>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Key/value stat cell. Values wrap instead of spilling out of their box. */
export function Stat({
  label,
  value,
  sub,
  align = "left",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  onDark?: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col min-w-0 ${align === "right" ? "items-end text-right" : ""}`}>
      <Label>{label}</Label>
      <div className="stat-value text-lg md:text-xl font-semibold mt-1 break-anywhere text-ink">{value}</div>
      {sub && <div className="text-[0.74rem] mt-0.5 break-anywhere text-ink-600">{sub}</div>}
    </div>
  );
}

/** Confident button. */
export function Button({
  children,
  variant = "primary",
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "dark" | "gold";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md2 px-4 h-9 text-[0.875rem] font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
  // primary: the one main action on a screen. gold: a brand-accented action.
  // ghost: secondary. `dark` is kept for call-site compatibility (= primary).
  const variants: Record<string, string> = {
    primary: "bg-ink text-white hover:bg-charcoal-700",
    dark: "bg-ink text-white hover:bg-charcoal-700",
    gold: "bg-gold-700 text-white hover:bg-gold-800",
    ghost: "border border-line bg-ivory-50 text-ink hover:border-ink/25",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

/** Slide-over evidence drawer. */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink/20 transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-[420px] max-w-[92vw] z-50 bg-ivory-50 hairline border-l border-ink/10 shadow-card transition-transform duration-300 overflow-y-auto dark-scroll ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 bg-ivory-50/95 backdrop-blur px-5 py-4 border-b border-ink/10 flex items-center justify-between z-10">
          <h3 className="serif text-lg text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md2 hover:bg-ink/5">
            <X size={18} className="text-ink-600" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </>
  );
}

/** Progress bar for a behavioural DNA dimension. */
export function Meter({ value }: { value: number; onDark?: boolean }) {
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-ink/8">
      <div
        className="h-full rounded-full bg-gold"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/** Simple horizontal tab row. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex p-0.5 rounded-md2 border border-line bg-ivory-100 ${className}`}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-md text-[0.82rem] font-medium transition-all ${
            value === t.id ? "bg-ivory-50 text-ink shadow-soft" : "text-ink-600 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
