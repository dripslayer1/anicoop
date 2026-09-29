-- =====================================================================
--  anicoop v2.3 – watch buddies per section. Run this whole file once in Supabase → SQL Editor → New query → Run.
--  Safe to re-run. It is also part of supabase_setup.sql (the watch buddies part), so re-running that file keeps it.
--  A watch buddy is now for one section (Anime, Manga, Movies & TV or Games): only that section's Plan to watch
--  syncs, and you can have a different buddy in each section. Buddies made before stay "all sections".
-- =====================================================================

alter table public.watch_buddies add column if not exists media_type text;   -- null = every section (made before v2.3)
alter table public.watch_buddies drop constraint if exists watch_buddies_media_type_check;
alter table public.watch_buddies add constraint watch_buddies_media_type_check check (media_type is null or media_type in ('ANIME', 'MANGA', 'TV', 'GAME'));
-- one link per pair and section (it was one per pair)
drop index if exists public.watch_buddies_pair_idx;
create unique index if not exists watch_buddies_pair_type_idx on public.watch_buddies (least(requester, addressee), greatest(requester, addressee), coalesce(media_type, '*'));

-- copies what one person has on Plan to watch in a section (null = every section) onto the other's list
create or replace function public.merge_buddy_section(src uuid, dst uuid, mtype text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anicoop.buddy_sync', 'on', true);
  insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
  select dst, e.media_id, e.media_type, e.media_data, 'PLANNING', 0, 0 from list_entries e
  where e.user_id = src and e.status = 'PLANNING' and (mtype is null or e.media_type = mtype)
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
end;
$$;
revoke execute on function public.merge_buddy_section(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.on_buddy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, actor_id, kind, media_type) values (new.addressee, new.requester, 'buddy_request', new.media_type);
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    insert into notifications (user_id, actor_id, kind, media_type) values (new.requester, new.addressee, 'buddy_accept', new.media_type);
    perform merge_buddy_section(new.requester, new.addressee, new.media_type);
    perform merge_buddy_section(new.addressee, new.requester, new.media_type);
  end if;
  return new;
end;
$$;

-- adding / removing something on Plan to watch: only the buddies of that section (or of every section) follow
create or replace function public.sync_buddy_planning()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; me uuid; mt text;
begin
  if coalesce(current_setting('anicoop.buddy_sync', true), '') = 'on' then return coalesce(new, old); end if;
  me := coalesce(new.user_id, old.user_id);
  mt := coalesce(new.media_type, old.media_type);
  perform set_config('anicoop.buddy_sync', 'on', true);
  for b in select distinct case when requester = me then addressee else requester end from watch_buddies
           where status = 'accepted' and (requester = me or addressee = me) and (media_type is null or media_type = mt) loop
    if tg_op in ('INSERT', 'UPDATE') and new.status = 'PLANNING' and (tg_op = 'INSERT' or old.status is distinct from 'PLANNING') then
      insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
      values (b, new.media_id, new.media_type, new.media_data, 'PLANNING', 0, 0)
      on conflict (user_id, media_id) do nothing;
    elsif tg_op = 'DELETE' and old.status = 'PLANNING' then
      delete from list_entries where user_id = b and media_id = old.media_id and status = 'PLANNING';
    end if;
  end loop;
  perform set_config('anicoop.buddy_sync', '', true);
  return coalesce(new, old);
end;
$$;

notify pgrst, 'reload schema';
