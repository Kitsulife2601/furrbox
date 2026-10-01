-- VRChat group audit log (read by the bot): every moderation done in VRChat itself –
-- warnings, kicks, bans, … – with time, moderator, target and details.
create table if not exists vrchat_audit (
  id           text primary key,
  created_at   timestamptz not null,
  actor_id     text,
  actor_name   text,
  target_id    text,
  event_type   text not null,
  description  text,
  data_json    text,
  received_at  timestamptz not null default now()
);
create index if not exists vrchat_audit_created_idx on vrchat_audit (created_at desc);
create index if not exists vrchat_audit_type_idx on vrchat_audit (event_type);
