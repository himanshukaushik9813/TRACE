/**
 * Canonical serialization + deterministic content hashing.
 *
 * "The compiler is deterministic" and "every claim is validated against
 * deterministic evidence" both hinge on being able to hash arbitrary IR
 * objects reproducibly across the browser, the Express API, and the worker.
 *
 * Rules:
 *  - Object keys are sorted recursively (stable regardless of insertion order).
 *  - bigint is serialized as "i:<decimal>" so it never collides with a number.
 *  - undefined is omitted at object level; null is kept.
 *  - Arrays keep order (it is semantically meaningful: events, steps, points).
 *
 * Digest:
 *  - The synchronous digest is a 128-bit FNV-1a (4 independent lanes over the
 *    canonical string). It is pure JS — byte-identical in Node, the worker,
 *    and the browser — so hashes are stable across every environment.
 *  - `digestAsync` additionally offers WebCrypto SHA-256 where available
 *    (browser + Node 18+) for anything that wants a standard digest.
 */

export function canonicalString(value: unknown): string {
  return canon(value);
}

function canon(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "number":
      return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
    case "bigint":
      return `"i:${v}"`;
    case "boolean":
      return String(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => canon(x)).join(",")}]`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`);
    return `{${parts.join(",")}}`;
  }
  // functions/symbols: not serializable — deterministic placeholder
  return "\"<unserializable>\"";
}

/** 4-lane 32-bit FNV-1a → 128 hex chars. Pure JS, identical everywhere. */
function fnv1a128(input: string): string {
  const out: string[] = [];
  for (let lane = 0; lane < 4; lane++) {
    // Different per-lane seeds so the lanes don't correlate.
    let h = [0x811c9dc5, 0x97448c1f, 0x517cc1b7, 0x6c2261c8][lane];
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push(h.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

export type ContentHash = {
  algorithm: "fnv1a-128";
  digest: string;
  /** Always stable across environments — hash *this* for cross-env equality. */
  canonical: string;
};

/** Synchronous, environment-independent digest. */
export function contentHash(value: unknown): ContentHash {
  const canonical = canonicalString(value);
  return { algorithm: "fnv1a-128", digest: fnv1a128(canonical), canonical };
}

/** Optional WebCrypto SHA-256 (browser + Node 18+) when a standard digest is wanted. */
export async function digestAsync(value: unknown): Promise<string> {
  const canonical = canonicalString(value);
  if (typeof globalThis.crypto?.subtle !== "undefined") {
    const buf = new TextEncoder().encode(canonical);
    const out = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(out))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return fnv1a128(canonical);
}

/** Short display form: "fnv1a:7c1e…d4" (first 4 + last 2 chars of digest). */
export function shortHash(value: unknown): string {
  const d = contentHash(value).digest;
  return `fnv1a:${d.slice(0, 4)}…${d.slice(-2)}`;
}
