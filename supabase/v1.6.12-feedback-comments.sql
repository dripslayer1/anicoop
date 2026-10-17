-- v1.6.12 — comments on feedback + notifications for new feedback and comments
-- Run once in Supabase → SQL Editor (safe to run again). Also in supabase_setup.sql.
--
-- · Anyone signed in can comment on a feedback post; you delete your own (roles with "Manage feedback" delete any).
-- · New feedback → a notification for everyone (Settings → Notifications → "New feedback…" turns it off).
-- · A new comment → a notification for the post's author and everyone who already commented on it or voted on it.
create table if not exists public.feedback_comments (
  id          bigint generated always as identity primary key,
  feedback_id bigint not null references public.feedback(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_comments_idx on public.feedback_comments (feedback_id, created_at);
alter table public.feedback_comments enable row level security;
grant select, insert, delete on public.feedback_comments to authenticated;
drop policy if exists "fb comments: everyone reads" on public.feedback_comments;
drop policy if exists "fb comments: post as you"    on public.feedback_comments;
drop policy if exists "fb comments: delete own"     on public.feedback_comments;
create policy "fb comments: everyone reads" on public.feedback_comments for select to authenticated using (true);
create policy "fb comments: post as you"    on public.feedback_comments for insert to authenticated with check (auth.uid() = user_id);
create policy "fb comments: delete own"     on public.feedback_comments for delete to authenticated
  using (auth.uid() = user_id or public.has_perm('manage_feedback'));

-- which feedback post a notification is about (gone with the post)
alter table public.notifications add column if not exists feedback_id bigint references public.feedback(id) on delete cascade;

create or replace function public.notify_feedback_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, kind, media_title, feedback_id)
  select p.id, new.user_id, 'feedback_new', left(new.title, 120), new.id
  from profiles p where p.id <> new.user_id and pref_on(p.id, 'feedback');
  return new;
end;
$$;
drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify after insert on public.feedback for each row execute function public.notify_feedback_post();

create or replace function public.notify_feedback_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select id, user_id, title into f from feedback where id = new.feedback_id;
  if f.id is null then return new; end if;
  insert into notifications (user_id, actor_id, kind, media_title, text, feedback_id)
  select x.uid, new.user_id, 'feedback_comment', left(f.title, 120), left(new.body, 140), f.id
  from (select f.user_id as uid
        union select c.user_id from feedback_comments c where c.feedback_id = f.id
        union select v.user_id from feedback_votes v where v.feedback_id = f.id) x
  where x.uid is not null and x.uid <> new.user_id and pref_on(x.uid, 'feedback');
  return new;
end;
$$;
drop trigger if exists feedback_comment_notify on public.feedback_comments;
create trigger feedback_comment_notify after insert on public.feedback_comments for each row execute function public.notify_feedback_comment();
revoke execute on function public.notify_feedback_post() from public, anon, authenticated;
revoke execute on function public.notify_feedback_comment() from public, anon, authenticated;

notify pgrst, 'reload schema';
