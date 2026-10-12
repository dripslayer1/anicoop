-- anicoop v1.3: "Track 18+ manga" (track, rate, compare 18+ manga without reading them)
-- Run once in Supabase → SQL Editor. It only adds one settings row; the owner fills it from Settings.
-- Only the owner can change it (the existing policy "config: owner"); everyone signed in can read it.
insert into public.app_config (key, value) values ('adult_track', '{"users": []}') on conflict (key) do nothing;
