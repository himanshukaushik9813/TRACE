-- A wallet with no Uniswap V3 positions in the window is a valid, completed
-- result — not a failure. Give it its own terminal status, and migrate rows
-- that were previously recorded as failed with NO_EVENTS.
alter table investigations drop constraint if exists investigations_status_check;
alter table investigations add constraint investigations_status_check
  check (status in ('queued','fetching','reconstructing','inferring','backtesting','archiving','done','no_positions','failed'));

update investigations
   set status = 'no_positions',
       progress = progress || jsonb_build_object('message', regexp_replace(coalesce(error, ''), '^NO_EVENTS:\s*', '')),
       error = null
 where status = 'failed' and progress->>'errorCode' = 'NO_EVENTS';
