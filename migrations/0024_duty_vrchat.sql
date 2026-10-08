-- Anwesenheit über VRChat: every team member's VRChat account (name + usr_ id) is kept at the
-- profile. Who is seen in an instance of our group counts as "anwesend" without touching a switch.
alter table furr_profile add column if not exists vrchat_user_id text;
alter table furr_profile add column if not exists vrchat_name text;
create index if not exists furr_profile_vrchat_idx on furr_profile (vrchat_user_id) where vrchat_user_id is not null;

-- vrchat_until:    seen in a group instance, counts until then (refreshed every minute)
-- vrchat_location: the instance they were seen in
-- vrchat_optout:   they switched to "Aus" by hand while in that instance – no auto "anwesend" there
alter table mod_duty add column if not exists vrchat_until timestamptz;
alter table mod_duty add column if not exists vrchat_location text;
alter table mod_duty add column if not exists vrchat_optout text;
