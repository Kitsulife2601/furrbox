-- FurrChat: stickers the team makes itself (own pictures, ideally with a transparent background).
create table if not exists chat_sticker (
  id          text primary key,
  name        text not null,
  mime_type   text not null,
  content_b64 text not null,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
