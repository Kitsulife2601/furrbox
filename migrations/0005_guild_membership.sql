-- Whether the user is a member of the Fish Discord server (checked at login). Non-members never get in.
alter table furr_profile add column if not exists discord_in_guild boolean;
