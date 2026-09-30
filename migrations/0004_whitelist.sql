-- Whitelist: only listed Discord users (plus Discord staff) may use FurrBox. Managed by Owner/Dev.
create table if not exists furr_whitelist (
  discord_id text primary key,
  note       text not null default '',
  added_by   text,
  created_at timestamptz not null default now()
);
insert into furr_setting (key, value) values ('whitelist_enabled', 'true') on conflict (key) do nothing;
