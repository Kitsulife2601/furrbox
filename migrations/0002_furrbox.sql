-- FurrBox core schema: profiles/roles, presence, FurrFS, chat, Discord bridge, moderation.

create table if not exists furr_profile (
  user_id      text primary key,
  username     text not null unique,
  display_name text not null,
  discord_id   text unique,
  role         text not null default 'member',
  created_at   timestamptz not null default now()
);

create table if not exists furr_presence (
  user_id           text primary key,
  platform          text not null default 'desktop',
  connected_at      timestamptz,
  last_heartbeat_at timestamptz,
  last_seen_at      timestamptz
);

-- FurrFS: private files belong to owner_id, public files have owner_id null.
-- `folder` is the virtual parent path ("" = root, "Dokumente/Bilder" = nested).
create table if not exists furr_file (
  id          text primary key,
  scope       text not null,
  owner_id    text,
  created_by  text,
  folder      text not null default '',
  name        text not null,
  is_folder   boolean not null default false,
  mime_type   text not null default 'application/octet-stream',
  size        integer not null default 0,
  content_b64 text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists furr_file_unique_name
  on furr_file (scope, coalesce(owner_id, ''), folder, name);
create index if not exists furr_file_folder_idx on furr_file (scope, owner_id, folder);

create table if not exists chat_message (
  id           text primary key,
  channel      text not null,
  sender_id    text not null,
  recipient_id text,
  content      text not null,
  created_at   timestamptz not null default now()
);
create index if not exists chat_message_channel_idx on chat_message (channel, created_at);

create table if not exists furr_setting (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into furr_setting (key, value) values ('chat_retention_days', '7') on conflict (key) do nothing;

create table if not exists furr_notification (
  id          serial primary key,
  audience    text not null default 'team',
  version     text not null default 'FurrBox',
  title       text not null,
  description text not null,
  created_at  timestamptz not null default now()
);

-- Synced from the Discord bot through the bridge API (/api/bridge/*).
create table if not exists discord_member (
  discord_id        text primary key,
  username          text not null,
  nickname          text,
  display_name      text not null,
  role_names        text not null default '[]',
  highest_privilege text not null default 'none',
  discord_status    text not null default 'offline',
  last_presence_at  timestamptz,
  synced_at         timestamptz not null default now()
);

-- Moderation commands queued by FurrBox, executed by the Discord bot.
create table if not exists moderation_request (
  id                  text primary key,
  action              text not null,
  moderator_user_id   text not null,
  moderator_discord_id text not null,
  target_discord_id   text not null,
  reason              text not null,
  duration_ms         integer,
  status              text not null default 'queued',
  error               text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists moderation_request_status_idx on moderation_request (status, created_at);

create table if not exists message_inspect (
  id           text primary key,
  message_id   text not null,
  requested_by text not null,
  status       text not null default 'queued',
  result_json  text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
