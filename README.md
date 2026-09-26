# anicoop — how to open it, put it online and install it as an app

## Open it on your PC right now (quick test)

Double-click `index.html`. It opens in your browser and you can log in and use everything.
Two things only work once it's online (step 2): installing it as an app, and some YouTube trailers.
YouTube needs a real website address to play trailers, so some won't play from a file on your PC.

**Want the full app on your PC without putting it online?** If you have VS Code:

1. Install the "Live Server" extension.
2. Open this folder in VS Code and click **Go Live** in the bottom-right corner.
3. It opens at `http://127.0.0.1:5500`, where trailers play and the Install button works.

anicoop is an installable web app (a PWA). You put this folder online once, and after that you and your friends open the link and tap Install. You get an app icon, it opens in its own window, it starts fast and it updates itself.

## 1\. Set up the database (skip this if you already did it)

Supabase → SQL Editor → paste all of `supabase\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\_setup.sql` → Run.

## 2\. Put it online for free (about 2 minutes)

The easiest way is Netlify Drop:

1. Go to https://app.netlify.com/drop and log in. It's free.
2. Drag this whole **anicoop** folder onto the page.
3. You get a link like `https://something.netlify.app`. You can rename the site in Site settings.

Other free hosts work too: GitHub Pages, Cloudflare Pages or Vercel. It has to be served over **https** or it can't be installed.

## 3\. Tell Supabase about the new link

Supabase → Authentication → URL Configuration:

* **Site URL**: your new link
* **Redirect URLs**: add your new link

Without this, the confirmation links in sign-up emails still point to the old address.

## 4\. Install it (each friend does this once)

After installing, anicoop gets its own icon in the Start menu, on the desktop and in the taskbar. It opens in its own window like any other program.

|Device|How|
|-|-|
|Windows / Mac (Chrome or Edge)|Open the link. Click the Install icon on the right side of the address bar, or use the "Install anicoop" pop-up in the app.|
|Android (Chrome)|Open the link, then tap ⋮ → **Install app** (or use the pop-up).|
|iPhone / iPad (Safari)|Open the link, then tap Share → **Add to Home Screen**.|

## Updating the app later

Change the files, then drag the folder onto Netlify again. In `sw.js`, change `VERSION` (for example to `anicoop-v2.0.1`). Everyone's app picks up the new version the next time they open it.

## Changing styles

`app.css` is pre-built from `src/input.css` with Tailwind. After editing classes, rebuild it:

```
npx tailwindcss@3 -c src/tailwind.config.js -i src/input.css -o app.css --minify
```

## Files

* `index.html` – page layout
* `app.js` – all the app logic
* `app.css` – compiled styles
* `sw.js` + `manifest.webmanifest` + `icons/` – what makes it an installable app
* `supabase\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\_setup.sql` – database setup


## Games section (IGDB / Twitch) — one-time setup

Game data comes from IGDB, which is run by Twitch. IGDB doesn't allow calls straight from a website, and your
Twitch **Client Secret must never go in `app.js`** (anyone can read that file). So the app talks to a small
Supabase Edge Function (`supabase/functions/igdb/index.ts`) that keeps the secret on the server.

**Option A: Supabase dashboard (no installs)**
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it exactly `igdb`.
2. Paste in everything from `supabase/functions/igdb/index.ts` and deploy. Leave **Verify JWT** turned on.
3. Supabase → **Edge Functions** → **Secrets** → add two secrets:
   * `TWITCH_CLIENT_ID` = your Twitch Client ID
   * `TWITCH_CLIENT_SECRET` = your Twitch Client Secret

**Option B: Supabase CLI**
```
supabase login
supabase link --project-ref trbwiqkgrifeigntvhmh
supabase secrets set TWITCH_CLIENT_ID=your_id TWITCH_CLIENT_SECRET=your_secret
supabase functions deploy igdb
```

Also run the whole `supabase_setup.sql` again (v7.4). It lets the Manhwa, Games and Movies & TV rankings save.

If your Twitch secret was ever pasted anywhere public, make a new one in the Twitch developer console
(dev.twitch.tv → Your Console → Applications → Manage → New Secret) and update the secret in Supabase.

## Movies & TV

The section is wired up like the others (lists, squads, rankings, stats, privacy) but has no data source yet.
Browse shows a "not connected yet" panel. When you have an API (TMDB, for example), plug it in where `TV_NOT_READY`
is used in `app.js`. Movie/TV ids use their own number range (`MOVIE_BASE`), so they never clash with anime or game ids.

## v7.5 update checklist

1. Run the whole `supabase_setup.sql` again. It adds the Feedback board, the shared "story order" for game series,
   and the separate Movies / TV shows rankings.
2. Update the `igdb` Edge Function: paste the new `supabase/functions/igdb/index.ts` and deploy again (the secrets stay).
   The new version adds Steam data (price, reviews, Metacritic, players now), time to beat and game characters.
3. Re-upload the folder to your host.

Notes:
* "Top 100" ranks by a weighted score (rating and number of votes), not the raw rating.
* Price sorting in Games uses Steam prices for the games that are loaded (IGDB has no prices). Games not on Steam go last.
* Story order: IGDB has no chronological order, so anyone signed in can arrange a series (Arrange → drag). Everyone sees it.
* There is no IMDb rating for games. Game pages show IGDB user + critic ratings, Metacritic and Steam reviews instead.

## v7.6 update checklist

1. Update the `igdb` Edge Function again (paste the new `supabase/functions/igdb/index.ts`, deploy). It now also talks to
   MangaDex: latest chapter + status on manga posters and the chapter list on manga pages. No SQL changes this time.
2. Re-upload the folder.

Notes:
* Manga "Read" lists official sources (from AniList and MangaDex) and MangaDex's chapter list. Chapters open on the
  source's own website. Nothing is hosted or copied into anicoop.
* Anime "Watch" only links to legal services (the streaming sites AniList knows, official free YouTube channels,
  and JustWatch for your country). anicoop doesn't aggregate unofficial streaming sites.

## v7.7 — Extensions + in-app manga reader

1. Update the `igdb` Edge Function again (paste the new `supabase/functions/igdb/index.ts`, deploy). It adds the
   "pages" call the reader needs. No SQL changes.
2. Re-upload the folder.

How it works (like Mihon): anicoop has no manga of its own. In the Manga section, open **Extensions** and install:
* **MangaDex**: read MangaDex chapters in the app (MangaDex's official API, which allows third-party readers).
  Chapters that MangaDex only links to (official releases) still open on the publisher's site.
* **Local files**: open CBZ / ZIP archives or images from your device. They're read in the browser and never uploaded.

The reader has Manga (right-to-left), Comic (left-to-right) and Webtoon (vertical) modes, remembered per title.
Finishing a chapter marks it read on your list (can be turned off in Extensions). There's also a "Mark read" button.

## v7.8 — Website sources (Mihon-style extensions)

1. Update the `igdb` Edge Function again (paste the new `supabase/functions/igdb/index.ts`, deploy). It adds the
   `fetch` call that website sources use. No SQL changes.
2. Re-upload the folder.

Manga → **Extensions** → **Website sources**:
* **Add a website**: paste the site's address and pick its template: *Madara* (WordPress manga sites) or
  *MangaThemesia* (MangaStream-style sites). Most manga sites use one of these. Press **Test**, then **Install**.
  *Custom* lets you enter your own CSS selectors as JSON.
* **Install from a repository**: paste a link to a JSON file with a list of sources:
  `{"name": "My repo", "sources": [{"name": "Site", "baseUrl": "https://…", "template": "madara", "lang": "en"}]}`

On a manga page, pick a source tab above the chapter list. anicoop finds the title on that site (or asks you which
result is right, then remembers it), lists its chapters, and opens them in the built-in reader, not on the site.
Extensions are settings only (no code), and pages are read without running the site's scripts, so no ads or trackers.
Sites behind Cloudflare's "checking your browser" page can't be read this way.

### Mihon / Tachiyomi repositories (v7.8.1)
Paste a repository's GitHub page (e.g. `https://github.com/keiyoushi/extensions`) or its `index.json` /
`index.min.json` file into **Install from a repository**. anicoop lists every site in it (search + language filter;
18+ sources only if the owner allowed 18+ for you). Mihon extensions are Android code that a website can't run, so
**Install** first checks the site:
* built on **Madara** or **MangaThemesia** → installed and readable in anicoop;
* behind **Cloudflare's bot check** → can't be read here (Mihon passes that check inside the phone's browser);
* custom-built site → needs its Android extension, can't be read here.
Roughly 1 in 6 sites in a big repository fall in the first group; most of the rest are behind Cloudflare.

### v7.8.4 — making Mihon repositories actually usable
* **Find readable sources** (in a repository's list) checks every source for you: it only marks a site ✓ readable if
  a test title's chapter really returns page images. Results are remembered for a week.
* A third template, **Generic (smart guess)**, reads many sites that aren't Madara/MangaThemesia by recognising title
  links, chapter links and the chapter's images. It also finds each site's own search address by itself.
* Sites that block their images on other websites are read through the proxy automatically.
* Tested on Keiyoushi's English list: 58 of 368 sources readable end to end (e.g. MangaPill, Asura Scans, MangaFox,
  MangaHere, Mangabat, MangaDNA, Galaxy Manga). Most others are behind Cloudflare or need their own Android code.

## v7.9 — Movies & TV (TMDB) + Songs (Spotify)

1. Supabase → **Edge Functions → Secrets** → add three secrets:
   * `TMDB_TOKEN` = your TMDB **API Read Access Token** (the long one starting with `eyJ…`)
   * `SPOTIFY_CLIENT_ID` = your Spotify Client ID
   * `SPOTIFY_CLIENT_SECRET` = your Spotify Client Secret
2. Update the `igdb` Edge Function (paste the new `supabase/functions/igdb/index.ts`, deploy).
3. Run the whole `supabase_setup.sql` again (it allows a Songs ranking).
4. Re-upload the folder.

Notes:
* Movies & TV: trending, search, filters (movies / TV shows, genre, year, status, sort), movie & show pages with trailers,
  cast (heart a character to favorite it), seasons, collections, IMDb link and **where to watch in your country**
  (streaming data by JustWatch through TMDB). Top 100 is weighted by votes.
* Songs: Spotify search (genre / year / hide explicit) and song pages with the Spotify player. New Spotify apps can't
  read Spotify's own charts, so "trending" and Top 100 are Apple Music's public most-played chart (pick a country),
  matched to Spotify tracks. Statuses: On Repeat, Want to Hear, Listened, On Hold, Skipped; progress counts plays.
* AniList has been returning empty lists for some manga requests; anicoop now works around it automatically.

### v7.9.1 — faster sections
* Each section's first Browse page is remembered: opening a section you've seen shows it instantly and refreshes it
  quietly in the background (the default view is kept in the browser, so it's instant after a restart too).
* A few seconds after the app opens, the other sections are prepared in the background.
* Requests for what you're looking at go ahead of background jobs (list checks, alerts, home posters).
* Games' default page is one request instead of two (needs the updated `igdb` Edge Function).
* AniList's trending sort for manga is currently broken (it can hang ~10 s and return nothing); anicoop switches to
  popularity after 2.5 s and remembers it.

## v8.0 — filters, looks & fixes

**To update:** re-upload the folder. Recommended: also redeploy the `igdb` Edge Function (paste the new
`supabase/functions/igdb/index.ts`, deploy). No SQL changes.

* **Songs fixed.** Spotify blocked the app for ~19 h: every chart load sent ~100 Spotify searches (one set per
  visitor's region). Browsing, search, genres, charts and Top 100 now come from Apple Music (free, no key, with 30-second
  previews). Spotify is only asked once per song, when you open it, for the player. Songs saved earlier still work.
  The new Edge Function also stops calling Spotify while Spotify says it's blocked, so a block can't drag on.
* **18+ manga fixed.** AniList no longer lists adult manga, so the "18+ only" list comes from MangaDex (by AniList id)
  with AniList details.
* **Filters:** pick several genres / tags (titles must have all of them); every active filter shows as a chip above the
  results with its own ×; the filter bar stays pinned under the header while you scroll. Movies & TV got Tags.
* **Movies & TV:** no anime (Japanese animation is in the Anime section); erotic titles only with "18+ only" on;
  click an actor to see their page (bio, details, known for, behind the camera, favorite them).
* **Look:** Geist font (the anicoop logo, ".studio" and the "// …" lines keep their fonts); secondary text and button
  borders follow your accent colour; livelier hover/click on buttons; bigger section switcher; clearer stats in light
  mode; back-to-top button; header icons reordered (settings · feedback | notifications · friends · chat), random
  button removed from the header (still in Browse).
* **Home:** the 4 posters stand along the line in 3D and can be saved straight to Plan / Watching / Completed.
* **Profile:** page background like Steam (Settings → Profile → Page background: themes, a banner from your list, a
  link or an upload, with a darken slider — friends see it); My rankings is full width.
* Squad rename is an in-app pop-up; "Squad talk" is now "Comments"; the Saved links section is gone; the ✓ next to a
  manga chapter (and the reader's button) marks it read **or** unread.
* Faster first loads: the server function is woken at start-up, other sections load sooner, and pointing at a
  section starts loading it before you click.

### v8.1 — polish
Re-upload the folder (no server or SQL changes).
* Dropdowns now open a menu in the site's own style (search inside long lists, ✓ to tick / untick several genres or tags).
* Select + Random pick live in the pinned filter bar, so they're always there while you scroll.
* The section switcher moved to the right side of the header; the tabs stay centred.
* Searching (e.g. Songs) from far down the page scrolls you up to the new results; Apple searches fall back to our
  server if your browser blocks them.
* Back-to-top button fixed (it wasn't being drawn at all) and it now shows after about one screen.
* Movies & TV: region tags (K-drama, C-drama, J-drama, Thai, Turkish, Bollywood, British, Nordic noir…) and ~40 more themes.
* Home: original grey text is back; the 4 posters sit centred between P1 and P2.
* Profile friends list buttons got the same hover / press effects; the poll winner is shown big and centred.

## v8.2 — roles, achievements, admin powers + Songs artists

**To update:** run the whole `supabase_setup.sql` again in Supabase → SQL Editor (it adds roles, role members,
achievements and the admin rules), then re-upload the folder. No Edge Function change.

* **Owner = full admin.** Settings → **Admin** (the old Owner tab):
  * **Roles:** make any role (name, colour, icon) and pick its powers — Full admin, Manage roles, Give achievements,
    Moderate, Manage feedback, Manage 18+. Order them with the arrows. Only the owner can make or hand out roles with
    "Full admin" / "Manage roles", so nobody can give themselves more power.
  * **People:** find anyone by username → give / take roles, give an achievement, remove their picture / banner / bio.
  * Roles (and "Owner") show under the name on everyone's profile.
* **Achievements** the owner (or a role with "Give achievements") hands out: title, description, icon, colour. They show
  on the person's profile with a shine; hover one to see what it's for and who gave it. Give them from someone's profile
  (Admin ▾ → Give achievement) or from Settings → Admin.
* **Moderation:** people with "Moderate" see delete buttons on everyone's posts, replies and comments (and can see every
  post); "Manage feedback" can change status / delete any feedback.
* **Songs:** searching an artist brings up their whole catalogue (up to 200 songs) plus a card to their **artist page**
  — photo, bio (Wikipedia), fans, albums / EPs / singles (open one to see its tracks) and every song, all inside anicoop.
  The Artist panel on a song page opens it too. 40+ more genres, and Tags: versions (acoustic, remix, live…),
  moods, anime / game / film songs and decades.
* Songs statuses: "Skipped" is now **Disliked**, and songs have no "On Hold".
* Home: section titles in your accent colour, the rest of the text white; the buttons on the 4 posters now line up with
  the mouse.

## v8.3 — rewatch counters, refresh keeps your page, MAL import fix, organised Songs

**Update:** just re-upload the folder. No database change this time (rewatch counters are saved inside each list entry).

* **Rewatching (anime):** a new **Repeating** status. Picking it on a finished anime starts rewatch #1, #2… (up to 5),
  each with its own episode counter; reaching the last episode finishes that rewatch and puts it back to Completed.
  "+1 EP" on a rewatch counts on the rewatch. Stats → *Episodes watched* counts every episode once; hover it to see
  the total with rewatches. Trying a 6th rewatch shows a pop-up and unlocks a secret badge. MAL / AniList imports
  bring their rewatch counts along, and a linked AniList account gets the rewatch count too.
* **Refresh keeps you where you were** (section, tab, title page, profile, artist page, open settings and scroll position).
* **MyAnimeList import:** titles AniList doesn't link to their MAL id are now looked up by name; batches no longer
  drop titles when AniList has two entries for one MAL id; titles already on your list are updated when the import is
  further along (e.g. Completed on MAL but Watching here). Anything still unmatched is listed by name after the import.
* **Songs:** results are a numbered track list (artist, album, year, length, your status) with *Group by*: Auto, Ranked,
  Artist, Album, Genre, Decade. Searching an artist shows Popular, then each of their releases in track order, then other matches.
  The covers grid is still one click away.
* **Artist pages:** Popular (their own songs first), then Discography split into Albums / EPs / Singles, newest first,
  with deluxe/clean editions merged and every release's songs in track order, then Features & other releases.

## v8.4 — Top 100 rework, playlists, song previews, game shelves, favourites

**Update:** run the whole `supabase_setup.sql` again (adds the `playlists` table), then re-upload the folder.

* **Top 100:** hiding a genre reloads the list right away (it used to go blank). Scores use the real number of people
  who rated each title and keep decimals (e.g. 9.06). Manga / Manhwa / Manhua and Movies / Series are separate lists.
  Songs show the 100 most streamed songs of all time (Spotify all-time list via Wikipedia), no explainer text.
* **Songs:** statuses are In Love / Liked / Disliked. Hover any song for a play button (30-second preview); a mini
  player follows you around the site and the volume is remembered. Artist pages have a Spotify-style discography
  (Popular releases / Albums / Singles and EPs): click a cover and its songs open right under it.
  **Playlists:** Songs → Solo list → New playlist, add songs from any song's edit window, reorder or remove them.
* **Games:** rows for New releases, Coming soon, Best of all time and Play together above the popular list.
  Platforms are just PC, PlayStation, Xbox and Mobile.
* **Favourites:** one section with Characters (anime / manga / games / movies & TV) and People (voice actors,
  actors, singers, staff). Artist pages have a "Favorite singer" button.
* **Fixes:** chat notifications stay read after a refresh; poll notifications open the right feed and scroll to the
  poll with the rest of the feed around it; the Browse side panel scrolls when zoomed in; the side panel lines up
  with the list in every section; the episodes-with-rewatches hover no longer flickers; "completed series" only
  counts a series when everything of it on your list is completed. Home's recommendation line is now a curve.

## v8.5 — organised sections, faster Top 100 & artist pages, global songs chart

**Update:** just re-upload the folder (no database change).

* **Anime, Manga, Movies & TV** now open with rows like Games: This season / Next season / Best of all time /
  Anime movies · Publishing now / Top manhwa / Best of all time / New & rising · In cinemas now / Popular series /
  Coming soon / Best of all time. Each section's rows load in one go and are kept for 2 hours.
* **Top 100:** pick **Rating + votes** (the weighted formula: a 9 from 100k people beats a 9.5 from 10) or
  **Rating only** (pure score; a tie goes to the one more people rated). Pages load in parallel (~1 s) and each list is
  kept for 6 hours, so it opens instantly the next time.
* **Songs:** "Top songs: Global" is the new default (the charts of 10 big countries combined); every country is still there.
* **Artist pages** show in under a second: the first 50 songs, then the full list, photo and bio fill in.
* **Removed** the watch / read links (streaming sites, reading sites, "Where to watch"). Episode and chapter lists stay.
* **Fix:** squad chips no longer hang off the bottom of a friend's profile card in the List view.

## v8.6 — Read / Watch window, anime & movie extensions, history, songs upgrades

**Update:** just re-upload the folder (no database change, no Edge Function change).

* **Read / Watch:** every manga, anime, movie and show has a big **Read** / **Watch** button (on the banner and in the
  button row). It opens one window with your sources and every chapter / episode, Netflix-style (number, picture, name,
  length, summary; TV shows have a season picker from TMDB). The old Extensions buttons are gone from the pages;
  Extensions now live inside this window.
* **Extensions for Anime and Movies & TV:** install Aniyomi repositories (e.g. `https://github.com/yuzono/anime-repo`)
  the same way as Mihon ones for manga. anicoop reads sites built on the **AnimeStream** and **DooPlay** WordPress themes
  and, otherwise, looks for the players on a site's episode pages. Episodes play in anicoop's own player: plain video
  files and HLS streams directly, site players inside a locked frame that can't open pop-ups or redirect you
  (a "pop-up blocker" switch is there in case a player refuses to load). Built in: **Internet Archive** (public-domain
  films & shows) for Movies & TV, and **Local video files** for Anime and Movies & TV.
* **Find sources with this title:** opened from a title, the check searches every source for *that* title — its own
  name, then its "Also known as" names, then the site's own "Alternative names" — and only marks sources that really
  have it and open here. It works again on the next title (it used to only work once).
* **18+ extensions** only show (and install) while the 18+ filter is on.
* **History** (button on every section's Browse page): chapters read, episodes watched, songs played and trailers
  watched, grouped by day. Remove one entry or clear a section. Kept on this device.
* **Songs:** Browse opens like the other sections (rows: Most streamed ever, USA, UK, Korea; covers view by default),
  "Show 100 more songs" on the chart and "Show 100 more" on Most streamed (beyond Wikipedia's 100, from kworb.net),
  a play button on each Most streamed row when you hover it, and the Artist / Album rows in a song's Info open the
  artist page / album.
* **Fixes:** the Home picks no longer flicker when you hover their edge; a friend's rankings are as wide as yours;
  the header fits on tablets and small or zoomed laptops (settings + feedback move into the section menu there), and
  the Feed's buttons wrap on phones. Nothing changes at 1100 px and wider.

## v8.7 — back button, album pages, one Top 100 ranking, fixes

**Update:** just re-upload the folder (no database change, no Edge Function change).

* **Back button works again** (v8.6's History list had taken the browser's `history` name, which broke Back and
  "stay on this page after a refresh").
* **Album pages:** the Album row in a song's Info (and "Album page" on an artist's release) opens the album's own page:
  cover, artist, release date, genre, label, length and every song.
* **Top 100:** one ranking — rating weighted by how many people rated it. Titles are compared on the score you see,
  so when two show the same score, the one more people rated is higher.
* **Read / Watch:** the button sits on the title's line (tablets and up); sources wrap onto a second line instead of
  running off the side; anime / movie sites never call episodes "chapters".
* **Anime sources:** installing one now checks that an episode really plays first; pages behind Cloudflare's check are
  recognised; titles on AnimeStream sites are read correctly (they used to include the latest episode's name).
  Sites like Anikoto / AniWave / AnimeKai / AnimeSogo / WCO lock their players behind code of their own, so they
  can't play here.
* **Songs:** Browse shows full rows only before "Show 100 more songs".
* **Smaller things:** posters no longer flicker when hovered at their edge; Home's top buttons use the theme colour;
  the Actors tab is gone from People in profiles; History is lighter (smaller entries, saved when the page is idle).

## v8.8 — full songs, a real song player, video sources

**Update:** re-upload the folder, then update the `igdb` Edge Function (paste the new
`supabase/functions/igdb/index.ts` and deploy). No database change. Songs and YouTube episodes already work before
the function update (slower, through the page reader); the update adds a direct YouTube search and the `{imdb}` blank.

* **Full songs:** each song is found on YouTube (the artist's own "Topic" upload first; covers, live and sped-up
  versions are skipped) and played in YouTube's own player, kept out of sight so you only hear it ("Video" shows it).
  Nothing is downloaded or converted to MP3. If YouTube has no match, or the owner blocks playing it outside YouTube,
  Apple's 30-second preview plays instead. The "Full / 0:30" button switches previews-only on and off.
* **Song player:** full-width bar with shuffle, previous, play/pause, next, repeat (list / one song), seek bar with
  times, queue (the album, chart or playlist you pressed play in), volume and lock-screen / media-key controls.
  It sits above every window, the manga reader and video player included, and the page and every window now end
  above it, so it never covers a button. A video or trailer pauses the song.
* **Video sources (anime, movies & TV):**
  * **YouTube** extension: plays free, official uploads of an episode or film (Muse Asia, Ani-One, TMS…).
  * **Player links:** add a player address with blanks anicoop fills in for the episode you pick:
    `{tmdb} {imdb} {anilist} {mal} {season} {episode} {title}` (Movies & TV can have a separate movie address).
    It plays in the pop-up-blocking frame. Only add players you're allowed to use.
* **Header:** the section switcher sits between the logo and the tabs.
* **Top 100:** a title can no longer appear twice (pages fetched together could overlap).
* **Home:** the top buttons really use the theme colour now (a white-text rule was winning).

## v8.9 — player fixes, Steam prices by region

**Update:** re-upload the folder. If you haven't yet, also deploy the v8.8 `igdb` Edge Function: full songs need it
to search YouTube reliably. No database change.

* **Songs that kept loading:** every step (finding the song, starting YouTube's player) now gives up after a few
  seconds and plays Apple's 30-second preview instead. If the browser blocks the sound until you tap, the bar says so;
  if a tap doesn't start it either, the preview plays. The player uses youtube.com (the no-cookie address could lose
  the player's "ready" signal). Pressing play on a song that's stuck starts it over.
* **Hide the player:** the bar's last button now hides it (the music keeps playing). A small round button in the
  bottom-left corner (the cover, with moving bars while it plays) brings it back.
* **Steam prices by region:** a game's Steam panel has "Prices in other regions": the store price in 22 regions,
  cheapest first, with a rough US-dollar value (exchange rates from open.er-api.com).
* **Poster quick menu** (the + on a card) is drawn on top of the page, so small cards (songs) no longer cut it off.
* **Header:** the small divider lines between the icons are gone.

## v9.0 — full songs from YouTube Music

**Update (both steps are needed for full songs):**
1. Re-upload the folder.
2. Supabase → Edge Functions → `igdb` → paste the new `supabase/functions/igdb/index.ts` → Deploy.
   Without this, songs play the 30-second preview and the player says why.

* **Songs are found on YouTube Music** ("Songs" search = the official audio tracks: no video intros, live or
  cover versions), then regular YouTube if needed. They play in YouTube's player, sound only. Nothing is downloaded
  or converted.
* **Blocked songs:** record labels often block their songs from playing outside YouTube. The player now tries the
  next few official uploads before falling back to the preview.
* **Fast previews when full songs can't work:** if the Edge Function is outdated or YouTube's player can't load,
  the preview starts within a few seconds, and for the next 10 minutes songs go straight to the preview.
* **The player tells you why:** "Finding it on YouTube Music…" while it looks; if the preview plays instead, the
  amber "0:30" badge explains why (hover it) and clicking it tries the full song again.

## v9.1 — add to playlist from anywhere, song fixes

**Update:** re-upload the folder (no database or Edge Function change).

* **Add to playlist from anywhere:** one small picker lists your playlists (a tick on the ones that already have the
  song) plus "New playlist". Open it from a song card's + menu ("Add to playlist…"), the ⊕ button on any song row
  (albums, artists, charts, playlists), the ⊕ in the player bar, or "Playlist" on a song's page.
* **Card menu no longer covers the card:** it opens beside the card (right, or left near the edge) after a short
  hover, so the card's play button stays clickable.
* **Songs:** the "+1 Play" row is gone from the card menu.
* **Random pick:** only uses titles (and genres) from the section you're in; on Browse it used to mix every section.

## v9.2 — continuous reading, music panel, random pick, emoji & GIFs

**Update:**
1. Re-upload the folder.
2. Supabase → Edge Functions → `igdb` → paste the new `supabase/functions/igdb/index.ts` → Deploy.
3. Supabase → Edge Functions → **Secrets** → add:
   * `EMOJI_API_KEY` = your emoji-api.com key (the full emoji list in chat)
   * `GIPHY_API_KEY` = a free GIPHY key (developers.giphy.com → Create an App → API). `TENOR_API_KEY` works too.
   Without them, chat shows a basic emoji set, and GIF uploads / links still work.

* **Continuous reading (manga & manhwa):** the next chapter's pages are fetched while you read. In Manga / Comic mode,
  turning past the last page opens the next chapter straight away; in Webtoon mode it's added under the one you're
  reading, with a small "Chapter N" divider. Every finished chapter is saved as read.
* **Music panel** (♪ in the header, the manga reader, the video player and the song bar): search songs, your
  playlists, liked and recent songs, and play them without leaving what you're doing. It opens on top of everything.
* **Random pick:** "Everything" (the whole catalogue) or "My lists". Everything has Browse's filters for the section
  you're in: genre (songs get all their genres), status (airing / publishing / finished / upcoming; games: released /
  upcoming / early access), format, and manga / manhwa / manhua.
* **Completed counts everything:** a manga without a final count uses MangaDex's latest chapter; a show listed without
  an episode count gets it from TMDB; a movie counts as 1.
* **Song search** also asks Spotify, so artists Apple's search misses (e.g. RILEY) show up; Apple's artist lookup
  checks 25 names instead of 5.
* **Chat:** emoji picker (search, categories, recent) and GIF search with trending GIFs.
* **Header:** a little space again between the feedback icon and notifications.

## v9.3 — Mihon server: AllManga, Bato, Webtoons, Tappytoon (and any other Mihon extension)

**Update:** re-upload the folder (no database or Edge Function change).

Some sites need their own extension code ("Not readable here: this site needs its own Android extension code"). A
**Mihon server** runs those real Mihon extensions on a computer, and anicoop reads through it.

### Set it up once (about 10 minutes)
1. Download **Suwayomi-Server** from https://github.com/Suwayomi/Suwayomi-Server/releases (latest release).
   On Windows take the Windows `.zip` (Java is included), unzip it, and run `Suwayomi Launcher`.
2. It opens its own page in your browser at **http://localhost:4567**.
3. There: **Settings → Browse → Extension repositories** (called **Extension stores** in newer versions) → add
   `https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json`
4. **Browse → Extensions** → install **AllManga**, **Bato.to**, **Webtoons.com** and **Tappytoon** (or any other).
   Tappytoon's paid chapters need you to log in to Tappytoon in that source's settings; free chapters work without.
5. In anicoop: a manga's **Read** window → **Extensions** → **Mihon server** → address `http://localhost:4567` →
   **Connect** → **Add** the sources you want. If Chrome asks to let the site "access other apps and services on this
   device", click **Allow**.

### Good to know
* The server has to be running while you read (it's on your computer). The address and login stay in your browser.
* To use it from your phone or from friends' devices, the server has to run on a computer that's always on
  (a home PC or a cheap / free cloud server) with a login set in its settings (Settings → Server → Basic
  authentication), reached over https. Enter that login in anicoop's Mihon server box.
* Sites behind Cloudflare's "checking your browser" page may still refuse the server.

## v9.4 — chapter banner, quick actions row, playlist adding, source check

**Update:** re-upload the folder (no database or Edge Function change).

* **Reading:** chapters still flow into each other; now a "Chapter N" banner shows when a new one starts, and in
  Webtoon mode the divider between chapters is a clear "Chapter N" label with "previous chapter saved as read".
* **Card quick actions:** hovering a card's + opens a compact row of round buttons just above it, inside the card
  (a caption names the one you're on). Its first button is Play, so the card's play button is never out of reach.
* **Playlists:** "Add songs" in an open playlist searches your songs and any song (Apple + Spotify); each row has
  Listen and one-click Add, and the panel stays open so you can add several.
* **Discography:** every release has a ▶ on its cover that plays it (the rest of its songs queued) without opening
  its track list.
* **On your sources:** opening a manga, anime or show checks your installed sources and shows which have it
  (✓ = click to read / watch there). Read / Watch starts on a source that has it.
* **Header:** a thin line between the feedback icon and the music icon.

## v9.5 — card menus, multi-select playlists, source badges

**Update:** re-upload the folder (no database or Edge Function change).

* **Card menus:** songs keep the row of round buttons (now always one line, above the +); every other section has
  the Solo list menu back, with "Play trailer" at the top so the card's play button is always one click away.
* **Select several songs → Add to playlist:** the Select bar (Songs) has "Add to playlist"; the picker shows how many
  of them each playlist already has and adds the rest.
* **Read / Watch window:** each source tab shows whether it has this title: ✓ green = has it, spinner = checking,
  faded ✗ = doesn't have it.

## v9.6 — Mihon sources without the 18+ switch, automatic play counts

**Update:** re-upload the folder (no database or Edge Function change).

* **Mihon server:** its sources show and can be added whatever the 18+ setting (the server is yours). Sources marked
  18+ there still carry the 18+ tag. Website sources and repositories keep the 18+ rule.
* **Plays count themselves:** a song counts as played after 30 seconds of listening (15 s for a 30-second preview).
  The count goes on the song's "Plays" in your list and shows on song rows (▶ 12) and next to songs in the Songs
  rankings on profiles (yours and friends'). Songs that aren't on your list keep their plays in this browser, and
  they're added when you add the song.

## v9.7 — Songs by permission, song stats, chapter order

**Update:** re-upload the folder, then run the SQL below once in Supabase → SQL Editor (it's also in
`supabase_setup.sql`, section 8d). No Edge Function change.

```sql
insert into public.app_config (key, value) values ('songs', '{"everyone": false, "users": []}') on conflict (key) do nothing;
drop policy if exists "admin: song settings" on public.app_config;
create policy "admin: song settings" on public.app_config for update to authenticated
  using (key = 'songs' and public.has_perm('manage_songs')) with check (key = 'songs' and public.has_perm('manage_songs'));
```

* **Songs are hidden until you're allowed**, like 18+: the Songs section, the music button, the player, song stats,
  the Songs ranking, artist and album pages all disappear. The owner picks who sees them in **Settings → Admin → Songs**
  ("Only people I pick" or "Everyone"). A role with **Manage songs** can do it too. Until the SQL is run only the
  owner sees Songs.
* **Song stats** say In Love / Liked / Disliked and show how many times each song was played (▶ 3), not "0/?".
* **On repeat** (Songs home): a play button instead of "+1 Play", and "Played 3 times".
* **Song page:** the play button is always there (also for songs from Spotify), and every song under
  "More from this album" has its own play button.
* **Volume:** dragging it all the way down mutes; un-muting from there brings the last volume back.
* **Read window:** a "Newest first / Oldest first" button above the chapters (remembered).
* **Home:** the 4 posters no longer go blurry for a moment when you hover them.

## v9.8 — phone layout, saved GIFs, faster songs, Squads inside Solo

**Update:** re-upload the folder (no database or Edge Function change).

* **Phones:** the bottom-bar icons were almost invisible (fixed); the Solo list's filters take two short rows instead of
  a whole screen; a title page shows the cover, title and Watch / Read first, then your list; smaller stat cards;
  tab rows scroll sideways; typing no longer zooms the page on iPhone; taps respond instantly.
* **Squads live inside Solo:** a Solo / Squads switch under the statuses (one less tab on the bottom bar).
* **Chat:** stickers removed (emojis replace them). **Saved GIFs** like Discord: tap the ☆ on any GIF (in the picker
  or in a chat) and it's in "Saved", on every device you sign in on.
* **Songs:** faster first play (YouTube's player loads in the background, a song played before starts without a
  new search, the next song in the queue is looked up early); music tries to keep playing when the phone locks or
  you leave the tab; artist names on song covers; better search order (exact titles first); search an artist's songs
  on their page; no more "2/?" anywhere for songs; the Songs ranking includes the songs people are In Love with; friends'
  Songs lists (for people allowed to see Songs).
* **Read window:** "Find chapter…" box (type 120 or a chapter name).
* **Friends:** pending requests (sent or received) open that person's profile.
* **Continue reading / watching cards** open the title with the Read / Watch window already up.
* **Compare** works per section (Anime, Manga, Games, Movies & TV, Songs) with that section's numbers, and opens on the
  section you're in.
* **Feed:** the tier list maker, poll / question pickers and hints follow the section you're in (games, movies & TV,
  songs… not only anime).

## v9.9 — sign in with Google / Discord, one feed for everything, Lists & Leaderboard, game characters, phone fixes

**Update:** merge the PR (GitHub Pages updates by itself), then **run the new SQL** below in Supabase → SQL Editor
(it's also section "8e" in `supabase_setup.sql`). No Edge Function change. To use the new sign-in buttons, switch the
providers on in Supabase (steps at the end of this section).

```sql
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
```

1. **Sign in with Google, Discord, Facebook or Twitch** on the login page. A new account gets a username made from its
   name there (numbers are added if it's taken) and can change it in Settings → Account. Signing in with an account that
   has the same email as your anicoop account opens that same account.
2. **GIFs** scroll down instead of sideways.
3. **Solo → Lists** and **Top 100 → Leaderboard** (tabs and the phone's bottom bar).
4. **Game characters:** the tier list maker in Games can add a game's whole cast ("Characters from a game") or single
   characters ("Pick one by one" → Characters); polls in Games search game characters. Characters with no picture on
   IGDB now get one from the game's Fandom wiki (or Wikipedia) — on game pages, tier lists, polls and favourites.
   The few left show their initials instead of a blank.
5. **One feed for every section**, with filters on top: All, Anime, Manga, Manhwa, Games, Movies & TV (and Songs).
   Every post shows which section it's about (tap it to see only those). When you post, "About:" picks where it shows
   (it starts on the section you're in).
6. **Continue reading** opens the exact chapter and page you were on (or the next chapter, if you finished that one).
   Closing the reader shows the chapter list.
7. **Phones:** filters with a search box (Genre, Tag…) no longer open the keyboard by themselves, and the list stays
   open when the keyboard comes up.
8. **Phones:** every row of tab buttons (like Anime / Manga / Games / Movies & TV) scrolls sideways when it doesn't fit.
9. **Phone headers:** Home fits every button; in Browse (and the other tabs) Settings and Feedback are back in the
   header. The back arrow and small logo step aside on phones (the phone's back works; Home is in the section menu).
10. **Hide genres** is clearly on ("Genres hidden" + a count, filled) or off, and hidden genres are red and marked "hidden".
11. **Selecting several titles on a phone:** the bar at the bottom says what each button does (Watching, Planning,
    Completed…, Add to squad, Remove) in three short rows.
12. **The music button** (after you hide the player) can be dragged anywhere; it stays where you leave it.
13. **Search shows the most popular first** (anime, manga, games, movies & TV). Games search also finds the big ones
    it used to miss (e.g. "zelda" now starts with Breath of the Wild).
14. **Less memory:** long webtoon reads keep only 3 chapters loaded (the older ones above you are let go), the Leaderboard
    and feed skip drawing rows far off screen, and big lists use lighter data.
15. **Searching on a phone** shows the results first (the Top 5 boxes are hidden while you search).
16. **Leaderboard:** a **Select** button — tick titles and add them to your list in one go.
17. **Movies:** a **Franchise** list (e.g. every Harry Potter movie) in release order or a story order anyone can
    arrange, with each movie's length, the whole franchise's watch time and how many you've seen.
18. **Keyboard:** **Shift+N / Shift+P** (or **Ctrl+→ / Ctrl+←**) for next / previous song. On computers the keyboard's own
    ⏭ ⏮ keys now work with full songs too.

**Switching on Google / Discord / Facebook / Twitch sign-in** (do only the ones you want; a button that isn't switched
on says so when tapped — ask to have it removed from the page):

1. Supabase → **Authentication → URL Configuration**: set **Site URL** to your site's address
   (e.g. `https://dripslayer1.github.io/anicoop/`) and add the same address under **Redirect URLs**.
2. Supabase → **Authentication → Providers** → open the provider and turn it on. It shows a **Callback URL**
   (`https://trbwiqkgrifeigntvhmh.supabase.co/auth/v1/callback`) and asks for a **Client ID** and **Client Secret**,
   which you get from that site:
   * **Google:** console.cloud.google.com → APIs & Services → OAuth consent screen (fill it in), then Credentials →
     Create credentials → OAuth client ID → Web application → add the Callback URL under "Authorized redirect URIs".
   * **Discord:** discord.com/developers/applications → New Application → OAuth2 → add the Callback URL under Redirects,
     copy the Client ID and reset / copy the Client Secret.
   * **Facebook:** developers.facebook.com → My Apps → Create app (Authenticate with Facebook Login) → Facebook Login
     settings → add the Callback URL to "Valid OAuth Redirect URIs"; App ID and App Secret are in App settings → Basic.
     The app has to be switched to **Live** before other people can use it.
   * **Twitch:** dev.twitch.tv/console → Register Your Application (a new one, not the IGDB one) → OAuth Redirect URL =
     the Callback URL → copy the Client ID and a new Client Secret.
3. Paste the ID and secret into Supabase and **Save**. Keys stay in Supabase only — never put them in the repo.

> **v10:** the Google / Discord / Facebook / Twitch buttons were taken off the login page again (email sign-in only).
> If you switched any of them on in Supabase, you can switch them off there too (Authentication → Providers); accounts
> already made with them keep working either way.

## v10.0 — MyAnimeList sync, more GIFs, tier lists for every section, "Wanna Rewatch", 18+ kept private, header search

**Update:** merge the PR (GitHub Pages updates by itself), then:
1. **Run this SQL** in Supabase → SQL Editor (it's also section "8f" in `supabase_setup.sql`; needed for item 18):
   ```sql
   alter table public.account_links add column if not exists refresh_token text;
   ```
2. **Deploy the Edge Function again** (Supabase → Edge Functions → `igdb` → replace the code with
   `supabase/functions/igdb/index.ts` → Deploy). It adds more GIFs when scrolling (item 1) and MyAnimeList sync (item 18).
3. For MyAnimeList sync, do the one-time **MyAnimeList setup** at the end of this section.

1. **GIFs:** scrolling down in the GIF picker loads 30 more each time.
2. **Tier lists in every section:** a switch at the top picks what you rank: **Characters** (Artists for Songs) or the
   titles themselves (Anime, Manga, Games, Movies & TV, Songs). Characters come from a title's whole cast, one by one, by
   tag/genre (anime & manga) or **from your list** (the main characters of your best-rated titles). Movies & TV
   characters use the actor's photo; Songs ranks artists (with their Deezer photos).
3. **Music with the screen off:** full songs come from YouTube's player, and phone browsers stop it when the screen
   locks or you switch apps (YouTube keeps background play for its Premium app, so no website can switch that off).
   Now: the lock-screen play button always resumes it, the song carries on by itself when you come back, and the lock
   screen shows the song's progress. The 30-second previews keep playing in the background.
4. **Login:** the Google / Discord / Facebook / Twitch buttons are gone (email only).
5. **Home:** "P1" is now on the left of its dot.
6. **Scrollbar:** the page's scrollbar is wider and easier to grab, like YouTube's.
7. **Select several:** a **Hide** button shrinks the selection bar into a small "3 selected" pill (tap it to open it again).
8. **Select several:** the selection bar no longer shows on top of Settings, a title's page, a profile or any window.
9. **Search button** (🔍) next to Settings on every page: it opens Browse of the section you're in with the search box
   ready to type in.
10. **Random pick:** add the pick to your list right there (Plan / Watching / Completed / Wanna rewatch).
11. **Random pick:** the dice buttons **1 2 3 4** in the corner roll that many picks at once, each with its own add buttons.
12. **"Series" count** (seasons of the same show count once) is more accurate: seasons are now joined through the
    seasons in between even when those aren't on your list (e.g. season 1 + The Final Season = 1 series), a failed
    lookup is asked again instead of being remembered as "no seasons", and the saved data refreshes every 2 weeks.
13. **Recommendations, related titles and franchise lists** have the same add buttons (Plan / Watching / Completed /
    Wanna rewatch) on every title.
14. **Select several:** after adding the selected titles to a list, they're unselected (they stay on the page), ready for
    the next ones.
15. **18+ stays private:** someone without 18+ access no longer sees 18+ titles anywhere: not on the owner's or a
    friend's list, rankings, stats (numbers are counted without them), squad lists, the feed or profile activity. New
    saves remember that a title is 18+; older saves are checked with AniList once (the answer is kept in the browser).
16. **Profile decorations:** 8 new effects (Autumn leaves, Confetti, Bubbles, Fireflies, Music notes, Matrix code,
    Lightning, Butterflies) and 8 new name styles (Ocean, Sunset, Toxic, Chrome, Vaporwave, Galaxy, Pulse, Retro 3D).
17. **Wanna Rewatch** (anime, movies & TV): a button on a title's page (and in the add buttons above) puts it on its own
    **Wanna Rewatch** list (a filter in Lists, and its own row there). The title keeps its status (Completed…); a title
    that isn't on your list yet goes in as Completed. Starting a rewatch takes it off the list.
18. **MyAnimeList sync:** Settings → Linked accounts → **Connect MyAnimeList**. From then on, every change to your solo
    list (add, status, episodes / chapters, score, rewatches, remove) is copied to your MyAnimeList list too, like AniList
    sync. **Copy my whole list to MyAnimeList** sends everything once. Only anime and manga (MyAnimeList has no games,
    movies or songs), and scores are rounded to whole numbers there. Each friend connects their own MyAnimeList.

**MyAnimeList setup (once, by the owner).** MyAnimeList only lets registered apps change lists, so the site needs its own
free "API client":

1. Sign in on myanimelist.net and open **myanimelist.net/apiconfig** → **Create ID**.
2. Fill it in:
   * **App Type:** `web`
   * **App Redirect URL:** your site's address exactly, e.g. `https://dripslayer1.github.io/anicoop/` (with the `/` at
     the end)
   * **Homepage URL:** the same address
   * **Commercial / Non-Commercial:** Non-Commercial · **Purpose of Use:** hobbyist
   * the name / description / contact fields can be anything (e.g. "anicoop — a list tracker for friends")
3. Agree and **Submit**. Open the new app from the list: it shows a **Client ID** and a **Client Secret**.
4. Supabase → **Edge Functions → Secrets** (Manage secrets) → add two secrets:
   `MAL_CLIENT_ID` = the Client ID, `MAL_CLIENT_SECRET` = the Client Secret. (Keys stay in Supabase only — never in the
   repo.)
5. Done. The Connect MyAnimeList button now works for everyone (after the SQL and the Edge Function update above).

## v10.1 — countdown, header search box, more lists, fixes

**Update:** merge the PR (GitHub Pages updates by itself). **No SQL, no Edge Function change.**

1. **GIFs:** a **Show 30 more** button under the GIFs (scrolling down still loads more too — both need the v10 Edge
   Function).
2. **Tier lists on the Activity page** follow the filter at the top: Games → games or game characters, Manga / Manhwa →
   manga or manga characters, Movies & TV → movies & shows or their characters (with the actors' photos), Songs → songs
   or artists. The filters now sit **above** the post box.
3. (Music with the screen off: can't be done — YouTube only allows that in its Premium app.)
4. **Home:** P1's and P2's dots sit exactly on the ends of the line on every screen size (on wide screens they were off).
5. **Search button:** opens a small search box right in the header. Results from the section you're in appear as you
   type (most popular first, with your status if it's on your list); tap one to open it, **Enter** shows every result.
6. **New lists:** **Wanna Reread** (manga & manhwa) and **Wanna Replay** (games), like Wanna Rewatch.
7. **Rankings on your profile:** tap your score on any title to change it right there.
8. **Fixed:** a title's page showed "–" instead of your score and episodes / chapters. (That bug could also reset them to
   0 when you pressed Save on the title's page — it's gone.)
9. **New list for games: In Rotation** (the games you keep going back to). A game can be In Rotation and Playing / Beaten
   at the same time.
10. **Lists:** a **Genre** filter (the genres of what's on that list, with how many).
11. **Compare lists:** the "Select all / Add to my list" bar follows you down while you scroll.
12. **Compare lists:** tapping a row selects it; only the cover or the name opens the title's page.
13. **Trailers:** a **volume** slider (it remembers your level) and a **⚙ quality** button. YouTube doesn't let websites
    pick the quality anymore, so ⚙ switches to YouTube's own controls at the same moment, where its ⚙ → Quality works
    ("Simple controls" switches back).
14. **Removed** the "series" count (seasons of the same anime counted as one): anime and manga are counted title by title.
15. **Fixed the X buttons** in Settings and in "Squads & more" (and two other windows): they sat half outside the window's
    left edge; now they're in the top-right corner.
16. **Anime countdown:** Anime → **Countdown** (next to History). Trending anime, upcoming anime and every episode airing
    soon, each with a live timer (days / hours / minutes / seconds, in your time zone). **Only my list** shows the ones on
    your lists. On phones the three columns are three tabs.
17. **The + menu** (and the phone's list sheet) has every list of that section: On Hold and Dropped everywhere, plus Wanna
    Rewatch (anime, movies & TV), Wanna Reread (manga & manhwa), Wanna Replay and In Rotation (games).
18. **Settings → Profile decorations:** each one (avatar frame, profile theme, page background, effect, name style,
    badges) is a small row showing what you picked; tap it to open its options.

## v10.3 – v10.5 — my watch link (includes v10.2)

**No SQL, no Edge Function change.** Merge, hard-refresh (Ctrl+Shift+R), the footer says v10.5.

- **v10.2:** in Lists, the Genre filter sits right under "Sort by".
- **My watch link (anime and Movies & TV):** on a title's page, "Add where you watch it" saves any link (Crunchyroll,
  Netflix…) with that title on your list, so it's on every device. **Watch ep N** opens it in a new tab; back on
  anicoop a bar asks how many episodes you watched (1 by default, up to what's left). **Save** counts them like the +1
  button (a rewatch counts on its own counter, the last episode marks it Completed, AniList / MAL sync as usual);
  **Not yet** counts nothing. The question stays until you answer, even after a reload. Manga, games and songs don't
  have it (the owner's choice).
- **v10.4:** on anime and Movies & TV pages the big **Watch** button opens your saved link (and asks how many episodes
  afterwards). No link saved → a message, and the link box opens. The extra "Watch · continue" button is gone on
  computers (phones keep it, their banner button is hidden). Manga keeps Read as before. Anime pages list the
  **official sites** AniList has (Crunchyroll first, then Netflix, HIDIVE…): open one, or tap **Use** to save it as
  your watch link.
- **v10.5:** Browse → **Continue watching** (anime and Movies & TV): tapping a card opens your watch link straight
  away (and asks how many episodes afterwards) instead of the extensions window. The card shows where it opens
  ("▶ crunchyroll.com") or "no link saved"; with no link it opens the title's page with the link box ready.
