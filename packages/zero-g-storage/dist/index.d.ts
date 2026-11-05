/**
 * 0G Storage archiving client.
 *
 *   - Live path: POST the artifact to the 0G storage endpoint and record the
 *     returned reference.
 *   - Demo path (no endpoint configured): produce a labelled
 *     `0G-STOR-arc_… · demo` reference locally.
 *
 * Every returned StorageRef carries `demo: boolean` so the UI can — and must —
 * show whether an archive is a real 0G write or the labelled demo reference.
 * The product rule "never claim a mocked integration is production-verified"
 * is enforced here at the data level, not just in copy.
 */
import { type StorageRef } from "@trace/strategy-ir";
export type ZeroGConfig = {
    /** 0G storage API endpoint. Omit → demo path. */
    endpoint?: string;
    apiKey?: string;
};
export type Artifact = {
    kind: string;
    content: unknown;
};
export declare function archive(opts: {
    cfg?: ZeroGConfig;
    artifacts: Artifact[];
    wallet: string;
}): Promise<StorageRef[]>;
export type { StorageRef };
