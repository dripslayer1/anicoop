# anicoop: handover

For the next agent/session taking over. Last updated at v10.1 (2026-09-26), when the v10.1 PR was opened.

> **v9.9 session (new account, working on the owner's own Windows PC):** the repo lives at
> `C:\Users\drips\Downloads\anicoop\anicoop`. Node.js LTS and GitHub CLI were installed there this session; `gh` is logged
> in as dripslayer1. New PowerShell windows may not see them on PATH yet: use `& "C:\Program Files\GitHub CLI\gh.exe"`
> and `C:\Program Files\nodejs\node.exe`, or reload PATH from the registry first. There is **no Python** on this PC.
> What v9.9, v10.0 and v10.1 changed is in §2; how testing works on this PC is in §5.

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
- PRs #3–#16 (v8.8 → v10.0 + handovers) are **merged into `main`**. v10.0 needed SQL 8f (`account_links.refresh_token`),
  the Edge Function redeploy (GIF paging, `mal` endpoint) and the `MAL_CLIENT_ID` / `MAL_CLIENT_SECRET` secrets; the
  owner registered the MAL API client ("anicoop", published) — whether they finished the rest is unconfirmed.
- v10.1 (#17) and v10.3 (#18: v10.2 genre filter under Sort by + v10.3 "my watch link") and v10.4 (#19) are merged. **v10.5 is PR #20
  from `claude/v10-5-continue-link`** (Continue watching cards open your link + v10.6 auto links, {ep}, smarter question, Send). **No SQL, no Edge
  Function change.** Check whether it was merged before starting the next change.

**Versioning:** each release bumps three places:
- `sw.js`: `const VERSION = 'anicoop-v10.1'`
- `index.html`: every `?v=10.1` cache-buster, plus the footer `<span>v10.1</span>` (around line 215)
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
- **v10.0** (17 items):
  - **Removed** the v9.9 OAuth buttons (`OAUTH_PROVIDERS` / `signInWith` are gone; SQL 8e `handle_new_user()` stays, it's
    harmless and still names accounts made with them).
  - **GIFs:** `gifMore` on the grid's scroll asks the Edge Function for `{ endpoint: 'gif', q, next }`; the function
    returns `next` (GIPHY offset / Tenor `pos`). An old function returns no `next` → no paging.
  - **Tier maker:** `tier.what` (CHARACTER / MEDIA) is a switch at the top for every section; `TIER_SOURCES` depends on
    it. TV characters = `tvApi.details(id).cast` (actor photo, `sub` = actor). Songs rank **artists** (`kind: 'ARTIST'`,
    `deezerArtists` via `siteFetch`; feed click → `openArtistByName`). `loadTierMine` with CHARACTER = main characters of
    your best-rated titles (AniList `id_in`, `gameApi.characters`, TMDB casts, or your most-played artists). Posted items
    keep `gameId`.
  - **Background music:** `bgPaused` (YouTube paused by the phone while hidden) → `resumeAfterPhone` on
    `visibilitychange`/`pageshow`; lock-screen `play`/`pause` are `playOnly`/`pauseOnly` (not a toggle); `seekto` +
    `setPositionState`. A one-time tip (`PREFS.bgTipSeen`). True background play of YouTube's iframe is impossible on
    phone browsers (see Dead ends).
  - **Header search:** `openSearch()` → Browse of the current section, focuses `#browse-search`. `.hdr-search` button
    in both headers; header icons shrink under 400px.
  - **Selection bar:** `batchShown` (only on browse / solo / coop / top, never over a title page, entity, profile or
    Settings), `batchMin` (the "N selected" pill, `.batch-pill`), and the selection is cleared after a batch status /
    squad add.
  - **Add buttons:** `quickAdd(m, st)`, `addStatuses(m)`, `addOn(m, st)`, `ADD_ICONS` (`.qadd` / `.qadd-btn`) on the random
    pick(s), "If you like this"/"Recommended", related titles (now a `div role=button`) and franchise rows.
  - **Random pick:** `randomCount` (1–4, in `PREFS.randomCount`), `randomMore`, `randomPicks`; `.rand-grid` cards.
  - **Wanna Rewatch** (ANIME, TV): not a status but a flag `rewish` on the solo entry, saved as `media_data.rw`
    (`entryData` / `listRow` / `withRepeats` keep it). `toggleRewish`, `isRewish`, `REWISH_TYPES`; pseudo-status
    `REWISH` in `STATUS_LABELS`/`STATUS_COLORS`, `listStatusOpts`, `filteredGroupedList` (its own group), starting a
    rewatch clears it.
  - **Series count:** `franchiseLinks` is now `anicoop_franchise_v2` (cleared every 14 days, `FR_AT_KEY`). After the
    list's own titles, `ensureFranchise` follows `frontier()` (unfetched neighbours of groups with your titles) up to 6
    steps / 1500 ids, and `franchiseGroups()` unions **every** known link, so seasons join through titles not on the
    list. Missing AniList answers are no longer stored as `[]`.
  - **18+ privacy:** `adultAllowed` moved up next to `secSolo` (TDZ). `isAdultMedia` = `isAdult`/`adult` flag (now kept by
    `slimAnime`), genre "Hentai", or `adultIds[id]` (AniList `isAdult: true` lookups via `checkAdultIds`, cached in
    `anicoop_adult_ids_v1`; popular 18+ anime are NOT tagged Hentai, so the lookup matters). Filtered: `secSolo`,
    `secCoop`, `uniqueItems`, `viewedUser.entries` (raw in `viewedUser.all`; stats are counted locally when something
    was hidden), `feedShown`, profile activity (`activityOk`; new list activities get `extra.adult`).
  - **P1** label left of its dot (container `left-[-16px]` so the dot stays at the end of the trail).
  - **Page scrollbar:** 14px track with a rounded thumb on `html` only (`scrollbar-width/color: auto` there, or Chrome
    ignores `::-webkit-scrollbar`).
  - **Decor:** 8 more `EFFECTS` (`FX_COUNT` sets particles per effect) and 8 more `NAME_STYLES` (CSS at the end of
    `input.css`).
  - **MyAnimeList sync** (mirrors the AniList sync): MAL has no CORS and its token exchange needs the client secret, so
    the Edge Function's `mal` endpoint does `config` / `token` / `refresh` / `api` (only `users/@me` and
    `anime|manga/<id>/my_list_status`, GET/PATCH/DELETE, whitelisted form fields). OAuth = authorization code + PKCE
    **plain** (`connectMal`, verifier + state in localStorage `anicoop_mal_pkce`; the `?code=&state=` return is read at
    setup and stripped; `loadMalLink` exchanges it). Tokens live in `account_links` (provider `mal`, new column
    `refresh_token`); `malApi` refreshes 2 days before expiry or after a 401. `malEnqueue` is called next to
    `alEnqueue` in `upsertSolo` / `deleteSolo` (imports are suppressed by `alSuppress`); `malIdsFor` maps AniList ids to
    `[idMal, type]` (localStorage `anicoop_malids_v1`); `malForm` maps statuses (REPEATING = completed + is_rewatching),
    progress, whole-number score, rewatch counts. Tested with a faked link (payloads, refresh, 404 on delete) and the
    Edge Function locally against the real MAL (it answers invalid_token / client auth failed as expected); **the real
    sign-in is untested** until the owner registers the MAL client.
- **v10.1** (18 items, #3 = no change: YouTube background play is Premium-only):
  - **Two old bugs found:** (1) `buildForm` had `score` / `progress` inside a `//` comment since the first upload, so a
    title's page showed "–" and Save on that page wrote 0 for both. (2) `.btn, .icon-btn … { position: relative }` came
    after Tailwind's `.absolute`, so every `absolute … icon-btn` (Settings X, the editor's X, …) fell back into the flow
    and `right-4` pushed it half outside the left edge. Now `:where(.btn, .icon-btn, .toggle, .clear-btn)`. Pop-ups also
    can't scroll sideways (`.modal-card:not(.overflow-y-auto) { overflow: clip }`).
  - **Feed tier lists:** `feedTierType` (composer.type when the composer is open, else `feedFilter.type`; MANHWA → MANGA)
    drives `tierType` on the feed; `openTierMaker` switches `section` to that type (so genres / labels match) and a
    Manhwa tier list gets `extra.country = 'KR'`. `.feed-types` moved above the composer.
  - **Header search:** `hs` + `toggleHeaderSearch` / `runHeaderSearch` / `pickHeaderResult` / `headerSearchAll`
    (`.hs-panel`, fixed under the header, one panel for both headers). `openSearch()` (v10) is what Enter uses.
  - **Marks:** `FLAG_OF = { REWISH: 'rewish', ROTATION: 'rotation' }`, `REWISH_TYPES` = ANIME, TV, MANGA, GAME (labels per
    section: Wanna Rewatch / Reread / Replay), `ROTATION_TYPES` = GAME ("In Rotation", `media_data.rot`, cyan).
    `toggleFlag(anime, key)`; `quickSolo` hands REWISH / ROTATION to it, so the + menu (`QuickAdd`: all 5 statuses + the
    marks, labelled by the title's own section via `labelOf`) and the phone sheet (`.sheet-chip`) just emit them.
    `extraLists` feeds `listStatusOpts` and `filteredGroupedList`.
  - **Rankings:** `rankScore` / `openRankScore` / `saveRankScore` (row wrapped in `<template v-for>` with a
    `.rank-score-edit` row under it; the drag code only counts `.rank-row`).
  - **Lists genre filter:** `listFilterGenre`, `listGenres` (in `baseListItems`, cleared by `clearListFilters`).
  - **Compare:** `.compare-bar` is sticky (top 72px); a row click toggles selection, cover / name buttons open the page.
  - **Trailer:** `ytVol` / `setYtVol` (localStorage `anicoop_trailer_vol`, sent once the player answers), `ytQuality` →
    `ytNative.on` reloads the embed with `controls=1&start=<t>` (YouTube ignores `setPlaybackQuality` since 2019).
  - **Series count removed** (owner's request): `withSeries` returns the cards unchanged; franchiseLinks / ensureFranchise
    are gone (their localStorage keys are deleted on load).
  - **Countdown:** `activeTab = 'countdown'` (not in `tabs`; Anime → Countdown button). `cd`, `loadCountdown` (one AniList
    query: trending RELEASING, NOT_YET_RELEASED by popularity, `airingSchedules(airingAt_greater: now)`),
    `loadCountdownMine` (`mediaId_in` your watching / planning / paused anime), `cdCols`, `cdParts` (ticks with `cdNow`
    every second only while the page is open).
  - **Home P1 / P2:** `.hero-orb` boxes placed at the path's ends in percent (40,40 and 496,568 of the 560×600 SVG, which
    stretches: `preserveAspectRatio="none"`), labels absolutely beside them.
  - **Decor settings:** each decoration block is `.decor-sec` with a `.decor-head` row (current choice in `.decor-now`)
    and `.decor-body` shown when `decorOpen` matches (one at a time).

---

## 3. Where we stopped / immediate next steps

**Stopped at:** the v10.6 PR (#20, v10.5 + v10.6) is open (no SQL, no Edge Function change). v10.1 is merged.

- **v10.3 my watch link** (anime + TV only, the owner's choice): `media_data.wl` (`entryData` / `listRow` / `withRepeats`
  keep it). `openMyLink` opens it and sets `watchAsk` (kept in localStorage `anicoop_watch_ask_v1`, so a reload on the
  phone still asks); `saveAsk` runs `soloNext(anime, 'EP')` n times (same rules as +1), then one upsert. `wlAtEnd`:
  finished titles just open the link. The owner wants to improve it later (ideas: auto-fill from AniList
  `externalLinks`, a "Continue watching" row on Home).
- **v10.4:** anime / TV banner Watch buttons call `watchMine` (your link, or a toast + the link editor); `openWatch`
  (the extensions window) is only reached from manga now, plus the "On your sources" chips. `.play-cta` is manga +
  phones only (on phones `.det-wrap > .banner-play` is hidden by CSS, so it is their only Watch button).
  `officialLinks` = AniList `externalLinks` type STREAMING (Crunchyroll first); **Use** saves one as the watch link.
- **v10.5:** `continueItem` (Browse → Continue watching) for anime / TV: `openMyLink` without leaving Browse, or the
  title page + `watchMine` when there is no link. Manga still opens the reader. Ideas the owner was given next:
  auto-fill links from AniList, a shared squad link, "new episode out" alerts that open the link, episode-numbered
  links ({ep}), resume-by-season for TV, a "Where I watch" default service.
- **v10.6** (owner: "implement all you think are good"): `PREFS.watchService` (any / a site / off) + `autoLinks`
  (localStorage `anicoop_autolinks_v1`, AniList `externalLinks` STREAMING, fetched 50 ids per call for anime on your
  list with no link; a title page fills it too). `linkInfo(a)` = own link, else the automatic one, with `{ep}` →
  next episode (`cleanLink` keeps `{ep}` through `new URL`). The question starts at the last count for that title
  (`anicoop_watch_n_v1`) (v10.7.1 removed the 60-second `quickBack` rule at the owner's request). `sendMyLink` reuses
  the chat "episode" card. Not done (told the owner why): squad-shared links, new-episode alerts with Watch, link
  health checks, TV seasons.
- **v10.6.1:** `cleanLink` / `fillEp` also take the number in braces (`{12}`, `{ e }`, `%7B12%7D`) as the episode slot.
- **v10.7:** `availRows` and the background `checkAvailability` are manga only (owner: anime / TV sources "not needed
  anymore"). The anime / TV sources window (`openWatch`) isn't reachable any more.
- **v10.7.1 / v1.0:** the 60-second quick-return rule is gone; `openExtensions` is forced to `'manga'`. **The owner renumbered
  the app to v1.0** (footer, `?v=1.0`, `sw.js` VERSION `anicoop-v1.0`): count on from there (v1.1, v1.2…), not v10.x.
- **v1.1:** `openWatchWindow` — `window.open(url, 'anicoop_watch', 'popup=yes,…')` centred, `win.opener = null`, polled
  every 0.7 s; when it closes, `watchClosed` pulses the question bar. `PREFS.watchOpen` popup | tab; phones (`touchUI`)
  and blocked pop-ups fall back to a tab. **Not an iframe:** streaming sites send X-Frame-Options / CSP frame-ancestors.
- **v1.2:** the pop-up opens as `about:blank` (same origin), gets `resizeTo` / `moveTo` to the centre of `screen.avail*`,
  shows `watchLaunchHtml` (anicoop colours from the CSS variables, cover / title / episode) for 0.9 s, then `opener = null`
  and `location.replace(url)`. A previous pop-up is closed first (it's cross-origin by then, so it can't be moved).
- **v1.3:** the owner's Brave (anicoop installed as an app, 2560×1440) put the pop-up at twice the asked position
  (bottom-right). `centerWin` reads `win.screenX/Y` while the pop-up is still our same-origin opening screen and
  re-aims with a secant step per axis (up to 6 tries, 130 ms apart, before the 0.9 s navigation). Simulated: doubling,
  shifting and correct browsers all end centred; a browser that ignores `moveTo` can't be fixed.
- **v1.4:** `defaultMode` = the title's saved mode, else `'vertical'` (Webtoon) for everything (was right-to-left for
  Japanese manga).
- **v1.0 again (after v1.4, owner: "bring back 1.0"):** footer v1.0; the cache-busting query is `?v=1.0-tour` and
  `sw.js` is `anicoop-v1.0-tour` (a plain `1.0` was used before, so browsers could have kept old files). Count on as
  v1.1, v1.2… (use a new query string each time). **Welcome tour:** `TOUR_STEPS` (go / sel / skipIfMissing / hero /
  last), `startTour` / `endTour` / `tourNext` / `tourBack`; the spotlight is `.tour-spot` with a 200vmax box-shadow,
  the card goes below / above / beside it (phones: docked at the bottom or top, the spot trimmed so they never overlap).
  `PREFS.tourDone` (+ localStorage `anicoop_tour_done_v1`); `maybeStartTour` runs after `fetchSettings` and waits for
  `introMode === 'done'`. Settings → Account → Take the tour. New pages / features: add a step to TOUR_STEPS.
- **v1.0.1 (tour "very laggy"):** removed the backdrop blur and the animated box-shadow ring; the spotlight moves with
  translate3d (size still width / height), the card sits in `.tour-pos` moved with translate3d, the progress bar uses
  scaleX; `placeTour` only writes `tour.rect` / `tour.card` when they changed (`same`), updates on scroll / resize via
  rAF plus a 600 ms check. Steps now 19: + Random pick, Save where you watch it, Watch then count (`demo: 'ask'`), and
  manga steps (`manga: true` → `tourScene` switches to Manga, others to Anime; the start section comes back in
  `endTour`), "add sources" opens Extensions and the repository box with `copy: MANGA_REPO` (keiyoushi). No Songs in
  the text (admins only).

**Next steps**
0. **When the owner reports back on v10.0,** check: MyAnimeList connect + a change showing up on MAL (the "Last sync
   problem" line in Settings → Linked accounts shows MAL's answer); GIF paging after the function redeploy; the lock-screen play button
   / coming back resumes full songs on their phone; the new decorations look right; and the media keys ⏭ ⏮ (v9.9, still
   unconfirmed).
   A friend's question (answered, no code change): MAL shows 304 completed, anicoop fewer/more — 5 recap TV specials
   aren't on AniList at all, and the profile "Completed" box counts every section (anime + manga + games + TV), while
   its click opens only the completed anime. Offered to make it anime-only or relabel it; the owner hasn't decided.
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
- **Watching anime inside anicoop from pirate sites** (v10.2 talk): refused adding 9anime-type sites, getting past a
  site's protected player or Cloudflare's bot check, and playing Crunchyroll (DRM) inside the site. The owner took the
  "my watch link" idea instead (v10.3).
- **No MP3 ripping or downloading YouTube audio;** YouTube playback goes only through the official IFrame player. SoundCloud was discussed: it only helps with independent music, not mainstream songs.
- **No Cloudflare bypasses,** no picking or recommending pirate sites, and no breaking site protections. "Not readable here: needs its own Android extension" sources can't run in a browser; the solution was the Suwayomi server.
- **A website can't auto-start Suwayomi.** Advice given: add it to Windows startup (`shell:startup`), or host it on an always-on device. Installing anicoop as a web app doesn't change that; only a real desktop app (Electron/Tauri) could.
- A **real Suwayomi can't be run in the sandbox,** because GitHub release downloads return 403. A fake GraphQL server (`scratchpad/fakesuwa.mjs`) plus a sparse clone of the Suwayomi source was used to check the schema.
- **YouTube, cdnjs and most external APIs are unreachable from the sandbox.** Full-song playback can't be verified here.
- **Full songs with the phone locked:** phone browsers pause the video inside YouTube's iframe when the page is hidden
  (a programmatic `playVideo()` stays paused until a real media-control tap). Getting the audio any other way means
  extracting / proxying YouTube streams (against YouTube's terms) or unofficial decrypted catalogues — don't. v10 does
  what's allowed: lock-screen play resumes, coming back resumes, previews play in the background.

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
