-- Changelog-Notizen für Event-Feed
create table if not exists furr_changelog (
  id          text primary key,
  title       text not null,
  body        text not null default '',
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists furr_changelog_at_idx on furr_changelog (created_at desc);
