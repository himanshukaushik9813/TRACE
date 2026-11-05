/**
 * Ambient declarations for @trace/world-auth's Node-only dependencies.
 *
 * The package itself is written to run in Node (it uses node:crypto for the
 * demo HMAC path). In a real install @types/node provides these; this file
 * keeps the package self-contained so it type-checks without node_modules.
 */

declare module "node:crypto" {
  interface HashLike {
    update(data: string | Uint8Array): HashLike;
    digest(encoding?: "hex" | "base64" | "latin1"): string;
  }
  function createHash(algorithm: string): HashLike;
  function createHmac(algorithm: string, key: string | Uint8Array): HashLike;
}

declare var process: { env: Record<string, string | undefined>; argv: string[]; pid: number; exit(code?: number): never };
