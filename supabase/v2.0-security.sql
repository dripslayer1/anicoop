-- =====================================================================
--  anicoop v2.0 – security fixes. Run this whole file once in Supabase → SQL Editor → New query → Run.
--  Safe to re-run. It is also part of supabase_setup.sql (section 9b), so re-running that file keeps the fixes.
-- =====================================================================

-- 1. A friend request or a watch-buddy request: only its status can change. Before, the person being asked could
--    rewrite who sent it, and so make anyone their friend or watch buddy without that person ever saying yes
--    (friends see your lists and stats; a watch buddy's Plan to watch is copied and kept in sync).
revoke update on public.friendships from anon, authenticated;
grant update (status) on public.friendships to authenticated;
revoke update on public.watch_buddies from anon, authenticated;
grant update (status) on public.watch_buddies to authenticated;
-- the old squads (moved into watch-together in v1.6) aren't edited any more
revoke update on public.squads from anon, authenticated;

-- 2. Profiles are for signed-in people only (they were readable by anyone on the internet with the site's public key).
--    The sign-up page checks "is this username taken?" with username_taken() instead.
revoke select on public.profiles from anon;
drop policy if exists "profiles: public read" on public.profiles;
drop policy if exists "profiles: signed-in read" on public.profiles;
create policy "profiles: signed-in read" on public.profiles for select to authenticated using (true);
create or replace function public.username_taken(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where lower(username) = lower(trim(name)));
$$;

-- 3. Database functions: signed-out visitors can't call any (except the username check), and the ones that only
--    work inside the database can't be called from the website at all. merge_buddy_planning could be called by
--    anyone, even signed out, to copy any person's Plan to watch into any other person's list.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.merge_buddy_planning(uuid, uuid) from authenticated;
revoke execute on function public.pref_on(uuid, text) from authenticated;
revoke execute on function public.mentioned_users(text, uuid) from authenticated;
grant execute on function public.username_taken(text) to anon, authenticated;
-- functions added later start out closed to signed-out visitors too
alter default privileges in schema public revoke execute on functions from public, anon;

-- 4. Uploads: only pictures and videos (anyone signed in could upload any file, e.g. a web page, to the public bucket)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set allowed_mime_types = array['image/*', 'video/*'] where id = 'anicoop-media';
  end if;
exception when undefined_column then null;
end $$;

notify pgrst, 'reload schema';
