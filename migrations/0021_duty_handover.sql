-- Übergabe-Notiz: who ends their duty leaves a short note about what is still open; the next one
-- sees it when they mark themselves "anwesend".
create table if not exists duty_handover (
  id         text primary key,
  user_id    text not null,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists duty_handover_created_idx on duty_handover (created_at desc);
