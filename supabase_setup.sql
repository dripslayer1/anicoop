-- =====================================================================
--  ANICOOP v7 – Supabase setup
--  Run the WHOLE file in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run. Keeps all your existing data (old co-op lists are copied into squads).
--  v4 adds: activity feed (likes, replies, @mentions), comment replies + likes, per-list privacy,
--           profile banner, synced settings and notification preferences.
--  v5 adds: posts / polls / questions with images + videos, poll votes, stat privacy,
--           favorite voice actors + staff, and a storage bucket for uploaded images/videos.
--  v6 adds: chat (DMs + message requests from non-friends), the app owner (who controls 18+ content)
--           and fixes posting polls/posts without an anime attached.
--  v7.9 adds: Songs rankings (Movies & TV + Songs sections).
--  v7.5 adds: feedback board with up/down votes, community story order for game series, Movies vs TV rankings.
--  v7.4 adds: Games section (IGDB) + Movies & TV placeholder, separate Manga / Manhwa / Games / Movies & TV rankings.
--  v7.3 adds: online status (last seen), see a friend's friends (if they allow it).
--  v7.2 adds: tier lists + debates, anime alerts, watch buddies, saved links, profile decorations, AniList sync.
--  v7.1 adds: your own ranking order (anime / movies / manga).
--  v7 adds: post audience (friends-only vs everyone), group chats, and animated (GIF) profile
--           pictures + banners.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. CORE TABLES (from earlier versions)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists accent text;
alter table public.profiles add column if not exists updated_at timestamptz default now();
alter table public.profiles add column if not exists banner_url text;

create table if not exists public.friendships (
  id          bigint generated always as identity primary key,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

-- old 1-to-1 co-op table (kept so nothing is lost; the app now uses squads)
create table if not exists public.coop_watchlists (
  id          bigint generated always as identity primary key,
  anime_id    integer not null,
  anime_data  jsonb   not null,
  status      text    not null default 'PLANNING',
  score       numeric default 0,
  progress    integer default 0,
  updated_by  uuid not null references public.profiles(id) on delete cascade,
  shared_with uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (anime_id, updated_by, shared_with)
);

create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));
create unique index if not exists friendships_pair_idx
  on public.friendships (least(sender_id, receiver_id), greatest(sender_id, receiver_id));

-- ---------------------------------------------------------------------
-- 2. NEW TABLES (v3)
-- ---------------------------------------------------------------------
-- Your personal ("solo") list — now in the cloud so friends can see your profile
create table if not exists public.list_entries (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  media_id    integer not null,
  media_type  text not null default 'ANIME',
  media_data  jsonb not null,
  status      text not null default 'PLANNING',
  score       numeric default 0,
  progress    integer default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, media_id)
);
create index if not exists list_entries_updated_idx on public.list_entries (updated_at desc);

create table if not exists public.favorite_characters (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  character_id integer not null,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, character_id)
);

-- Squads = co-op groups with any number of friends
create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  color       text,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  legacy_pair text unique,           -- marks squads copied from the old co-op table
  created_at  timestamptz not null default now()
);
create table if not exists public.squad_members (
  squad_id  uuid not null references public.squads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  added_by  uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);
create table if not exists public.squad_entries (
  squad_id    uuid not null references public.squads(id) on delete cascade,
  media_id    integer not null,
  media_type  text not null default 'ANIME',
  media_data  jsonb not null,
  status      text not null default 'PLANNING',
  score       numeric default 0,
  progress    integer default 0,
  added_by    uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (squad_id, media_id)
);

-- Comments on a show, or on one episode/chapter of it
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  media_id    integer not null,
  media_type  text not null default 'ANIME',
  media_title text,
  media_cover text,
  episode     integer,                 -- null = about the whole show
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists comments_media_idx on public.comments (media_id, created_at desc);
alter table public.comments add column if not exists parent_id bigint references public.comments(id) on delete cascade;

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,   -- who receives it
  actor_id    uuid references public.profiles(id) on delete cascade,           -- who did something
  kind        text not null,            -- comment | squad_added | squad_entry
  media_id    integer,
  media_type  text,
  media_title text,
  media_cover text,
  episode     integer,
  squad_id    uuid references public.squads(id) on delete cascade,
  text        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications add column if not exists activity_id bigint;
alter table public.notifications add column if not exists comment_id bigint;

-- One row per day a user opened the app → "days active"
create table if not exists public.user_activity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------
-- 2b. NEW TABLES (v4)
-- ---------------------------------------------------------------------
-- Your settings (theme, scoring, list order, activity) + which notifications you want. Only you can read them.
create table if not exists public.user_settings (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  notif_prefs jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Who can see each of your lists (ANIME / MANGA …)
--   friends = all friends (default) · private = only you · except = all friends except hidden_from
create table if not exists public.list_privacy (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  media_type  text not null,
  mode        text not null default 'friends' check (mode in ('friends', 'private', 'except')),
  hidden_from uuid[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, media_type)
);

-- Activity feed: "Watched episode 5 of Frieren", "Completed Bocchi the Rock!" …
create table if not exists public.activities (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  media_id      integer not null,
  media_type    text not null default 'ANIME',
  media_title   text,
  media_cover   text,
  status        text not null,
  progress_from integer,
  progress_to   integer,
  squad_id      uuid references public.squads(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists activities_user_idx on public.activities (user_id, created_at desc);
create index if not exists activities_created_idx on public.activities (created_at desc);

create table if not exists public.activity_replies (
  id          bigint generated always as identity primary key,
  activity_id bigint not null references public.activities(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists activity_replies_idx on public.activity_replies (activity_id, created_at);

-- Likes on activities, activity replies and comments
create table if not exists public.likes (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('activity', 'reply', 'comment')),
  target_id   bigint not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index if not exists likes_target_idx on public.likes (target_type, target_id);

-- ---------------------------------------------------------------------
-- 2c. NEW TABLES (v5)
-- ---------------------------------------------------------------------
-- Who can see each profile stat: { "anime": { "mode": "friends", "hidden_from": ["<user id>", …] }, … }
--   mode = everyone (anyone signed in) · friends (default) · private (only you)
create table if not exists public.stat_privacy (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  rules      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.favorite_staff (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  staff_id   integer not null,
  kind       text not null default 'staff' check (kind in ('va', 'staff')),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, staff_id)
);

-- the feed now has posts, polls and questions next to list updates
alter table public.activities alter column media_id drop not null;
alter table public.activities alter column status drop not null;
alter table public.activities alter column media_type drop not null;   -- v6 fix: posts + polls don't need an anime
alter table public.activities add column if not exists kind text not null default 'list';
alter table public.activities add column if not exists body text;
alter table public.activities add column if not exists attachments jsonb not null default '[]'::jsonb;  -- [{ type: image|video|youtube|link, url }]
alter table public.activities add column if not exists poll jsonb;                                      -- { question, ends_at, options: [{ id, label, image, media_id?, character_id? }] }
alter table public.activities add column if not exists episode integer;
alter table public.activities add column if not exists spoiler boolean not null default false;
alter table public.activities add column if not exists best_reply_id bigint;
alter table public.activities add column if not exists closed boolean not null default false;
do $$ begin
  alter table public.activities add constraint activities_kind_check check (kind in ('list', 'post', 'poll', 'question'));
exception when duplicate_object then null; end $$;

create table if not exists public.poll_votes (
  activity_id bigint not null references public.activities(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  option_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (activity_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2d. NEW TABLES (v6)
-- ---------------------------------------------------------------------
-- Chat: one row per pair of people (user_a < user_b). Messages from non-friends start as a "request".
create table if not exists public.chat_threads (
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'open' check (status in ('open', 'request', 'declined')),
  requested_by    uuid references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  a_read_at       timestamptz not null default '1970-01-01',
  b_read_at       timestamptz not null default '1970-01-01',
  created_at      timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'text' check (kind in ('text', 'sticker', 'gif', 'image', 'anime', 'episode')),
  body        text check (char_length(body) <= 4000),
  payload     jsonb,
  reply_to    bigint references public.messages(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (sender_id <> receiver_id)
);
create index if not exists messages_pair_idx on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at desc);
create index if not exists messages_receiver_idx on public.messages (receiver_id, created_at desc);

-- The app owner decides who may see 18+ content
create table if not exists public.app_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values ('adult', '{"everyone": false, "users": []}') on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2e. NEW TABLES (v7)
-- ---------------------------------------------------------------------
-- posts/polls/questions can go out to just your friends, or to everyone on the app
alter table public.activities add column if not exists audience text not null default 'friends' check (audience in ('friends', 'everyone'));

-- group chats: a named room with 2+ members. Group messages reuse the "messages" table (group_id set, receiver_id null).
create table if not exists public.chat_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  avatar_url text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.chat_group_members (
  group_id  uuid not null references public.chat_groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  read_at   timestamptz not null default '1970-01-01',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists chat_group_members_user_idx on public.chat_group_members (user_id);

alter table public.messages add column if not exists group_id uuid references public.chat_groups(id) on delete cascade;
alter table public.messages alter column receiver_id drop not null;
do $$ begin
  alter table public.messages add constraint messages_target_check check (
    (group_id is null and receiver_id is not null) or (group_id is not null and receiver_id is null));
exception when duplicate_object then null; end $$;
create index if not exists messages_group_idx on public.messages (group_id, created_at desc);

-- notifications for group messages need to know which group
alter table public.notifications add column if not exists group_id uuid references public.chat_groups(id) on delete cascade;

-- v7.1: your own order for your rankings (anime / movies / manga). Titles you haven't placed fall in by score.
create table if not exists public.rank_orders (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  category   text not null check (category in ('ANIME', 'MOVIE', 'MANGA', 'MANHWA', 'GAME', 'FILM', 'TV', 'SONG')),
  media_ids  integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
-- v7.4: rankings also for manhwa, games and movies & TV (widens the check on databases made before v7.4)
alter table public.rank_orders drop constraint if exists rank_orders_category_check;
alter table public.rank_orders add constraint rank_orders_category_check check (category in ('ANIME', 'MOVIE', 'MANGA', 'MANHWA', 'GAME', 'FILM', 'TV', 'SONG'));

-- ---------------------------------------------------------------------
-- 2f. NEW TABLES (v7.2)
-- ---------------------------------------------------------------------
-- feed: tier lists + debates
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in ('list', 'post', 'poll', 'question', 'tierlist', 'debate'));
alter table public.activities add column if not exists extra jsonb;          -- tier list: { title, source, tiers: [...] } · debate: { sides: [a, b] }
alter table public.activity_replies add column if not exists side text;     -- which side of a debate a reply argues

-- "notify me about this anime" (new episodes, new seasons, changes)
create table if not exists public.media_follows (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  media_id   integer not null,
  media_type text not null default 'ANIME',
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, media_id)
);

-- watch buddies: two people whose Plan to watch lists stay in sync
create table if not exists public.watch_buddies (
  id         bigint generated always as identity primary key,
  requester  uuid not null references public.profiles(id) on delete cascade,
  addressee  uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists watch_buddies_pair_idx on public.watch_buddies (least(requester, addressee), greatest(requester, addressee));

-- links you saved on an anime page (only you see them)
create table if not exists public.media_links (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  media_id   integer not null,
  url        text not null check (char_length(url) <= 2000),
  label      text check (char_length(label) <= 120),
  episode    integer,
  created_at timestamptz not null default now()
);
create index if not exists media_links_idx on public.media_links (user_id, media_id);

-- profile decorations (frame, theme, badges you pin) — everyone can see them
alter table public.profiles add column if not exists decor jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists last_seen timestamptz;   -- v7.3: "seen 5 min ago" (only if you show yourself online)

-- linked accounts (AniList) — the token is only readable by you
create table if not exists public.account_links (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  provider     text not null check (provider in ('anilist', 'mal')),
  access_token text not null,
  remote_id    bigint,
  remote_name  text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  primary key (user_id, provider)
);
insert into public.app_config (key, value) values ('anilist', '{"client_id": ""}') on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. HELPER FUNCTIONS (security definer so policies don't loop)
-- ---------------------------------------------------------------------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a = b or exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.sender_id = a and f.receiver_id = b) or (f.sender_id = b and f.receiver_id = a)));
$$;

create or replace function public.is_squad_member(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from squad_members where squad_id = s and user_id = auth.uid());
$$;

create or replace function public.is_squad_creator(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from squads where id = s and created_by = auth.uid());
$$;

-- Can the signed-in user see this person's list of this media type?
create or replace function public.can_view_list(owner uuid, mtype text)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or (
    are_friends(auth.uid(), owner)
    and not exists (
      select 1 from list_privacy p
      where p.user_id = owner and p.media_type = coalesce(mtype, 'ANIME')
        and (p.mode = 'private' or (p.mode = 'except' and auth.uid() = any(p.hidden_from)))));
$$;

-- Which of this person's lists are hidden from me (so the app can say so instead of showing "empty")
create or replace function public.list_hidden_types(owner uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.media_type), '{}') from list_privacy p
  where p.user_id = owner and not can_view_list(owner, p.media_type);
$$;
grant execute on function public.list_hidden_types(uuid) to authenticated;

-- list updates follow that list's privacy; posts, polls and questions are for friends,
-- unless the author chose "everyone" (audience), in which case anyone signed in can see it
create or replace function public.activity_visible(owner uuid, akind text, mtype text, aud text default 'friends')
returns boolean language sql stable security definer set search_path = public as $$
  select case when coalesce(akind, 'list') = 'list' then can_view_list(owner, mtype)
              when coalesce(aud, 'friends') = 'everyone' then auth.uid() is not null
              else are_friends(auth.uid(), owner) end;
$$;

create or replace function public.can_see_activity(aid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from activities a where a.id = aid and activity_visible(a.user_id, a.kind, a.media_type, a.audience));
$$;

create or replace function public.poll_open(aid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from activities a where a.id = aid and a.kind in ('poll', 'debate') and not a.closed
                 and coalesce((a.poll ->> 'ends_at')::timestamptz, now() + interval '1 day') > now());
$$;

-- is this list hidden from the signed-in user by its privacy setting? (ignores friendship)
create or replace function public.list_hidden_from_me(owner uuid, mtype text)
returns boolean language sql stable security definer set search_path = public as $$
  select owner <> auth.uid() and exists (select 1 from list_privacy p where p.user_id = owner and p.media_type = mtype
    and (p.mode = 'private' or (p.mode = 'except' and auth.uid() = any(p.hidden_from))));
$$;

create or replace function public.stat_visible(owner uuid, stat text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r jsonb; m text;
begin
  if owner = auth.uid() then return true; end if;
  select rules -> stat into r from stat_privacy where user_id = owner;
  if r is not null and exists (select 1 from jsonb_array_elements_text(coalesce(r -> 'hidden_from', '[]'::jsonb)) x where x = auth.uid()::text) then
    return false;
  end if;
  m := coalesce(r ->> 'mode', 'friends');
  return m = 'everyone' or (m = 'friends' and are_friends(auth.uid(), owner));
end;
$$;

-- Profile stats for anyone, with each stat blanked (null) if its owner hides it from you
create or replace function public.profile_stats(owner uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; days int; ah boolean; mh boolean;
begin
  if auth.uid() is null then return null; end if;
  select count(*) filter (where media_type = 'ANIME') as anime,
         count(*) filter (where media_type = 'MANGA') as manga,
         coalesce(sum(case when status = 'COMPLETED' then coalesce(nullif(media_data ->> 'episodes', '')::int, progress) else progress end) filter (where media_type = 'ANIME'), 0) as eps,
         coalesce(sum(case when status = 'COMPLETED' then coalesce(nullif(media_data ->> 'episodes', '')::int, progress) else progress end) filter (where media_type = 'MANGA'), 0) as chapters,
         count(*) filter (where status = 'COMPLETED') as completed,
         count(*) filter (where status = 'COMPLETED' and media_type = 'ANIME') as anime_done,
         count(*) filter (where status = 'COMPLETED' and media_type = 'MANGA') as manga_done,
         avg(score) filter (where score > 0) as mean
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
grant execute on function public.profile_stats(uuid) to authenticated;

-- ---- owner + 18+ ----
create or replace function public.is_app_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;
grant execute on function public.is_app_owner() to authenticated;

-- The first person to press "Claim owner" in Settings becomes the owner (only works while there is none)
create or replace function public.claim_owner()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  lock table app_admins in exclusive mode;
  if exists (select 1 from app_admins) then return exists (select 1 from app_admins where user_id = auth.uid()); end if;
  insert into app_admins (user_id) values (auth.uid());
  return true;
end;
$$;
grant execute on function public.claim_owner() to authenticated;

create or replace function public.adult_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select is_app_owner() or coalesce((select (value ->> 'everyone')::boolean or (value -> 'users') ? auth.uid()::text from app_config where key = 'adult'), false);
$$;
grant execute on function public.adult_allowed() to authenticated;

create or replace function public.has_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins);
$$;
grant execute on function public.has_owner() to authenticated;

-- ---- chat ----
create or replace function public.can_message(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and target <> auth.uid() and exists (select 1 from profiles where id = target)
     and not exists (select 1 from chat_threads t where t.user_a = least(auth.uid(), target) and t.user_b = greatest(auth.uid(), target)
                     and t.status = 'declined' and t.requested_by = auth.uid());
$$;

-- Your conversations with the last message + unread count
create or replace function public.my_chats()
returns table (other uuid, status text, requested_by uuid, last_message_at timestamptz, last_body text, last_kind text, last_sender uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select case when t.user_a = auth.uid() then t.user_b else t.user_a end,
         t.status, t.requested_by, t.last_message_at, m.body, m.kind, m.sender_id,
         (select count(*) from messages x where x.receiver_id = auth.uid()
            and x.sender_id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
            and x.created_at > case when t.user_a = auth.uid() then t.a_read_at else t.b_read_at end)
  from chat_threads t
  left join lateral (select body, kind, sender_id from messages
                     where least(sender_id, receiver_id) = t.user_a and greatest(sender_id, receiver_id) = t.user_b
                     order by created_at desc limit 1) m on true
  where auth.uid() in (t.user_a, t.user_b)
  order by t.last_message_at desc;
$$;
grant execute on function public.my_chats() to authenticated;

create or replace function public.mark_chat_read(other uuid)
returns void language sql security definer set search_path = public as $$
  update chat_threads set a_read_at = case when user_a = auth.uid() then now() else a_read_at end,
                          b_read_at = case when user_b = auth.uid() then now() else b_read_at end
  where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other);
$$;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Accept or decline a message request from someone who isn't your friend
create or replace function public.respond_chat(other uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  update chat_threads set status = case when accept then 'open' else 'declined' end
  where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other) and requested_by = other and status <> 'open'
  returning status into st;
  return st;
end;
$$;
grant execute on function public.respond_chat(uuid, boolean) to authenticated;

-- ---- group chat ----
create or replace function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_group_members where group_id = gid and user_id = auth.uid());
$$;
grant execute on function public.is_group_member(uuid) to authenticated;

-- Creates a group with you as the first member, then adds any friends you picked
create or replace function public.create_group(gname text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(gname), '') = '' then raise exception 'Group needs a name'; end if;
  insert into chat_groups (name, created_by) values (left(trim(gname), 60), auth.uid()) returning id into gid;
  insert into chat_group_members (group_id, user_id) values (gid, auth.uid());
  foreach m in array coalesce(member_ids, '{}'::uuid[]) loop
    if m <> auth.uid() and are_friends(auth.uid(), m) then
      insert into chat_group_members (group_id, user_id) values (gid, m) on conflict do nothing;
    end if;
  end loop;
  return gid;
end;
$$;
grant execute on function public.create_group(text, uuid[]) to authenticated;

-- Any current member can add one of their own friends to the group
create or replace function public.add_group_member(gid uuid, member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(gid) then raise exception 'You are not in that group'; end if;
  if not public.are_friends(auth.uid(), member_id) then raise exception 'Only friends can be added'; end if;
  insert into chat_group_members (group_id, user_id) values (gid, member_id) on conflict do nothing;
end;
$$;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

create or replace function public.leave_group(gid uuid)
returns void language sql security definer set search_path = public as $$
  delete from chat_group_members where group_id = gid and user_id = auth.uid();
$$;
grant execute on function public.leave_group(uuid) to authenticated;

create or replace function public.mark_group_read(gid uuid)
returns void language sql security definer set search_path = public as $$
  update chat_group_members set read_at = now() where group_id = gid and user_id = auth.uid();
$$;
grant execute on function public.mark_group_read(uuid) to authenticated;

-- Your groups, each with its member count, last message + unread count
create or replace function public.my_groups()
returns table (id uuid, name text, avatar_url text, member_count bigint, last_message_at timestamptz, last_body text, last_kind text, last_sender uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.avatar_url,
         (select count(*) from chat_group_members gm2 where gm2.group_id = g.id),
         coalesce(m.created_at, g.created_at), m.body, m.kind, m.sender_id,
         (select count(*) from messages x where x.group_id = g.id and x.sender_id <> auth.uid() and x.created_at > gmy.read_at)
  from chat_group_members gmy
  join chat_groups g on g.id = gmy.group_id
  left join lateral (select body, kind, sender_id, created_at from messages where group_id = g.id order by created_at desc limit 1) m on true
  where gmy.user_id = auth.uid()
  order by coalesce(m.created_at, g.created_at) desc;
$$;
grant execute on function public.my_groups() to authenticated;

-- Member ids for a group you belong to (the app resolves these against profiles it already has)
create or replace function public.group_member_ids(gid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from chat_group_members where group_id = gid and public.is_group_member(gid);
$$;
grant execute on function public.group_member_ids(uuid) to authenticated;

-- Ends a poll once its time is up (any viewer's app calls this) and tells the author + voters who won
create or replace function public.close_poll(aid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a activities%rowtype; win text; lbl text; total int;
begin
  select * into a from activities where id = aid and kind = 'poll';
  if a.id is null or not can_see_activity(aid) then return null; end if;
  if a.closed or coalesce((a.poll ->> 'ends_at')::timestamptz, now() + interval '1 day') > now() then return jsonb_build_object('closed', a.closed); end if;
  update activities set closed = true where id = aid and not closed;
  if not found then return jsonb_build_object('closed', true); end if;
  select option_id into win from poll_votes where activity_id = aid group by option_id order by count(*) desc, min(created_at) limit 1;
  select count(*) into total from poll_votes where activity_id = aid;
  select o ->> 'label' into lbl from jsonb_array_elements(a.poll -> 'options') o where o ->> 'id' = win;
  insert into notifications (user_id, actor_id, kind, activity_id, text)
  select u, case when u = a.user_id then null else a.user_id end, 'poll_ended', aid,
         left(coalesce(a.poll ->> 'question', 'Poll'), 90) || ' → ' || coalesce(lbl, 'no votes') || ' (' || total || ' votes)'
  from (select a.user_id as u union select user_id from poll_votes where activity_id = aid) t
  where pref_on(u, 'poll_ended');
  return jsonb_build_object('closed', true, 'winner', win);
end;
$$;
grant execute on function public.close_poll(bigint) to authenticated;

create or replace function public.activity_owner(aid bigint)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from activities where id = aid;
$$;

-- Notification preference (everything is ON unless you switch it off in Settings)
create or replace function public.pref_on(uid uuid, pref text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (s.notif_prefs ->> pref)::boolean from user_settings s where s.user_id = uid), true);
$$;

-- Friends @mentioned in a text (e.g. "@ellen look at this")
create or replace function public.mentioned_users(body text, author uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id
  from regexp_matches(coalesce(body, ''), '@([A-Za-z0-9_.]{3,20})', 'g') as m
  join profiles p on lower(p.username) = lower(rtrim(m[1], '.'))
  where p.id <> author and are_friends(author, p.id);
$$;

-- Create a squad with you + any of your friends in one go
create or replace function public.create_squad(p_name text, p_members uuid[], p_color text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Squad needs a name'; end if;
  insert into squads (name, color, created_by) values (left(trim(p_name), 40), p_color, auth.uid()) returning id into sid;
  insert into squad_members (squad_id, user_id, added_by) values (sid, auth.uid(), auth.uid());
  foreach m in array coalesce(p_members, '{}'::uuid[]) loop
    if m <> auth.uid() and are_friends(auth.uid(), m) then
      insert into squad_members (squad_id, user_id, added_by) values (sid, m, auth.uid()) on conflict do nothing;
    end if;
  end loop;
  return sid;
end;
$$;
grant execute on function public.create_squad(text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. AUTO-CREATE PROFILE ON SIGN-UP
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, username)
select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'username'), ''), split_part(u.email, '@', 1))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. COPY OLD 1-TO-1 CO-OP LISTS INTO 2-PERSON SQUADS (runs once per pair)
-- ---------------------------------------------------------------------
do $$
declare r record; sid uuid; na text; nb text;
begin
  for r in
    select distinct least(updated_by, shared_with) as a, greatest(updated_by, shared_with) as b
    from public.coop_watchlists where shared_with is not null
  loop
    select id into sid from public.squads where legacy_pair = r.a::text || ':' || r.b::text;
    if sid is null then
      select username into na from public.profiles where id = r.a;
      select username into nb from public.profiles where id = r.b;
      insert into public.squads (name, created_by, legacy_pair)
      values (left(coalesce(na, '?') || ' & ' || coalesce(nb, '?'), 40), r.a, r.a::text || ':' || r.b::text)
      returning id into sid;
      insert into public.squad_members (squad_id, user_id, added_by)
      values (sid, r.a, null), (sid, r.b, null) on conflict do nothing;
      insert into public.squad_entries (squad_id, media_id, media_type, media_data, status, score, progress, added_by, updated_by, created_at, updated_at)
      select distinct on (c.anime_id) sid, c.anime_id, coalesce(c.anime_data->>'type', 'ANIME'), c.anime_data, c.status, c.score, c.progress, null, null, c.created_at, c.created_at
      from public.coop_watchlists c
      where least(c.updated_by, c.shared_with) = r.a and greatest(c.updated_by, c.shared_with) = r.b
      order by c.anime_id, c.created_at desc
      on conflict (squad_id, media_id) do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. NOTIFICATION TRIGGERS
-- ---------------------------------------------------------------------
-- Friend requests: "When someone follows me"
create or replace function public.notify_friendship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' and pref_on(new.receiver_id, 'follow') then
    insert into notifications (user_id, actor_id, kind) values (new.receiver_id, new.sender_id, 'follow');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' and pref_on(new.sender_id, 'follow') then
    insert into notifications (user_id, actor_id, kind) values (new.sender_id, new.receiver_id, 'friend_accept');
  end if;
  return new;
end;
$$;
drop trigger if exists on_friendship_change on public.friendships;
create trigger on_friendship_change after insert or update on public.friendships
  for each row execute function public.notify_friendship();

-- New comment → reply notification, @mentions, then every other friend
create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare done uuid[] := array[new.user_id]; target uuid;
begin
  if new.parent_id is not null then
    select user_id into target from comments where id = new.parent_id;
    if target is not null and not target = any(done) then
      if pref_on(target, 'comment_reply') then
        insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, episode, text, comment_id)
        values (target, new.user_id, 'comment_reply', new.media_id, new.media_type, new.media_title, new.media_cover, new.episode, left(new.body, 140), new.id);
      end if;
      done := done || target;
    end if;
  end if;
  for target in select * from mentioned_users(new.body, new.user_id) loop
    if not target = any(done) then
      if pref_on(target, 'comment_mention') then
        insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, episode, text, comment_id)
        values (target, new.user_id, 'comment_mention', new.media_id, new.media_type, new.media_title, new.media_cover, new.episode, left(new.body, 140), new.id);
      end if;
      done := done || target;
    end if;
  end loop;
  insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, episode, text, comment_id)
  select f.other, new.user_id, 'comment', new.media_id, new.media_type, new.media_title, new.media_cover, new.episode, left(new.body, 140), new.id
  from (select case when sender_id = new.user_id then receiver_id else sender_id end as other
        from friendships where status = 'accepted' and (sender_id = new.user_id or receiver_id = new.user_id)) f
  where not f.other = any(done) and pref_on(f.other, 'friend_comment');
  return new;
end;
$$;
drop trigger if exists on_comment_created on public.comments;
create trigger on_comment_created after insert on public.comments
  for each row execute function public.notify_comment();

-- Reply on an activity → its owner + anyone @mentioned
create or replace function public.notify_activity_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare a activities%rowtype; target uuid; done uuid[] := array[new.user_id];
begin
  select * into a from activities where id = new.activity_id;
  if a.user_id is not null and not a.user_id = any(done) then
    if pref_on(a.user_id, 'activity_reply') then
      insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, text, activity_id)
      values (a.user_id, new.user_id, 'activity_reply', a.media_id, a.media_type, a.media_title, a.media_cover, left(new.body, 140), a.id);
    end if;
    done := done || a.user_id;
  end if;
  for target in select * from mentioned_users(new.body, new.user_id) loop
    if not target = any(done) and pref_on(target, 'activity_mention') then
      insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, text, activity_id)
      values (target, new.user_id, 'activity_mention', a.media_id, a.media_type, a.media_title, a.media_cover, left(new.body, 140), a.id);
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists on_activity_reply on public.activity_replies;
create trigger on_activity_reply after insert on public.activity_replies
  for each row execute function public.notify_activity_reply();

-- New post / poll / question → friends (+ anyone @mentioned)
create or replace function public.notify_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid; done uuid[] := array[new.user_id]; txt text;
begin
  if new.kind = 'list' then return new; end if;
  txt := left(coalesce(nullif(new.body, ''), new.poll ->> 'question', ''), 140);
  for target in select * from mentioned_users(coalesce(new.body, '') || ' ' || coalesce(new.poll ->> 'question', ''), new.user_id) loop
    if pref_on(target, 'activity_mention') then
      insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, text, activity_id)
      values (target, new.user_id, 'activity_mention', new.media_id, new.media_type, new.media_title, new.media_cover, txt, new.id);
    end if;
    done := done || target;
  end loop;
  insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, text, activity_id)
  select f.other, new.user_id, 'friend_' || new.kind, new.media_id, new.media_type, new.media_title, new.media_cover, txt, new.id
  from (select case when sender_id = new.user_id then receiver_id else sender_id end as other
        from friendships where status = 'accepted' and (sender_id = new.user_id or receiver_id = new.user_id)) f
  where not f.other = any(done) and pref_on(f.other, 'friend_post');
  return new;
end;
$$;
drop trigger if exists on_post_created on public.activities;
create trigger on_post_created after insert on public.activities
  for each row execute function public.notify_post();

-- New message: open/extend the thread (non-friends → request), then notify. Group messages skip all of that.
create or replace function public.before_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare t chat_threads%rowtype; a uuid; b uuid;
begin
  if new.group_id is not null then
    if not public.is_group_member(new.group_id) then raise exception 'You are not in that group'; end if;
    return new;
  end if;
  a := least(new.sender_id, new.receiver_id); b := greatest(new.sender_id, new.receiver_id);
  select * into t from chat_threads where user_a = a and user_b = b for update;
  if t.user_a is null then
    insert into chat_threads (user_a, user_b, status, requested_by, last_message_at)
    values (a, b, case when are_friends(new.sender_id, new.receiver_id) then 'open' else 'request' end, new.sender_id, now());
  else
    if t.status = 'declined' and t.requested_by = new.sender_id then raise exception 'This person declined your messages'; end if;
    update chat_threads set last_message_at = now(),
      status = case when status <> 'open' and (requested_by <> new.sender_id or are_friends(a, b)) then 'open' else status end
    where user_a = a and user_b = b;
  end if;
  return new;
end;
$$;
drop trigger if exists on_message_before on public.messages;
create trigger on_message_before before insert on public.messages
  for each row execute function public.before_message();

create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare txt text; st text; m uuid;
begin
  txt := case new.kind when 'text' then left(new.body, 140) when 'sticker' then 'sent a sticker' when 'gif' then 'sent a GIF'
              when 'image' then 'sent a picture' when 'anime' then 'recommended ' || coalesce(new.payload ->> 'title', 'something')
              when 'episode' then 'shared ' || coalesce(new.payload ->> 'title', '') || ' · Ep ' || coalesce(new.payload ->> 'episode', '?') end;
  if new.group_id is not null then
    for m in select user_id from chat_group_members where group_id = new.group_id and user_id <> new.sender_id loop
      if pref_on(m, 'message') then
        update notifications set text = txt, created_at = now()
        where user_id = m and actor_id = new.sender_id and kind = 'group_message' and group_id = new.group_id and not read;
        if not found then
          insert into notifications (user_id, actor_id, kind, text, group_id) values (m, new.sender_id, 'group_message', txt, new.group_id);
        end if;
      end if;
    end loop;
    return new;
  end if;
  select status into st from chat_threads where user_a = least(new.sender_id, new.receiver_id) and user_b = greatest(new.sender_id, new.receiver_id);
  if st = 'declined' or not pref_on(new.receiver_id, 'message') then return new; end if;
  -- one unread notification per person: update it instead of stacking new ones
  update notifications set text = txt, created_at = now(), kind = case when st = 'request' then 'message_request' else 'message' end
  where user_id = new.receiver_id and actor_id = new.sender_id and kind in ('message', 'message_request') and not read;
  if not found then
    insert into notifications (user_id, actor_id, kind, text) values (new.receiver_id, new.sender_id, case when st = 'request' then 'message_request' else 'message' end, txt);
  end if;
  return new;
end;
$$;
drop trigger if exists on_message_after on public.messages;
create trigger on_message_after after insert on public.messages
  for each row execute function public.notify_message();

-- Question author picks a best answer → tell whoever wrote it
create or replace function public.notify_best_answer()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid; txt text;
begin
  if new.best_reply_id is null or new.best_reply_id is not distinct from old.best_reply_id then return new; end if;
  select user_id, left(body, 140) into target, txt from activity_replies where id = new.best_reply_id and activity_id = new.id;
  if target is not null and target <> new.user_id and pref_on(target, 'activity_reply') then
    insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, text, activity_id)
    values (target, new.user_id, 'best_answer', new.media_id, new.media_type, new.media_title, new.media_cover, txt, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists on_best_answer on public.activities;
create trigger on_best_answer after update of best_reply_id on public.activities
  for each row execute function public.notify_best_answer();

-- Likes → the owner of the liked thing (once per person + thing)
create or replace function public.notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; k text; aid bigint; cid bigint; a activities%rowtype; c comments%rowtype; txt text;
begin
  if new.target_type = 'activity' then
    select * into a from activities where id = new.target_id;
    owner := a.user_id; k := 'activity_like'; aid := a.id;
  elsif new.target_type = 'reply' then
    select r.user_id, r.activity_id, left(r.body, 140) into owner, aid, txt from activity_replies r where r.id = new.target_id;
    select * into a from activities where id = aid;
    k := 'reply_like';
  else
    select * into c from comments where id = new.target_id;
    owner := c.user_id; k := 'comment_like'; cid := c.id; txt := left(c.body, 140);
  end if;
  if owner is null or owner = new.user_id or not pref_on(owner, k) then return new; end if;
  if exists (select 1 from notifications n where n.user_id = owner and n.actor_id = new.user_id and n.kind = k
             and coalesce(n.activity_id, -1) = coalesce(aid, -1) and coalesce(n.comment_id, -1) = coalesce(cid, -1)
             and coalesce(n.text, '') = coalesce(txt, '')) then
    return new;
  end if;
  insert into notifications (user_id, actor_id, kind, media_id, media_type, media_title, media_cover, episode, text, activity_id, comment_id)
  values (owner, new.user_id, k, coalesce(a.media_id, c.media_id), coalesce(a.media_type, c.media_type), coalesce(a.media_title, c.media_title),
          coalesce(a.media_cover, c.media_cover), c.episode, txt, aid, cid);
  return new;
end;
$$;
drop trigger if exists on_like on public.likes;
create trigger on_like after insert on public.likes
  for each row execute function public.notify_like();

-- Someone adds you to a squad
create or replace function public.notify_squad_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.added_by is not null and new.added_by <> new.user_id and pref_on(new.user_id, 'squad') then
    insert into notifications (user_id, actor_id, kind, squad_id, text)
    select new.user_id, new.added_by, 'squad_added', new.squad_id, s.name from squads s where s.id = new.squad_id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_squad_member_added on public.squad_members;
create trigger on_squad_member_added after insert on public.squad_members
  for each row execute function public.notify_squad_member();

-- Someone adds a new show to a squad list → the other members hear about it
create or replace function public.notify_squad_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.added_by is not null then
    insert into notifications (user_id, actor_id, kind, squad_id, media_id, media_type, media_title, media_cover, text)
    select m.user_id, new.added_by, 'squad_entry', new.squad_id, new.media_id, new.media_type,
           coalesce(new.media_data->'title'->>'romaji', new.media_data->'title'->>'english'),
           new.media_data->'coverImage'->>'large', s.name
    from squad_members m join squads s on s.id = m.squad_id
    where m.squad_id = new.squad_id and m.user_id <> new.added_by and pref_on(m.user_id, 'squad');
  end if;
  return new;
end;
$$;
drop trigger if exists on_squad_entry_added on public.squad_entries;
create trigger on_squad_entry_added after insert on public.squad_entries
  for each row execute function public.notify_squad_entry();

-- ---- a person's friends list, shown on their profile if their setting allows (v7.3) ----
-- setting lives in user_settings.settings.friendsVisibility: everyone | friends (default) | private
create or replace function public.friends_of(owner uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when owner = auth.uid() or (
      case coalesce((select settings ->> 'friendsVisibility' from user_settings where user_id = owner), 'friends')
        when 'everyone' then auth.uid() is not null
        when 'friends' then are_friends(auth.uid(), owner)
        else false end)
    then jsonb_build_object('hidden', false, 'ids', coalesce((
      select jsonb_agg(case when f.sender_id = owner then f.receiver_id else f.sender_id end)
      from friendships f where f.status = 'accepted' and owner in (f.sender_id, f.receiver_id)), '[]'::jsonb))
    else jsonb_build_object('hidden', true, 'ids', '[]'::jsonb) end;
$$;
grant execute on function public.friends_of(uuid) to authenticated;

-- ---- watch buddies (v7.2) ----
create or replace function public.is_buddy(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from watch_buddies w where w.status = 'accepted'
                 and ((w.requester = a and w.addressee = b) or (w.requester = b and w.addressee = a)));
$$;
grant execute on function public.is_buddy(uuid, uuid) to authenticated;

-- copies everything one person has on Plan to watch onto the other's list (never touches titles they already have)
create or replace function public.merge_buddy_planning(src uuid, dst uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anicoop.buddy_sync', 'on', true);
  insert into list_entries (user_id, media_id, media_type, media_data, status, score, progress)
  select dst, e.media_id, e.media_type, e.media_data, 'PLANNING', 0, 0 from list_entries e
  where e.user_id = src and e.status = 'PLANNING'
  on conflict (user_id, media_id) do nothing;
  perform set_config('anicoop.buddy_sync', '', true);
end;
$$;

create or replace function public.on_buddy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, actor_id, kind) values (new.addressee, new.requester, 'buddy_request');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    insert into notifications (user_id, actor_id, kind) values (new.requester, new.addressee, 'buddy_accept');
    perform merge_buddy_planning(new.requester, new.addressee);
    perform merge_buddy_planning(new.addressee, new.requester);
  end if;
  return new;
end;
$$;
drop trigger if exists on_buddy_change on public.watch_buddies;
create trigger on_buddy_change after insert or update on public.watch_buddies
  for each row execute function public.on_buddy_change();

-- when you add / remove something on Plan to watch, your buddies' Plan to watch follows (only Plan to watch — their
-- watching/completed titles are never changed). Changes made by this sync don't ripple on to other buddies.
create or replace function public.sync_buddy_planning()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; me uuid;
begin
  if coalesce(current_setting('anicoop.buddy_sync', true), '') = 'on' then return coalesce(new, old); end if;
  me := coalesce(new.user_id, old.user_id);
  perform set_config('anicoop.buddy_sync', 'on', true);
  for b in select case when requester = me then addressee else requester end from watch_buddies
           where status = 'accepted' and (requester = me or addressee = me) loop
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
drop trigger if exists on_list_buddy_sync on public.list_entries;
create trigger on_list_buddy_sync after insert or update of status or delete on public.list_entries
  for each row execute function public.sync_buddy_planning();

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY — drop every old policy, then recreate
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('profiles', 'friendships', 'coop_watchlists', 'list_entries', 'favorite_characters',
      'squads', 'squad_members', 'squad_entries', 'comments', 'notifications', 'user_activity',
      'user_settings', 'list_privacy', 'activities', 'activity_replies', 'likes', 'stat_privacy', 'favorite_staff', 'poll_votes', 'chat_threads', 'messages', 'app_admins', 'app_config',
      'chat_groups', 'chat_group_members', 'rank_orders', 'media_follows', 'watch_buddies', 'media_links', 'account_links')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.profiles            enable row level security;
alter table public.friendships         enable row level security;
alter table public.coop_watchlists     enable row level security;
alter table public.list_entries        enable row level security;
alter table public.favorite_characters enable row level security;
alter table public.squads              enable row level security;
alter table public.squad_members       enable row level security;
alter table public.squad_entries       enable row level security;
alter table public.comments            enable row level security;
alter table public.notifications       enable row level security;
alter table public.user_activity       enable row level security;
alter table public.user_settings       enable row level security;
alter table public.list_privacy        enable row level security;
alter table public.activities          enable row level security;
alter table public.activity_replies    enable row level security;
alter table public.likes               enable row level security;
alter table public.stat_privacy        enable row level security;
alter table public.favorite_staff      enable row level security;
alter table public.poll_votes          enable row level security;
alter table public.chat_threads        enable row level security;
alter table public.messages            enable row level security;
alter table public.app_admins          enable row level security;
alter table public.app_config          enable row level security;
alter table public.chat_groups         enable row level security;
alter table public.chat_group_members  enable row level security;
alter table public.rank_orders         enable row level security;
alter table public.media_follows       enable row level security;
alter table public.watch_buddies       enable row level security;
alter table public.media_links         enable row level security;
alter table public.account_links       enable row level security;

grant select on public.profiles to anon;
grant select, insert, update, delete on public.profiles, public.friendships, public.coop_watchlists, public.list_entries,
  public.favorite_characters, public.squads, public.squad_members, public.squad_entries, public.comments,
  public.notifications, public.user_activity, public.user_settings, public.list_privacy, public.activities,
  public.activity_replies, public.likes, public.stat_privacy, public.favorite_staff, public.poll_votes, public.chat_threads, public.messages,
  public.app_admins, public.app_config, public.chat_groups, public.chat_group_members, public.rank_orders, public.media_follows, public.watch_buddies, public.media_links, public.account_links to authenticated;

-- profiles
create policy "profiles: public read" on public.profiles for select to anon, authenticated using (true);
create policy "profiles: insert own"  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles: update own"  on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- friendships
create policy "friendships: see own" on public.friendships for select to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "friendships: send request" on public.friendships for insert to authenticated with check (auth.uid() = sender_id and status = 'pending');
create policy "friendships: receiver accepts" on public.friendships for update to authenticated using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);
create policy "friendships: either side removes" on public.friendships for delete to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- old co-op table (read/delete only now)
create policy "coop: members read" on public.coop_watchlists for select to authenticated using (auth.uid() = updated_by or auth.uid() = shared_with);
create policy "coop: members delete" on public.coop_watchlists for delete to authenticated using (auth.uid() = updated_by or auth.uid() = shared_with);

-- personal lists + favourites: you write your own, friends can read
create policy "list: friends read" on public.list_entries for select to authenticated using (public.can_view_list(user_id, media_type));
create policy "list: own insert"   on public.list_entries for insert to authenticated with check (auth.uid() = user_id);
create policy "list: own update"   on public.list_entries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "list: own delete"   on public.list_entries for delete to authenticated using (auth.uid() = user_id);

create policy "favs: friends read" on public.favorite_characters for select to authenticated using (public.are_friends(auth.uid(), user_id));
create policy "favs: own insert"   on public.favorite_characters for insert to authenticated with check (auth.uid() = user_id);
create policy "favs: own delete"   on public.favorite_characters for delete to authenticated using (auth.uid() = user_id);

-- squads
create policy "squads: members read"   on public.squads for select to authenticated using (public.is_squad_member(id) or created_by = auth.uid());
create policy "squads: create"         on public.squads for insert to authenticated with check (created_by = auth.uid());
create policy "squads: members rename" on public.squads for update to authenticated using (public.is_squad_member(id)) with check (public.is_squad_member(id));
create policy "squads: creator delete" on public.squads for delete to authenticated using (created_by = auth.uid());

create policy "members: members read" on public.squad_members for select to authenticated using (public.is_squad_member(squad_id));
create policy "members: add" on public.squad_members for insert to authenticated with check (
  (user_id = auth.uid() and public.is_squad_creator(squad_id))                         -- creator joins own squad
  or (public.is_squad_member(squad_id) and public.are_friends(auth.uid(), user_id))    -- members add their friends
);
create policy "members: leave or creator removes" on public.squad_members for delete to authenticated using (user_id = auth.uid() or public.is_squad_creator(squad_id));

create policy "squad entries: members read"   on public.squad_entries for select to authenticated using (public.is_squad_member(squad_id));
create policy "squad entries: members add"    on public.squad_entries for insert to authenticated with check (public.is_squad_member(squad_id));
create policy "squad entries: members edit"   on public.squad_entries for update to authenticated using (public.is_squad_member(squad_id)) with check (public.is_squad_member(squad_id));
create policy "squad entries: members remove" on public.squad_entries for delete to authenticated using (public.is_squad_member(squad_id));

-- comments: you and your friends can read, you write/delete your own
create policy "comments: friends read" on public.comments for select to authenticated using (public.are_friends(auth.uid(), user_id));
create policy "comments: own insert"   on public.comments for insert to authenticated with check (auth.uid() = user_id);
create policy "comments: own delete"   on public.comments for delete to authenticated using (auth.uid() = user_id);

-- notifications: only yours (created by the triggers above)
create policy "notifications: own read"   on public.notifications for select to authenticated using (auth.uid() = user_id);
create policy "notifications: own update" on public.notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications: own delete" on public.notifications for delete to authenticated using (auth.uid() = user_id);
-- the app itself adds "a show on your list changed" notices for you
create policy "notifications: site data self insert" on public.notifications for insert to authenticated
  with check (auth.uid() = user_id and actor_id is null and kind in ('media_related', 'media_changed', 'media_removed', 'media_episode'));

-- activity
create policy "activity: friends read" on public.user_activity for select to authenticated using (public.are_friends(auth.uid(), user_id));
create policy "activity: own insert"   on public.user_activity for insert to authenticated with check (auth.uid() = user_id);

-- settings + privacy: only you
create policy "settings: own" on public.user_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "privacy: own"  on public.list_privacy  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- activity feed: visible to whoever can see that list (or everyone, if the author chose that audience)
create policy "feed: read"       on public.activities for select to authenticated using (public.activity_visible(user_id, kind, media_type, audience));
create policy "feed: own insert" on public.activities for insert to authenticated with check (auth.uid() = user_id);
create policy "feed: own update" on public.activities for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "feed: own delete" on public.activities for delete to authenticated using (auth.uid() = user_id);

create policy "replies: read"   on public.activity_replies for select to authenticated using (public.can_see_activity(activity_id));
create policy "replies: insert" on public.activity_replies for insert to authenticated with check (auth.uid() = user_id and public.can_see_activity(activity_id));
create policy "replies: delete" on public.activity_replies for delete to authenticated using (auth.uid() = user_id or public.activity_owner(activity_id) = auth.uid());

create policy "likes: read"       on public.likes for select to authenticated using (true);
create policy "likes: own insert" on public.likes for insert to authenticated with check (auth.uid() = user_id);
create policy "likes: own delete" on public.likes for delete to authenticated using (auth.uid() = user_id);

-- stat privacy: only you
create policy "stat privacy: own" on public.stat_privacy for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- favorite voice actors + staff: friends read, you edit
create policy "fav staff: friends read" on public.favorite_staff for select to authenticated using (public.are_friends(auth.uid(), user_id));
create policy "fav staff: own insert"   on public.favorite_staff for insert to authenticated with check (auth.uid() = user_id);
create policy "fav staff: own delete"   on public.favorite_staff for delete to authenticated using (auth.uid() = user_id);

-- poll votes: see them if you can see the poll, vote/change/remove while it's open
create policy "votes: read"   on public.poll_votes for select to authenticated using (public.can_see_activity(activity_id));
create policy "votes: vote"   on public.poll_votes for insert to authenticated with check (auth.uid() = user_id and public.can_see_activity(activity_id) and public.poll_open(activity_id));
create policy "votes: change" on public.poll_votes for update to authenticated using (auth.uid() = user_id and public.poll_open(activity_id)) with check (auth.uid() = user_id and public.poll_open(activity_id));
-- chat
create policy "threads: mine"     on public.chat_threads for select to authenticated using (auth.uid() in (user_a, user_b));
create policy "messages: mine"    on public.messages for select to authenticated using (auth.uid() in (sender_id, receiver_id) or public.is_group_member(group_id));
create policy "messages: send"    on public.messages for insert to authenticated with check (
  auth.uid() = sender_id and (
    (group_id is null and public.can_message(receiver_id)) or
    (group_id is not null and public.is_group_member(group_id))
  ));
create policy "messages: unsend"  on public.messages for delete to authenticated using (auth.uid() = sender_id);

-- group chats: members read/leave; creating + adding members goes through the functions above
create policy "groups: members read"   on public.chat_groups for select to authenticated using (public.is_group_member(id));
create policy "groups: create"         on public.chat_groups for insert to authenticated with check (created_by = auth.uid());
create policy "groups: creator rename" on public.chat_groups for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "group members: read"    on public.chat_group_members for select to authenticated using (public.is_group_member(group_id));
create policy "group members: leave"   on public.chat_group_members for delete to authenticated using (user_id = auth.uid());

-- ranking order: friends can see it (so your profile shows your order), only you change it
create policy "rank order: friends read" on public.rank_orders for select to authenticated using (public.are_friends(auth.uid(), user_id));
create policy "rank order: own write"    on public.rank_orders for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- v7.2
create policy "follows: own"   on public.media_follows for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "links: own"     on public.media_links   for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts: own"  on public.account_links for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "buddies: see own"  on public.watch_buddies for select to authenticated using (auth.uid() in (requester, addressee));
create policy "buddies: ask"      on public.watch_buddies for insert to authenticated with check (auth.uid() = requester and status = 'pending' and public.are_friends(requester, addressee));
create policy "buddies: accept"   on public.watch_buddies for update to authenticated using (auth.uid() = addressee) with check (auth.uid() = addressee);
create policy "buddies: end"      on public.watch_buddies for delete to authenticated using (auth.uid() in (requester, addressee));

-- owner + app config: everyone can read the config, only the owner changes it
create policy "admins: read"      on public.app_admins for select to authenticated using (true);
create policy "config: read"      on public.app_config for select to authenticated using (true);
create policy "config: owner"     on public.app_config for update to authenticated using (public.is_app_owner()) with check (public.is_app_owner());

create policy "votes: remove" on public.poll_votes for delete to authenticated using (auth.uid() = user_id and public.poll_open(activity_id));

-- ---------------------------------------------------------------------
-- 7b. v7.5 — feedback board (everyone reads, up/down votes) + community story order for game series
-- ---------------------------------------------------------------------
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 3 and 120),
  body        text check (char_length(body) <= 2000),
  category    text not null default 'idea' check (category in ('idea', 'bug', 'other')),
  status      text not null default 'open' check (status in ('open', 'planned', 'done', 'declined')),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

create table if not exists public.feedback_votes (
  feedback_id bigint not null references public.feedback(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

-- the order a game series is meant to be played in (story order). Anyone signed in can arrange it.
create table if not exists public.story_orders (
  series_key  text primary key check (char_length(series_key) <= 40),
  media_ids   integer[] not null default '{}',
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.feedback       enable row level security;
alter table public.feedback_votes enable row level security;
alter table public.story_orders   enable row level security;
grant select, insert, update, delete on public.feedback, public.feedback_votes, public.story_orders to authenticated;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('feedback', 'feedback_votes', 'story_orders')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "feedback: everyone reads"  on public.feedback for select to authenticated using (true);
create policy "feedback: post as you"     on public.feedback for insert to authenticated with check (auth.uid() = user_id and status = 'open');
create policy "feedback: owner sets status" on public.feedback for update to authenticated using (public.is_app_owner()) with check (public.is_app_owner());
create policy "feedback: delete own (or owner)" on public.feedback for delete to authenticated using (auth.uid() = user_id or public.is_app_owner());

create policy "fb votes: everyone reads"  on public.feedback_votes for select to authenticated using (true);
create policy "fb votes: own"             on public.feedback_votes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "story order: everyone reads" on public.story_orders for select to authenticated using (true);
create policy "story order: add"            on public.story_orders for insert to authenticated with check (updated_by = auth.uid());
create policy "story order: rearrange"      on public.story_orders for update to authenticated using (true) with check (updated_by = auth.uid());

-- ---------------------------------------------------------------------
-- 8. REALTIME (live updates)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['friendships', 'squads', 'squad_members', 'squad_entries', 'notifications', 'comments', 'list_entries',
                           'activities', 'activity_replies', 'poll_votes', 'messages', 'chat_threads', 'chat_groups', 'chat_group_members', 'watch_buddies'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. STORAGE for images + videos in posts (public bucket, you upload into your own folder)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'No storage schema here (not Supabase?) — skipping the media bucket';
    return;
  end if;
  begin
    insert into storage.buckets (id, name, public, file_size_limit) values ('anicoop-media', 'anicoop-media', true, 52428800)
    on conflict (id) do update set public = true, file_size_limit = 52428800;
  exception when undefined_column then
    insert into storage.buckets (id, name, public) values ('anicoop-media', 'anicoop-media', true)
    on conflict (id) do update set public = true;
  end;
  execute 'drop policy if exists "anicoop media: upload own" on storage.objects';
  execute 'drop policy if exists "anicoop media: delete own" on storage.objects';
  execute $p$create policy "anicoop media: upload own" on storage.objects for insert to authenticated
            with check (bucket_id = 'anicoop-media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy "anicoop media: delete own" on storage.objects for delete to authenticated
            using (bucket_id = 'anicoop-media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- ---------------------------------------------------------------------
-- 8b. v8.2 — ROLES, ACHIEVEMENTS the owner gives, ADMIN POWERS
--   * The owner always has every power.
--   * Roles (name, colour, icon, powers) are made by the owner (or someone whose role has "manage_roles").
--     Anyone's roles show on their profile.
--   * Powers: admin (all of them) · manage_roles · give_awards · moderate · manage_feedback · manage_18
--   * Only the owner can create or hand out roles that carry "admin" or "manage_roles" (no giving yourself more power).
-- ---------------------------------------------------------------------
create table if not exists public.app_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  color       text not null default '#B490F5',
  icon        text not null default 'fa-shield-halved',
  perms       text[] not null default '{}',
  position    int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.app_roles(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);
create table if not exists public.awards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 40),
  description text check (char_length(description) <= 160),
  icon        text not null default 'fa-trophy',
  color       text not null default '#f59e0b',
  awarded_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists awards_user_idx on public.awards (user_id, created_at desc);

-- does the signed-in person have this power? (owner: always)
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_app_owner() or exists (
    select 1 from user_roles ur join app_roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and (p = any(r.perms) or 'admin' = any(r.perms)));
$$;
grant execute on function public.has_perm(text) to authenticated;
-- roles that carry power over roles themselves: only the owner hands those out
create or replace function public.role_is_high(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select perms && array['admin', 'manage_roles'] from app_roles where id = rid), false);
$$;
grant execute on function public.role_is_high(uuid) to authenticated;

alter table public.app_roles  enable row level security;
alter table public.user_roles enable row level security;
alter table public.awards     enable row level security;

drop policy if exists "roles: read"   on public.app_roles;
drop policy if exists "roles: add"    on public.app_roles;
drop policy if exists "roles: edit"   on public.app_roles;
drop policy if exists "roles: remove" on public.app_roles;
create policy "roles: read"   on public.app_roles for select to authenticated using (true);
create policy "roles: add"    on public.app_roles for insert to authenticated
  with check (public.is_app_owner() or (public.has_perm('manage_roles') and not (perms && array['admin', 'manage_roles'])));
create policy "roles: edit"   on public.app_roles for update to authenticated
  using (public.is_app_owner() or (public.has_perm('manage_roles') and not (perms && array['admin', 'manage_roles'])))
  with check (public.is_app_owner() or (public.has_perm('manage_roles') and not (perms && array['admin', 'manage_roles'])));
create policy "roles: remove" on public.app_roles for delete to authenticated
  using (public.is_app_owner() or (public.has_perm('manage_roles') and not (perms && array['admin', 'manage_roles'])));

drop policy if exists "user roles: read"   on public.user_roles;
drop policy if exists "user roles: give"   on public.user_roles;
drop policy if exists "user roles: take"   on public.user_roles;
create policy "user roles: read" on public.user_roles for select to authenticated using (true);
create policy "user roles: give" on public.user_roles for insert to authenticated
  with check (public.is_app_owner() or (public.has_perm('manage_roles') and not public.role_is_high(role_id)));
create policy "user roles: take" on public.user_roles for delete to authenticated
  using (public.is_app_owner() or (public.has_perm('manage_roles') and not public.role_is_high(role_id)));

drop policy if exists "awards: read"   on public.awards;
drop policy if exists "awards: give"   on public.awards;
drop policy if exists "awards: take"   on public.awards;
create policy "awards: read" on public.awards for select to authenticated using (true);
create policy "awards: give" on public.awards for insert to authenticated with check (public.has_perm('give_awards') and awarded_by = auth.uid());
create policy "awards: take" on public.awards for delete to authenticated using (public.has_perm('give_awards'));

-- admin powers over other people's things (these add to the normal "your own" rules)
drop policy if exists "admin: delete posts"    on public.activities;
drop policy if exists "admin: delete replies"  on public.activity_replies;
drop policy if exists "admin: delete comments" on public.comments;
drop policy if exists "admin: edit profiles"   on public.profiles;
drop policy if exists "admin: feedback status" on public.feedback;
drop policy if exists "admin: delete feedback" on public.feedback;
drop policy if exists "admin: 18+ settings"    on public.app_config;
drop policy if exists "admin: see posts"       on public.activities;
create policy "admin: delete posts"    on public.activities       for delete to authenticated using (public.has_perm('moderate'));
create policy "admin: delete replies"  on public.activity_replies for delete to authenticated using (public.has_perm('moderate'));
create policy "admin: delete comments" on public.comments         for delete to authenticated using (public.has_perm('moderate'));
create policy "admin: edit profiles"   on public.profiles         for update to authenticated using (public.has_perm('moderate')) with check (public.has_perm('moderate'));
create policy "admin: feedback status" on public.feedback         for update to authenticated using (public.has_perm('manage_feedback')) with check (public.has_perm('manage_feedback'));
create policy "admin: delete feedback" on public.feedback         for delete to authenticated using (public.has_perm('manage_feedback'));
create policy "admin: 18+ settings"    on public.app_config       for update to authenticated using (public.has_perm('manage_18')) with check (public.has_perm('manage_18'));
-- moderators can see every post (not only friends' ones) so they can remove what breaks the rules
create policy "admin: see posts"       on public.activities       for select to authenticated using (public.has_perm('moderate'));

-- people whose role has manage_18 can also see 18+ content
create or replace function public.adult_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select has_perm('manage_18') or coalesce((select (value ->> 'everyone')::boolean or (value -> 'users') ? auth.uid()::text from app_config where key = 'adult'), false);
$$;

do $$ begin
  begin alter publication supabase_realtime add table public.user_roles; exception when others then null; end;
  begin alter publication supabase_realtime add table public.awards; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 8c. v8.4 — PLAYLISTS (Songs → Solo list: your own "albums" of songs)
--   The songs are kept inside the playlist, in order. Anyone who can see your Songs list can see your playlists.
-- ---------------------------------------------------------------------
create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  songs       jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists playlists_user_idx on public.playlists (user_id, created_at);
alter table public.playlists enable row level security;
grant select, insert, update, delete on public.playlists to authenticated;
drop policy if exists "playlists: read"   on public.playlists;
drop policy if exists "playlists: add"    on public.playlists;
drop policy if exists "playlists: edit"   on public.playlists;
drop policy if exists "playlists: remove" on public.playlists;
create policy "playlists: read"   on public.playlists for select to authenticated using (auth.uid() = user_id or public.can_view_list(user_id, 'SONG'));
create policy "playlists: add"    on public.playlists for insert to authenticated with check (auth.uid() = user_id);
create policy "playlists: edit"   on public.playlists for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "playlists: remove" on public.playlists for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 8d. v9.7 — SONGS ARE HIDDEN UNTIL YOU'RE ALLOWED (like 18+)
--   The owner (and roles with "Manage songs") pick who sees Songs in Settings → Admin.
-- ---------------------------------------------------------------------
insert into public.app_config (key, value) values ('songs', '{"everyone": false, "users": []}') on conflict (key) do nothing;
drop policy if exists "admin: song settings" on public.app_config;
create policy "admin: song settings" on public.app_config for update to authenticated
  using (key = 'songs' and public.has_perm('manage_songs')) with check (key = 'songs' and public.has_perm('manage_songs'));

-- ---------------------------------------------------------------------
-- 8e. v9.9 — SIGN IN WITH GOOGLE / DISCORD / FACEBOOK / TWITCH
--   A new account gets a username made from its name there (or its email), cleaned up to 3–20 letters,
--   numbers, _ or . — with numbers added if someone already has it. (Before, a taken name or an account
--   without an email made the sign-up fail with "Database error saving new user".)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  pick text;
  tries int := 0;
begin
  base := coalesce(nullif(trim(m->>'username'), ''), nullif(trim(m->>'user_name'), ''), nullif(trim(m->>'preferred_username'), ''),
                   nullif(trim(m->'custom_claims'->>'global_name'), ''), nullif(trim(m->>'full_name'), ''), nullif(trim(m->>'name'), ''),
                   nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user');
  base := left(regexp_replace(base, '[^A-Za-z0-9_.]', '', 'g'), 20);
  if char_length(base) < 3 then base := 'user' || base; end if;
  pick := base;
  while exists (select 1 from public.profiles where lower(username) = lower(pick)) loop
    tries := tries + 1;
    pick := left(base, 16) || (1000 + floor(random() * 9000))::int::text;
    if tries > 25 then pick := 'user' || substr(md5(new.id::text), 1, 12); exit; end if;
  end loop;
  insert into public.profiles (id, username) values (new.id, pick) on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Tell the Supabase API about new columns right away (avoids "not in the schema cache" errors)
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
