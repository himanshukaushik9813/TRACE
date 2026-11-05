/** Financial number & time formatting. Kept dependency-free. */

export const fmt = {
  /** Compact USD figure with a currency prefix, e.g. $1.24M */
  usd(v: number, digits = 2): string {
    const abs = Math.abs(v);
    const sign = v < 0 ? "−" : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(digits) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(digits) + "M";
    if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(digits) + "K";
    return sign + "$" + abs.toFixed(digits);
  },

  /** Tabular decimal, e.g. 3.42 */
  num(v: number, digits = 2): string {
    return v.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  },

  /** Signed percent, e.g. +12.4% */
  pct(v: number, digits = 2): string {
    const s = v > 0 ? "+" : "";
    return s + v.toFixed(digits) + "%";
  },

  /** 16-digit-ish address shortening: 0x1a2b…9f3c */
  addr(a: string): string {
    if (!a) return "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  },

  /** Short block: 21,834,211 → 21.83M */
  block(n: number): string {
    return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n.toLocaleString("en-US");
  },

  /** Relative-ish timestamp from a unix ms date. */
  ts(ms: number, withTime = true): string {
    const d = new Date(ms);
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (!withTime) return date;
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    return date + " · " + time;
  },

  /** Unix seconds → readable date/time (UTC). 0/null → "—" (never fabricated). */
  tsSec(sec: number | string | null | undefined, withTime = true): string {
    const n = Number(sec);
    if (!n) return "—";
    const d = new Date(n * 1000);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" } : { timeZone: "UTC" }) });
  },

  /** Token base units → human amount with real decimals (null decimals → raw units). */
  units(raw: string | number | bigint | null | undefined, decimals: number | null | undefined, digits = 4): string {
    if (raw == null) return "—";
    const n = Number(raw);
    if (decimals == null) return `${n.toLocaleString("en-US")} (base units)`;
    const v = n / 10 ** decimals;
    if (v === 0) return "0";
    if (Math.abs(v) < 10 ** -digits) return v.toExponential(2);
    return v.toLocaleString("en-US", { maximumFractionDigits: digits });
  },

  /** Human float with sensible precision. */
  amt(v: number | null | undefined, digits = 4): string {
    if (v == null || !Number.isFinite(v)) return "—";
    if (v === 0) return "0";
    if (Math.abs(v) < 10 ** -digits) return v.toExponential(2);
    return v.toLocaleString("en-US", { maximumFractionDigits: digits });
  },

  /** Uniswap fee tier (hundredths of a bip) → "0.30%". */
  feeTier(t: number | null | undefined): string {
    if (!t) return "—";
    return `${(t / 10_000).toFixed(t % 100 === 0 ? 2 : 3)}%`;
  },

  /** Fraction → percent string. */
  frac(v: number | null | undefined, digits = 1): string {
    if (v == null || !Number.isFinite(v)) return "—";
    return `${(v * 100).toFixed(digits)}%`;
  },

  /** Truncate a tx hash: 0x9f…c2 */
  hash(h: string): string {
    if (!h) return "—";
    return h.slice(0, 6) + "…" + h.slice(-4);
  },
};
