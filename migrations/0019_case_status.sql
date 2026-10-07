-- Fall-Status: every evidence case (a folder in FurrFS) can have a state, someone who takes care
-- of it and a short note. Cases without a row count as "open" and unassigned.
create table if not exists evidence_case_meta (
  case_path   text primary key,
  status      text not null default 'open',   -- open | working | waiting | done
  assignee_id text,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists evidence_case_meta_status_idx on evidence_case_meta (status);
