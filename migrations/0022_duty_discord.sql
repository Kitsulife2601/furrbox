-- "Anwesend" by button in Discord: counts for a while even without FurrBox open (normally the
-- status only counts while FurrBox was seen in the last minutes).
alter table mod_duty add column if not exists discord_until timestamptz;
