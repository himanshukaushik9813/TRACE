import type { IntegrationStatus } from "@/lib/api";

/** Integration statuses in plain words, for people who don't read status codes. */
export const PLAIN_STATUS: Record<IntegrationStatus, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  "VERIFIED LIVE": { label: "Working", tone: "good" },
  "VERIFIED TESTNET": { label: "Working on Sepolia", tone: "good" },
  "IMPLEMENTED BUT NOT VERIFIED": { label: "Ready, not yet proven by a real transaction", tone: "warn" },
  "BLOCKED BY EXTERNAL DEPENDENCY": { label: "Unavailable", tone: "bad" },
  "NOT IMPLEMENTED": { label: "Not built", tone: "neutral" },
};

export const plainStatus = (s: IntegrationStatus | string | undefined) => PLAIN_STATUS[s as IntegrationStatus] ?? { label: String(s ?? "Unknown"), tone: "neutral" as const };
