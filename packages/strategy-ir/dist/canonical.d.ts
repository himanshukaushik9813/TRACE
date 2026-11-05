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
export declare function canonicalString(value: unknown): string;
export type ContentHash = {
    algorithm: "fnv1a-128";
    digest: string;
    /** Always stable across environments — hash *this* for cross-env equality. */
    canonical: string;
};
/** Synchronous, environment-independent digest. */
export declare function contentHash(value: unknown): ContentHash;
/** Optional WebCrypto SHA-256 (browser + Node 18+) when a standard digest is wanted. */
export declare function digestAsync(value: unknown): Promise<string>;
/** Short display form: "fnv1a:7c1e…d4" (first 4 + last 2 chars of digest). */
export declare function shortHash(value: unknown): string;
