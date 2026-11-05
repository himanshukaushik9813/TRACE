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
import { type StorageRef } from "@trace/strategy-ir";
export type ZeroGStorageConfig = {
    rpcUrl?: string;
    indexerUrl?: string;
    privateKey?: string;
    /** Skip the read-back verification (default false). */
    skipVerify?: boolean;
};
export type Artifact = {
    kind: string;
    content: unknown;
};
export type ArchiveOutcome = {
    status: "archived" | "partial" | "failed" | "not_configured";
    refs: StorageRef[];
    errors: {
        kind: string;
        error: string;
    }[];
    signer?: string;
};
export declare const storageConfigured: (cfg: ZeroGStorageConfig) => boolean;
/** Signer address + native balance on 0G Galileo (for /integrations). */
export declare function storageAccount(cfg: ZeroGStorageConfig): Promise<{
    address: string;
    balanceWei: string;
} | null>;
export declare function archive(opts: {
    cfg?: ZeroGStorageConfig;
    artifacts: Artifact[];
}): Promise<ArchiveOutcome>;
export type { StorageRef };
