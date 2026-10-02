-- FurrChat: stickers, evidence-case links and files from the PC.
alter table chat_message add column if not exists kind text not null default 'text';
alter table chat_message add column if not exists attachment_json text;

-- File contents live here (not in FurrFS), so only the people in the chat can open them and
-- they are deleted together with the message.
create table if not exists chat_attachment (
  id          text primary key,
  message_id  text not null,
  name        text not null,
  mime_type   text not null,
  size        integer not null,
  content_b64 text not null,
  created_at  timestamptz not null default now()
);
create index if not exists chat_attachment_message_idx on chat_attachment (message_id);
