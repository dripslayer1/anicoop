-- v1.7.0 — GYM: workouts (progressive overload), routines + weekly plan, food & macros, body weight / water
-- Run once in Supabase → SQL Editor (safe to run again). Also in supabase_setup.sql.
-- Everything here is private: only you can read or change your own rows.

-- your gym settings: units, rest timer, weekly plan, macro targets, custom exercises, plates…
create table if not exists public.gym_settings (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (octet_length(data::text) < 100000),
  updated_at timestamptz not null default now()
);
-- routines (e.g. "Push": bench press 4 × 6-8, …)
create table if not exists public.gym_routines (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  exercises  jsonb not null default '[]'::jsonb check (octet_length(exercises::text) < 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gym_routines_user_idx on public.gym_routines (user_id);
-- finished workouts: every exercise with its sets (weights in kg)
create table if not exists public.gym_workouts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null default 'Workout' check (char_length(name) between 1 and 80),
  routine_id bigint references public.gym_routines(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  exercises  jsonb not null default '[]'::jsonb check (octet_length(exercises::text) < 200000),
  notes      text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists gym_workouts_user_idx on public.gym_workouts (user_id, started_at desc);
-- food you ate (the macros of the amount you had; `food` keeps the per-100 g values to add it again)
create table if not exists public.gym_foods (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  meal       text not null default 'snacks' check (meal in ('breakfast', 'lunch', 'dinner', 'snacks')),
  name       text not null check (char_length(name) between 1 and 120),
  grams      numeric check (grams >= 0 and grams <= 10000),
  kcal       numeric not null default 0 check (kcal >= 0 and kcal <= 20000),
  protein    numeric not null default 0 check (protein >= 0 and protein <= 2000),
  carbs      numeric not null default 0 check (carbs >= 0 and carbs <= 2000),
  fat        numeric not null default 0 check (fat >= 0 and fat <= 2000),
  food       jsonb check (food is null or octet_length(food::text) < 4000),
  created_at timestamptz not null default now()
);
create index if not exists gym_foods_user_idx on public.gym_foods (user_id, day);
-- one row per day: body weight, body fat, water
create table if not exists public.gym_days (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  weight     numeric check (weight > 0 and weight < 1000),
  bodyfat    numeric check (bodyfat >= 0 and bodyfat <= 80),
  water_ml   integer check (water_ml >= 0 and water_ml <= 20000),
  notes      text check (char_length(notes) <= 500),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.gym_settings enable row level security;
alter table public.gym_routines enable row level security;
alter table public.gym_workouts enable row level security;
alter table public.gym_foods    enable row level security;
alter table public.gym_days     enable row level security;
grant select, insert, update, delete on public.gym_settings, public.gym_routines, public.gym_workouts, public.gym_foods, public.gym_days to authenticated;
drop policy if exists "gym settings: own" on public.gym_settings;
drop policy if exists "gym routines: own" on public.gym_routines;
drop policy if exists "gym workouts: own" on public.gym_workouts;
drop policy if exists "gym foods: own"    on public.gym_foods;
drop policy if exists "gym days: own"     on public.gym_days;
create policy "gym settings: own" on public.gym_settings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gym routines: own" on public.gym_routines for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gym workouts: own" on public.gym_workouts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gym foods: own"    on public.gym_foods    for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gym days: own"     on public.gym_days     for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
