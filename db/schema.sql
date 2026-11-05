-- TRACE — Postgres / Supabase schema.
--
-- Design notes:
--  * Every table that can be filled from a live chain read carries a
--    `source` column: 'live' | 'demo_fixture' | 'deterministic'.
--    The UI's DemoBadge derives from this, not from a global flag.
--  * Strategy IR rows are immutable snapshots keyed by content hash
--    (strategy_version_hash) — a strategy version, once issued, is never
--    edited in place. New inference = new row.
--  * Authorizations pin (strategy_version_hash, program_hash, challenge);
--    replay protection lives in `challenges`.

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------
create table investigations (
  id                uuid primary key default gen_random_uuid(),
  wallet             text not null,
  chain_id           integer not null default 1,
  status             text not null default 'queued'
                    check (status in ('queued','reconstructing','done','failed')),
  source             text not null default 'live'
                    check (source in ('live','demo_fixture','deterministic')),
  period_from_ts     bigint,
  period_to_ts       bigint,
  -- Filled in by the worker when the run completes; empty until then.
  events_fingerprint text not null default '',
  summary_json       jsonb not null default '{}'::jsonb,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on investigations (wallet, created_at desc);

-- Reconstructed lifecycle events (first-class blockchain evidence).
create table events (
  id              bigserial primary key,
  investigation   uuid not null references investigations(id) on delete cascade,
  tx              text not null,
  block           bigint not null,
  log_index       integer not null,
  ts              bigint not null default 0,
  kind            text not null check (kind in ('MINT','INCREASE','DECREASE','COLLECT','TRANSFER','BURN')),
  token_id        bigint not null,
  owner           text,
  liquidity_delta bigint not null default 0,
  amount0         bigint not null default 0,
  amount1         bigint not null default 0,
  fee0            bigint not null default 0,
  fee1            bigint not null default 0,
  tick_lower      integer not null default 0,
  tick_upper      integer not null default 0,
  note            text
);
create index on events (investigation, block, log_index);
create index on events (tx);

-- Reconstructed V3 positions + accounting (principal ≠ fees, enforced in the
-- column split — no single "value" column that mixes the two).
create table positions (
  id             bigserial primary key,
  investigation  uuid not null references investigations(id) on delete cascade,
  token_id       bigint not null,
  pool           text,
  token0         text,
  token1         text,
  fee_tier_bps   integer,
  tick_lower     integer,
  tick_upper     integer,
  liquidity      numeric,
  status         text not null check (status in ('active','closed')),
  deposited_t0   numeric not null default 0,
  deposited_t1   numeric not null default 0,
  withdrawn_t0   numeric not null default 0,
  withdrawn_t1   numeric not null default 0,
  fees_collected_t0 numeric not null default 0,
  fees_collected_t1 numeric not null default 0,
  unique (investigation, token_id)
);

-- Behavioural fingerprints (deterministic layer output).
create table fingerprints (
  investigation  uuid primary key references investigations(id) on delete cascade,
  data           jsonb not null,
  computed_at    timestamptz not null default now()
);

-- Immutable strategy versions (Strategy IR snapshots).
create table strategies (
  id                     uuid primary key default gen_random_uuid(),
  investigation          uuid not null references investigations(id) on delete cascade,
  ir_json               jsonb not null,
  ir_id                  text not null,          -- deterministic IR id
  strategy_version_hash  text not null,
  family                 text not null,
  confidence             numeric check (confidence >= 0 and confidence <= 1),
  source                 text not null check (source in ('0G_PRIVATE_COMPUTER','DETERMINISTIC_ONLY','demo_fixture')),
  attested               boolean not null default false,
  schema_valid           boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (investigation, strategy_version_hash)
);
create index on strategies (ir_id);

-- Look-ahead-safe backtests.
create table backtests (
  id               uuid primary key default gen_random_uuid(),
  strategy_id      uuid not null references strategies(id) on delete cascade,
  result_json      jsonb not null,
  train_end_block  bigint not null,
  test_start_block bigint not null,
  gap_blocks       integer not null,
  lookahead_guard  text not null check (lookahead_guard in ('enforced','waived')),
  waive_reason     text,
  created_at       timestamptz not null default now(),
  constraint no_lookahead check (
    lookahead_guard = 'waived'
    or waive_reason is not null
    or test_start_block > train_end_block
  )
);
-- In addition, a trigger rejects look-ahead splits at the database level,
-- so no code path can store a violated invariant.
create or replace function enforce_no_lookahead() returns trigger
language plpgsql as $$
begin
  if new.lookahead_guard = 'enforced' and new.test_start_block <= new.train_end_block then
    raise exception 'look-ahead violation: test window must start strictly after train window';
  end if;
  return new;
end $$;
create trigger trg_no_lookahead before insert or update on backtests
  for each row execute function enforce_no_lookahead();

-- Deterministic Aqua programs.
create table aqua_programs (
  id           uuid primary key default gen_random_uuid(),
  strategy_id  uuid not null references strategies(id) on delete cascade,
  program_json jsonb not null,
  program_hash text not null,
  compatibility_json jsonb not null,
  verdict      text not null check (verdict in ('FULL','PARTIAL','INCOMPATIBLE')),
  created_at   timestamptz not null default now()
);

-- Authorization challenges (replay protection, server-side only).
create table challenges (
  challenge   text primary key,
  strategy_id uuid not null references strategies(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  consumed_at timestamptz
);

-- World Agent Pass proofs.
create table authorizations (
  id                    uuid primary key default gen_random_uuid(),
  strategy_id           uuid not null references strategies(id) on delete cascade,
  program_id            uuid references aqua_programs(id),
  world_id              text not null,
  claims_json           jsonb not null,
  signature             text not null,
  validated             boolean not null default false,
  validation_json       jsonb not null default '{}'::jsonb,
  status                text not null default 'pending'
                        check (status in ('pending','authorized','rejected','expired','consumed')),
  issued_at             timestamptz not null default now()
);
create index on authorizations (strategy_id, status);

-- 0G Storage archives.
create table archives (
  ref          text not null,
  kind         text not null,
  content_hash text not null,
  size_bytes   integer,
  source       text not null check (source in ('0G_LIVE','0G_DEMO')),
  investigation uuid references investigations(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on archives (content_hash);
