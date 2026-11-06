-- Execution is authorized by the user's EIP-712 wallet signature only.
-- Drop the retired third-party human-verification columns and table.
alter table authorizations drop column if exists world_status;
alter table authorizations drop column if exists world_nullifier;
drop table if exists world_nullifiers;
