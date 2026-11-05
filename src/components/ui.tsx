import type { ReactNode } from "react";
import { DEMO_MODE } from "@/lib/assets";
import { X } from "lucide-react";

/** Card surface — light ivory or dark charcoal. */
export function Card({
  children,
  dark = false,
  className = "",
  pad = true,
}: {
  children: ReactNode;
  dark?: boolean;
  className?: string;
  pad?: boolean;
}) {
  const bg = dark
    ? "bg-charcoal-900 hairline-dark"
    : "bg-ivory-50 hairline";
  const bd = dark ? "border border-cream/10" : "border border-ink/10";
  return (
    <div
      className={`${bg} ${bd} rounded-panel shadow-card ${pad ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Small uppercase field label. */
export function Label({ children, onDark }: { children: ReactNode; onDark?: boolean }) {
  return (
    <div className={`label ${onDark ? "text-cream-muted" : ""}`}>{children}</div>
  );
}

/** Section title with a hairline rule. */
export function SectionTitle({
  eyebrow,
  title,
  onDark,
  action,
}: {
  eyebrow?: string;
  title: string;
  onDark?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <Label onDark={onDark}>{eyebrow}</Label>}
        <h2
          className={`serif text-xl md:text-2xl leading-tight mt-1 ${
            onDark ? "text-cream" : "text-ink"
          }`}
        >
          {title}
        </h2>
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
    neutral: "bg-ink/5 text-ink/70 border-ink/10",
    gold: "bg-gold/12 text-gold border-gold/30",
    sage: "bg-sage/14 text-sage-600 border-sage/30",
    amber: "bg-amber/12 text-amber border-amber/30",
    brick: "bg-brick/12 text-brick border-brick/30",
    forest: "bg-forest/12 text-forest border-forest/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-medium tracking-wide border ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/** Clear "demo data" marker — the spec forbids presenting fixtures as real. */
export function DemoBadge({ onDark }: { onDark?: boolean }) {
  if (!DEMO_MODE) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[0.62rem] font-semibold uppercase tracking-wide2 border ${
        onDark
          ? "border-gold/40 bg-gold/10 text-gold-300"
          : "border-gold/40 bg-gold/10 text-gold"
      }`}
      title="Figures shown are a labelled known-good fixture, not a live chain read."
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${onDark ? "bg-gold-300" : "bg-gold"}`}
      />
      Demo data
    </span>
  );
}

/** Key/value stat cell. */
export function Stat({
  label,
  value,
  sub,
  onDark,
  align = "left",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  onDark?: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end text-right" : ""}`}>
      <Label onDark={onDark}>{label}</Label>
      <div
        className={`stat-value text-lg md:text-xl font-semibold mt-1 ${
          onDark ? "text-cream" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div
          className={`text-[0.72rem] mt-0.5 ${
            onDark ? "text-cream-muted" : "text-ink-600"
          }`}
        >
          {sub}
        </div>
      )}
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
    "inline-flex items-center justify-center gap-2 rounded-md2 px-4 py-2 text-sm font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-charcoal text-cream hover:bg-graphite shadow-soft",
    dark: "bg-ink text-ivory-50 hover:bg-graphite",
    gold: "bg-gold text-charcoal-900 hover:bg-gold-300 shadow-glow",
    ghost: "border border-ink/15 text-ink hover:bg-ink/5",
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
        className={`fixed inset-0 z-40 bg-charcoal-900/40 transition-opacity ${
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
export function Meter({ value, onDark }: { value: number; onDark?: boolean }) {
  return (
    <div className={`h-1.5 w-full rounded-full overflow-hidden ${onDark ? "bg-cream/12" : "bg-ink/10"}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-gold to-gold-300"
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
  onDark,
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
      className={`inline-flex p-0.5 rounded-md2 border ${className} ${
        onDark ? "border-cream/12 bg-charcoal-900" : "border-ink/10 bg-ivory"
      }`}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-md text-[0.82rem] font-medium transition-all ${
            value === t.id
              ? onDark
                ? "bg-cream text-ink shadow-soft"
                : "bg-ink text-ivory-50 shadow-soft"
              : onDark
                ? "text-cream-muted hover:text-cream"
                : "text-ink-600 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
