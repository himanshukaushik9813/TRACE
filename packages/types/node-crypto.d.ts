/**
 * Offline ambient declaration for node:crypto (used by @trace/world-auth).
 * In a real build @types/node provides the real types; this stub exists so the
 * monorepo type-checks without node_modules present in the sandbox.
 */
declare module "node:crypto" {
  export interface HashLike {
    update(data: string | Uint8Array): HashLike;
    digest(encoding?: "hex" | "base64" | "latin1"): string;
  }
  export function createHash(algorithm: string): HashLike;
  export function createHmac(algorithm: string, key: string | Uint8Array): HashLike;
}
