# TRACE UI redesign: audit and plan

Living record of the frontend redesign. Each phase ships as one commit and
waits for explicit approval before the next starts. Backend, API contracts,
database schema, wallet connection, Sepolia, Aqua and 0G stay untouched unless
a change is called out below with its reason and approved first.

## Decisions (approved)

| Topic | Decision |
|---|---|
| Palette | The brief's palette exactly: background #F7F3EB, card #FFFFFF, secondary #F3EBDD, text #171714, secondary text #77736A, gold #B68A42, muted gold #C6A66B, green #278653, border #E9E2D6. Light theme only. |
| Fonts | Playfair Display for page titles; Inter for body text and UI; tabular numerals. |
| World ID | Stays removed (commit 346d407). No placeholder verification UI. Revisit later. |
| 3D | Built in code with Three.js / React Three Fiber, driven by real application data, with WebGL and reduced-motion fallbacks. No generated image assets unless decided later. |
| Components | Reuse and restyle `src/components/ui.tsx`; no new component library. |

## Audit summary (Nov 7, 2026)

Working live: Sepolia RPC, Uniswap V3 data, investigation pipeline, strategy
inference (rule-based; 0G inference unavailable), backtest (794 real swaps),
What-if, Aqua compatibility, plan, EIP-712 authorization, approve and ship on
Sepolia, reports with JSON download, database and job queue. 25 API routes,
96/96 unit tests.

Partial (shown honestly in the UI): 0G Storage archive (uploader account
unfunded), 0G inference (`no_provider_for_trust_mode`).

## Phase 0 (done, commit e6a4d7a, deployed and verified)

1. Positions 3D terrain: the draft files were deployed by mistake; replaced with
   the verified final versions, now using `lib/terrain-data.ts`. Verified live.
2. Understand step showed "Running" while a finished investigation's results
   loaded. Now "Finished: Analysis finished; loading the result", and
   "Unavailable" if the load fails. Verified live on real runs with the result
   request delayed (5 s) and forced to fail, plus recovery.

Checks: typecheck, lint, 96/96 unit tests; all 7 pages at 1440 px and 390 px
with no console errors and no page-level horizontal overflow. A local
production build and the Playwright E2E suite cannot run in the available
sandboxes (no network); the Vercel deploy is the production build.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Two bug fixes above | Done |
| 1 | Theme tokens: palette, fonts, 8 px spacing (tailwind.config.js, globals.css) | Awaiting approval |
| 2 | Layout: 232 px sidebar (Investigate, Positions, Strategy, Backtest, Execute, Reports, Activity), mobile drawer, shared page header | Not started |
| 3 | Investigate page polish plus the bug fixes below | Not started |
| 4 | Positions, Strategy, Backtest, Execute, Reports, Activity on one page pattern | Not started |
| 5 | Shared lazy R3F 3D kit, one data-driven scene per page, fallbacks | Not started |
| 6 | Final verification and deliverables | Not started |

After every phase: typecheck, lint, unit tests, then live screenshots at
1440x900, 1280x800, 768 and 390x844 with console checks.

## Phase 3 additions: bugs found after Phase 0

### 3.1 Panels show steps as still running after they finished (frontend)

While `/investigations/:id/full` loads, and after it fails, the Investigate
panels keep their in-progress copy: Main position says "Rebuilding the
wallet's positions from its transactions…" and Performance says "Testing the
strategy on the pool's real past trades…", although both stages finished on
the server. Cause: `src/app/page.tsx` renders those placeholders whenever
`fullData` is null, which covers "still running", "finished, result loading"
and "result failed to load" alike.

Fix: drive each panel from the investigation's real status. Running stage:
its current progress text. Finished but loading: "Loading the result".
Load failed: a short failure line pointing at the retry in 3.2. No panel may
claim a stage is running unless the server says it is.

### 3.2 No retry on the results error (frontend)

The error box shows "Something went wrong" and the raw message with no
action; retrying currently happens only when the window regains focus.

Fix: a "Try again" button that calls the existing results query's refetch
(`GET /investigations/:id/full`). It never POSTs `/investigations`, so no
duplicate investigation is created. Plain-language message, technical detail
folded away.

### 3.3 The two console 500 errors (backend change needed; approval required)

Identified from Render application logs (Render's free plan keeps no
per-request logs, so the route is inferred from the code and timing):

- 11 `[api] error: Too Many Requests` entries in the last 24 h, all just after
  a new deploy (instances lxg5b, 5b97n, 5cr5l, cvcdt), in bursts of up to 6.
- Cause, with high confidence: `GET /wallets/suggested` (called on every
  Investigate page load for "More real liquidity providers found on Sepolia
  right now"). It runs a live scan of about 50,000 Sepolia blocks
  (`findActiveLpWallets`) with no error handling. Success is cached for 10
  minutes per instance; failure is not cached, so a fresh instance under the
  Sepolia RPC's rate limit fails on each load. The upstream 429 reaches the
  catch-all error handler and goes out as a 500, and the frontend retries the
  query 3 times, producing the bursts.
- Not reproducible now: 27 page loads across all 7 pages returned 200 for
  every API call, because the cache is warm.

This is a genuine bug: an upstream rate limit reported as a server crash,
plus repeated heavy scans while rate-limited. Proposed fix (backend, small,
needs approval because it touches the API):
1. `/wallets/suggested`: on an upstream rate limit, serve the last good result
   if one exists; otherwise answer 503 with a clear message and a short
   back-off before scanning again. Response shape unchanged on success.
2. Frontend: do not retry this query on 503, and simply hide the optional
   suggestions list when it is unavailable. Nothing is suppressed: the error
   stays visible in logs and the network panel, and the main investigation is
   unaffected.

### 3.4 "Try an example wallet" always creates a duplicate run (frontend)

Verified live: the button calls the same `run()` as Investigate. It fills the
input and POSTs `/investigations` immediately (one request,
`{"wallet":"0x4797…eb4c","days":30,"restart":false}`), replacing the
investigation on screen. The server reuses only a run that is still in
progress, so when the example wallet's finished result is already displayed
it starts a new duplicate run (seen: 0ecee0a4… replaced by 1482a382…).
Correction: the earlier report that it "didn't start" came from a mis-aimed
test click, not from the app.

Fix: make the action explicit and avoid duplicates. If the example wallet's
finished investigation is already displayed, the button does nothing new and
says so; if a recent finished investigation of the example wallet exists,
open it instead of re-running (using the existing recent-investigations data);
otherwise start one. Running again stays available through "Restart
investigation". Button label and tooltip state what will happen.

### 3.5 Activity list grows without limit, and silently caps at 50 (backend change needed; approval required)

`/activity` renders every investigation of the wallet as one flat list (32
for the demo wallet: 31 finished, 1 cancelled; 0 transactions). The API
(`GET /activity/:wallet`) returns at most the newest 50 investigations and
100 transactions, so beyond 50 older records disappear from the page, though
they remain in the database.

Fix: show the newest 10 with "Load more". To reach records past 50 without
deleting anything, add optional, backward-compatible paging to
`GET /activity/:wallet` (`limit`, plus a `before` timestamp cursor). Existing
callers that send neither keep today's response exactly. Nothing is deleted
or hidden permanently.

### Test plan for these fixes

Typecheck, lint, unit tests (plus new unit tests for the API paging and the
suggested-wallets rate-limit path), then live checks: a real investigation
with the result request delayed and forced to fail (panels and retry), the
example button on an empty page, on its own finished result and on another
wallet, Activity paging past 10 and past 50 records, and the console on all
7 pages.
