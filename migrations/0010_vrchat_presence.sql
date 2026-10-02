-- Weltenkarte: team members who chose to share where they are in VRChat. Written by their own
-- FurrBox desktop app (own VRChat login) about once a minute; removed when they stop sharing.
create table if not exists vrchat_presence (
  user_id        text primary key,
  vrchat_user_id text not null,
  vrchat_name    text,
  image          text,
  location       text not null,
  world_name     text,
  world_image    text,
  updated_at     timestamptz not null default now()
);
