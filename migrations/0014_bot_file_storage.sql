-- Big evidence files live on the PC of the Discord bot (no size limit). FurrBox only relays them
-- in small pieces: uploads go browser -> bot_file_chunk ('up') -> bot, downloads the other way.
alter table furr_file add column if not exists on_bot boolean not null default false;
alter table furr_file add column if not exists bot_state text;          -- uploading | stored | failed
alter table furr_file add column if not exists bot_chunks integer;       -- set when the upload is complete
alter table furr_file add column if not exists bot_error text;

create table if not exists bot_file_chunk (
  file_id    text not null,
  direction  text not null,                -- 'up' (to the bot) or 'down' (from the bot)
  idx        integer not null,
  data_b64   text not null,
  created_at timestamptz not null default now(),
  primary key (file_id, direction, idx)
);

create table if not exists bot_file_request (
  file_id      text primary key,
  status       text not null default 'queued',  -- queued | sending | done | failed
  total_chunks integer,
  error        text,
  requested_at timestamptz not null default now()
);
