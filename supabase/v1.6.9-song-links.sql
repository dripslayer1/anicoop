-- v1.6.9 — "Wrong song?": a song's YouTube upload, set by hand, for everyone
-- Run once in Supabase → SQL Editor (safe to run again). Also in supabase_setup.sql.
--
-- When the song player finds the wrong upload, the owner (or a role with "Manage songs") pastes the right
-- YouTube / YouTube Music link. Everyone's player plays that one for the song from then on.
-- song_key = the app's key for a song: its title + first artist, simplified ("paraboy|leslieparrish").
create table if not exists public.song_links (
  song_key   text primary key check (char_length(song_key) between 2 and 300),
  video_id   text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  label      text check (char_length(label) <= 300),
  set_by     uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.song_links enable row level security;
grant select, insert, update, delete on public.song_links to authenticated;
drop policy if exists "song links: read"   on public.song_links;
drop policy if exists "song links: set"    on public.song_links;
drop policy if exists "song links: change" on public.song_links;
drop policy if exists "song links: remove" on public.song_links;
-- everyone signed in reads them (the player needs them); only the owner / "Manage songs" set, change or remove them
create policy "song links: read"   on public.song_links for select to authenticated using (true);
create policy "song links: set"    on public.song_links for insert to authenticated
  with check (public.has_perm('manage_songs') and set_by = auth.uid());
create policy "song links: change" on public.song_links for update to authenticated
  using (public.has_perm('manage_songs')) with check (public.has_perm('manage_songs') and set_by = auth.uid());
create policy "song links: remove" on public.song_links for delete to authenticated using (public.has_perm('manage_songs'));

notify pgrst, 'reload schema';
