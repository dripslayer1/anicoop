-- anicoop v1.4.3: an 18+ watch buddy (both people need 18+ access: full or Track 18+).
-- Run in Supabase → SQL Editor after v1.4.2 (safe to run again; also in supabase_setup.sql).
-- It also brings in watch buddies per section (v2.3) in case that file was never run: without it, removing or adding
-- something on Plan to watch fails with "column media_type does not exist".

-- ---- v2.3 watch buddies per section ----
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

-- (v1.4.3) an 18+ watch buddy: only between two friends who both have 18+ access (full or Track 18+). It syncs their
-- 18+ Plan to read / watch (manga and anime) and nothing else; Manga / Anime / "All sections" buddies still never get 18+.
create or replace function public.adult_access_of(u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = u)
      or exists (select 1 from user_roles ur join app_roles r on r.id = ur.role_id
                 where ur.user_id = u and ('manage_18' = any(r.perms) or 'admin' = any(r.perms)))
      or coalesce((select (value ->> 'everyone')::boolean or (value -> 'users') ? u::text from app_config where key = 'adult'), false)
      or coalesce((select (value -> 'users') ? u::text from app_config where key = 'adult_track'), false);
$$;
revoke execute on function public.adult_access_of(uuid) from public, anon, authenticated;
-- the app asks this to show the 18+ buddy button (someone without 18+ access always gets "no")
create or replace function public.buddy18_ok(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and adult_access_of(auth.uid()) and adult_access_of(other) and are_friends(auth.uid(), other);
$$;
revoke execute on function public.buddy18_ok(uuid) from public, anon;
grant execute on function public.buddy18_ok(uuid) to authenticated;

alter table public.watch_buddies drop constraint if exists watch_buddies_media_type_check;
alter table public.watch_buddies add constraint watch_buddies_media_type_check check (media_type is null or media_type in ('ANIME', 'MANGA', 'TV', 'GAME', 'ADULT'));
drop policy if exists "buddies: ask"    on public.watch_buddies;
drop policy if exists "buddies: accept" on public.watch_buddies;
create policy "buddies: ask"    on public.watch_buddies for insert to authenticated
  with check (auth.uid() = requester and status = 'pending' and public.are_friends(requester, addressee)
              and (media_type is distinct from 'ADULT' or public.buddy18_ok(addressee)));
create policy "buddies: accept" on public.watch_buddies for update to authenticated
  using (auth.uid() = addressee)
  with check (auth.uid() = addressee and (media_type is distinct from 'ADULT' or public.buddy18_ok(requester)));

create or replace function public.merge_buddy_section(src uuid, dst uuid, mtype text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mtype = 'ADULT' and not (adult_access_of(src) and adult_access_of(dst)) then return; end if;
  perform set_config('anicoop.buddy_sync', 'on', true);
  insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
  select dst, e.media_id, e.media_type, e.media_data, 'PLANNING', 0, 0 from list_entries e
  where e.user_id = src and e.status = 'PLANNING'
    and case when mtype = 'ADULT' then e.media_type in ('ADULT', 'ADULT_ANIME')
             else e.media_type not in ('ADULT', 'ADULT_ANIME') and (mtype is null or e.media_type = mtype) end
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
end;
$$;
create or replace function public.sync_buddy_planning()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; me uuid; mt text; adult boolean;
begin
  if coalesce(current_setting('anicoop.buddy_sync', true), '') = 'on' then return coalesce(new, old); end if;
  me := coalesce(new.user_id, old.user_id);
  mt := coalesce(new.media_type, old.media_type);
  adult := mt in ('ADULT', 'ADULT_ANIME');
  if adult and not adult_access_of(me) then return coalesce(new, old); end if;
  perform set_config('anicoop.buddy_sync', 'on', true);
  for b in select distinct case when requester = me then addressee else requester end from watch_buddies
           where status = 'accepted' and (requester = me or addressee = me)
             and case when adult then media_type = 'ADULT' else media_type is null or media_type = mt end loop
    if adult and not adult_access_of(b) then continue; end if;
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
revoke execute on function public.merge_buddy_section(uuid, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
