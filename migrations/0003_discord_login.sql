-- Discord login: staff privilege read from the user's own Discord roles at sign-in.
alter table furr_profile add column if not exists discord_privilege text;
alter table furr_profile add column if not exists discord_checked_at timestamptz;
