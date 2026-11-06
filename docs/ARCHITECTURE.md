# Architecture

```
 Browser (Next.js 14, wagmi + viem, Sepolia only)
   │  reads: TRACE API          writes: user's wallet (MetaMask) → Sepolia
   ▼
 TRACE API (Express)  ──queue──►  Worker (BullMQ on Upstash Redis, TLS)
   │                                   │
   │                                   ▼
   │                        Investigation pipeline
   │                         1. chain-data      Sepolia logs, positions(), receipts, Swap prices
   │                         2. uniswap-v3      reconstruction (principal ≠ fees)
   │                         3. strategy-inference  Strategy DNA + evidence baseline
   │                                            + 0G Router hypothesis → deterministic gate
   │                         4. backtester      look-ahead-safe replay on real swaps
   │                         5. zero-g-storage  0G Galileo upload + verified read-back
   ▼                                   ▼
 Postgres (Supabase) ◄──────────── persistence (immutable raw events + strategy versions)

 Execute flow (API, on demand):
   aqua-adapter  on-chain compatibility checks → SwapVM order (official 1inch SDK) → plan
   authorization challenge → EIP-712 signature by the user → server verification
   aqua-adapter  receipt verification of approve / ship / dock (events + virtual balances)
```

## Packages

| Package | Responsibility |
|---|---|
| `packages/chain-config` | Single source of truth: Sepolia chain, verified contract addresses (with sources), explorer links, integration status labels. No dependencies; used by the browser and the server. |
| `packages/strategy-ir` | Shared data contract (IR v2), validators, canonical hashing (FNV-1a 128), content-addressed strategy ids. |
| `packages/chain-data` | viem client: ERC-721 discovery, lifecycle logs, Multicall3 metadata, Collect fee/principal split, pool Swap price series, active-LP discovery. Typed errors with secrets scrubbed; shared rate limiter. |
| `packages/uniswap-v3` | Order-independent reconstruction and decimal-normalised accounting. |
| `packages/strategy-inference` | Strategy DNA fingerprints, deterministic families and rules, the 0G Router client and the evidence gate. |
| `packages/backtester` | Canonical V3 position math on real swaps, fee model from swap flow, enforced train/test split. |
| `packages/aqua-adapter` | Rule-by-rule compatibility, on-chain checks, SwapVM compile, simulation, receipt verification. |
| `packages/authorization` | EIP-712 typed data and server-side verification of the wallet authorization. |
| `packages/zero-g-storage` | Genuine 0G Storage uploads with Merkle-proof read-back. |
| `server/` | Config validation, integration probes, Express routes, BullMQ worker, Postgres layer. |
| `src/` | Next.js app: 8 screens, wagmi wallet, network guard, real-data hooks. |

## Data model

The migrations in `db/migrations/` are applied by `scripts/migrate.mjs`.

- `raw_events` are immutable: a trigger blocks UPDATE and DELETE. Ingestion is idempotent through the unique key `(chain_id, tx_hash, log_index, token_id)`. Each investigation links to its events in `investigation_events`.
- `strategies` are immutable and content-addressed by `ir_id`. A 0G hypothesis records its evidence baseline as `parent_ir_id`.
- `backtest_runs` have a database-level no-look-ahead trigger.
- `execution_plans` are immutable and have a unique `plan_hash`.
- `challenges` are single-use and consumed atomically. They feed `authorizations`.
- `transactions` hold receipt-verified status, confirmations, gas, whether the calldata matched the plan, and the outcome.
- `storage_artifacts` has a row only after a successful upload.
- Every chain-dependent row carries `chain_id` with `CHECK (chain_id = 11155111)`.

## Request lifecycle (investigation)
1. `POST /investigations {wallet, days}` creates a row and queues a BullMQ job (15-minute lock, no stalled re-runs).
2. The worker updates `status` and `progress` at each stage. The UI polls `GET /investigations/:id`.
3. Every result is persisted. `GET /investigations/:id/full` returns everything the screens render.
