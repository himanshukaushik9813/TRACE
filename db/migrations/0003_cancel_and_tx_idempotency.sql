-- Restart / new investigation: a superseded run is cancelled, not left running.
-- 'cancelled' is terminal; workers check it between stages and stop writing.
alter table investigations drop constraint if exists investigations_status_check;
alter table investigations add constraint investigations_status_check
  check (status in ('queued','fetching','reconstructing','inferring','backtesting','archiving','done','no_positions','failed','cancelled'));

-- Duplicate-submission guard at the database level: a plan can have at most one
-- ship transaction that is pending or confirmed. A reverted ship may be retried.
create unique index if not exists transactions_one_live_ship
  on transactions (plan_id) where op = 'ship' and status in ('submitted', 'success');
