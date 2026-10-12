-- anicoop v1.5: manga / manhwa that aren't on AniList, from MangaUpdates.
-- Run in Supabase → SQL Editor (safe to run again; also in supabase_setup.sql). Then deploy the updated "igdb" Edge Function.
-- (v1.5) MangaUpdates titles (manga AniList doesn't have): each MangaUpdates series gets a small number here, and its
-- list id is 1100000000 + that number (MangaUpdates' own ids are too big for list rows). Everyone gets the same number.
create table if not exists public.mu_titles (
  n          integer generated always as identity primary key,
  series_id  bigint not null unique,
  created_at timestamptz not null default now()
);
alter table public.mu_titles enable row level security;
grant select on public.mu_titles to authenticated;
drop policy if exists "mu: read" on public.mu_titles;
create policy "mu: read" on public.mu_titles for select to authenticated using (true);
-- numbers for up to 100 series at once (new ones are made); only signed-in people
create or replace function public.mu_ids(sids bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return '{}'::jsonb; end if;
  if coalesce(array_length(sids, 1), 0) > 100 then raise exception 'At most 100 at once'; end if;
  insert into mu_titles (series_id) select distinct s from unnest(sids) s where s > 0 on conflict (series_id) do nothing;
  return coalesce((select jsonb_object_agg(series_id::text, n) from mu_titles where series_id = any(sids)), '{}'::jsonb);
end;
$$;
revoke execute on function public.mu_ids(bigint[]) from public, anon;
grant execute on function public.mu_ids(bigint[]) to authenticated;

notify pgrst, 'reload schema';
