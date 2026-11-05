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

import {
  contentHash,
  type StorageRef,
} from "@trace/strategy-ir";

export type ZeroGConfig = {
  /** 0G storage API endpoint. Omit → demo path. */
  endpoint?: string;
  apiKey?: string;
};

export type Artifact = {
  kind: string; // "investigation summary" | "inference output" | "backtest report" | …
  content: unknown; // the IR object to persist
};

export async function archive(opts: {
  cfg?: ZeroGConfig;
  artifacts: Artifact[];
  wallet: string;
}): Promise<StorageRef[]> {
  const cfg = opts.cfg ?? {};
  const base = Date.now();

  if (!cfg.endpoint) {
    // Demo path: labelled references, content hashed for reproducibility.
    return opts.artifacts.map((a, i) => ({
      ref: `0G-STOR-arc_${hex2(base + i)} · demo`,
      kind: a.kind,
      contentHash: contentHash(a.content).digest.slice(0, 16),
      sizeBytes: new TextEncoder().encode(JSON.stringify(a.content)).length,
      ts: base + i,
      demo: true,
    }));
  }

  // Live path: POST each artifact. A failed live write is a hard error — we
  // never silently degrade to a demo ref and call it real.
  const out: StorageRef[] = [];
  for (const a of opts.artifacts) {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        kind: a.kind,
        wallet: opts.wallet,
        content: a.content,
      }),
    });
    if (!res.ok) {
      throw new Error(`0G storage archive failed (${res.status}) for ${a.kind}`);
    }
    const json = (await res.json()) as { ref: string; sizeBytes?: number };
    out.push({
      ref: json.ref,
      kind: a.kind,
      contentHash: contentHash(a.content).digest.slice(0, 16),
      sizeBytes: json.sizeBytes ?? new TextEncoder().encode(JSON.stringify(a.content)).length,
      ts: Math.floor(Date.now() / 1000),
      demo: false,
    });
  }
  return out;
}

function hex2(n: number): string {
  return n.toString(16).slice(-4);
}

export type { StorageRef };
