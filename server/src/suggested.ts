/**
 * "More real liquidity providers found on Sepolia right now" (GET /wallets/suggested).
 *
 * The list comes from a live scan of recent Uniswap V3 position mints on
 * Sepolia, which is a heavy read. It is optional on the page, so this module
 * keeps it from hurting the rest of the app:
 *
 * - a successful scan is cached for `ttlMs` (10 minutes);
 * - concurrent requests share one in-flight scan (no bursts of scans);
 * - when the Sepolia RPC rate-limits or is unreachable, the last good result is
 *   served (marked `stale`), or, with no good result yet, the caller gets a 503
 *   with a plain reason and a `retryAfterSec`, and no new scan is started until
 *   that back-off has passed;
 * - any other error is passed on unchanged (a real bug stays a 500).
 *
 * Nothing is fabricated: a 503 means "no list right now", never a fake list.
 */

/** Upstream conditions that are not TRACE bugs: the RPC said "slow down" or could not be reached. */
const UPSTREAM_CODES = new Set(["RATE_LIMITED", "RPC_UNREACHABLE"]);

export type SuggestedResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 503; body: { error: string; code: string; retryAfterSec: number }; retryAfterSec: number };

export function createSuggestedWallets(
  scan: () => Promise<Record<string, unknown>>,
  opts: { ttlMs?: number; backoffMs?: number; now?: () => number } = {},
) {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const backoffMs = opts.backoffMs ?? 60_000;
  const now = opts.now ?? Date.now;

  let good: { at: number; data: Record<string, unknown> } | null = null;
  let inflight: Promise<Record<string, unknown>> | null = null;
  let backoffUntil = 0;
  let lastCode = "RATE_LIMITED";

  const unavailable = (): SuggestedResult => {
    const retryAfterSec = Math.max(1, Math.ceil((backoffUntil - now()) / 1000));
    if (good) return { status: 200, body: { ...good.data, stale: true, staleSince: new Date(good.at).toISOString() } };
    return {
      status: 503,
      retryAfterSec,
      body: {
        error:
          lastCode === "RATE_LIMITED"
            ? "The Sepolia RPC is rate-limiting TRACE right now, so live wallet suggestions are temporarily unavailable."
            : "The Sepolia RPC could not be reached, so live wallet suggestions are temporarily unavailable.",
        code: lastCode,
        retryAfterSec,
      },
    };
  };

  return async function get(): Promise<SuggestedResult> {
    if (good && now() - good.at <= ttlMs) return { status: 200, body: good.data };
    if (now() < backoffUntil) return unavailable();
    try {
      inflight ??= scan().finally(() => {
        inflight = null;
      });
      const data = await inflight;
      good = { at: now(), data };
      return { status: 200, body: data };
    } catch (err) {
      // Classified chain errors carry a code; an unclassified provider error is
      // recognised by its text (the Render logs showed a bare "Too Many Requests").
      const msg = String((err as Error)?.message ?? err);
      const code = (err as { code?: string })?.code ?? (/429|rate limit|too many requests/i.test(msg) ? "RATE_LIMITED" : "");
      if (!UPSTREAM_CODES.has(code)) throw err;
      lastCode = code;
      backoffUntil = now() + backoffMs;
      return unavailable();
    }
  };
}
