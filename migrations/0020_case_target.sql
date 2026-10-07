-- Personenakte: a case remembers who it is about (Discord id / usr_ id and the name), so every
-- case of one person can be found again. Older cases are matched by their folder name.
alter table evidence_case_meta add column if not exists target_id text;
alter table evidence_case_meta add column if not exists target_name text;
create index if not exists evidence_case_meta_target_idx on evidence_case_meta (target_id) where target_id is not null;
