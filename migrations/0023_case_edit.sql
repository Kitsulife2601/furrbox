-- Fallakte bearbeiten: the violation and a description are kept at the case, so they can be
-- shown in the list and changed later.
alter table evidence_case_meta add column if not exists category text;
alter table evidence_case_meta add column if not exists description text;
