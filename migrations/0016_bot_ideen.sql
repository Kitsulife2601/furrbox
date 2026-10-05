-- Bot Ideen: dauerhafte Sanctions, Outbox-Embeds, Vote-Spiegel, Hints, Flags, Audit-Stub
-- 2026-10-05

create table if not exists mod_sanction (
  id                     text primary key,
  discord_id             text not null,
  kind                   text not null,
  reason                 text,
  moderator_discord_id   text,
  moderation_request_id  text,
  case_id                text,
  starts_at              timestamptz not null default now(),
  expires_at             timestamptz,
  active                 boolean not null default true,
  created_at             timestamptz not null default now()
);
create index if not exists mod_sanction_active_idx on mod_sanction (active, expires_at);
create index if not exists mod_sanction_discord_idx on mod_sanction (discord_id, active);

alter table mod_duty add column if not exists status text not null default 'off';
update mod_duty set status = 'on' where on_duty = true and (status is null or status = 'off');

alter table bot_outbox add column if not exists kind text not null default 'plain';
alter table bot_outbox add column if not exists embed_json text;
alter table bot_outbox add column if not exists components_json text;
alter table bot_outbox add column if not exists dedupe_key text;
alter table bot_outbox add column if not exists discord_message_id text;
alter table bot_outbox add column if not exists ref_id text;
create index if not exists bot_outbox_dedupe_idx on bot_outbox (dedupe_key, created_at desc);

create table if not exists bot_vote_mirror (
  vote_id            text primary key,
  channel_id         text not null,
  discord_message_id text,
  payload_json       text not null,
  audit_id           text,
  updated_at         timestamptz not null default now()
);

create table if not exists furr_hint (
  id                      text primary key,
  text                    text not null,
  requested_by_discord_id text,
  status                  text not null default 'queued',
  error                   text,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz
);
create index if not exists furr_hint_status_idx on furr_hint (status, created_at);

create table if not exists bot_clip_request (
  id                      text primary key,
  vote_id                 text,
  audit_id                text,
  reason                  text,
  meta_json               text,
  requested_by_discord_id text,
  status                  text not null default 'queued',
  created_at              timestamptz not null default now()
);
create index if not exists bot_clip_request_status_idx on bot_clip_request (status, created_at);

create table if not exists mod_flag (
  id         text primary key,
  kind       text not null,
  discord_id text,
  context    text,
  source     text,
  active     boolean not null default true,
  alerted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mod_flag_alert_idx on mod_flag (active, alerted, created_at);

create table if not exists mod_audit (
  id         text primary key,
  source     text not null,
  kind       text not null,
  target     text,
  target_id  text,
  detail     text,
  case_id    text,
  created_at timestamptz not null default now()
);
create index if not exists mod_audit_created_idx on mod_audit (created_at desc);

insert into furr_setting (key, value) values
  ('mod_channel_id', ''),
  ('quiet_hours_enabled', 'false'),
  ('quiet_hours_start', '23:00'),
  ('quiet_hours_end', '07:00'),
  ('quiet_hours_tz', 'Europe/Berlin'),
  ('alert_min_interval_sec', '30')
on conflict (key) do nothing;
