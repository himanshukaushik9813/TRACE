-- TRACE — initial schema (Postgres / Supabase). Applied by scripts/migrate.mjs.
--
-- Principles:
--  * Ethereum Sepolia only: every chain-dependent row carries chain_id and a
--    CHECK pins it to 11155111.
--  * Raw chain events are immutable and ingested idempotently
--    (unique (chain_id, tx_hash, log_index, token_id), ON CONFLICT DO NOTHING,
--    UPDATE/DELETE blocked by trigger).
--  * Strategy versions are immutable snapshots keyed by their content id.
--  * Look-ahead-violating backtests are rejected by the database itself.
--  * No private keys or seed phrases are ever stored.

create extension if not exists pgcrypto;

create or replace function trace_forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;

-- ----------------------------------------------------------------------
create table wallets (
  address        text primary key check (address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id       integer not null default 11155111 check (chain_id = 11155111),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_connected_at timestamptz
);

create table investigations (
  id                 uuid primary key default gen_random_uuid(),
  wallet             text not null check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id           integer not null default 11155111 check (chain_id = 11155111),
  status             text not null default 'queued'
                     check (status in ('queued','fetching','reconstructing','inferring','backtesting','archiving','done','failed')),
  progress           jsonb not null default '{}'::jsonb,
  window_days        integer,
  window_from_block  bigint,
  window_to_block    bigint,
  period_from_ts     bigint,
  period_to_ts       bigint,
  events_fingerprint text,
  summary_json       jsonb,
  notes              jsonb not null default '[]'::jsonb,
  integrations_json  jsonb not null default '{}'::jsonb,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on investigations (wallet, created_at desc);
create index on investigations (status, created_at desc);

-- Immutable raw lifecycle events (first-class blockchain evidence).
create table raw_events (
  id                  bigserial primary key,
  chain_id            integer not null default 11155111 check (chain_id = 11155111),
  tx_hash             text not null check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  log_index           integer not null,
  block               bigint not null,
  ts                  bigint not null default 0,
  kind                text not null check (kind in ('MINT','INCREASE','DECREASE','COLLECT','TRANSFER','BURN')),
  token_id            numeric not null,
  pool                text,
  owner               text,
  from_addr           text,
  to_addr             text,
  liquidity_delta     numeric not null default 0,
  amount0             numeric not null default 0,
  amount1             numeric not null default 0,
  fee0                numeric not null default 0,
  fee1                numeric not null default 0,
  tick_lower          integer not null default 0,
  tick_upper          integer not null default 0,
  gas_used            numeric,
  effective_gas_price numeric,
  ingested_at         timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index, token_id)
);
create index on raw_events (token_id, block, log_index);
create index on raw_events (tx_hash);
create trigger trg_raw_events_immutable before update or delete on raw_events
  for each row execute function trace_forbid_mutation();

create table investigation_events (
  investigation uuid not null references investigations(id) on delete cascade,
  raw_event_id  bigint not null references raw_events(id),
  primary key (investigation, raw_event_id)
);

create table positions (
  id               bigserial primary key,
  investigation    uuid not null references investigations(id) on delete cascade,
  chain_id         integer not null default 11155111 check (chain_id = 11155111),
  token_id         numeric not null,
  pool             text,
  token0           text,
  token1           text,
  symbol0          text,
  symbol1          text,
  decimals0        integer,
  decimals1        integer,
  fee_tier         integer,
  tick_lower       integer,
  tick_upper       integer,
  liquidity        numeric,
  status           text not null check (status in ('active','closed')),
  opened_block     bigint,
  closed_block     bigint,
  history_complete boolean not null default false,
  deposited0       numeric not null default 0,
  deposited1       numeric not null default 0,
  withdrawn0       numeric not null default 0,
  withdrawn1       numeric not null default 0,
  fees0            numeric not null default 0,
  fees1            numeric not null default 0,
  unique (investigation, token_id)
);

create table strategy_dna (
  investigation uuid primary key references investigations(id) on delete cascade,
  data          jsonb not null,
  computed_at   timestamptz not null default now()
);

create table inference_runs (
  id               uuid primary key default gen_random_uuid(),
  investigation    uuid not null references investigations(id) on delete cascade,
  status           text not null check (status in ('succeeded','failed','rejected','not_configured')),
  request_id       text,
  model            text,
  provider_address text,
  tee_verified     boolean,
  trust_mode       text,
  http_status      integer,
  error_code       text,
  error            text,
  usage            jsonb,
  response_hash    text,
  latency_ms       integer,
  rules_rejected   integer not null default 0,
  created_at       timestamptz not null default now()
);
create index on inference_runs (investigation, created_at desc);

-- Immutable strategy versions (content-addressed).
create table strategies (
  id                    uuid primary key default gen_random_uuid(),
  investigation         uuid not null references investigations(id) on delete cascade,
  chain_id              integer not null default 11155111 check (chain_id = 11155111),
  ir_id                 text not null unique,
  parent_ir_id          text,
  ir_json               jsonb not null,
  version_hash          text not null,
  family                text not null,
  confidence            numeric not null check (confidence >= 0 and confidence <= 1),
  provider              text not null check (provider in ('0G_ROUTER','DETERMINISTIC_ONLY')),
  role                  text not null check (role in ('evidence_baseline','ai_hypothesis')),
  inference_run         uuid references inference_runs(id),
  created_at            timestamptz not null default now()
);
create index on strategies (investigation, created_at desc);
create trigger trg_strategies_immutable before update on strategies
  for each row execute function trace_forbid_mutation();

create table backtest_runs (
  id               uuid primary key default gen_random_uuid(),
  strategy_id      uuid not null references strategies(id) on delete cascade,
  status           text not null check (status in ('completed','insufficient_data','failed')),
  reason           text,
  pool             text,
  result_json      jsonb not null,
  train_end_block  bigint not null,
  test_start_block bigint not null,
  gap_blocks       integer not null,
  lookahead_guard  text not null check (lookahead_guard in ('enforced','waived')),
  waive_reason     text,
  created_at       timestamptz not null default now(),
  constraint backtest_waiver_reason check (lookahead_guard = 'enforced' or waive_reason is not null)
);
create or replace function enforce_no_lookahead() returns trigger
language plpgsql as $$
begin
  if new.lookahead_guard = 'enforced' and new.test_start_block <= new.train_end_block then
    raise exception 'look-ahead violation: test window must start strictly after train window';
  end if;
  return new;
end $$;
create trigger trg_no_lookahead before insert or update on backtest_runs
  for each row execute function enforce_no_lookahead();

create table compatibility_reports (
  id           uuid primary key default gen_random_uuid(),
  strategy_id  uuid not null references strategies(id) on delete cascade,
  maker        text,
  verdict      text not null check (verdict in ('FULL','PARTIAL','INCOMPATIBLE')),
  report_json  jsonb not null,
  created_at   timestamptz not null default now()
);

create table execution_plans (
  id            uuid primary key default gen_random_uuid(),
  strategy_id   uuid not null references strategies(id) on delete cascade,
  chain_id      integer not null default 11155111 check (chain_id = 11155111),
  maker         text not null check (maker ~ '^0x[0-9a-fA-F]{40}$'),
  plan_hash     text not null unique,
  strategy_hash text not null,
  plan_json     jsonb not null,
  created_at    timestamptz not null default now()
);
create trigger trg_plans_immutable before update on execution_plans
  for each row execute function trace_forbid_mutation();

-- Server-issued single-use challenges (replay protection).
create table challenges (
  challenge    text primary key check (challenge ~ '^0x[0-9a-fA-F]{64}$'),
  plan_id      uuid not null references execution_plans(id) on delete cascade,
  wallet       text not null,
  action       text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create table authorizations (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references execution_plans(id) on delete cascade,
  chain_id          integer not null default 11155111 check (chain_id = 11155111),
  wallet            text not null,
  action            text not null,
  claims_json       jsonb not null,
  signature         text not null,
  validated         boolean not null,
  verification_json jsonb not null,
  world_status      text not null default 'not_configured',
  world_nullifier   text,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
create index on authorizations (plan_id, created_at desc);

create table world_nullifiers (
  nullifier  text not null,
  action     text not null,
  created_at timestamptz not null default now(),
  primary key (nullifier, action)
);

create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  chain_id            integer not null default 11155111 check (chain_id = 11155111),
  plan_id             uuid references execution_plans(id) on delete set null,
  authorization_id    uuid references authorizations(id) on delete set null,
  op                  text not null check (op in ('approve','ship','dock','swap')),
  tx_hash             text not null unique check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  from_addr           text,
  to_addr             text,
  status              text not null default 'submitted' check (status in ('submitted','success','reverted')),
  block               bigint,
  confirmations       integer,
  gas_used            numeric,
  effective_gas_price numeric,
  matches_plan        boolean,
  outcome             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on transactions (plan_id, created_at);

-- Genuine 0G Storage uploads only (a row exists only after a successful upload).
create table storage_artifacts (
  id             uuid primary key default gen_random_uuid(),
  investigation  uuid references investigations(id) on delete set null,
  strategy_id    uuid references strategies(id) on delete set null,
  kind           text not null,
  root_hash      text not null,
  tx_hash        text not null,
  content_hash   text not null,
  size_bytes     integer not null,
  network        text not null default '0g-galileo-testnet',
  retrievable    boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (root_hash, kind)
);
create index on storage_artifacts (investigation);
