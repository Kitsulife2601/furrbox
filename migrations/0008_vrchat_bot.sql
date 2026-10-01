-- VRChat now runs through the Discord bot on the owner's PC (VRChat ties a login to the
-- address it came from, which changes on every Vercel request). FurrBox queues jobs here,
-- the bot executes them and reports results + the current group state.
create table if not exists vrchat_job (
  id           text primary key,
  kind         text not null,
  payload_json text,
  status       text not null default 'queued',
  result_json  text,
  error        text,
  requested_by text not null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists vrchat_job_status_idx on vrchat_job (status, created_at);

alter table vrchat_connection add column if not exists state_at timestamptz;
-- Login cookies are no longer kept on the server.
update vrchat_connection set auth_cookie = null, two_factor_cookie = null, pending_cookie = null, pending_methods = null;
