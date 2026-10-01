-- VRChat group link: one connected VRChat account (cookies only, never the password),
-- cached group instances and VRChat group moderation log.
create table if not exists vrchat_connection (
  id                integer primary key default 1,
  auth_cookie       text,
  two_factor_cookie text,
  pending_cookie    text,
  pending_methods   text,
  account_id        text,
  account_name      text,
  group_id          text,
  group_json        text,
  group_fetched_at  timestamptz,
  instances_fetched_at timestamptz,
  connected_by      text,
  connected_at      timestamptz,
  last_error        text
);

create table if not exists vrchat_instance (
  instance_id  text primary key,
  location     text not null,
  world_id     text,
  world_name   text,
  world_image  text,
  capacity     integer,
  member_count integer not null default 0,
  region       text,
  access_type  text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  closed_at    timestamptz
);

create table if not exists vrchat_moderation (
  id                text primary key,
  action            text not null,
  target_user_id    text not null,
  target_name       text,
  reason            text not null,
  moderator_user_id text not null,
  status            text not null,
  error             text,
  created_at        timestamptz not null default now()
);
