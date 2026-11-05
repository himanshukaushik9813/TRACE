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

  /** Truncate a tx hash: 0x9f…c2 */
  hash(h: string): string {
    if (!h) return "—";
    return h.slice(0, 6) + "…" + h.slice(-4);
  },
};
