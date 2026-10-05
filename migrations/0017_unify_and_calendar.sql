-- Unify mod_sanction (Bot-Schema discord_id/kind ↔ Server platform/target_id/type)
-- + Kalender-Cache für Group Calendar Bridge. Idempotent.

alter table mod_sanction add column if not exists platform text;
alter table mod_sanction add column if not exists target_id text;
alter table mod_sanction add column if not exists target_name text;
alter table mod_sanction add column if not exists type text;
alter table mod_sanction add column if not exists created_by text;
alter table mod_sanction add column if not exists lifted_at timestamptz;
alter table mod_sanction add column if not exists lifted_by text;

-- Bot-Spalten (falls nur Server-Migration lief)
alter table mod_sanction add column if not exists discord_id text;
alter table mod_sanction add column if not exists kind text;
alter table mod_sanction add column if not exists moderator_discord_id text;
alter table mod_sanction add column if not exists moderation_request_id text;
alter table mod_sanction add column if not exists starts_at timestamptz;

-- Backfill Server ← Bot
update mod_sanction
set platform = coalesce(nullif(platform, ''), 'discord'),
    target_id = coalesce(nullif(target_id, ''), discord_id),
    type = coalesce(nullif(type, ''), kind),
    created_by = coalesce(nullif(created_by, ''), nullif(moderator_discord_id, ''), 'bot')
where (target_id is null or target_id = '' or type is null or type = '');

-- Backfill Bot ← Server
update mod_sanction
set discord_id = coalesce(nullif(discord_id, ''), case when platform = 'discord' then target_id else null end),
    kind = coalesce(nullif(kind, ''), type)
where (discord_id is null or kind is null) and target_id is not null;

-- Defaults für neue Writes
alter table mod_sanction alter column platform set default 'discord';
update mod_sanction set platform = 'discord' where platform is null;
alter table mod_sanction alter column platform set not null;

update mod_sanction set created_by = 'system' where created_by is null or created_by = '';
alter table mod_sanction alter column created_by set default 'system';

-- Kalender-Events (Bot/Mock füllt, Server liest – Idle-sparsam)
create table if not exists group_calendar_event (
  id            text primary key,
  group_id      text not null,
  title         text not null,
  description   text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  category      text,
  image_url     text,
  source        text not null default 'mock',  -- mock | vrchat | bot
  raw_json      text,
  updated_at    timestamptz not null default now()
);
create index if not exists group_calendar_starts_idx on group_calendar_event (group_id, starts_at);

create table if not exists group_calendar_reminder (
  event_id      text not null references group_calendar_event(id) on delete cascade,
  kind          text not null default 'starting_soon',
  fired_at      timestamptz not null default now(),
  primary key (event_id, kind)
);

-- Event-Feed Typen (changelog / system) – gleiche alert_event Tabelle, Setting für Group-ID
insert into furr_setting (key, value) values
  ('vrchat_calendar_group_id', ''),
  ('vrchat_calendar_mock', 'true'),
  ('calendar_soon_minutes', '30'),
  ('status_web_poll_ms', '15000')
on conflict (key) do nothing;
