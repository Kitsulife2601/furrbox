-- Anwesenheit: team members mark themselves "anwesend" (can moderate right now) or not – from the
-- VR panel or the desktop. Every change and every handled vote kick goes into the duty log.
create table if not exists mod_duty (
  user_id    text primary key,
  on_duty    boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists mod_duty_log (
  id         text primary key,
  user_id    text not null,
  kind       text not null,            -- on | off | votekick
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists mod_duty_log_created_idx on mod_duty_log (created_at desc);

-- Messages the Discord bot should post (e.g. "instance opened – who is on duty").
create table if not exists bot_outbox (
  id         text primary key,
  channel_id text not null,
  content    text not null,
  status     text not null default 'queued',
  created_at timestamptz not null default now()
);

-- Channel for the bot's "instance opened – who is anwesend" message (Fish server).
insert into furr_setting (key, value) values ('duty_channel_id', '1434484156431204382') on conflict (key) do nothing;
