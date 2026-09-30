-- Whitelist login: after Discord, whitelisted (non-staff) users also sign in with a
-- name + password the owner hands out. The start password must be changed on first use.
alter table furr_whitelist add column if not exists username text;
alter table furr_whitelist add column if not exists password_hash text;
alter table furr_whitelist add column if not exists must_change_password boolean not null default true;
alter table furr_whitelist add column if not exists password_changed_at timestamptz;
alter table furr_whitelist add column if not exists failed_attempts integer not null default 0;
alter table furr_whitelist add column if not exists locked_until timestamptz;
create unique index if not exists furr_whitelist_username_idx on furr_whitelist (lower(username));

-- Which login sessions passed the name/password step (hash of the session token).
create table if not exists furr_whitelist_unlock (
  token_hash text primary key,
  user_id    text not null,
  created_at timestamptz not null default now()
);
create index if not exists furr_whitelist_unlock_user_idx on furr_whitelist_unlock (user_id);
