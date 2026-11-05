/**
 * 0G Storage archiving (Galileo testnet) — genuine uploads only.
 *
 *   upload:   canonical JSON → MemData → Merkle tree → indexer.upload(file, rpc, signer)
 *             → { rootHash, txHash } (the storage fee is paid on 0G Galileo by the
 *             server's dedicated burner key)
 *   verify:   indexer.downloadToBlob(rootHash, { proof: true }) → compare bytes
 *
 * A StorageRef is only ever returned after a successful upload; `retrievable`
 * is true only after the Merkle-proof-verified download matched the content.
 * There is no demo path: without configuration `archive()` reports
 * `not_configured` and returns no references.
 */

import { contentHash, canonicalString, type StorageRef } from "@trace/strategy-ir";

export type ZeroGStorageConfig = {
  rpcUrl?: string;
  indexerUrl?: string;
  privateKey?: string;
  /** Skip the read-back verification (default false). */
  skipVerify?: boolean;
};

export type Artifact = { kind: string; content: unknown };

export type ArchiveOutcome = {
  status: "archived" | "partial" | "failed" | "not_configured";
  refs: StorageRef[];
  errors: { kind: string; error: string }[];
  signer?: string;
};

/** ethers errors embed the whole transaction; keep the code + node message only. */
function conciseError(err: unknown): string {
  const e = err as { code?: string; shortMessage?: string; info?: { error?: { message?: string } }; message?: string };
  const inner = e?.info?.error?.message;
  if (e?.code) return `${e.code}: ${inner ?? e.shortMessage ?? "upload failed"}`;
  return String(e?.message ?? err).split(" (transaction=")[0].slice(0, 300);
}

export const storageConfigured =(cfg: ZeroGStorageConfig) => Boolean(cfg.rpcUrl && cfg.indexerUrl && cfg.privateKey);

async function sdk() {
  const [zg, ethers] = await Promise.all([import("@0gfoundation/0g-storage-ts-sdk"), import("ethers")]);
  return { zg, ethers };
}

/** Signer address + native balance on 0G Galileo (for /integrations). */
export async function storageAccount(cfg: ZeroGStorageConfig): Promise<{ address: string; balanceWei: string } | null> {
  if (!storageConfigured(cfg)) return null;
  const { ethers } = await sdk();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet = new ethers.Wallet(cfg.privateKey!, provider);
  const bal = await provider.getBalance(wallet.address);
  return { address: wallet.address, balanceWei: bal.toString() };
}

export async function archive(opts: { cfg?: ZeroGStorageConfig; artifacts: Artifact[] }): Promise<ArchiveOutcome> {
  const cfg = opts.cfg ?? {};
  if (!storageConfigured(cfg)) {
    return { status: "not_configured", refs: [], errors: opts.artifacts.map((a) => ({ kind: a.kind, error: "0G Storage not configured" })) };
  }
  const { zg, ethers } = await sdk();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const signer = new ethers.Wallet(cfg.privateKey!, provider);
  const indexer = new zg.Indexer(cfg.indexerUrl!);
  const refs: StorageRef[] = [];
  const errors: { kind: string; error: string }[] = [];

  // Preflight: an unfunded uploader can never pay the storage fee. Checking the
  // balance (one cheap read) fails fast with the real reason instead of
  // attempting every upload and waiting for each to be rejected.
  try {
    const bal = await provider.getBalance(signer.address);
    if (bal === 0n) {
      const why = `uploader ${signer.address} has 0 balance on 0G Galileo — fund it at https://faucet.0g.ai, then Retry archive`;
      return { status: "failed", refs, errors: opts.artifacts.map((a) => ({ kind: a.kind, error: why })), signer: signer.address };
    }
  } catch {
    /* balance unreadable — fall through to the real upload attempt, which reports its own error */
  }

  for (const a of opts.artifacts) {
    try {
      const text = canonicalString({ kind: a.kind, content: a.content });
      const bytes = new TextEncoder().encode(text);
      const file = new zg.MemData(bytes);
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr || !tree) throw new Error(`merkle tree: ${treeErr?.message ?? "failed"}`);
      const [res, upErr] = await indexer.upload(file, cfg.rpcUrl!, signer as never);
      if (upErr) throw upErr;
      if (!("rootHash" in res)) throw new Error("unexpected multi-fragment upload for a small artifact");

      let retrievable = false;
      if (!cfg.skipVerify) {
        const [blob, dlErr] = await indexer.downloadToBlob(res.rootHash, { proof: true });
        if (dlErr) throw new Error(`uploaded (tx ${res.txHash}) but read-back failed: ${dlErr.message}`);
        const back = new Uint8Array(await blob.arrayBuffer());
        retrievable = back.length >= bytes.length && new TextDecoder().decode(back.slice(0, bytes.length)) === text;
      }
      refs.push({
        rootHash: res.rootHash,
        txHash: res.txHash,
        kind: a.kind,
        contentHash: contentHash(a.content).digest.slice(0, 32),
        sizeBytes: bytes.length,
        ts: Math.floor(Date.now() / 1000),
        network: "0g-galileo-testnet",
        retrievable,
      });
    } catch (err) {
      errors.push({ kind: a.kind, error: conciseError(err) });
    }
  }
  return {
    status: errors.length === 0 ? "archived" : refs.length ? "partial" : "failed",
    refs,
    errors,
    signer: signer.address,
  };
}

export type { StorageRef };
