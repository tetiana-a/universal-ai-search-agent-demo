-- AURELIUS archive: one table for every record (communities, campaigns, posts, monitoring, journal, searches).
-- Run once in Supabase → SQL Editor → New query → paste → Run.
create table if not exists public.aurelius_archive (
  collection text not null,
  id text not null,
  day date,
  data jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists aurelius_archive_day on public.aurelius_archive (day);
create index if not exists aurelius_archive_collection_day on public.aurelius_archive (collection, day);
-- Only the server (service role key) may read or write: no public access.
alter table public.aurelius_archive enable row level security;
