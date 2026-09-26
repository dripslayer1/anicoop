-- anicoop v1.6 database update: copy ALL of this into Supabase → SQL Editor → New query → Run (once).
-- (It is also in supabase_setup.sql as section 8h. Safe to run again: nothing is copied twice.)

-- ---------------------------------------------------------------------
-- 8h. v1.6 — WATCH TOGETHER (friend tags on titles), GROUP CHAT PICTURES, SHARED PLAYLISTS
--   Everything lives in each person's own list. Inviting friends to a title makes a "watch party" for it: people who
--   accept get the title on their list and their picture on its poster. Everyone keeps their own status (one can be
--   Rewatching while another is Watching or has Dropped it); the episode count moves together.
--   Old squads move over once: each title on a squad list becomes a watch party with the same people (anime, manga,
--   movies & TV), and every member gets the squad's titles on their own list (games and songs too, without tags).
--   The squad tables stay in the database untouched: nothing is deleted.
-- ---------------------------------------------------------------------
create table if not exists public.watch_parties (
  id           uuid primary key default gen_random_uuid(),
  media_id     integer not null,
  media_type   text not null default 'ANIME',
  media_data   jsonb not null default '{}'::jsonb,
  progress     integer not null default 0,         -- the shared episode / chapter count
  created_by   uuid references public.profiles(id) on delete set null,
  legacy_squad uuid,                               -- moved over from this squad
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists watch_parties_media_idx on public.watch_parties (media_id);
create unique index if not exists watch_parties_legacy_idx on public.watch_parties (legacy_squad, media_id) where legacy_squad is not null;
create table if not exists public.party_members (
  party_id   uuid not null references public.watch_parties(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  state      text not null default 'invited' check (state in ('invited', 'joined', 'dropped', 'declined', 'left')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (party_id, user_id)
);
create index if not exists party_members_user_idx on public.party_members (user_id);
alter table public.notifications add column if not exists party_id uuid references public.watch_parties(id) on delete cascade;

create or replace function public.is_party_member(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from party_members where party_id = pid and user_id = auth.uid());
$$;
grant execute on function public.is_party_member(uuid) to authenticated;

alter table public.watch_parties enable row level security;
alter table public.party_members enable row level security;
grant select on public.watch_parties, public.party_members to authenticated;
drop policy if exists "parties: members read" on public.watch_parties;
drop policy if exists "party members: members read" on public.party_members;
create policy "parties: members read" on public.watch_parties for select to authenticated using (public.is_party_member(id));
create policy "party members: members read" on public.party_members for select to authenticated using (public.is_party_member(party_id));
-- (every change goes through the functions below, so nobody can change someone else's part)

-- Invite friends to one or more titles: p_items = [{ media_id, media_type, media_data, progress }, …]. Your own party for
-- a title is reused (so the tags add up); otherwise a new one starts with you in it. Returns the party ids.
create or replace function public.party_invite(p_items jsonb, p_members uuid[])
returns setof uuid language plpgsql security definer set search_path = public as $$
declare it jsonb; pid uuid; m uuid; mid integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    mid := (it ->> 'media_id')::integer;
    if mid is null then continue; end if;
    pid := null;
    select p.id into pid from watch_parties p join party_members pm on pm.party_id = p.id
      where p.media_id = mid and pm.user_id = auth.uid() and pm.state in ('joined', 'dropped')
      order by p.updated_at desc limit 1;
    if pid is null then
      insert into watch_parties (media_id, media_type, media_data, progress, created_by)
      values (mid, coalesce(it ->> 'media_type', 'ANIME'), coalesce(it -> 'media_data', '{}'::jsonb), greatest(0, coalesce((it ->> 'progress')::integer, 0)), auth.uid())
      returning id into pid;
      insert into party_members (party_id, user_id, state, invited_by) values (pid, auth.uid(), 'joined', auth.uid());
    end if;
    foreach m in array coalesce(p_members, '{}'::uuid[]) loop
      if m <> auth.uid() and public.are_friends(auth.uid(), m) then
        insert into party_members (party_id, user_id, state, invited_by) values (pid, m, 'invited', auth.uid())
        on conflict (party_id, user_id) do update set state = 'invited', invited_by = auth.uid(), updated_at = now()
          where party_members.state in ('declined', 'left');
      end if;
    end loop;
    return next pid;
  end loop;
end;
$$;
grant execute on function public.party_invite(jsonb, uuid[]) to authenticated;

-- Your answer / your part: joined (accept, or back in after dropping), declined, dropped (you stay in its history), left
create or replace function public.party_respond(pid uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_state not in ('joined', 'declined', 'dropped', 'left') then raise exception 'Unknown answer'; end if;
  update party_members set state = p_state, updated_at = now() where party_id = pid and user_id = auth.uid();
end;
$$;
grant execute on function public.party_respond(uuid, text) to authenticated;

-- The shared count moves (only people in the party can move it)
create or replace function public.party_progress(pid uuid, n integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from party_members where party_id = pid and user_id = auth.uid() and state = 'joined') then return; end if;
  update watch_parties set progress = greatest(0, coalesce(n, 0)), updated_at = now() where id = pid;
end;
$$;
grant execute on function public.party_progress(uuid, integer) to authenticated;

-- Take back an invite nobody answered yet (anyone in the party can)
create or replace function public.party_cancel(pid uuid, member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from party_members where party_id = pid and user_id = auth.uid() and state in ('joined', 'dropped')) then return; end if;
  delete from party_members where party_id = pid and user_id = member and state = 'invited';
end;
$$;
grant execute on function public.party_cancel(uuid, uuid) to authenticated;

-- Alerts: you're invited · someone accepted your invite · someone dropped a title you watch together
create or replace function public.notify_party()
returns trigger language plpgsql security definer set search_path = public as $$
declare p watch_parties%rowtype; t text; c text; prev text := null;
begin
  if tg_op = 'UPDATE' then prev := old.state; end if;
  select * into p from watch_parties where id = new.party_id;
  t := coalesce(p.media_data -> 'title' ->> 'english', p.media_data -> 'title' ->> 'romaji', 'a title');
  c := p.media_data -> 'coverImage' ->> 'large';
  if new.state = 'invited' and prev is distinct from 'invited'
     and new.invited_by is not null and new.invited_by <> new.user_id and pref_on(new.user_id, 'squad') then
    insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, party_id)
    values (new.user_id, new.invited_by, 'party_invite', p.media_id, p.media_type, t, c, p.id);
  elsif prev = 'invited' and new.state = 'joined'
     and new.invited_by is not null and new.invited_by <> new.user_id and pref_on(new.invited_by, 'squad') then
    insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, party_id)
    values (new.invited_by, new.user_id, 'party_joined', p.media_id, p.media_type, t, c, p.id);
  elsif prev = 'joined' and new.state = 'dropped' then
    insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, party_id)
    select pm.user_id, new.user_id, 'party_dropped', p.media_id, p.media_type, t, c, p.id
    from party_members pm where pm.party_id = p.id and pm.user_id <> new.user_id and pm.state = 'joined' and pref_on(pm.user_id, 'squad');
  end if;
  return new;
end;
$$;
drop trigger if exists on_party_member on public.party_members;
create trigger on_party_member after insert or update of state on public.party_members
  for each row execute function public.notify_party();

-- Move the old squads over, once (a note in app_config remembers it, so running this file again adds nothing back)
do $$
begin
  if exists (select 1 from public.app_config where key = 'squads_moved') then return; end if;
  perform set_config('anicoop.buddy_sync', 'on', true);   -- (watch buddies' Plan to watch lists don't copy these)
  insert into public.watch_parties (media_id, media_type, media_data, progress, created_by, legacy_squad, created_at, updated_at)
  select e.media_id, e.media_type, e.media_data, coalesce(e.progress, 0), coalesce(e.added_by, s.created_by), e.squad_id, e.created_at, e.updated_at
  from public.squad_entries e join public.squads s on s.id = e.squad_id
  where e.media_type in ('ANIME', 'MANGA', 'TV')
  on conflict (legacy_squad, media_id) where legacy_squad is not null do nothing;
  insert into public.party_members (party_id, user_id, state, invited_by, created_at)
  select p.id, m.user_id, 'joined', p.created_by, m.joined_at
  from public.watch_parties p join public.squad_members m on m.squad_id = p.legacy_squad
  on conflict (party_id, user_id) do nothing;
  insert into public.list_entries (user_id, media_id, media_type, media_data, status, score, progress, created_at, updated_at)
  select distinct on (m.user_id, e.media_id) m.user_id, e.media_id, e.media_type, e.media_data, e.status, coalesce(e.score, 0), coalesce(e.progress, 0), e.created_at, e.updated_at
  from public.squad_entries e join public.squad_members m on m.squad_id = e.squad_id
  order by m.user_id, e.media_id, e.updated_at desc
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
  insert into public.app_config (key, value) values ('squads_moved', jsonb_build_object('at', now()));
end $$;

-- Group chats: anyone in the group can set its picture
create or replace function public.set_group_avatar(gid uuid, url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(gid) then raise exception 'You are not in that group'; end if;
  if url is not null and (char_length(url) > 2000 or url !~* '^https://') then raise exception 'That picture link is not allowed'; end if;
  update chat_groups set avatar_url = url where id = gid;
end;
$$;
grant execute on function public.set_group_avatar(uuid, text) to authenticated;

-- Shared playlists: the owner adds friends (members); members can add, remove and reorder songs and rename it.
-- Only the owner changes who is in it or deletes it; a member can take themselves out.
alter table public.playlists add column if not exists members uuid[] not null default '{}';
create index if not exists playlists_members_idx on public.playlists using gin (members);
drop policy if exists "playlists: read" on public.playlists;
drop policy if exists "playlists: edit" on public.playlists;
create policy "playlists: read" on public.playlists for select to authenticated
  using (auth.uid() = user_id or auth.uid() = any(members) or public.can_view_list(user_id, 'SONG'));
create policy "playlists: edit" on public.playlists for update to authenticated
  using (auth.uid() = user_id or auth.uid() = any(members)) with check (true);
create or replace function public.guard_playlist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'A playlist can''t change owner'; end if;
  if auth.uid() is distinct from old.user_id and new.members is distinct from old.members
     and new.members is distinct from array_remove(old.members, auth.uid()) then
    raise exception 'Only the owner can change who is in a playlist';
  end if;
  if auth.uid() = old.user_id and new.members is distinct from old.members then
    new.members := array(select distinct m from unnest(new.members) m where m <> old.user_id and public.are_friends(old.user_id, m));
  end if;
  return new;
end;
$$;
drop trigger if exists on_playlist_guard on public.playlists;
create trigger on_playlist_guard before update on public.playlists for each row execute function public.guard_playlist();
-- someone added you to their playlist
create or replace function public.notify_playlist_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare before uuid[] := '{}';
begin
  if tg_op = 'UPDATE' then before := coalesce(old.members, '{}'::uuid[]); end if;
  insert into notifications (user_id, actor_id, kind, text)
  select m, new.user_id, 'playlist_added', new.name
  from unnest(new.members) m
  where m <> new.user_id and not (m = any(before)) and pref_on(m, 'squad');
  return new;
end;
$$;
drop trigger if exists on_playlist_member on public.playlists;
create trigger on_playlist_member after insert or update of members on public.playlists for each row execute function public.notify_playlist_member();

do $$
declare t text;
begin
  foreach t in array array['watch_parties', 'party_members', 'playlists'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
