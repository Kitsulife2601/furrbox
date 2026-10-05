-- FurrBox 2.0.26: Sanctions, unified audit, votekick sessions, alert bus,
-- chatbox hints, watchlist, anti-troll flags, ban undo. Append-only where noted.

-- ---------- Duty: on | off | away (on_duty bleibt für bestehende Queries) ----------
alter table mod_duty add column if not exists status text not null default 'off';
update mod_duty set status = case when on_duty then 'on' else 'off' end where status is null or status = 'off' and on_duty;
-- Sync trigger-ähnlich: status ist Quelle der Wahrheit bei neuen Writes.

-- ---------- Persistente Strafen (Bot-Reconcile nach Restart) ----------
create table if not exists mod_sanction (
  id           text primary key,
  platform     text not null default 'discord',  -- discord | vrchat
  target_id    text not null,                    -- discord snowflake oder usr_…
  target_name  text,
  type         text not null,                    -- mute | timeout | ban | warn
  reason       text not null,
  case_id      text,
  expires_at   timestamptz,                      -- null = permanent
  created_by   text not null,
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz,
  lifted_by    text,
  active       boolean not null default true
);
create index if not exists mod_sanction_active_idx on mod_sanction (active, expires_at) where active;
-- 0016_bot_ideen.sql (sortiert davor) legt mod_sanction mit Bot-Schema an (discord_id/kind),
-- dann greift das create table oben nicht. Spalten für die Indizes sicherstellen;
-- Backfill/Vereinheitlichung macht 0017_unify_and_calendar.sql.
alter table mod_sanction add column if not exists platform text not null default 'discord';
alter table mod_sanction add column if not exists target_id text;
create index if not exists mod_sanction_target_idx on mod_sanction (platform, target_id, active);
create index if not exists mod_sanction_case_idx on mod_sanction (case_id) where case_id is not null;

-- ---------- Gemeinsames Audit (append-only) ----------
create table if not exists furr_audit (
  id          text primary key,
  at          timestamptz not null default now(),
  source      text not null,          -- discord | vrchat | furrbox | desktop | bot
  actor_id    text,
  actor_name  text,
  action      text not null,          -- duty.on | whitelist.add | votekick.result | …
  target_id   text,
  target_name text,
  case_id     text,
  detail      text,                   -- keine Secrets
  meta_json   text
);
create index if not exists furr_audit_at_idx on furr_audit (at desc);
create index if not exists furr_audit_case_idx on furr_audit (case_id, at desc) where case_id is not null;
create index if not exists furr_audit_action_idx on furr_audit (action, at desc);

-- ---------- Votekick-Sessions ----------
create table if not exists votekick_session (
  id              text primary key,
  target_usr      text not null,
  target_name     text,
  initiator_usr   text,
  initiator_name  text,
  world           text,
  instance_id     text,
  status          text not null default 'open',  -- open | passed | failed | expired | cancelled
  yes_count       integer not null default 0,
  no_count        integer not null default 0,
  quorum          integer not null default 3,
  client_key      text,                          -- Idempotenz (create)
  created_by      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  closed_at       timestamptz,
  result_detail   text
);
create unique index if not exists votekick_session_client_key_idx
  on votekick_session (client_key) where client_key is not null;
create index if not exists votekick_session_status_idx on votekick_session (status, expires_at);

create table if not exists votekick_vote (
  session_id   text not null references votekick_session(id) on delete cascade,
  voter_key    text not null,          -- usr_ oder discord oder furr user
  vote         text not null,          -- yes | no
  created_at   timestamptz not null default now(),
  primary key (session_id, voter_key)
);

-- ---------- Alert-Bus ----------
create table if not exists alert_event (
  id           text primary key,
  kind         text not null,          -- vote.result | whitelist.deny | duty.change | duty.empty | incident.mark | watchlist.join | ban.undo | anti_troll
  severity     text not null default 'info',  -- info | warn | critical
  title        text not null,
  body         text not null default '',
  payload_json text,
  dedup_key    text,
  channels     text not null default '["bot","desktop","vr"]',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 minutes'),
  delivered_bot boolean not null default false
);
create index if not exists alert_event_pending_idx on alert_event (delivered_bot, created_at) where not delivered_bot;
create index if not exists alert_event_dedup_idx on alert_event (dedup_key, created_at desc) where dedup_key is not null;
create index if not exists alert_event_created_idx on alert_event (created_at desc);

-- ---------- Chatbox-Hinweise ----------
create table if not exists chatbox_hint (
  id           text primary key,
  text         text not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  delivered    boolean not null default false
);
create index if not exists chatbox_hint_pending_idx on chatbox_hint (delivered, expires_at) where not delivered;

-- ---------- Watchlist (usr_) – Sightings kommen von Desktop/Bridge, kein Server-Polling ----------
create table if not exists watchlist_entry (
  usr_id       text primary key,
  display_name text,
  note         text not null default '',
  alarm_join   boolean not null default true,
  added_by     text not null,
  created_at   timestamptz not null default now()
);

create table if not exists watchlist_sighting (
  id           text primary key,
  usr_id       text not null,
  display_name text,
  kind         text not null default 'join',  -- join | leave | rejoin
  world        text,
  instance_id  text,
  hopping      boolean not null default false,
  source       text not null default 'desktop', -- desktop | bridge | vr
  seen_at      timestamptz not null default now()
);
create index if not exists watchlist_sighting_usr_idx on watchlist_sighting (usr_id, seen_at desc);
create index if not exists watchlist_sighting_seen_idx on watchlist_sighting (seen_at desc);

-- ---------- Anti-Troll Flags (kein Auto-Ban) ----------
create table if not exists anti_troll_flag (
  id           text primary key,
  target_key   text not null,           -- usr_ oder discord id
  platform     text not null default 'vrchat',
  kind         text not null,           -- vote_abuse | repeat_report | rejoin_hopping | other
  score        integer not null default 1,
  detail       text,
  case_id      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  notified_bot boolean not null default false
);
create index if not exists anti_troll_target_idx on anti_troll_flag (target_key, kind);

-- ---------- Ban Undo (10 s Fenster) ----------
create table if not exists ban_undo (
  token        text primary key,
  platform     text not null,           -- discord | vrchat
  target_id    text not null,
  target_name  text,
  reason       text not null,
  case_id      text not null,
  moderator_id text not null,
  job_or_req   text,                    -- vrchat_job.id oder moderation_request.id
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);
create index if not exists ban_undo_expires_idx on ban_undo (expires_at);

-- Einstellungen (Quorum / Cooldown / Heartbeat-Fenster)
insert into furr_setting (key, value) values
  ('votekick_quorum', '3'),
  ('votekick_cooldown_sec', '120'),
  ('votekick_ttl_sec', '60'),
  ('chatbox_hint_max_len', '80'),
  ('chatbox_hint_ttl_sec', '45'),
  ('alert_dedup_sec', '30'),
  ('watchlist_hop_window_sec', '90'),
  ('duty_heartbeat_grace_sec', '120')
on conflict (key) do nothing;
