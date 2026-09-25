# anicoop: handover

For the next agent/session taking over. Last updated at v9.9 (2026-09-25), when the v9.9 PR was opened.

> **v9.9 session (new account, working on the owner's own Windows PC):** the repo lives at
> `C:\Users\drips\Downloads\anicoop\anicoop`. Node.js LTS and GitHub CLI were installed there this session; `gh` is logged
> in as dripslayer1. New PowerShell windows may not see them on PATH yet: use `& "C:\Program Files\GitHub CLI\gh.exe"`
> and `C:\Program Files\nodejs\node.exe`, or reload PATH from the registry first. There is **no Python** on this PC.
> What v9.9 changed is in §2; how testing works on this PC is in §5.

---

## 1. Project goal and current status

**anicoop** is a social tracker for a group of friends. It covers **anime, manga/manhwa, movies & TV, games and songs**. It has solo lists, shared "squad" lists, a feed, chat, profiles, rankings, tier lists, and an in-app manga reader and video player that use extensions/sources the user installs.

- **Repo:** `dripslayer1/anicoop`. Working branch: `claude/intelligent-johnson-gofau9`. The default branch is `main`.
- **Hosting:** now **GitHub Pages**, served from this public repo (the owner used Netlify Drop before). There is no build step. The repo must stay public for free GitHub Pages, so every file in it is publicly downloadable.
- **Backend:** **Supabase** (auth, Postgres with RLS, realtime, storage), plus one Edge Function, `supabase/functions/igdb/index.ts`, which the owner deploys by hand.
- **Owner workflow after each merged PR:**
  1. Merge the PR.
  2. GitHub Pages redeploys by itself after the merge.
  3. Deploy the Edge Function if it changed.
  4. Run any new SQL in Supabase → SQL Editor.
  5. Hard-refresh (Ctrl+Shift+R).
  6. Check that the footer shows the new version.

**Status**
- PRs #3–#14 (v8.8 → v9.8 + handovers) are **merged into `main`**.
- **v9.9 is a PR from `claude/intelligent-johnson-gofau9`** (the owner's 18-item list). It **needs SQL** (section
  "8e. v9.9" — a new `handle_new_user()`), and the OAuth providers must be switched on in Supabase (README v9.9 has the
  steps). Check whether it was merged before starting the next change.

**Versioning:** each release bumps three places:
- `sw.js`: `const VERSION = 'anicoop-v9.8'`
- `index.html`: every `?v=9.8` cache-buster, plus the footer `<span>v9.8</span>` (around line 214)
- `README.md`: a new `## v9.x — …` section at the bottom, written in plain language for the owner, with an **Update:** line saying whether SQL or an Edge Function redeploy is needed.

---

## 2. What was accomplished in this session (v8.8 → v9.8)

These are cumulative; the README has one section per version.

- **v8.8:**
  - Themed home nav, and the section switcher placed between the logo and Browse.
  - Removed duplicate Top 100 titles.
  - In-site video sources.
  - Full songs through the **YouTube IFrame API**, audio only.
  - A new player bar: shuffle, previous, play, next, repeat, and a queue. It sits above every popup and doesn't block buttons.
- **v8.9:**
  - Fixed small-card menu clipping.
  - The player's X now hides it, and a bottom-left "peek" button brings it back.
  - Songs no longer load forever: timeouts, plus a fallback to Apple's 30-second preview.
  - Steam prices by region.
  - Removed the header divider lines.
- **v9.0–9.1:**
  - Switched to YouTube Music search (the `ytm` endpoint).
  - Add to playlist from anywhere (a global `plPicker`).
  - Removed "+1 Play" for songs.
  - Fixed song genres in random pick.
- **v9.2:**
  - Continuous webtoon reading across chapters, with auto mark-read.
  - Random pick across the whole catalogue with status filters.
  - A music panel reachable from anywhere.
  - Emoji (emoji-api.com) and GIF (GIPHY or Tenor) APIs through the Edge Function.
  - "Completed" counts every chapter/episode.
  - Better artist search (the RILEY case).
- **v9.3:** **Mihon server (Suwayomi) integration** for AllManga, Bato, Webtoons.com and Tappytoon, over its GraphQL API.
- **v9.4:**
  - A banner when a new chapter starts.
  - A vertical divider between the feedback and music icons.
  - "Play" on discography releases.
  - Availability chips showing which installed sources have a title.
- **v9.5:**
  - The old Solo-list hover menu is back for non-songs (with a Play row).
  - A one-line song row menu.
  - Add to playlist for several selected songs.
  - Availability badges on the Read-window source tabs.
- **v9.6:**
  - Mihon-server sources ignore the 18+ switch.
  - **Automatic play counting:** a play counts after 30 s, or 15 s for previews.
- **v9.7 (needs SQL; the owner was told):**
  - **Songs hidden behind a permission**, like 18+. Stored in `app_config` key `songs`, managed in Settings → Admin → Songs, with a new role power `manage_songs`.
  - Song stats say In Love / Liked / Disliked with play counts.
  - "On repeat" cards have a play button.
  - Play buttons on the song page and under "More from this album".
  - Dragging the volume to 0 mutes.
  - Newest/oldest chapter sort.
  - Home hero posters no longer blur on hover.
- **v9.8 (PR #12, merged):**
  - Phone layout fixes.
  - Stickers removed; **saved GIFs** (`PREFS.savedGifs`, synced).
  - Faster first song play.
  - Background-play resume.
  - Artist names on song covers.
  - Song search ranking (`songRelevance`).
  - Search on artist pages.
  - "N/?" removed everywhere for songs.
  - The Songs ranking includes In Love songs.
  - Friends' Songs lists.
  - Chapter search box.
  - Pending friend requests are clickable.
  - Continue cards open the Read/Watch window.
  - Compare is section-aware.
  - The feed's tier list maker and pickers are section-aware.
  - **Squads moved inside the Solo tab** as a Solo/Squads switch.
- **v9.9 (needs SQL 8e):**
  - **OAuth sign-in** (`OAUTH_PROVIDERS`, `signInWith`: Google, Discord, Facebook, Twitch). `handle_new_user()` now
    makes a clean, unique username from the provider's name; `fetchProfile` does the same if the trigger didn't.
  - Tabs renamed: Solo → **Lists**, Top 100 → **Leaderboard** (ids are still `solo` / `top`).
  - **One feed for every section:** `fetchFeed` filters by `feedFilter.type` (`FEED_TYPES`). Manhwa posts are
    `media_type = 'MANGA'` with `extra.country = 'KR'`. The composer has `composer.type` ("About:"), and `composerType`
    drives the picker and wording. `actSection(a)` is the chip on each post.
  - **Game characters:** `gameApi.searchCharacters`. `wikiCharPics(chars, game, hints)` fills missing pictures from the
    game's **Fandom wiki** (the host is guessed from the game/franchise names by `fandomFor` and cached in
    `anicoop_fandom_v1`), then Wikipedia. Results are cached in `anicoop_charpics_v2`. `picOf(url, name, id)` gives the
    fallback (initials SVG) everywhere. `charPicFix` holds pictures found for already-saved favourites (they aren't
    written back: `favorite_characters` has no update policy). The tier maker for GAME has `tierChars`, a
    "Characters from a game" source, and characters in "Pick one by one". `openCharacter` ignores ids ≥ `GAME_BASE`.
  - **Resume reading:** `readPos` (localStorage `anicoop_readpos_v1`: manga id → chapter, source, page) is saved by a
    watcher on the reader. `continueItem` → `resumeReading(a)` waits (`until`) for the chapter list, then opens that
    chapter and page (`scrollStripTo` in webtoon mode; `rd.resume` makes the pages above load eagerly).
  - **Memory:** the webtoon strip keeps `STRIP_MAX = 3` chapters (`pruneStrip`, which corrects the scroll). Page keys are
    `rdPageKey(n)` (chapter id + page). `pageCache` is capped at 6. Leaderboard rows are `markRaw`. `.rank-row` and
    `.activity-card` use `content-visibility: auto`.
  - **Phones:** the Dropdowns search box isn't auto-focused on touch (`touchUI()`), and a resize that only changes the
    height (the keyboard) no longer closes the menu. Every `.seg` scrolls sideways under 768px. The header shows
    settings and feedback under 768px; under 640px it hides `.hdr-back` and `.hdr-logo`, and `SECTIONS[x].tiny` is the
    short section name. The home header hides the wordmark under 440px.
  - "Hide genres": `.hg-toggle` / `.hg-genre` styles, "Genres hidden" label. Batch bar: three rows on phones
    (`.batch-count`, `.batch-statuses`, `.batch-more`).
  - `v-drag-fab:music` on `.pbar-peek` (the `DragFab` directive; position in `anicoop_fab_music`).
  - **Search popularity:** AniList uses `[POPULARITY_DESC, SEARCH_MATCH]` (characters use `FAVOURITES_DESC`). Games use
    `gameApi.searchPopular` (`name ~ *"q"*` sorted by `total_rating_count`, then IGDB `search` fuzzy matches). TMDB
    uses `tmdbPopular` (by `vote_count`).
  - Leaderboard **Select** (`visibleAnime` covers `top`; rows toggle while `selectMode`).
  - **Movie franchise:** reuses `gameExtra` / `loadSeries` with `seriesOpts[0].movie = true` and key
    `tmdbc:<collectionId>` in `story_orders`. `movieSeries` fetches runtimes. `movieTotals`, `fmtMins`.
  - **Keys:** `skipSong`, Shift+N/P, Ctrl+←/→, `MediaTrackNext/Previous`. On desktop only, a looping silent WAV
    (`keysAnchor`) restarts after YouTube starts, so the OS media keys reach our `mediaSession` handlers instead of
    YouTube's iframe. This is **not verified with real hardware keys** — ask the owner.

---

## 3. Where we stopped / immediate next steps

**Stopped at:** the v9.9 PR is open. The owner has to merge it, run SQL 8e, and switch on the OAuth providers they want.

**Next steps**
0. **When the owner reports back on v9.9,** check these first: whether the media keys ⏭ ⏮ work with full songs (the
   `keysAnchor` trick); whether OAuth sign-in works (Site URL / Redirect URLs in Supabase must include the Pages
   address); and whether the phone header looks right on their phone.
1. **Older checks from v9.8:**
   - Phone layout. `src/input.css` has the new `@media (max-width: 767px)` blocks at the end, marked with `v9.8` comments. The title-page reorder uses `display: contents` on `.det-left` and `.det-main` (classes in `index.html` around lines 506–600).
   - Background music on a locked phone: `app.js`, the `onStateChange` handler inside `ytPlayer()`, which uses `userPausedAt`. Some mobile browsers still force-pause YouTube, and that can't be fully fixed from a web page.
2. **Unresolved since v8.8:** the owner said *full songs never play* and only the 30-second preview works. The real cause is unknown because YouTube is unreachable from our sandbox. v8.9 added a diagnostic: the amber `0:30` badge on the player explains why (`player.why`). **Ask the owner what that badge says.** The code is in `app.js`: search for `startSong`, `ytCandidates`, `ytTry`, `whyFull`, `fullDown`.
3. **Before every PR:**
   - If the previous PR was merged, sync first: `git fetch origin main && git merge --ff-only origin/main`. If fast-forward fails, use `git merge --no-edit origin/main`.
   - Bump the version (see §1).
   - Rebuild the CSS.
   - Run `node --check app.js`.
   - Run the Playwright tests.
   - Write a README section.
   - Commit, push, and open the PR with `mcp__github__create_pull_request` (cloud sessions) or
     `& "C:\Program Files\GitHub CLI\gh.exe" pr create` (on the owner's PC).
4. **Security (done):** `session-history.jsonl` (which held API keys) was deleted from `main`, and the owner generated new Twitch, TMDB and emoji keys, which live only in Supabase Edge Function secrets. The old keys remain in git history but no longer work. **Never commit keys or secrets:** the repo is public because GitHub Pages hosts the site.

---

## 4. Architecture, decisions, gotchas and dead ends

### Architecture
- **There's no bundler.** The app is:
  - `index.html`: about 4.7k lines of Vue in-DOM templates. The whole UI lives in this one file.
  - `app.js`: about 9k lines, all in one Vue 3 (global build) `setup()` that ends with one huge `return { … }`.
  - `app.css`: compiled Tailwind.
  - `sw.js`: the service worker.
  - `manifest.webmanifest`.
- **Components** defined in `app.js`: `PosterCard`, `QuickAdd`, `TrackRow` (song rows), `UserAvatar`, and others.
- **Anything a template uses must be added to the `return {}` at the end of `setup()`** in `app.js`. Forgetting this is the most common bug; the render silently gets `undefined`.
- **The CSS build:** `npx tailwindcss@3 -c src/tailwind.config.js -i src/input.css -o app.css --minify`. Edit `src/input.css`, never `app.css`. New style blocks are appended at the end with a `/* v9.x … */` comment.
- **Data sources:**
  - **AniList:** anime and manga.
  - **IGDB (Twitch):** games.
  - **TMDB:** movies & TV.
  - **Songs:** Apple iTunes Search/Lookup and charts, plus Spotify through the Edge Function, Deezer for artist photos, and Wikipedia for bios. Full audio comes from the YouTube IFrame API; the video id is found through the Edge Function's `ytm` and `yt` searches.
- **Synthetic numeric ids:** `GAME_BASE=1e9`, `MOVIE_BASE=1.2e9`, `SHOW_BASE=1.3e9`, `PERSON_BASE=1.4e9`, `SONG_BASE=1.5e9`. `typeOfId(id)` maps an id back to its type.
- **The Edge Function `igdb`** handles these `kind`s: igdb, tmdb, spotify, steam, mangadex, fetch (a CORS proxy for sources), yt, ytm, emoji, gif. Its secrets: Twitch, TMDB, Spotify, `EMOJI_API_KEY`, `GIPHY_API_KEY` or `TENOR_API_KEY`.
- **User preferences:**
  - `PREFS` (reactive; defaults in `defaultPrefs()` near the top of `app.js`) is saved to localStorage **and synced to Supabase `user_settings`**. New synced settings go there, as `savedGifs` did.
  - Anything sensitive or device-specific must NOT go in `PREFS`. For example, the Mihon server login lives in localStorage key `anicoop_mihon_v1`.
- **Permissions:**
  - Owner, roles and powers: the `ROLE_PERMS` array and `can(perm)`.
  - 18+ access: the `adult_allowed()` RPC and `app_config` key `adult`.
  - Song access: the `songsOn` computed and `songsCfg` (`app_config` key `songs`). `songBlocked()` guards song entry points, and the last answer is cached in localStorage `anicoop_songs_ok` to avoid flashing songs in or out while loading. Until the v9.7 SQL is run, only the owner sees Songs.
- **Database:** `supabase_setup.sql` is the full cumulative schema. New SQL goes in as a new numbered section, like "8d. v9.7", placed before "10. Tell the Supabase API…". The README also shows the new SQL in its version section.
- **Song player:**
  - Engine 1: an `<audio>` element for Apple's previews.
  - Engine 2: a YouTube IFrame player in `#song-yt-box`, which lives outside Vue.
  - `startSong` works through candidate video ids with `ytTry`: it tries the next id on error 150/101 and falls back to the preview.
  - `ytSongs` (localStorage) remembers the working video id per song. `candCache` caches searches in memory. `warmSongs()` preloads the player. `prefetchNextSong()` looks up the next song in the queue.
- **Mihon / Suwayomi:** the user runs Suwayomi-Server locally, and the app talks to its GraphQL API (`sources`, `fetchSourceManga` with a LongString source id, `fetchChapters`, `fetchChapterPages`). These sources have `template: 'mihon'`.

### Gotchas (things that bit us)
- **Never use `text-base` for font size.** The Tailwind config defines a **colour** called `base` (the background), so `text-base` also sets the text colour to the background colour and makes it invisible. This caused the invisible phone bottom-bar icons in v9.8. Use `text-[16px]`. The same trap applies to any class named after a theme colour (base, surface, raised, overlay, line, line2, ink, sub, mute, lilac, volt, pink, onaccent, onvolt, inv).
- **Tailwind circular-dependency error:** don't write selectors like `.x .text-ink { @apply … }` in `input.css`. Use custom class names instead (`pbar-q-t`, `mu-t`, …).
- **Temporal dead zone (TDZ) in `setup()`:** `const`s declared later in `setup()` can't be read by code that runs immediately (for example `watch(..., { immediate: true })` getters, or computeds read during setup). Lazy uses inside computeds, callbacks and functions are fine. Example: `songsOn` reads `isOwner`, which is declared thousands of lines later; this only works because `songsCfg.ready` is false during setup.
- **Duplicate identifiers:** `setup()` is one enormous scope, so run `node --check app.js` after edits. Names that already existed and collided with new ones: `chNum`, `prefetchNext`.
- **In-DOM templates:** don't put `&amp;` inside `{{ }}` expressions. Use `<template v-if>` alternatives instead (see the home tagline).
- **The detail page crashes in tests** if `selectedAnime` lacks fields real data always has. Use a TV-shaped test object (with `seasons`) or real normalized data.
- **Status labels depend on the section:** `STATUS_LABELS` follows the current section, so a Songs list viewed while in the Anime section shows "Watching" instead of "In Love". Use `statusLabelFor(type, status)` whenever the item's type may differ from the section.
- **The phone breakpoint is `md` (768px).** The bottom tab bar is `.mnav`. Inputs are forced to 16px on phones so iOS doesn't zoom.
- **MangaDex chapters** arrive **newest first**, 100 at a time. Oldest-first sorting and chapter search call `loadAllChapters()`.

### Dead ends / refusals (don't retry)
- **No MP3 ripping or downloading YouTube audio;** YouTube playback goes only through the official IFrame player. SoundCloud was discussed: it only helps with independent music, not mainstream songs.
- **No Cloudflare bypasses,** no picking or recommending pirate sites, and no breaking site protections. "Not readable here: needs its own Android extension" sources can't run in a browser; the solution was the Suwayomi server.
- **A website can't auto-start Suwayomi.** Advice given: add it to Windows startup (`shell:startup`), or host it on an always-on device. Installing anicoop as a web app doesn't change that; only a real desktop app (Electron/Tauri) could.
- A **real Suwayomi can't be run in the sandbox,** because GitHub release downloads return 403. A fake GraphQL server (`scratchpad/fakesuwa.mjs`) plus a sparse clone of the Suwayomi source was used to check the schema.
- **YouTube, cdnjs and most external APIs are unreachable from the sandbox.** Full-song playback can't be verified here.

---

## 5. Context for continuing efficiently

- **The owner isn't a developer.** Reply in plain language:
  - What changed, grouped by their numbered items.
  - Whether SQL or an Edge Function deploy is needed.
  - The exact update steps.
  - The PR link.

  They send numbered wish lists with screenshots, and sometimes pure questions ("just a question, don't do anything"); answer those without coding.
- **Git:** develop only on `claude/intelligent-johnson-gofau9`. Once a PR is merged, start the next change from the latest `main` (sync as in §3). Commit messages end with the `Co-Authored-By` and `Claude-Session` lines from the session instructions. Only open PRs when the work is done (that has been the pattern: one PR per version).
- **Testing on the owner's Windows PC (v9.9):** there's no Python and no Playwright. Serve the repo with a tiny Node
  static server (a scratchpad `serve.mjs`: `node serve.mjs <repo> 5577`, started from `.claude/launch.json`; `.claude/`
  is in `.git/info/exclude`), then use the Claude **Browser pane** (`preview_start`, `javascript_tool`). The real
  internet works there (AniList, IGDB/TMDB through the Edge Function, MangaDex, Fandom, Wikipedia). Fake a login the same
  way as below (`sb.from = () => <Proxy>`, set `currentUser` / `currentProfile` on `setupState`). **If the pane is
  hidden, `requestAnimationFrame` never fires, so Vue's page transitions freeze.** Run
  `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)` and inject
  `*{transition-duration:0s!important;animation-duration:0s!important}` right after each reload. Screenshots of a hidden
  pane are unreliable: read the DOM text instead.
- **Local testing (headless Chromium, cloud sandbox):**
  - Serve the repo with `python3 -m http.server 5577` from the repo root, run in the background.
  - Playwright uses `executablePath: '/opt/pw-browsers/chromium'`. Harnesses from this session lived in the scratchpad, which won't carry over; recreate them as needed:
    - `h.mjs <w> <h> <out.png|-> "<js>"` runs JS with `st = document.getElementById('app')._vnode.component.setupState`.
    - `shot.mjs` is the same, plus a full or element screenshot at 2× scale and mobile emulation.
    - `audit.mjs` checks many views and viewport sizes for horizontal overflow.
  - **Pattern:**
    - Route everything except localhost to abort.
    - Serve Vue and supabase-js from local `node_modules` (`npm i vue @supabase/supabase-js`).
    - Serve Font Awesome from `npm i @fortawesome/fontawesome-free@6`, matching the URL pattern `font-awesome/<ver>/…`. Without it, icons don't render and screenshots mislead.
    - Fake a login with `st.authReady = true; st.currentUser = { id: 'preview' }`.
    - Stub the database with `sb.from = () => <Proxy chain resolving { data: [], error: null }>`.
    - Set `localStorage.anicoop_intro_at` to skip the intro.
    - Set `st.songsCfg.ready = true; st.songsCfg.users = ['preview']` to see Songs.
- **Useful `app.js` landmarks** (search for these names):
  - Songs: `songApi` (browse, findArtist, artist), `songRelevance`/`bySongRelevance`, `startSong`, `playPreview`, `countPlay`.
  - Profiles: `statsFor`, `statCards`, `statColumns`, `buildRankings`, `comparison`/`compareGroups`, `drill*`.
  - Feed: `submitComposer`, `openPicker`/`runPicker`, `TIER_SOURCES`/`tierType`, `openTierMaker`.
  - Reader: `loadChapters`, `sortedChapters`, `filteredChapters`, `chQ`, `openWatch`, `continueItem`, `readTabs`, `availRows`.
  - Mihon: `mihon*`.
  - Owner and permissions: `loadOwnerState`, `loadSongsCfg`, `ROLE_PERMS`, `can`.
  - Chat and GIFs: `gifState`, `gifTab`, `toggleSaveGif`.
  - Settings sync: `defaultPrefs`, `saveSettings`.
- **`index.html` landmarks:**
  - Home/intro (top).
  - Tracker header (around line 230).
  - Mobile nav `.mnav` (around line 280).
  - Entity pages for artist/album/character (around lines 290–500).
  - Title detail page (starts at `<!-- ===== ANIME / MANGA DETAILS ===== -->`).
  - Browse, Feed, Solo/Coop (`activeTab === 'coop' || 'solo'`), Profile, Chat.
  - Modals: settings, drill, edit, watch/read window `wp`, tier maker, player bar `.pbar`, music panel.
