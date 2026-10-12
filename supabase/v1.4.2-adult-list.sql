-- anicoop v1.4.2: the 18+ list (18+ manga = 'ADULT', 18+ anime = 'ADULT_ANIME'; Track 18+ sees both).
-- Run in Supabase → SQL Editor (safe to run again, also after the v1.4 / v1.4.1 files).
-- ---- v1.4 the 18+ list (also in supabase/v1.4-adult-list.sql) ----
-- 18+ manga / manhwa / manhua are saved with media_type 'ADULT'. The database only sends those rows (and list updates
-- about them) to their owner and to friends with 18+ access or "Track 18+ manga". They follow the Manga list's privacy.
create or replace function public.adult_track_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value -> 'users') ? auth.uid()::text from app_config where key = 'adult_track'), false);
$$;
grant execute on function public.adult_track_allowed() to authenticated;

create or replace function public.can_view_list(owner uuid, mtype text)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or (
    are_friends(auth.uid(), owner)
    and (coalesce(mtype, '') <> 'ADULT' or adult_allowed() or adult_track_allowed())
    and (coalesce(mtype, '') <> 'ADULT_ANIME' or adult_allowed() or adult_track_allowed())
    and not exists (
      select 1 from list_privacy p
      where p.user_id = owner and p.media_type = case when mtype = 'ADULT' then 'MANGA' when mtype = 'ADULT_ANIME' then 'ANIME' else coalesce(mtype, 'ANIME') end
        and (p.mode = 'private' or (p.mode = 'except' and auth.uid() = any(p.hidden_from)))));
$$;

-- profile numbers: "Completed" and "Mean score" leave out 18+ titles for people who can't see them
create or replace function public.profile_stats(owner uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; days int; ah boolean; mh boolean; sees boolean; sees_a boolean;
begin
  if auth.uid() is null then return null; end if;
  sees := owner = auth.uid() or adult_allowed() or adult_track_allowed();   -- 18+ manga
  sees_a := owner = auth.uid() or adult_allowed() or adult_track_allowed();   -- 18+ anime (v1.4.2 Track 18+ too)
  select count(*) filter (where media_type = 'ANIME') as anime,
         count(*) filter (where media_type = 'MANGA') as manga,
         coalesce(sum(case when status = 'COMPLETED' then coalesce(nullif(media_data ->> 'episodes', '')::int, progress) else progress end) filter (where media_type = 'ANIME'), 0) as eps,
         coalesce(sum(case when status = 'COMPLETED' then coalesce(nullif(media_data ->> 'episodes', '')::int, progress) else progress end) filter (where media_type = 'MANGA'), 0) as chapters,
         count(*) filter (where status = 'COMPLETED' and (sees or media_type <> 'ADULT') and (sees_a or media_type <> 'ADULT_ANIME')) as completed,
         count(*) filter (where status = 'COMPLETED' and media_type = 'ANIME') as anime_done,
         count(*) filter (where status = 'COMPLETED' and media_type = 'MANGA') as manga_done,
         avg(score) filter (where score > 0 and (sees or media_type <> 'ADULT') and (sees_a or media_type <> 'ADULT_ANIME')) as mean
    into e from list_entries where user_id = owner;
  select count(*) into days from user_activity where user_id = owner;
  ah := list_hidden_from_me(owner, 'ANIME'); mh := list_hidden_from_me(owner, 'MANGA');
  return jsonb_build_object(
    'days',      case when stat_visible(owner, 'days') then days end,
    'anime',     case when stat_visible(owner, 'anime') and not ah then e.anime end,
    'manga',     case when stat_visible(owner, 'manga') and not mh then e.manga end,
    'eps',       case when stat_visible(owner, 'eps') and not ah then e.eps end,
    'chapters',  case when stat_visible(owner, 'chapters') and not mh then e.chapters end,
    'completed', case when stat_visible(owner, 'completed') then e.completed end,
    'anime_done', case when stat_visible(owner, 'completed') and not ah then e.anime_done end,
    'manga_done', case when stat_visible(owner, 'completed') and not mh then e.manga_done end,
    'mean',      case when stat_visible(owner, 'mean') then round(e.mean, 2) end);
end;
$$;

-- watch buddies never copy 18+ titles into each other's Plan to read
create or replace function public.merge_buddy_planning(src uuid, dst uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anicoop.buddy_sync', 'on', true);
  insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
  select dst, e.media_id, e.media_type, e.media_data, 'PLANNING', 0, 0 from list_entries e
  where e.user_id = src and e.status = 'PLANNING' and e.media_type not in ('ADULT', 'ADULT_ANIME')
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
end;
$$;
create or replace function public.merge_buddy_section(src uuid, dst uuid, mtype text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anicoop.buddy_sync', 'on', true);
  insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
  select dst, e.media_id, e.media_type, e.media_data, 'PLANNING', 0, 0 from list_entries e
  where e.user_id = src and e.status = 'PLANNING' and e.media_type not in ('ADULT', 'ADULT_ANIME') and (mtype is null or e.media_type = mtype)
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
end;
$$;
create or replace function public.sync_buddy_planning()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; me uuid; mt text;
begin
  if coalesce(current_setting('anicoop.buddy_sync', true), '') = 'on' then return coalesce(new, old); end if;
  me := coalesce(new.user_id, old.user_id);
  mt := coalesce(new.media_type, old.media_type);
  if mt in ('ADULT', 'ADULT_ANIME') then return coalesce(new, old); end if;
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
revoke execute on function public.merge_buddy_planning(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.merge_buddy_section(uuid, uuid, text) from public, anon, authenticated;

-- an 18+ ranking of its own
alter table public.rank_orders drop constraint if exists rank_orders_category_check;
alter table public.rank_orders add constraint rank_orders_category_check check (category in ('ANIME', 'MOVIE', 'MANGA', 'MANHWA', 'GAME', 'FILM', 'TV', 'SONG', 'ADULT'));

-- move what's already saved: manga marked 18+ → the 18+ list (the app moves older ones it finds itself)
update public.list_entries set media_type = 'ADULT'
  where media_type = 'MANGA' and coalesce(media_data ->> 'isAdult', '') = 'true';
update public.activities set media_type = 'ADULT'
  where media_type = 'MANGA' and kind = 'list' and coalesce(extra ->> 'adult', '') = 'true';
-- (v1.4.1) 18+ anime → 'ADULT_ANIME'
update public.list_entries set media_type = 'ADULT_ANIME'
  where media_type = 'ANIME' and coalesce(media_data ->> 'isAdult', '') = 'true';
update public.activities set media_type = 'ADULT_ANIME'
  where media_type = 'ANIME' and kind = 'list' and coalesce(extra ->> 'adult', '') = 'true';

notify pgrst, 'reload schema';
