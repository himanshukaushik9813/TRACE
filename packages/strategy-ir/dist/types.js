/**
 * TRACE — Strategy IR v1 (shared data contract).
 *
 * This module is the single source of truth for the shapes that flow through
 * the pipeline: chain-data → reconstruction → inference → backtest →
 * compatibility/compile → proof claims. Zero runtime dependencies: it must
 * run unchanged in the browser, the Express API, and the BullMQ worker.
 *
 * Integrity rules encoded here:
 *  - Every event carries a tx reference (blockchain evidence is first-class).
 *  - Accounting keeps principal withdrawals strictly distinct from fees.
 *  - Strategy proposals are hypotheses with evidence refs, not claims.
 *  - Backtests carry their train/test split and assumptions.
 *  - Proofs are bound to (user, strategy version, plan hash, action, expiry,
 *    challenge) and are validated server-side.
 */
export {};
