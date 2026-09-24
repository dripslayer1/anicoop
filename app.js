/* ==================================================================
   anicoop v6 — app logic (Vue 3 + Supabase + AniList)
   ================================================================== */
const { createApp, ref, shallowRef, reactive, computed, onMounted, watch, nextTick } = Vue;

// The publishable key is safe to expose – security comes from the RLS policies in supabase_setup.sql
const SUPABASE_URL = 'https://trbwiqkgrifeigntvhmh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_15WKt42O2_ilZPZyH9C4eA_5ICg40kN';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ANILIST = 'https://graphql.anilist.co';
const STATUS_ORDER = ['WATCHING', 'PLANNING', 'COMPLETED', 'REPEATING', 'PAUSED', 'DROPPED'];
// an anime you finished and are watching again: each rewatch gets its own episode counter, up to 5 of them
const MAX_REPEATS = 5;
// Labels change with the section (anime: "Watching / Episode", manga: "Reading / Chapter")
const LABEL_SETS = {
    ANIME: { labels: { WATCHING: 'Watching', PLANNING: 'Plan to Watch', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' },
             short: { WATCHING: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' }, ep: 'Episode', short1: 'EP', unit: 'EPS' },
    MANGA: { labels: { WATCHING: 'Reading', PLANNING: 'Plan to Read', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' },
             short: { WATCHING: 'Reading', PLANNING: 'Planning', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' }, ep: 'Chapter', short1: 'CH', unit: 'CH' },
    GAME:  { labels: { WATCHING: 'Playing', PLANNING: 'Plan to Play', COMPLETED: 'Beaten', PAUSED: 'On Hold', DROPPED: 'Dropped' },
             short: { WATCHING: 'Playing', PLANNING: 'Plan to Play', COMPLETED: 'Beaten', PAUSED: 'On Hold', DROPPED: 'Dropped' }, ep: 'Hour', short1: 'HR', unit: 'HRS' },
    TV:    { labels: { WATCHING: 'Watching', PLANNING: 'Plan to Watch', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' },
             short: { WATCHING: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed', PAUSED: 'On Hold', DROPPED: 'Dropped' }, ep: 'Episode', short1: 'EP', unit: 'EPS' },
    SONG:  { labels: { WATCHING: 'In Love', PLANNING: 'Saved', COMPLETED: 'Liked', PAUSED: 'On Hold', DROPPED: 'Disliked' },
             short: { WATCHING: 'In Love', PLANNING: 'Saved', COMPLETED: 'Liked', PAUSED: 'On Hold', DROPPED: 'Disliked' }, ep: 'Play', short1: 'PLAY', unit: 'PLAYS' },
};
Object.values(LABEL_SETS).forEach(set => { set.labels.REPEATING = 'Repeating'; set.short.REPEATING = 'Repeating'; });
const STATUS_LABELS = reactive({ ...LABEL_SETS.ANIME.labels });
const STATUS_SHORT = reactive({ ...LABEL_SETS.ANIME.short });
const UNIT = reactive({ ep: 'Episode', short: 'EP', unit: 'EPS', type: 'ANIME' });
// statuses you can pick: songs are just In Love / Liked / Disliked, and "Repeating" is for anime only
const statusPick = () => STATUS_ORDER.filter(s => !(UNIT.type === 'SONG' && (s === 'PAUSED' || s === 'PLANNING')) && !(s === 'REPEATING' && UNIT.type !== 'ANIME'));
const applyLabels = (type) => {
    const set = LABEL_SETS[type] || LABEL_SETS.ANIME;
    Object.assign(STATUS_LABELS, set.labels); Object.assign(STATUS_SHORT, set.short);
    UNIT.ep = set.ep; UNIT.short = set.short1; UNIT.unit = set.unit; UNIT.type = LABEL_SETS[type] ? type : 'ANIME';
};

// Home hub sections. Anime + Manga come from AniList, Games from IGDB (Twitch), Movies & TV from TMDB,
// Songs from Spotify (charts from Apple Music's public "most played" list). All but AniList go through the proxy.
const SECTIONS = {
    anime:  { id: 'anime',  label: 'Anime', short: 'Anime', type: 'ANIME', live: true, color: '#B490F5', icon: 'fa-dragon',
              blurb: 'Seasonal hits, classics & your squad lists.' },
    manga:  { id: 'manga',  label: 'Manga & Manhwa', short: 'Manga', type: 'MANGA', live: true, color: '#FF4D8D', icon: 'fa-book-open',
              blurb: 'Manga, manhwa & manhua — every chapter.' },
    movies: { id: 'movies', label: 'Movies & TV Shows', short: 'Movies & TV', type: 'TV', live: true, color: '#3b82f6', icon: 'fa-film',
              blurb: 'Films and series for movie night.' },
    games:  { id: 'games',  label: 'Games', short: 'Games', type: 'GAME', live: true, color: '#D4FF3A', icon: 'fa-gamepad',
              blurb: 'Plan to play, now playing & beaten.' },
    songs:  { id: 'songs',  label: 'Songs', short: 'Songs', type: 'SONG', live: true, color: '#1DB954', icon: 'fa-music',
              blurb: 'Songs you love, like & your own playlists.' },
};
const SECTION_OF_TYPE = { ANIME: 'anime', MANGA: 'manga', GAME: 'games', TV: 'movies', SONG: 'songs' };
// short word for a media type, used in sentences ("this game", "plans to play")
const TYPE_WORD = { ANIME: 'anime', MANGA: 'manga', GAME: 'game', TV: 'show', SONG: 'song' };
const typeWord = (t) => TYPE_WORD[t || 'ANIME'] || 'anime';
const isAniListType = (t) => !t || t === 'ANIME' || t === 'MANGA';
// List rows are keyed by (user, media_id), so ids from other sites get their own number range and can
// never clash with an AniList id: games = IGDB id + 1.0e9, movies = TMDB id + 1.2e9, shows = TMDB id + 1.3e9,
// songs = a number made from the Spotify id + 1.5e9 (Spotify ids are text; the real id is kept in the saved data).
const GAME_BASE = 1000000000, MOVIE_BASE = 1200000000, SHOW_BASE = 1300000000, PERSON_BASE = 1400000000, SONG_BASE = 1500000000;
const typeOfId = (id) => id >= SONG_BASE ? 'SONG' : id >= MOVIE_BASE && id < PERSON_BASE ? 'TV' : id >= GAME_BASE && id < MOVIE_BASE ? 'GAME' : null;
const SECTION_LIST = Object.values(SECTIONS);
const ACCENTS = ['#B490F5', '#D4FF3A', '#FF4D8D', '#3b82f6', '#22c55e', '#f59e0b', '#22d3ee', '#f97316'];
const THEME_ACCENTS = ['#D4FF3A', '#B490F5', '#FF4D8D', '#22d3ee', '#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#F5F5F7'];
const STATUS_COLORS = { WATCHING: '#3b82f6', PLANNING: '#f59e0b', COMPLETED: '#22c55e', REPEATING: '#14b8a6', PAUSED: '#a855f7', DROPPED: '#ef4444' };
const RELATION_ORDER = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'OTHER', 'CHARACTER', 'SOURCE', 'ADAPTATION'];

// ---------- helpers ----------
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);  // so "_" in usernames isn't a wildcard
// filters that can hold several values (genres, tags) keep them as "a,b,c" so every "is a filter set?" check still works
const splitMulti = (v) => String(v || '').split(',').filter(Boolean);
const readJSON = (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } };
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
// ---------- your preferences (Settings). Cached in this browser so the theme is right before you log in. ----------
const PREFS_KEY = 'anicoop_prefs';
const defaultPrefs = () => ({
    theme: 'dark', accent: '#D4FF3A', posterSize: 'm', titleLang: 'romaji',
    scoreFormat: 'POINT_10_DECIMAL', listOrder: 'updated', friendsVisibility: 'friends', showOnline: true,
    activity: { enabled: true, progress: true, WATCHING: true, PLANNING: true, COMPLETED: true, REPEATING: true, PAUSED: true, DROPPED: true },
    hiddenGenres: { ANIME: [], MANGA: [], GAME: [], TV: [], SONG: [] },   // genres you never want to see (Browse, Top 100, trending, random)
    extensions: [],                                         // manga reading extensions you installed (Mihon-style)
    players: [],                                            // player links you added (anime, movies & TV): an address with {tmdb} / {episode}… blanks
    sources: [],                                            // website sources you added (Mihon-style extensions: settings only, no code) · kind: manga | anime | tv
    repos: {},                                              // the extension repository you last opened, per section
    reader: { autoMark: true, saver: false, modes: {} },   // reader: mark chapters read at the end, data saver, reading mode per title
});
const mergePrefs = (base, extra) => ({ ...base, ...(extra || {}), activity: { ...base.activity, ...(extra?.activity || {}) }, hiddenGenres: { ...base.hiddenGenres, ...(extra?.hiddenGenres || {}) }, reader: { ...base.reader, ...(extra?.reader || {}) } });
const PREFS = reactive(mergePrefs(defaultPrefs(), readJSON(PREFS_KEY)));
const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null;
    const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const applyTheme = () => {
    const root = document.documentElement;
    root.classList.toggle('theme-light', PREFS.theme === 'light');
    const rgb = hexToRgb(PREFS.accent) || [212, 255, 58];
    root.style.setProperty('--c-volt', rgb.join(' '));
    root.style.setProperty('--c-onvolt', luminance(rgb) > 0.38 ? '10 10 12' : '255 255 255');   // readable text on the accent
    // secondary text (was grey) follows the accent: softer shades of it, nudged until they're readable on this theme
    const light = PREFS.theme === 'light';
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const readable = (c, towards, ok) => { let out = c; for (let t = 0.1; !ok(luminance(out)) && t <= 0.9; t += 0.1) out = mix(c, towards, t); return out; };
    const sub = light ? readable(mix(rgb, [0, 0, 0], 0.45), [0, 0, 0], (l) => l < 0.12) : readable(mix(rgb, [245, 245, 247], 0.18), [255, 255, 255], (l) => l > 0.3);
    const mute = light ? readable(mix(rgb, [70, 70, 80], 0.5), [0, 0, 0], (l) => l < 0.2) : readable(mix(rgb, [14, 14, 18], 0.4), [255, 255, 255], (l) => l > 0.14);
    root.style.setProperty('--c-sub', sub.join(' '));
    root.style.setProperty('--c-mute', mute.join(' '));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PREFS.theme === 'light' ? '#F2F2F6' : '#050507');
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(PREFS)); } catch {}
};
applyTheme();

// Title language: Romaji / English / Native (falls back when a title has no translation)
const titleOf = (a) => {
    const t = a?.title || {};
    const order = PREFS.titleLang === 'english' ? [t.english, t.romaji, t.native] : PREFS.titleLang === 'native' ? [t.native, t.romaji, t.english] : [t.romaji, t.english, t.native];
    return order.find(Boolean) || 'Untitled';
};
const altTitleOf = (a) => {
    const main = titleOf(a); const t = a?.title || {};
    return [t.english, t.romaji, t.native].find(x => x && x !== main) || '';
};

// Scoring systems (scores are stored as 0–10, only the display + input change)
const SCORE_FORMATS = [
    { v: 'POINT_100', l: '100 Point', ex: '55/100' },
    { v: 'POINT_10_DECIMAL', l: '10 Point Decimal', ex: '5.5/10' },
    { v: 'POINT_10', l: '10 Point', ex: '5/10' },
    { v: 'POINT_5', l: '5 Star', ex: '3/5' },
    { v: 'POINT_3', l: '3 Point Smiley', ex: ':)' },
];
const SMILEYS = [{ v: 3.5, icon: 'fa-face-frown', l: ':(' }, { v: 6, icon: 'fa-face-meh', l: ':|' }, { v: 8.5, icon: 'fa-face-smile', l: ':)' }];
const smileyOf = (s) => s >= 7.5 ? SMILEYS[2] : s >= 4.5 ? SMILEYS[1] : SMILEYS[0];
const formatScore = (s) => {
    s = Number(s) || 0; if (s <= 0) return '';
    switch (PREFS.scoreFormat) {
        case 'POINT_100': return String(Math.round(s * 10));
        case 'POINT_10': return String(Math.max(1, Math.round(s)));
        case 'POINT_5': return Math.max(1, Math.round(s / 2)) + '★';
        case 'POINT_3': return smileyOf(s).l;
        default: return String(Math.round(s * 10) / 10);
    }
};
const formatAvg = (avg100) => avg100 ? (PREFS.scoreFormat === 'POINT_100' ? avg100 + '%' : (avg100 / 10).toFixed(1)) : '';
const formatMean = (mean10) => mean10 ? (PREFS.scoreFormat === 'POINT_100' ? String(Math.round(mean10 * 10)) : mean10.toFixed(1)) : '–';

// Episode info for posters: "3/12" while airing, "EP 7" if the total isn't announced, "12 EPS" when finished
const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtRuntime = (min) => min >= 60 ? `${Math.floor(min / 60)}H ${min % 60 ? (min % 60) + 'M' : ''}`.trim() : min + 'M';
const epBadge = (a) => {
    if (!a) return '';
    if ((a.type || 'ANIME') === 'MANGA') { const ch = lastChapterOf(a) || a.episodes; return ch ? 'CH ' + fmtChapter(ch) : ''; }   // latest chapter (MangaDex fills in ongoing ones)
    if (a.type === 'SONG') return a.durationMs ? fmtDuration(a.durationMs) : '';
    if (a.type === 'TV') return a.status === 'NOT_YET_RELEASED' ? 'SOON' : a.format === 'MOVIE' ? (a.runtime ? fmtRuntime(a.runtime) : 'MOVIE') : a.episodes ? a.episodes + ' EPS' : (a.status === 'RELEASING' ? 'AIRING' : 'SERIES');
    if (a.type === 'GAME') return a.priceText || (a.kind === 'DLC' || a.kind === 'Expansion' ? a.kind.toUpperCase() : a.status === 'NOT_YET_RELEASED' ? 'SOON' : a.gameStatus === 'Early access' ? 'EARLY ACCESS' : (a.platforms || []).slice(0, 2).join(' · '));
    if (a.format === 'MOVIE' && (a.episodes || 1) === 1) return 'MOVIE';
    const total = a.episodes || null;
    if (a.status === 'RELEASING') {
        const n = a.nextAiringEpisode;
        const aired = n?.episode ? (n.airingAt && n.airingAt * 1000 < Date.now() ? n.episode : n.episode - 1) : null;
        if (aired != null && total) return `${Math.min(aired, total)}/${total}`;
        if (aired != null) return `EP ${aired}`;
        return total ? `?/${total}` : 'AIRING';
    }
    if (a.status === 'NOT_YET_RELEASED') return 'SOON';
    return total ? `${total} EPS` : '';
};
const POSTER_GRIDS = {
    s: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2.5 md:gap-3',
    m: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-5',
    l: 'grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-5 md:gap-6',
};
const posterGrid = () => POSTER_GRIDS[PREFS.posterSize] || POSTER_GRIDS.m;
const normMedia = (m) => m ? ({ ...m, type: m.type || 'ANIME', episodes: m.episodes ?? m.chapters ?? null }) : m;
// Only store what the lists need (the detail query includes characters/description which bloat storage)
const slimAnime = (a) => ({
    id: a.id, title: { romaji: a.title?.romaji || null, english: a.title?.english || null, native: a.title?.native || null },
    status: a.status || null, seasonYear: a.seasonYear || null, chapters: a.chapters || null,
    nextAiringEpisode: a.nextAiringEpisode?.episode ? { episode: a.nextAiringEpisode.episode, airingAt: a.nextAiringEpisode.airingAt || null } : null,
    coverImage: { large: a.coverImage?.large || null }, bannerImage: a.bannerImage || null,
    episodes: a.episodes || a.chapters || null, averageScore: a.averageScore || null, genres: a.genres || [], format: a.format || null,
    type: a.type || 'ANIME', countryOfOrigin: a.countryOfOrigin || null,
    trailer: a.trailer?.id ? { id: a.trailer.id, site: a.trailer.site } : null,
    ...(a.type === 'TV' ? { extId: a.extId || null, kind: a.kind || null, runtime: a.runtime || null } : {}),
    ...(a.type === 'SONG' ? { extId: a.extId || null, artists: (a.artists || []).slice(0, 4), album: a.album || null, durationMs: a.durationMs || null, explicit: !!a.explicit, previewUrl: a.previewUrl || null, spotifyId: a.spotifyId || null, appleUrl: a.appleUrl || null } : {}),
    ...(a.type === 'GAME' ? { extId: a.extId || null, platforms: (a.platforms || []).slice(0, 8), coop: !!a.coop, kind: a.kind || null, gameStatus: a.gameStatus || null, steamId: a.steamId || null, releaseDate: a.releaseDate || null } : {}),
});
// what a list row saves in media_data: the title's info + your repeat counters
const entryData = (e, anime = e.anime) => ({ ...slimAnime(anime), ...(e.repeats?.length ? { rep: e.repeats.slice(0, MAX_REPEATS) } : {}), ...(e.lilbro ? { lilbro: true } : {}) });
const typeOf = (i) => i?.anime?.type || 'ANIME';
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const timeAgo = (iso) => {
    const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60; if (m < 60) return Math.floor(m) + 'm';
    const h = m / 60; if (h < 24) return Math.floor(h) + 'h';
    const d = h / 24; if (d < 7) return Math.floor(d) + 'd';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const emptyForm = () => ({ anime: null, status: 'PLANNING', score: 0, progress: 0, inSolo: false, squadIds: [], originalSquadIds: [], wasSolo: false });
// rewatch counters (media_data.rep, one number per repeat) and the hidden "lil bro" flag live inside media_data, so they need no new column
const listRow = (r) => ({ anime: normMedia(r.media_data), status: r.status, score: Number(r.score) || 0, progress: r.progress || 0, updatedAt: r.updated_at, createdAt: r.created_at || r.updated_at,
    repeats: Array.isArray(r.media_data?.rep) ? r.media_data.rep.map(n => Math.max(0, Number(n) || 0)).slice(0, MAX_REPEATS) : [], lilbro: !!r.media_data?.lilbro });
// the fields every list/browse query asks AniList for
const MEDIA_FIELDS = 'id type isAdult episodes chapters format status seasonYear countryOfOrigin title { romaji english native } coverImage { large } bannerImage averageScore genres trailer { id site } nextAiringEpisode { episode airingAt }';
const LIST_ORDERS = [
    { v: 'updated', l: 'Last updated' }, { v: 'added', l: 'Last added' }, { v: 'score', l: 'Score' },
    { v: 'title', l: 'Title' }, { v: 'progress', l: 'Progress' }, { v: 'release', l: 'Release year' }, { v: 'average', l: 'Average score' },
];
const sortEntries = (items, order) => {
    const by = {
        updated: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
        added: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
        score: (a, b) => (b.score || 0) - (a.score || 0) || titleOf(a.anime).localeCompare(titleOf(b.anime)),
        title: (a, b) => titleOf(a.anime).localeCompare(titleOf(b.anime)),
        progress: (a, b) => (b.progress || 0) - (a.progress || 0),
        release: (a, b) => (b.anime?.seasonYear || 0) - (a.anime?.seasonYear || 0),
        average: (a, b) => (b.anime?.averageScore || 0) - (a.anime?.averageScore || 0),
    }[order] || null;
    return by ? [...items].sort(by) : items;
};
// MyAnimeList + AniList status names → anicoop
const MAL_STATUS = { 'watching': 'WATCHING', 'reading': 'WATCHING', 'completed': 'COMPLETED', 'on-hold': 'PAUSED', 'dropped': 'DROPPED', 'plan to watch': 'PLANNING', 'plan to read': 'PLANNING', '1': 'WATCHING', '2': 'COMPLETED', '3': 'PAUSED', '4': 'DROPPED', '6': 'PLANNING' };
const ANILIST_STATUS = { CURRENT: 'WATCHING', REPEATING: 'REPEATING', PLANNING: 'PLANNING', COMPLETED: 'COMPLETED', PAUSED: 'PAUSED', DROPPED: 'DROPPED' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// AniList currently returns nothing for manga when a query asks for "isAdult: false". So that filter is taken
// out of every query and 18+ titles are removed from the answer here instead (MEDIA_FIELDS includes isAdult).
const dropAdult = (node) => {
    if (Array.isArray(node)) return node.filter(x => !(x && typeof x === 'object' && x.isAdult === true)).map(dropAdult);
    if (node && typeof node === 'object') for (const k of Object.keys(node)) node[k] = dropAdult(node[k]);
    return node;
};
const BROKEN_KEY = 'anicoop_brokensorts_v1';
const brokenSorts = readJSON(BROKEN_KEY) || {};   // "MANGA|TRENDING_DESC" → { use: 'POPULARITY_DESC', at } (kept across restarts)
const saveBroken = () => { try { localStorage.setItem(BROKEN_KEY, JSON.stringify(brokenSorts)); } catch {} };
const anilistOnce = async (rawQuery, variables) => {
    const noAdult = /isAdult:\s*false/.test(rawQuery);
    const query = noAdult ? rawQuery.replace(/isAdult:\s*false\s*,\s*/g, '').replace(/,\s*isAdult:\s*false/g, '').replace(/\(\s*isAdult:\s*false\s*\)/g, '') : rawQuery;
    // AniList sometimes returns an empty list for some sorts (e.g. trending manga) while others still work:
    // if a list that should have results comes back empty, ask again sorted by popularity, then by score.
    // A sort that failed is remembered for 30 minutes, so the next request goes straight to the working one.
    const sortOf = (/sort:\s*(\[[^\]]*\]|[A-Z_]+)/.exec(query) || [])[1];
    const fallbackable = sortOf && !/search:|id_in|idMal_in/.test(query) && !/type:\s*ANIME/.test(query);
    const bkey = fallbackable ? ((/type:\s*(\w+)/.exec(query) || [])[1] || '') + '|' + sortOf : null;
    const known = bkey && brokenSorts[bkey] && Date.now() - brokenSorts[bkey].at < 30 * 60 * 1000 ? brokenSorts[bkey].use : null;
    let data;
    if (fallbackable && !known) {
        // the broken sorts can also hang ~10 s before answering nothing: if there's no answer after 2.5 s,
        // ask with the fallback sort at the same time and take whichever brings results first
        const alt = /^\[?POPULARITY_DESC/.test(sortOf) ? 'SCORE_DESC' : 'POPULARITY_DESC';   // fall back to popularity unless that's what failed
        const primary = anilistRaw(query, variables).then(d => ({ d }), e => ({ e }));
        const first = await Promise.race([primary, sleep(2500).then(() => null)]);
        if (first?.d?.Page?.media?.length) data = first.d;
        else {
            const d2 = await anilistRaw(query.replace(sortOf, alt), variables).catch(() => null);
            if (d2?.Page?.media?.length) { data = d2; brokenSorts[bkey] = { use: alt, at: Date.now() }; saveBroken(); }
            else { const p = first || await primary; if (p.e) throw p.e; data = p.d; }
        }
    } else data = await anilistRaw(known ? query.replace(sortOf, known) : query, variables);
    return noAdult ? dropAdult(data) : data;
};
const anilistRaw = async (query, variables) => {
    let res;
    try { res = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) }); }
    catch { throw new Error('Could not reach AniList — check your connection and try again.'); }
    if (res.status === 429) throw new Error('AniList rate limit hit – wait a minute and try again.');
    if (!res.ok) throw new Error(`AniList error (${res.status}) – try again.`);
    let json;
    try { json = await res.json(); } catch { throw new Error('AniList sent back something unreadable — try again.'); }
    if (json.errors?.length) throw new Error(json.errors[0].message);
    if (!json.data) throw new Error('AniList returned no data — try again.');
    return json.data;
};
// Request lanes: a few calls at a time, spaced to stay under the API's rate limit. What you're looking at goes in the
// fast lane; background jobs (list checks, alerts, home posters, prefetching) use at most one slot and always wait
// behind it — so opening a section never sits in line behind housekeeping.
const makeLane = ({ concurrent, gap }) => {
    const hi = [], lo = []; let active = 0, activeLow = 0, lastStart = 0, timer = null;
    const pump = () => {
        while (active < concurrent && (hi.length || (lo.length && activeLow < 1))) {
            const wait = lastStart + gap - Date.now();
            if (wait > 0) { if (!timer) timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
            const low = !hi.length; const job = low ? lo.shift() : hi.shift();
            active++; if (low) activeLow++; lastStart = Date.now();
            job.fn().then(job.ok, job.bad).finally(() => { active--; if (low) activeLow--; pump(); });
        }
    };
    return (fn, low = false) => new Promise((ok, bad) => { (low ? lo : hi).push({ fn, ok, bad }); pump(); });
};
// AniList: auto-retry with backoff on the rare 429 instead of surfacing an error / an empty result
const aniLane = makeLane({ concurrent: 2, gap: 120 });
const anilistLow = (query, variables) => anilist(query, variables, { low: true });   // background jobs
const anilist = (query, variables, { low = false } = {}) => aniLane(async () => {
    for (let attempt = 0; ; attempt++) {
        try { return await anilistOnce(query, variables); }
        catch (err) {
            if (attempt < 2 && /rate limit/i.test(err.message || '')) { await sleep(1500 * (attempt + 1)); continue; }
            throw err;
        }
    }
}, low);

/* ------------------------------------------------------------------
   IGDB (Twitch) — data for the Games section.
   Calls go through the "igdb" Supabase Edge Function (supabase/functions/igdb): IGDB blocks
   browsers, and the Twitch Client Secret has to stay on a server, never in this file.
   Game media objects are shaped like AniList ones (title / coverImage / genres …) so the lists,
   posters, rankings and squads all work the same.
   ------------------------------------------------------------------ */
const IGDB_IMG = (id, size = 't_cover_big') => id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : null;
const GAME_GENRES = [
    { v: 31, l: 'Adventure' }, { v: 33, l: 'Arcade' }, { v: 35, l: 'Card & board' }, { v: 4, l: 'Fighting' }, { v: 25, l: 'Hack and slash' },
    { v: 32, l: 'Indie' }, { v: 36, l: 'MOBA' }, { v: 7, l: 'Music' }, { v: 8, l: 'Platform' }, { v: 2, l: 'Point-and-click' },
    { v: 9, l: 'Puzzle' }, { v: 10, l: 'Racing' }, { v: 12, l: 'RPG' }, { v: 11, l: 'RTS' }, { v: 5, l: 'Shooter' },
    { v: 13, l: 'Simulator' }, { v: 14, l: 'Sport' }, { v: 15, l: 'Strategy' }, { v: 24, l: 'Tactical' }, { v: 16, l: 'Turn-based strategy' },
    { v: 34, l: 'Visual novel' },
];
// Tags: IGDB keywords (k), game modes (m) and themes (t) people actually search by
const GAME_TAGS = [
    { v: 'k416', l: 'Roguelike' }, { v: 'k17292', l: 'Roguelite' }, { v: 'k25210', l: 'Gacha' }, { v: 'k286', l: 'Competitive' },
    { v: 'k1655', l: 'Esports' }, { v: 'k546', l: 'PvP' }, { v: 'm6', l: 'Battle royale' }, { v: 'm5', l: 'MMO' },
    { v: 'k17326', l: 'Soulslike' }, { v: 'k477', l: 'Metroidvania' }, { v: 'k38865', l: 'Deckbuilder' }, { v: 'k2385', l: 'Free to play' },
    { v: 't38', l: 'Open world' }, { v: 't33', l: 'Sandbox' }, { v: 't21', l: 'Survival' }, { v: 't19', l: 'Horror' },
    { v: 't23', l: 'Stealth' }, { v: 't1', l: 'Action' }, { v: 't17', l: 'Fantasy' }, { v: 't18', l: 'Sci-fi' },
    { v: 't43', l: 'Mystery' }, { v: 't27', l: 'Comedy' }, { v: 't44', l: 'Romance' }, { v: 't40', l: 'Party' },
    { v: 't22', l: 'Historical' }, { v: 't39', l: 'Warfare' }, { v: 'm4', l: 'Split-screen' },
];
const TAG_FIELD = { k: 'keywords', m: 'game_modes', t: 'themes' };
const TAG_NAMES = new Map(GAME_TAGS.map(t => [t.v, t.l]));
// Platforms are kept to four families (the filter and every game's list): PC, PlayStation, Xbox and Mobile
const GAME_PLATFORMS = [
    { v: 'pc', l: 'PC', ids: [6, 3, 14] }, { v: 'ps', l: 'PlayStation', ids: [48, 167, 9] },
    { v: 'xbox', l: 'Xbox', ids: [49, 169, 12] }, { v: 'mobile', l: 'Mobile', ids: [34, 39] },
];
const PLATFORM_FAMILY = { 6: 'PC', 3: 'PC', 14: 'PC', 7: 'PlayStation', 8: 'PlayStation', 9: 'PlayStation', 48: 'PlayStation', 167: 'PlayStation', 38: 'PlayStation', 46: 'PlayStation',
    11: 'Xbox', 12: 'Xbox', 49: 'Xbox', 169: 'Xbox', 34: 'Mobile', 39: 'Mobile' };
const platformIds = (v) => GAME_PLATFORMS.find(p => p.v === String(v))?.ids || GAME_PLATFORMS.find(p => p.ids.includes(Number(v)))?.ids || [];   // old saved filters used one IGDB id
// a platform (IGDB object, or the short name saved on older list entries) → its family, or nothing (Switch, Stadia, Fire TV…)
const familyOf = (p) => PLATFORM_FAMILY[p?.id] || (typeof p === 'string' ? (/^(pc|win|linux|mac)/i.test(p) ? 'PC' : /^(ps|playstation|psp|vita)/i.test(p) ? 'PlayStation' : /^(x|xbox|xone|series)/i.test(p) ? 'Xbox' : /^(android|ios)/i.test(p) ? 'Mobile' : null) : null);
const platformFamilies = (list) => ['PC', 'PlayStation', 'Xbox', 'Mobile'].filter(f => (list || []).some(p => familyOf(p) === f));
const GAME_SORTS = [
    { v: '', l: 'Popular' }, { v: 'rating_desc', l: 'Rating: high → low' }, { v: 'rating_asc', l: 'Rating: low → high' },
    { v: 'price_asc', l: 'Price: low → high' }, { v: 'price_desc', l: 'Price: high → low' }, { v: 'new', l: 'Newest' },
];
const GENRE_SHORT = { 'Role-playing (RPG)': 'RPG', 'Real Time Strategy (RTS)': 'RTS', 'Turn-based strategy (TBS)': 'Turn-based strategy', "Hack and slash/Beat 'em up": 'Hack and slash', 'Card & Board Game': 'Card & board', 'Visual Novel': 'Visual novel' };
const GAME_SITES = { 1: ['Official site', '#B490F5'], 13: ['Steam', '#1b2838'], 16: ['Epic Games', '#313131'], 17: ['GOG', '#86328a'], 15: ['itch.io', '#fa5c5c'],
    22: ['Xbox', '#107c10'], 23: ['PlayStation', '#0070d1'], 24: ['Nintendo', '#e60012'], 10: ['App Store', '#0a84ff'], 12: ['Google Play', '#01875f'],
    3: ['Wikipedia', '#636466'], 2: ['Wiki', '#636466'], 14: ['Reddit', '#ff4500'], 18: ['Discord', '#5865f2'] };
const GAME_STATUS = { 0: 'Released', 2: 'Alpha', 3: 'Beta', 4: 'Early access', 5: 'Offline', 6: 'Cancelled', 7: 'Rumored', 8: 'Delisted' };
const GAME_KIND = { 1: 'DLC', 2: 'Expansion', 4: 'Standalone expansion', 8: 'Remake', 9: 'Remaster', 10: 'Expanded game' };
const MAIN_TYPES = '(0,4,8,9,10)';        // main games, standalone expansions, remakes, remasters, expanded games
const SEARCH_TYPES = '(0,1,2,4,8,9,10)';  // search also shows DLC + expansions (never editions, bundles, mods, soundtracks)
const ADULT_THEME = 42;                   // IGDB "Erotic" — hidden unless the owner allows 18+ for you
// no Deluxe / Ultimate / Collector's editions (those have a version_parent), no soundtracks or art books
const CLEAN_GAMES = 'version_parent = null & name !~ *"soundtrack"* & name !~ *"artbook"* & name !~ *"art book"*';
const GAME_PAGE = 48;
const GAME_FIELDS = 'name,cover.image_id,first_release_date,total_rating,total_rating_count,genres.name,platforms.abbreviation,game_modes.name,themes.name,videos.video_id,artworks.image_id,screenshots.image_id,game_type,game_status,websites.url,websites.type';
const GAME_REL_FIELDS = (k) => `${k}.name,${k}.cover.image_id,${k}.first_release_date,${k}.game_type`;
const GAME_DETAIL_FIELDS = [GAME_FIELDS, 'summary,storyline,themes.name,platforms.name,player_perspectives.name,url,aggregated_rating,aggregated_rating_count,keywords.name',
    'involved_companies.company.name,involved_companies.developer,involved_companies.publisher,franchises.name,collections.name,franchise',
    'alternative_names.name,videos.name,external_games.uid,external_games.external_game_source',
    ...['similar_games', 'dlcs', 'expansions', 'standalone_expansions', 'remakes', 'remasters', 'parent_game'].map(GAME_REL_FIELDS)].join(',');
const igdbStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const steamIdOf = (g) => {
    const w = (g.websites || []).find(x => x.type === 13 && /\/app\/(\d+)/.test(x.url || ''));
    if (w) return Number(/\/app\/(\d+)/.exec(w.url)[1]);
    const e = (g.external_games || []).find(x => x.external_game_source === 1 && /^\d+$/.test(x.uid || ''));
    return e ? Number(e.uid) : null;
};
const hoursOf = (secs) => secs ? Math.round(secs / 360) / 10 : null;   // seconds → hours, 1 decimal

const normGame = (g) => {
    const d = g.first_release_date ? new Date(g.first_release_date * 1000) : null;
    const vid = (g.videos || []).find(v => v.video_id);
    const bg = g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id;
    return {
        id: GAME_BASE + g.id, extId: g.id, type: 'GAME', format: 'GAME', kind: GAME_KIND[g.game_type] || null,
        title: { romaji: g.name || 'Untitled', english: null, native: null },
        coverImage: { large: IGDB_IMG(g.cover?.image_id) }, bannerImage: IGDB_IMG(bg, 't_1080p'),
        status: !d || d.getTime() > Date.now() ? 'NOT_YET_RELEASED' : 'FINISHED',
        gameStatus: GAME_STATUS[g.game_status] && g.game_status !== 0 ? GAME_STATUS[g.game_status] : null,
        seasonYear: d ? d.getFullYear() : null, releaseDate: d ? d.toISOString() : null,
        episodes: null, chapters: null, countryOfOrigin: null, nextAiringEpisode: null,
        averageScore: g.total_rating ? Math.round(g.total_rating) : null, rating: g.total_rating || null, votes: g.total_rating_count || 0,
        genres: (g.genres || []).map(x => GENRE_SHORT[x.name] || x.name),
        platforms: platformFamilies(g.platforms),
        coop: (g.game_modes || []).some(m => (m?.id ?? m) === 3),
        adult: (g.themes || []).some(t => (t?.id ?? t) === ADULT_THEME),
        steamId: steamIdOf(g),
        trailer: vid ? { id: vid.video_id, site: 'youtube' } : null,
    };
};
// the full game page: story, companies, tags, videos, screenshots, DLC / remakes and similar games
const normGameDetail = (g) => {
    const m = normGame(g);
    const names = (arr) => (arr || []).map(x => x.name).filter(Boolean);
    const companies = (flag) => (g.involved_companies || []).filter(c => c[flag]).map(c => c.company?.name).filter(Boolean);
    const para = (t) => escapeHtml(t).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    const rel = [['PARENT', g.parent_game ? [g.parent_game] : []], ['EXPANSION', [...(g.expansions || []), ...(g.standalone_expansions || [])]],
        ['DLC', g.dlcs], ['REMAKE', g.remakes], ['REMASTER', g.remasters]];
    const alt = [...new Set(names(g.alternative_names).filter(n => n !== g.name && /^[\x20-\x7EÀ-ɏ]+$/.test(n)))];
    // tags: every IGDB theme + game mode, plus the keywords from our tag list (roguelike, gacha, …)
    const kw = new Set((g.keywords || []).map(k => 'k' + k.id));
    const tags = [...new Set([
        ...GAME_TAGS.filter(t => kw.has(t.v)).map(t => t.l),
        ...names(g.themes).filter(n => !/erotic/i.test(n)).map(n => n.replace(/^Science fiction$/, 'Sci-fi').replace(/^4X.*$/, '4X')),
        ...names(g.game_modes),
    ])];
    const rows = [
        m.releaseDate && [m.status === 'NOT_YET_RELEASED' ? 'Releases' : 'Released', new Date(m.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })],
        !m.releaseDate && ['Release', 'To be announced'],
        ['Status', GAME_STATUS[g.game_status] || (m.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Released'), m.gameStatus === 'Early access' || m.status === 'NOT_YET_RELEASED'],
        m.kind && ['Type', m.kind],
        platformFamilies(g.platforms).length && ['Platforms', platformFamilies(g.platforms).join(', ')],
        companies('developer').length && ['Developer', companies('developer').join(', ')],
        companies('publisher').length && ['Publisher', companies('publisher').join(', ')],
        g.player_perspectives?.length && ['Perspective', names(g.player_perspectives).join(', ')],
        (g.franchises?.length || g.collections?.length) && ['Series', [...new Set([...names(g.franchises), ...names(g.collections)])].join(', ')],
        g.total_rating && ['IGDB rating', `${Math.round(g.total_rating)}%` + (g.total_rating_count ? ` · ${g.total_rating_count.toLocaleString()} ratings` : '')],
        g.aggregated_rating && ['Critics', `${Math.round(g.aggregated_rating)}%` + (g.aggregated_rating_count ? ` · ${g.aggregated_rating_count} reviews` : '')],
        alt.length && ['Also known as', alt.slice(0, 3).join(' · ')],
    ].filter(Boolean).map(([k, v, hot]) => ({ k, v, hot: !!hot }));
    const seriesIds = [...(g.franchises || []).map(f => ({ key: 'f' + f.id, field: 'franchises', id: f.id, name: f.name })),
        ...(g.collections || []).map(c => ({ key: 'c' + c.id, field: 'collections', id: c.id, name: c.name }))];
    return {
        ...m,
        description: [g.summary && para(g.summary), g.storyline && '<b>Story</b><br>' + para(g.storyline)].filter(Boolean).join('<br><br>') || null,
        gameInfo: rows, gameTags: tags,
        gameLinks: (g.websites || []).filter(w => GAME_SITES[w.type]).sort((a, b) => Object.keys(GAME_SITES).indexOf(String(a.type)) - Object.keys(GAME_SITES).indexOf(String(b.type)))
            .map(w => ({ id: w.id || w.url, url: w.url, site: GAME_SITES[w.type][0], color: GAME_SITES[w.type][1], type: w.type })),
        screenshots: [...(g.screenshots || []), ...(g.artworks || [])].filter(s => s.image_id).slice(0, 16).map(s => ({ thumb: IGDB_IMG(s.image_id, 't_screenshot_big'), full: IGDB_IMG(s.image_id, 't_1080p') })),
        videos: (g.videos || []).filter(v => v.video_id).slice(0, 12).map(v => ({ id: v.video_id, name: v.name || 'Video' })),
        relations: { edges: rel.flatMap(([relationType, list]) => (list || []).filter(x => x?.id).map(x => ({ relationType, node: normGame(x) }))) },
        dlcIds: [...(g.dlcs || []), ...(g.expansions || []), ...(g.standalone_expansions || [])].map(x => x.id).filter(Boolean),
        similar: (g.similar_games || []).filter(x => x?.cover).slice(0, 12).map(normGame),
        series: seriesIds,
    };
};

const proxyErr = async (error) => {
    const status = error.context?.status; let msg = '';
    try { msg = (await error.context.json())?.error || ''; } catch {}
    if (error.name === 'FunctionsFetchError' || status === 404) return new Error('The Games service isn’t set up yet — deploy the “igdb” Edge Function in Supabase (see README).');
    if (status === 429) return new Error('IGDB rate limit hit – wait a moment and try again.');
    if (status === 401) return new Error('Sign in to browse games.');
    return new Error(msg || error.message || 'Could not reach IGDB — try again.');
};
const igdbOnce = async (endpoint, query) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint, query } });
    if (!error) return Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : []);
    throw await proxyErr(error);
};
// IGDB allows 4 requests a second (and 8 at once): 3 at a time, starts spaced 260 ms apart
const igdbLane = makeLane({ concurrent: 3, gap: 260 });
const igdb = (endpoint, query, { low = false } = {}) => igdbLane(async () => {
    for (let attempt = 0; ; attempt++) {
        try { return await igdbOnce(endpoint, query); }
        catch (err) { if (attempt < 2 && /rate limit/i.test(err.message || '')) { await sleep(1000 * (attempt + 1)); continue; } throw err; }
    }
}, low);
// Steam store data (price, Metacritic, reviews, players) through the same proxy
const steamCountry = () => { const m = /-([A-Z]{2})$/.exec(navigator.language || ''); return (m ? m[1] : 'US').toLowerCase(); };
const steam = async (kind, appids, cc = steamCountry()) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'steam', kind, appids, cc } });
    if (error) throw await proxyErr(error);
    return typeof data === 'string' ? JSON.parse(data) : data;
};
/* ------------------------------------------------------------------
   MangaDex (through the same proxy): latest chapter + publishing status for manga & manhwa,
   and the chapter list / reading sources on a manga page. Results are kept for a day in this browser.
   ------------------------------------------------------------------ */
const MD_KEY = 'anicoop_mangadex_v1';
const MD_TTL = 20 * 3600 * 1000;
const mangaInfo = reactive(readJSON(MD_KEY) || {});   // AniList id → { md, status, last, final, links, langs, at }
const mdQueue = []; const mdPending = new Set(); let mdBusy = false, mdOff = false;
const saveMangaInfo = debounce(() => {
    try { localStorage.setItem(MD_KEY, JSON.stringify(Object.fromEntries(Object.entries(mangaInfo).sort((a, b) => b[1].at - a[1].at).slice(0, 1500)))); } catch {}
}, 2000);
const mangaDex = async (body) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'mangadex', ...body } });
    if (error) { const e = await proxyErr(error); e.status = error.context?.status; throw e; }
    return typeof data === 'string' ? JSON.parse(data) : data;
};
const runMangaQueue = async () => {
    if (mdBusy) return; mdBusy = true;
    while (mdQueue.length && !mdOff) {
        const m = mdQueue.shift();
        try { mangaInfo[m.id] = { ...(await mangaDex({ kind: 'find', alId: m.id, titles: [m.title?.english, m.title?.romaji].filter(Boolean) })), at: Date.now() }; saveMangaInfo(); }
        catch (err) { if (err.status === 400 || err.status === 404 || err.status === 401) mdOff = true; }   // proxy not updated / not signed in: stop for this visit
        mdPending.delete(m.id);
        await sleep(700);   // each lookup is ~3 MangaDex requests; stays under their ~5 req/s limit
    }
    mdBusy = false;
};
// ask for a manga's latest chapter + status (queued, cached); cheap to call for every poster
const needMangaInfo = (m) => {
    if (!m?.id || m.type !== 'MANGA' || mdOff || !navigator.onLine) return;
    const c = mangaInfo[m.id];
    if ((c && Date.now() - c.at < MD_TTL) || mdPending.has(m.id)) return;
    mdPending.add(m.id); mdQueue.push(m); runMangaQueue();
};
/* ------------------------------------------------------------------
   Website sources (Mihon-style extensions).
   A source is a small settings object, never code: the site's address + which template it uses
   (or your own CSS selectors). Pages are fetched through the proxy and read here with DOMParser,
   which never runs the site's scripts — so the site's ads and trackers never load either.
   Selector spec: "css selector" = text, "css@attr|attr2" = first non-empty attribute (made absolute).
   ------------------------------------------------------------------ */
const SOURCE_TEMPLATES = {
    madara: {
        label: 'Madara (WordPress manga sites)',
        search: { url: '{base}/?s={q}&post_type=wp-manga', item: '.c-tabs-item__content, .row.c-tabs-item, .page-item-detail', title: ['.post-title a', 'h3 a', 'a@title'], link: ['.post-title a@href', 'h3 a@href', 'a@href'], cover: 'img@data-src|data-lazy-src|srcset|src' },
        chapters: { item: 'li.wp-manga-chapter', name: 'a', link: 'a@href', date: '.chapter-release-date', ajax: '{manga}ajax/chapters/' },
        pages: { image: '.reading-content img@data-src|data-lazy-src|data-cfsrc|src' },
    },
    mangathemesia: {
        label: 'MangaThemesia (MangaStream-style sites)',
        search: { url: '{base}/?s={q}', item: '.listupd .bs, .listupd .bsx', title: ['.tt', 'a@title'], link: 'a@href', cover: 'img@data-src|data-lazy-src|src' },
        chapters: { item: '#chapterlist li, .eplister li', name: ['.chapternum', 'a'], link: 'a@href', date: '.chapterdate' },
        pages: { image: '#readerarea img@data-src|data-lazy-src|src', script: '"images"\\s*:\\s*(\\[[^\\]]*\\])' },
    },
    generic: { label: 'Generic (smart guess)', search: { url: '{base}/?s={q}' }, chapters: {}, pages: {} },   // everything by the smart fallback
    custom: { label: 'Custom (my own selectors)', search: {}, chapters: {}, pages: {} },
    // ---- video sites (anime, movies & TV). Their "chapters" are episodes and "pages" are the video servers. ----
    animestream: {
        label: 'AnimeStream (WordPress anime sites)', video: true,
        search: { url: '{base}/?s={q}', item: 'div.listupd article, .listupd .bs', title: ['a.tip@title', 'div.tt::own', 'div.ttl::own', '.tt', 'a@title'], link: 'a@href', cover: 'img@data-src|data-lazy-src|srcset|src' },
        chapters: { item: 'div.eplister li, .eplister li', name: ['.epl-title', '.epl-num', 'a'], num: '.epl-num', link: 'a@href', date: '.epl-date' },
        pages: { servers: 'select.mirror option, ul.mirror a' },
    },
    dooplay: {
        label: 'DooPlay (WordPress movie & TV sites)', video: true,
        search: { url: '{base}/?s={q}', item: 'div.result-item, .search-page .result-item', title: ['.title a', 'img@alt'], link: ['.title a@href', 'div.image a@href', 'a@href'], cover: 'img@data-src|data-lazy-src|srcset|src' },
        chapters: { item: 'ul.episodios li', name: ['.episodiotitle a', '.episodiotitle', 'a'], num: '.numerando', link: ['.episodiotitle a@href', 'a@href'], date: '.date' },
        pages: { dooplay: true },
    },
    genericvideo: { label: 'Generic video site (smart guess)', video: true, search: { url: '{base}/?s={q}' }, chapters: {}, pages: {} },
};
// which templates fit a section: manga sites for Manga, video sites for Anime and Movies & TV
const templatesFor = (kind) => Object.fromEntries(Object.entries(SOURCE_TEMPLATES).filter(([k, t]) => k === 'custom' || !!t.video === (kind !== 'manga')));
const MEDIA_KIND = { MANGA: 'manga', ANIME: 'anime', TV: 'tv' };
const KIND_LABEL = { manga: 'Manga & manhwa', anime: 'Anime', tv: 'Movies & TV' };
const srcDef = (s) => {
    const t = SOURCE_TEMPLATES[s?.template] || SOURCE_TEMPLATES.custom; const c = s?.selectors || {};
    return { search: { ...t.search, ...(c.search || {}) }, chapters: { ...t.chapters, ...(c.chapters || {}) }, pages: { ...t.pages, ...(c.pages || {}) } };
};
const siteFetch = async (url, { method = 'GET', referer, form, as = 'text' } = {}) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'fetch', url, method, referer, form, as } });
    if (error) { const e = await proxyErr(error); e.status = error.context?.status; throw e; }
    if (as === 'image') return data;   // Blob
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    // Cloudflare's "checking your browser" page comes back instead of the real one
    if (typeof d?.body === 'string' && /<title>\s*just a moment|cf-chl-|challenge-platform|cf_chl_opt/i.test(d.body.slice(0, 20000))) throw new Error(`${new URL(url).hostname} blocked the request (it may be behind Cloudflare protection).`);
    if (d?.status >= 400) throw new Error(d.status === 403 || d.status === 503 ? `${new URL(url).hostname} blocked the request (it may be behind Cloudflare protection).` : `The site answered ${d.status}.`);
    return d;
};
// ---------- YouTube search: full songs (audio only) and free official episodes play in YouTube's own player ----------
// Asked through the "yt" endpoint of the Edge Function; before that's deployed, the results page is read through "fetch".
const ytTime = (t) => String(t || '').split(':').reduce((a, x) => a * 60 + (parseInt(x, 10) || 0), 0);
const ytWalk = (o, out) => {
    if (!o || typeof o !== 'object' || out.length >= 30) return;
    if (Array.isArray(o)) { for (const x of o) ytWalk(x, out); return; }
    const v = o.videoRenderer;
    if (v?.videoId) {
        const badges = JSON.stringify(v.ownerBadges || []);
        out.push({ id: v.videoId, title: (v.title?.runs || []).map(r => r.text).join(''), channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
            secs: ytTime(v.lengthText?.simpleText), thumb: (v.thumbnail?.thumbnails || []).slice(-1)[0]?.url || '', badge: /OFFICIAL_ARTIST/.test(badges) ? 'artist' : /VERIFIED/.test(badges) ? 'verified' : '' });
        return;
    }
    for (const k in o) ytWalk(o[k], out);
};
const ytCache = new Map();
const ytSearch = async (q) => {
    q = String(q || '').trim(); if (!q) return [];
    if (ytCache.has(q)) return ytCache.get(q);
    let items = null;
    try {
        const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'yt', q } });
        if (!error) { const d = typeof data === 'string' ? JSON.parse(data) : data; if (Array.isArray(d?.items)) items = d.items; }
    } catch {}
    if (!items) {
        const html = (await siteFetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D&hl=en&gl=US`)).body || '';
        const m = /var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s.exec(html);
        if (!m) throw new Error('YouTube search didn’t answer. Try again in a moment.');
        items = []; ytWalk(JSON.parse(m[1]), items);
    }
    if (ytCache.size > 200) ytCache.clear();
    ytCache.set(q, items);
    return items;
};
const htmlDoc = (html, base) => { const d = new DOMParser().parseFromString(html || '', 'text/html'); const b = d.createElement('base'); b.href = base; d.head.prepend(b); return d; };
const absUrl = (v, base) => { try { return new URL(v.trim().split(/\s+/)[0], base).href; } catch { return null; } };
// read one value from an element with a spec (or a list of specs, first hit wins)
// text with a space between each piece, so "Chapter 201" + "6 days ago" doesn't become "Chapter 2016 days ago"
const textOf = (el) => { const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT); const parts = []; let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) parts.push(t); } return parts.join(' '); };
// "sel::own" = only the element's own text (not its children's), e.g. a title box that also holds the latest episode
const URL_ATTR = /^(href|src|srcset|poster|content|data-(src|lazy-src|original|cfsrc|url|link|href|em|embed|video))$/i;
const pick = (root, spec, base) => {
    for (const sp of [].concat(spec || [])) {
        let [sel, attrs] = String(sp).split('@');
        const own = /::own$/.test(sel || ''); if (own) sel = sel.replace(/::own$/, '');
        const el = sel ? root.querySelector(sel) : root; if (!el) continue;
        if (!attrs) {
            const t = (own ? [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ') : textOf(el)).replace(/\s+/g, ' ').trim();
            if (t) return t; continue;
        }
        // links and pictures become full addresses; a title="…" / alt="…" stays text
        for (const a of attrs.split('|')) { const v = el.getAttribute(a); if (v && v.trim() && !/^data:/.test(v.trim())) return URL_ATTR.test(a) ? absUrl(v, base) : v.replace(/\s+/g, ' ').trim(); }
    }
    return null;
};
// Smart fallback: when a template's selectors find nothing, recognise things by their shape instead —
// title links look like /manga/<slug>, chapter links contain "chapter"/"ch-12", and the chapter's pages are
// the biggest group of images on the page. This also powers the "Generic" template.
const MANGA_LINK = /\/(manga|manhwa|manhua|series|serie|comic|comics|webtoon|webtoons|title|titles|book|obra|project)s?\/(?:\d+\/)?[^/?#]+\/?$/i;   // also /manga/123/slug
const CHAPTER_LINK = /(chapter|chapitre|capitulo|cap[-_]|chap[-_]|\bch[-_.]?\d|episode|\bep[-_.]?\d)/i;
// anime / movie / show pages on video sites (episode pages are told apart by CHAPTER_LINK)
const VIDEO_LINK = /\/(anime|animes|watch|series|serie|movie|movies|film|films|tv|tvshows?|shows?|drama|dramas|donghua|ova|title)\/(?:\d+\/)?[^/?#]+\/?$/i;
const JUNK_IMG = /logo|avatar|icon|banner|ads?[-_/]|sprite|loading|spinner|emoji|gravatar|placeholder|flags?\/|\.svg(\?|$)/i;
const imgSrc = (img, base) => pick(img, '@data-src|data-lazy-src|data-original|data-cfsrc|data-url|srcset|src', base);
const guess = {
    search(doc, base, video = false) {
        const origin = new URL(base).origin; const out = new Map(); const LINK = video ? VIDEO_LINK : MANGA_LINK;
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = absUrl(a.getAttribute('href'), base); if (!href || !href.startsWith(origin) || a.closest('nav, header, footer, [class*="menu"], [class*="navbar"]')) return;   // skip site menus
            const path = new URL(href).pathname; if (!LINK.test(path) || (CHAPTER_LINK.test(path) && !(video && /\/(movie|movies|film|films)\//i.test(path)))) return;
            const box = a.closest('article, li, .item, .card, [class*="item"], [class*="card"], div') || a;
            const img = a.querySelector('img') || box.querySelector('img');
            // prefer a real title: the link's title, a heading in the card, the cover's alt text — the link's full text is last (it often includes the latest chapter)
            const heading = box.querySelector('h1, h2, h3, h4, h5, [class*="title"]')?.textContent;
            const title = [a.getAttribute('title'), a.querySelector('h1, h2, h3, h4, h5, [class*="title"]')?.textContent, heading, img?.getAttribute('alt'), a.textContent].map(t => (t || '').replace(/\s+/g, ' ').replace(/\s*(chapter|episode|ch\.)\s*[\d.]+.*$/i, '').trim()).find(t => t.length > 1 && t.length < 150) || '';
            const cur = out.get(href) || { url: href, title: '', cover: null };
            // "One Piece One Piece" (heading + a hidden copy) → "One Piece"
            const once = (t) => { const m = /^(.+?) \1$/.exec(t); return m ? m[1] : t; };
            if (title && !cur.title) cur.title = once(title);
            if (!cur.cover && img) cur.cover = imgSrc(img, base);
            out.set(href, cur);
        });
        return [...out.values()].filter(x => x.title && !/^(read|more|next|prev|home|manga|series|comics?|watch|movies?|tv ?shows?|anime)$/i.test(x.title));
    },
    chapters(doc, mangaUrl, s) {
        const origin = new URL(mangaUrl).origin; const out = new Map();
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = absUrl(a.getAttribute('href'), mangaUrl); if (!href || !href.startsWith(origin) || a.closest('nav, header, footer') || href.replace(/\/$/, '') === mangaUrl.replace(/\/$/, '')) return;
            const text = textOf(a).replace(/\s+/g, ' ').trim();
            if (!CHAPTER_LINK.test(new URL(href).pathname) && !/^(chapter|ch\.?|episode|ep\.?)\s*\d/i.test(text)) return;
            if (/first|last|latest|newest|oldest/i.test(text) && !/\d/.test(text)) return;
            if (out.has(href)) return;
            // the address ("/chapter-201") is the most reliable number; the link text is the fallback
            const ch = chapNo((/(?:chapter|chap|ch|episode|ep)[-_.]?(\d+(?:[-.]\d+)?)/i.exec(new URL(href).pathname) || [])[1]?.replace('-', '.')) || chapNo(text);
            let name = cleanChapterName(text).slice(0, 120);
            const word = isVideoSrc(s) ? 'Episode' : 'Chapter';   // anime / movie sites have episodes
            if (!/\d/.test(name) && ch) name = `${word} ${ch}`;
            out.set(href, { id: href, link: href, ch, title: name || word, at: null, src: s.id, group: s.name, url: null });
        });
        return [...out.values()];
    },
    pages(doc, chapterUrl) {
        // the element holding the most images is the reader
        let best = null, bestN = 0;
        doc.querySelectorAll('div, section, article, main, center').forEach(el => {
            const n = el.querySelectorAll(':scope > img, :scope > * > img, :scope > * > * > img').length;
            if (n > bestN) { best = el; bestN = n; }
        });
        if (!best || bestN < 2) return [];
        return [...best.querySelectorAll('img')].map(img => imgSrc(img, chapterUrl)).filter(u => u && !JUNK_IMG.test(u));
    },
    // video sites: the players on an episode page — iframes, server buttons that carry the player address, <video> tags,
    // and .m3u8 / .mp4 addresses written into the page's scripts
    videos(doc, html, pageUrl) {
        const out = [];
        doc.querySelectorAll('iframe').forEach(f => { const u = f.getAttribute('src') || f.getAttribute('data-src') || f.getAttribute('data-lazy-src'); if (u) out.push({ name: '', url: u }); });
        doc.querySelectorAll('[data-embed], [data-video], [data-em], [data-link], [data-player]').forEach(el => {
            const u = embedFrom(el.getAttribute('data-embed') || el.getAttribute('data-video') || el.getAttribute('data-em') || el.getAttribute('data-link') || el.getAttribute('data-player'), pageUrl);
            if (u) out.push({ name: textOf(el).slice(0, 40), url: u });
        });
        doc.querySelectorAll('video[src], video source[src]').forEach(v => out.push({ name: 'Video', url: v.getAttribute('src') }));
        const text = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
        for (const m of text.matchAll(/https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/gi)) if (!/trailer|preview|thumb|sprite/i.test(m[0])) out.push({ name: /m3u8/i.test(m[0]) ? 'Stream' : 'Video', url: m[0] });
        return out;
    },
    // sites that draw pages with JavaScript still ship the image addresses inside the page's data:
    // take every image URL in the raw HTML and keep the biggest group from the same folder
    pagesFromData(html) {
        const text = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
        const groups = new Map();
        for (const m of text.matchAll(/https?:\/\/[^"'\s<>()\\,]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>\\,]*)?/gi)) {
            const u = m[0]; if (JUNK_IMG.test(u) || /thumb|cover|poster|\/w\d{2,3}\//i.test(u)) continue;
            const dir = u.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '');
            if (!groups.has(dir)) groups.set(dir, []);
            const g = groups.get(dir); if (!g.includes(u)) g.push(u);
        }
        let best = [];
        groups.forEach(g => { if (g.length > best.length) best = g; });
        return best.length >= 3 ? best : [];
    },
};
// "Chapter 1{Pre Release}6 days ago" → "Chapter 1": drop tags, "NEW", dates and "… ago" that sites glue onto names
const cleanChapterName = (t) => String(t || '').replace(/\s+/g, ' ')
    .replace(/\{[^}]*\}/g, ' ').replace(/\s*\d+\s*(sec|second|min|minute|hour|day|week|month|year)s?\s*ago\s*$/i, '')
    .replace(/\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*,?\s*\d{4}\s*$/i, '').replace(/\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s*$/, '')
    .replace(/\s*\d+\s*[smhdwy]\s*ago\s*$/i, '').replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '')
    .replace(/\s*(new|hot|free|up)\s*$/i, '').replace(/^[○●•·\-\s]+/, '').replace(/\s+/g, ' ').trim();
const chapNo = (name) => { const m = /(?:ch(?:apter)?|ep(?:isode)?|#)\.?\s*(\d+(?:\.\d+)?)/i.exec(name || '') || /(\d+(?:\.\d+)?)/.exec(name || ''); return m ? m[1] : null; };
const normTitle = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const isVideoSrc = (s) => s?.id === 'archive' || !!SOURCE_TEMPLATES[s?.template]?.video || s?.kind === 'anime' || s?.kind === 'tv';
const hostName = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Server'; } };
// season + episode number from what a site shows: "S2 E5", "2x5", DooPlay's "2 - 5", "/season-2-episode-5/", "Episode 5", "05"
const epMeta = (c) => {
    let path = ''; try { path = decodeURIComponent(new URL(c.link).pathname); } catch {}
    const texts = [c.num, c.title, path].filter(Boolean).map(String);
    let season = null, ep = null;
    for (const t of texts) {
        const m = /\bs(?:eason)?[-_ .]?(\d{1,2})[-_ .]*e(?:p(?:isode)?)?[-_ .]?(\d{1,4})\b/i.exec(t) || /\b(\d{1,2})\s*[x×]\s*(\d{1,4})\b/.exec(t) || /^\s*(\d{1,2})\s*-\s*(\d{1,4})\s*$/.exec(t);
        if (m) { season = +m[1]; ep = +m[2]; break; }
    }
    if (ep == null) for (const t of texts) { const m = /(?:episode|\bep)[-_ .]?(\d{1,4}(?:\.\d)?)/i.exec(t) || /^\s*(\d{1,4}(?:\.\d)?)\s*$/.exec(t); if (m) { ep = parseFloat(m[1]); break; } }
    if (ep == null) { const n = chapNo(c.num || c.title); if (n) ep = parseFloat(n); }
    const bare = !c.title || /^\s*(?:episode|ep\.?|chapter|ch\.?)?\s*[\d.]+\s*$/i.test(c.title);
    // it's a video site: whatever the site calls them, these are episodes
    const title = bare && ep != null ? `Episode ${ep}` : String(c.title || '').replace(/\bchapters?\b/gi, (w) => /s$/i.test(w) ? 'Episodes' : 'Episode').replace(/\bch\.\s*(?=\d)/gi, 'Ep ');
    return { ...c, season, ep, ch: ep != null ? String(ep) : c.ch, title };
};
// a server button's value can be a link, a bit of HTML, or HTML in base64: find the player address inside
const embedFrom = (raw, base) => {
    raw = String(raw || '').trim(); if (!raw) return null;
    if (/^(https?:)?\/\//i.test(raw)) return absUrl(raw, base);
    let html = raw;
    if (!/[<>]/.test(raw)) { try { html = atob(raw.replace(/\s/g, '')); } catch { return null; } }
    const d = new DOMParser().parseFromString(html, 'text/html');
    const el = d.querySelector('iframe'); const src = el?.getAttribute('src') || el?.getAttribute('data-src') || d.querySelector('[itemprop=embedUrl]')?.getAttribute('content') || d.querySelector('video source, video')?.getAttribute('src');
    if (src) return absUrl(src, base);
    const m = /https?:\/\/[^"'\s<>]+/.exec(html); return m ? m[0] : null;
};
const NOT_PLAYER = /facebook\.com|disqus|googletagmanager|doubleclick|googlesyndication|recaptcha|twitter\.com|x\.com\/|instagram|discord|youtube\.com|youtu\.be|about:blank|\/ads?\//i;
const videoOf = (u, base) => {
    const url = u && absUrl(u, base); if (!url || !/^https?:/i.test(url) || NOT_PLAYER.test(url)) return null;
    return { url, kind: /\.m3u8(\?|$)/i.test(url) ? 'hls' : /\.(mp4|webm|ogv|m4v)(\?|$)/i.test(url) ? 'file' : 'embed' };
};
// Internet Archive: public-domain and freely licensed films & TV, played straight from archive.org
const IA = 'https://archive.org';
const textAny = async (url) => {
    try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {}
    return (await siteFetch(url)).body;
};
const archiveApi = {
    async search(q) {
        const query = `title:(${q.replace(/[():"]/g, ' ')}) AND mediatype:(movies) AND -collection:(trailers)`;
        const j = JSON.parse(await textAny(`${IA}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=year&sort[]=downloads+desc&rows=24&output=json`));
        return (j?.response?.docs || []).map(d => ({ title: String(d.title || d.identifier), year: d.year || null, url: `${IA}/details/${d.identifier}`, cover: `${IA}/services/img/${d.identifier}` }));
    },
    async episodes(url) {
        const id = (/\/details\/([^/?#]+)/.exec(url) || [])[1]; if (!id) return [];
        const j = JSON.parse(await textAny(`${IA}/metadata/${id}`));
        // one file per video: the h.264 / MPEG4 copy, not the small 512kb version or the .ogv
        const best = new Map();
        (j?.files || []).filter(f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name || '')).forEach(f => {
            const key = f.name.replace(/(_512kb)?\.(ia\.)?(mp4|m4v|webm|ogv)$/i, '');
            const rank = /512kb/i.test(f.name) ? 1 : /\.ogv$/i.test(f.name) ? 0 : /\.webm$/i.test(f.name) ? 2 : 3;
            if (!best.has(key) || best.get(key).rank < rank) best.set(key, { f, rank });
        });
        const files = [...best.values()].map(x => x.f).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        // file names are often years or reel numbers, so episodes are simply counted in order
        return files.map((f, n) => ({ id: `${id}/${f.name}`, link: `${IA}/download/${id}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`, ch: String(n + 1), ep: n + 1, season: null,
            title: files.length === 1 ? 'Movie' : (f.title || f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')), movie: files.length === 1, src: 'archive', group: 'Internet Archive', url: null }));
    },
    async videos(link) { return [{ name: 'Internet Archive', ...videoOf(link, IA) }]; },
};
const sourceApi = {
    async search(s, q) {
        const def = srcDef(s).search; const base = s.baseUrl.replace(/\/+$/, '');
        // Generic sites: find which search address the site uses (?s=, /search?q=, …) and remember it on the source
        if (s.id === 'archive') return archiveApi.search(q);
        const video = isVideoSrc(s);
        if ((s.template === 'generic' || s.template === 'genericvideo') && !s.selectors?.search?.url) {
            const run = async (p) => {
                try { return guess.search(htmlDoc((await siteFetch(p.replace('{base}', base).replace('{q}', encodeURIComponent(q)))).body, base + '/'), base + '/', video).filter((x, n, all) => all.findIndex(y => y.url === x.url) === n); }
                catch { return null; }
            };
            const want = normTitle(q).split(' ').filter(w => w.length > 2);
            const score = (list) => (list || []).filter(x => want.every(w => normTitle(x.title).includes(w))).length / Math.max(3, (list || []).length);
            const matches = (x) => want.every(w => normTitle(x.title).includes(w));
            const byMatch = (list) => [...list.filter(matches), ...list.filter(x => !matches(x))];   // titles matching what you typed first
            if (s.searchUrl) { const list = await run(s.searchUrl); if (list?.length) return byMatch(list).slice(0, 20); }   // known address
            // otherwise try the usual search addresses and keep the one whose results match what you typed best
            // (a homepage that happens to show the title scores low: most of its results don't match)
            let best = null, bestScore = -1;
            for (const p of ['{base}/?s={q}', '{base}/search?q={q}', '{base}/search?keyword={q}', '{base}/search?title={q}', '{base}/search?query={q}', '{base}/search?name={q}', '{base}/?search={q}', '{base}/search/{q}']) {
                const list = await run(p); if (!list?.length) continue;
                const sc = score(list);
                if (sc > bestScore) { best = { p, list }; bestScore = sc; }
                if (sc >= 0.5) break;   // clearly a real search page
            }
            if (best && bestScore > 0) s.searchUrl = best.p;
            return byMatch(best?.list || []).slice(0, 20);
        }
        const url = (def.url || '{base}/?s={q}').replace('{base}', base).replace('{q}', encodeURIComponent(q));
        const doc = htmlDoc((await siteFetch(url)).body, base + '/');
        let list = def.item ? [...doc.querySelectorAll(def.item)].map(el => ({ title: pick(el, def.title, base), url: pick(el, def.link, base), cover: pick(el, def.cover, base) })) : [];
        list = list.filter(x => x.title && x.url);
        if (!list.length) list = guess.search(doc, base + '/', video);   // layout differs from the template → smart fallback
        return list.filter((x, n, all) => all.findIndex(y => y.url === x.url) === n).slice(0, 20);   // nested cards can match twice
    },
    async chapters(s, mangaUrl) {
        if (s.id === 'archive') return archiveApi.episodes(mangaUrl);
        const def = srcDef(s).chapters; const base = s.baseUrl.replace(/\/+$/, '');
        const read = (doc) => def.item ? [...doc.querySelectorAll(def.item)].map(el => {
            const name = cleanChapterName(pick(el, def.name, base)); const link = pick(el, def.link, base);
            return link ? { id: link, link, ch: chapNo(name), title: name, num: def.num ? pick(el, def.num, base) : null, at: def.date ? pick(el, def.date, base) : null, src: s.id, group: s.name, url: null } : null;
        }).filter(Boolean) : [];
        const page = htmlDoc((await siteFetch(mangaUrl)).body, mangaUrl);
        let list = read(page);
        // newer Madara sites load the chapter list separately
        if (!list.length && def.ajax) {
            try { list = read(htmlDoc((await siteFetch(def.ajax.replace('{manga}', mangaUrl.replace(/\/?$/, '/')).replace('{base}', base), { method: 'POST', referer: mangaUrl })).body, mangaUrl)); } catch {}
        }
        if (!list.length) list = guess.chapters(page, mangaUrl, s);
        const seen = new Set();
        list = list.filter(c => !seen.has(c.link) && seen.add(c.link));
        if (!isVideoSrc(s)) return list;
        // video sites: episodes in order (season, then episode). A page with no episode list is a movie: the page itself plays.
        list = list.map(epMeta).sort((a, b) => (a.season || 0) - (b.season || 0) || (a.ep ?? 1e6) - (b.ep ?? 1e6));
        return list.length ? list : [{ id: mangaUrl, link: mangaUrl, ch: '1', ep: 1, season: null, title: 'Movie', movie: true, src: s.id, group: s.name, url: null }];
    },
    // video servers for one episode: [{ name, url, kind: 'embed' | 'hls' | 'file' }]
    async videos(s, epUrl) {
        if (s.id === 'archive') return archiveApi.videos(epUrl);
        const def = srcDef(s).pages; const base = s.baseUrl.replace(/\/+$/, '');
        const html = (await siteFetch(epUrl, { referer: s.baseUrl })).body;
        const doc = htmlDoc(html, epUrl);
        const out = [];
        const add = (name, u) => { const v = videoOf(u, epUrl); if (v && !out.some(o => o.url === v.url)) out.push({ ...v, name: (name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || hostName(v.url) }); };
        if (def.servers) doc.querySelectorAll(def.servers).forEach(el => add(textOf(el), embedFrom(el.getAttribute('value') || el.getAttribute('data-em') || el.getAttribute('data-src') || '', epUrl)));
        if (def.dooplay) {
            // DooPlay asks the site for each server's player: the newer JSON address first, the older admin-ajax call if that fails
            const opts = [...doc.querySelectorAll('li.dooplay_player_option[data-post], #playeroptionsul li[data-post]')].filter(li => li.getAttribute('data-nume') !== 'trailer').slice(0, 8);
            const found = await Promise.all(opts.map(async (li) => {
                const [post, type, nume] = ['data-post', 'data-type', 'data-nume'].map(a => encodeURIComponent(li.getAttribute(a) || ''));
                const embed = (d) => { try { return embedFrom(JSON.parse(d.body).embed_url, epUrl); } catch { return null; } };
                let u = null;
                try { u = embed(await siteFetch(`${base}/wp-json/dooplayer/v2/${post}/${type}/${nume}`, { referer: epUrl })); } catch {}
                if (!u) { try { u = embed(await siteFetch(`${base}/wp-admin/admin-ajax.php`, { method: 'POST', referer: epUrl, form: `action=doo_player_ajax&post=${post}&nume=${nume}&type=${type}` })); } catch {} }
                return u ? [textOf(li.querySelector('.title') || li), u] : null;
            }));
            found.filter(Boolean).forEach(([n, u]) => add(n, u));
        }
        if (!out.length) guess.videos(doc, html, epUrl).forEach(v => add(v.name, v.url));
        return out;
    },
    async pages(s, chapterUrl) {
        const def = srcDef(s).pages;
        const html = (await siteFetch(chapterUrl, { referer: s.baseUrl })).body;
        const doc = htmlDoc(html, chapterUrl);
        let urls = [];
        if (def.script) { const m = new RegExp(def.script).exec(html); if (m) { try { urls = JSON.parse(m[1]).map(u => absUrl(String(u), chapterUrl)).filter(Boolean); } catch {} } }
        if (!urls.length && def.image) {
            const [sel, attrs] = String(def.image).split('@');
            urls = [...doc.querySelectorAll(sel)].map(el => pick(el, '@' + (attrs || 'src'), chapterUrl)).filter(u => u && !JUNK_IMG.test(u));
        }
        if (urls.length <= 1) { const g = guess.pages(doc, chapterUrl); if (g.length > urls.length) urls = g; }
        if (urls.length <= 1) { const g = guess.pagesFromData(html); if (g.length > urls.length) urls = g; }
        return [...new Set(urls)];
    },
};
// ---- finding one title on a source: its own names first, then its "Also known as" names ----
// names written into a description: "Also known as: X, Y", "a.k.a. X", "Alternative titles: X / Y"
const akaFromDesc = (html) => {
    const t = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
    const m = /(?:also known as|a\.k\.a\.?|aka|alternative (?:titles?|names?)|other names?)\s*[:\-–]?\s*([^\n.]{2,200})/i.exec(t);
    return m ? m[1].split(/[,;/|]|\bor\b/).map(x => x.replace(/["“”‘’()]/g, '').trim()).filter(x => x.length > 1 && x.length < 120) : [];
};
const namesOf = (a) => [...new Set([a?.title?.english, a?.title?.romaji, a?.title?.native, ...(a?.synonyms || []), ...akaFromDesc(a?.description)].filter(Boolean).map(String))];
// same title, ignoring punctuation, "The", "Season 2" / "(TV)" style tails and the word "manga"/"anime"
const SAME_STRIP = /\b(the|a|tv|official|manga|manhwa|manhua|webtoon|comic|comics|anime|series|movie|film|uncensored|dub|dubbed|sub|subbed|english)\b/g;
const sameTitle = (a, b) => {
    const x = normTitle(a), y = normTitle(b); if (!x || !y) return false;
    if (x === y) return true;
    const strip = (t) => t.replace(SAME_STRIP, ' ').replace(/\s+/g, ' ').trim();
    const sx = strip(x), sy = strip(y);
    return sx.length > 2 && sx === sy;
};
// alternative names a site prints on the title's own page ("Alternative", "Also known as", "Other names", …)
const ALT_LABEL = /^(alternative(?: titles?| names?)?|alt(?:ernative)?\.? ?names?|also known as|other names?|synonyms?|associated names?|aka)\s*:?$/i;
const altNamesOn = async (s, url) => {
    const doc = htmlDoc((await siteFetch(url)).body, url); const out = [];
    const split = (t) => String(t || '').split(/[,;/|\n]|\s•\s/).map(x => x.trim()).filter(x => x.length > 1 && x.length < 120);
    doc.querySelectorAll('.alter, .alternative, .alternate, [class*="alt-name"], [class*="alternative"]').forEach(el => out.push(...split(textOf(el).replace(/^[^:]{0,30}:\s*/, ''))));
    doc.querySelectorAll('h5, h4, b, strong, span, dt, th, td, div, label').forEach(el => {
        if (el.children.length > 1 || !ALT_LABEL.test(textOf(el).trim())) return;
        const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
        if (next) out.push(...split(textOf(next)));
    });
    return [...new Set(out)].slice(0, 30);
};
// → { match, results }: match is null when the source doesn't have the title under any of its names
const findTitleOn = async (s, a, { deep = true } = {}) => {
    const names = namesOf(a); const tried = new Set(); let first = null;
    for (const n of names.slice(0, 7)) {
        const key = normTitle(n); if (key.length < 2 || tried.has(key)) continue;
        let results;
        try { results = await sourceApi.search(s, n); }
        catch (err) { if (!tried.size) throw err; continue; }   // the very first search failing = the site itself doesn't work
        tried.add(key);
        if (!first) first = results;
        const hit = results.find(r => names.some(x => sameTitle(r.title, x)));
        if (hit) return { match: hit, results };
    }
    // not listed under any of its names: the site may use another one, so check the top results' own "Alternative names"
    if (deep) for (const r of (first || []).slice(0, 3)) {
        try { const alts = await altNamesOn(s, r.url); if (alts.some(x => names.some(y => sameTitle(x, y)))) return { match: r, results: first }; } catch {}
    }
    return { match: null, results: first || [] };
};
// posters only ask once they're (nearly) on screen
const mdSeen = new IntersectionObserver((list) => list.forEach(e => { if (e.isIntersecting) { mdSeen.unobserve(e.target); needMangaInfo(e.target._manga); } }), { rootMargin: '400px 0px' });
const MANGA_STATUS = { RELEASING: ['Ongoing', '#22c55e'], FINISHED: ['Completed', '#3b82f6'], HIATUS: ['Hiatus', '#f59e0b'], CANCELLED: ['Cancelled', '#ef4444'], NOT_YET_RELEASED: ['Upcoming', '#a855f7'] };
const MD_STATUS = { ongoing: 'RELEASING', completed: 'FINISHED', hiatus: 'HIATUS', cancelled: 'CANCELLED' };
// AniList knows hiatus/cancelled too, but MangaDex is often more up to date — the "stopped" states win
const mangaStatusOf = (a) => {
    if (!a || a.type !== 'MANGA') return null;
    const md = MD_STATUS[mangaInfo[a.id]?.status];
    const s = (md === 'HIATUS' || md === 'CANCELLED') && a.status !== 'FINISHED' ? md : (a.status || md);
    const v = MANGA_STATUS[s]; return v ? { key: s, label: v[0], color: v[1] } : null;
};
const lastChapterOf = (a) => a?.chapters || mangaInfo[a?.id]?.last || null;
const fmtChapter = (n) => n == null ? '?' : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

// o = { adult: 18+ allowed + switched on, hidden: [genre ids you filtered out site-wide] }
const gameWhere = (f, o = {}) => {
    const w = ['cover != null', CLEAN_GAMES];
    w.push(o.adult ? `themes = (${ADULT_THEME})` : `themes != (${ADULT_THEME})`);
    if (o.hidden?.length) w.push(`genres != (${o.hidden.map(Number).join(',')})`);
    if (f.genre) w.push(`genres = [${splitMulti(f.genre).map(g => parseInt(g, 10)).join(',')}]`);   // [..] = has all of them
    if (f.platform && platformIds(f.platform).length) w.push(`platforms = (${platformIds(f.platform).join(',')})`);   // any console of that family
    splitMulti(f.tag).forEach(t => { if (TAG_FIELD[t[0]]) w.push(`${TAG_FIELD[t[0]]} = (${parseInt(t.slice(1), 10)})`); });
    if (f.year) { const y = parseInt(f.year, 10); w.push(`first_release_date >= ${Date.UTC(y, 0, 1) / 1000} & first_release_date < ${Date.UTC(y + 1, 0, 1) / 1000}`); }
    const now = Math.floor(Date.now() / 1000);
    if (f.status === 'FINISHED') w.push(`first_release_date <= ${now}`);
    if (f.status === 'NOT_YET_RELEASED') w.push(`first_release_date > ${now}`);
    if (f.status === 'EARLY') w.push('game_status = 4');
    if (f.coop) w.push('game_modes = (3)');
    return w.join(' & ');
};
// search: base games first, then their DLC / expansions
const mainFirst = (rows) => rows.map((g, n) => ({ g, n })).sort((a, b) => ((a.g.game_type === 1 || a.g.game_type === 2) - (b.g.game_type === 1 || b.g.game_type === 2)) || a.n - b.n).map(x => x.g);
let popularOneTrip = true;   // turned off if the deployed proxy doesn't know "popular_games" yet
const gameApi = {
    // Browse: search, filters, sorting, or (nothing set) what people are playing right now
    async browse(f, page = 1, o = {}, { low = false } = {}) {
        const offset = (page - 1) * GAME_PAGE;
        const q = (f.search || '').trim();
        const where = gameWhere(f, o);
        if (q) {
            const rows = await igdb('games', `search "${igdbStr(q)}"; fields ${GAME_FIELDS}; where ${where} & game_type = ${SEARCH_TYPES}; limit ${GAME_PAGE}; offset ${offset};`, { low });
            return { items: mainFirst(rows).map(normGame), hasNextPage: rows.length === GAME_PAGE };
        }
        const sorted = f.sort === 'rating_desc' || f.sort === 'rating_asc' || f.sort === 'new';
        if (!(f.genre || f.platform || f.year || f.status || f.coop || f.tag || sorted || o.adult)) {
            // newer proxy: popularity list + game details in a single round trip
            if (popularOneTrip) {
                try {
                    const d = await igdbLane(async () => {
                        const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'popular_games', limit: GAME_PAGE, offset, fields: GAME_FIELDS, where } });
                        if (error) { const e = await proxyErr(error); e.status = error.context?.status; throw e; }
                        return typeof data === 'string' ? JSON.parse(data) : data;
                    }, low);
                    const order = new Map((d.ids || []).map((id, k) => [id, k]));
                    return { items: (d.games || []).sort((a, b) => order.get(a.id) - order.get(b.id)).map(normGame), hasNextPage: !!d.full };
                } catch (err) { if (err.status !== 400) throw err; popularOneTrip = false; }   // older proxy: use two calls
            }
            const pops = await igdb('popularity_primitives', `fields game_id; where popularity_type = 3; sort value desc; limit ${GAME_PAGE}; offset ${offset};`, { low });
            const ids = pops.map(p => p.game_id).filter(Boolean);
            if (!ids.length) return { items: [], hasNextPage: false };
            const rows = await igdb('games', `fields ${GAME_FIELDS}; where id = (${ids.join(',')}) & ${where}; limit ${GAME_PAGE};`, { low });
            const order = new Map(ids.map((id, k) => [id, k]));
            return { items: rows.sort((a, b) => order.get(a.id) - order.get(b.id)).map(normGame), hasNextPage: pops.length === GAME_PAGE };
        }
        // rating sorts only count games with enough ratings, so 3 perfect votes don't top the list
        const sort = f.sort === 'rating_desc' ? 'total_rating desc' : f.sort === 'rating_asc' ? 'total_rating asc' : f.sort === 'new' ? 'first_release_date desc'
            : f.status === 'NOT_YET_RELEASED' ? 'hypes desc' : 'total_rating_count desc';
        const extra = f.sort?.startsWith('rating') ? ' & total_rating_count >= 150' : f.sort === 'new' ? ` & first_release_date <= ${Math.floor(Date.now() / 1000)}` : '';
        const rows = await igdb('games', `fields ${GAME_FIELDS}; where ${where} & game_type = ${MAIN_TYPES}${extra}; sort ${sort}; limit ${GAME_PAGE}; offset ${offset};`, { low });
        return { items: rows.map(normGame), hasNextPage: rows.length === GAME_PAGE };
    },
    // Browse's front page, organised in rows (all asked at once): what's new, what's coming, the best, co-op
    async shelves(o = {}) {
        const where = gameWhere({}, o), now = Math.floor(Date.now() / 1000), day = 86400;
        const q = (extra, sort, limit = 18) => igdb('games', `fields ${GAME_FIELDS}; where ${where} & game_type = ${MAIN_TYPES} & ${extra}; sort ${sort}; limit ${limit};`, { low: true }).then(r => r.map(normGame)).catch(() => []);
        const [fresh, soon, best, coop] = await Promise.all([
            q(`first_release_date >= ${now - 120 * day} & first_release_date <= ${now} & total_rating_count >= 5`, 'total_rating_count desc'),
            q(`first_release_date > ${now} & first_release_date < ${now + 365 * day} & hypes > 5`, 'hypes desc'),
            q('total_rating_count >= 1500 & total_rating >= 86', 'total_rating desc'),
            q(`game_modes = (3) & total_rating_count >= 60 & first_release_date >= ${now - 6 * 365 * day}`, 'total_rating_count desc'),
        ]);
        return { fresh, soon: soon.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate)), best, coop };
    },
    async search(q, limit = 8) {
        const rows = await igdb('games', `search "${igdbStr(q)}"; fields ${GAME_FIELDS}; where cover != null & ${CLEAN_GAMES} & themes != (${ADULT_THEME}) & game_type = ${SEARCH_TYPES}; limit ${limit};`);
        return mainFirst(rows).map(normGame);
    },
    async details(id) {
        const rows = await igdb('games', `fields ${GAME_DETAIL_FIELDS}; where id = ${parseInt(id - GAME_BASE, 10)};`);
        return rows[0] ? normGameDetail(rows[0]) : null;
    },
    // how long it takes to beat (IGDB community times, in seconds → hours)
    async timeToBeat(ids) {
        if (!ids.length) return new Map();
        const rows = await igdb('game_time_to_beats', `fields game_id,hastily,normally,completely,count; where game_id = (${ids.join(',')}); limit 500;`);
        return new Map(rows.map(r => [r.game_id, r]));
    },
    // every main game in the same franchise / series, oldest first, with time to beat (incl. each game's DLC)
    async series(s, adult) {
        const rows = await igdb('games', `fields name,cover.image_id,first_release_date,total_rating,total_rating_count,platforms.abbreviation,genres.name,game_type,dlcs,expansions,standalone_expansions,themes;
            where ${s.field} = (${s.id}) & ${CLEAN_GAMES} & game_type = ${MAIN_TYPES}${adult ? '' : ` & themes != (${ADULT_THEME})`}; sort first_release_date asc; limit 200;`);
        const dlcOf = (g) => [...(g.dlcs || []), ...(g.expansions || []), ...(g.standalone_expansions || [])];
        const ttb = await gameApi.timeToBeat([...new Set(rows.flatMap(g => [g.id, ...dlcOf(g)]))].slice(0, 450)).catch(() => new Map());   // still list the games if play times fail
        return rows.map(g => {
            const t = ttb.get(g.id) || {};
            const dlc = dlcOf(g).reduce((n, id) => n + (ttb.get(id)?.completely || 0), 0);
            return { ...normGame(g), hours: { story: hoursOf(t.hastily), sides: hoursOf(t.normally), full: hoursOf(t.completely), fullDlc: t.completely ? hoursOf(t.completely + dlc) : null } };
        });
    },
    async characters(id) {
        const rows = await igdb('characters', `fields name,mug_shot.image_id,description; where games = (${parseInt(id - GAME_BASE, 10)}); limit 40;`);
        return rows.filter(c => c.name).map(c => ({ id: GAME_BASE + c.id, name: { full: c.name }, image: { large: IGDB_IMG(c.mug_shot?.image_id, 't_cover_big') }, section: 'GAME', gameId: id }));
    },
    // a random well-known game (for Random pick with no filters)
    async random(o = {}) {
        const rows = await igdb('games', `fields ${GAME_FIELDS}; where total_rating_count > 40 & ${gameWhere({}, o)} & game_type = ${MAIN_TYPES}; sort total_rating_count desc; limit 1; offset ${Math.floor(Math.random() * 1500)};`);
        return rows[0] ? normGame(rows[0]) : null;
    },
    // leaderboard pool: well-rated games with enough ratings, best first (re-ranked by weighted score on our side)
    async top(page, o = {}) {
        const rows = await igdb('games', `fields ${GAME_FIELDS}; where total_rating_count >= 25 & ${gameWhere({}, o)} & game_type = ${MAIN_TYPES}; sort total_rating desc; limit 200; offset ${page * 200};`);
        return { items: rows.map(normGame), done: rows.length < 200 };
    },
    // daily check of the games on your lists (release date, early access → released, …)
    async refresh(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200).map(id => id - GAME_BASE);
            out.push(...(await igdb('games', `fields ${GAME_FIELDS}; where id = (${chunk.join(',')}); limit 200;`, { low: true })).map(normGame));
        }
        return out;
    },
};
/* ------------------------------------------------------------------
   TMDB — the Movies & TV section (through the proxy; the token stays on the server).
   Movies and shows are both media type 'TV' (format 'MOVIE' or 'TV'), so lists, squads and stats treat them as one section.
   ------------------------------------------------------------------ */
const TMDB_IMG = (p, size = 'w500') => p ? `https://image.tmdb.org/t/p/${size}${p}` : null;
const TMDB_GENRE_NAMES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-fi', 10770: 'TV movie', 53: 'Thriller',
    10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-fi & Fantasy', 10766: 'Soap',
    10767: 'Talk', 10768: 'War & Politics' };
// one genre list for both: each maps to TMDB's movie genre and its TV genre (null = that kind has no such genre)
const TV_GENRES = [
    { v: 'action', l: 'Action', movie: 28, tv: 10759 }, { v: 'adventure', l: 'Adventure', movie: 12, tv: 10759 }, { v: 'animation', l: 'Animation', movie: 16, tv: 16 },
    { v: 'comedy', l: 'Comedy', movie: 35, tv: 35 }, { v: 'crime', l: 'Crime', movie: 80, tv: 80 }, { v: 'documentary', l: 'Documentary', movie: 99, tv: 99 },
    { v: 'drama', l: 'Drama', movie: 18, tv: 18 }, { v: 'family', l: 'Family', movie: 10751, tv: 10751 }, { v: 'fantasy', l: 'Fantasy', movie: 14, tv: 10765 },
    { v: 'history', l: 'History', movie: 36, tv: null }, { v: 'horror', l: 'Horror', movie: 27, tv: null }, { v: 'kids', l: 'Kids', movie: null, tv: 10762 },
    { v: 'music', l: 'Music', movie: 10402, tv: null }, { v: 'mystery', l: 'Mystery', movie: 9648, tv: 9648 }, { v: 'reality', l: 'Reality', movie: null, tv: 10764 },
    { v: 'romance', l: 'Romance', movie: 10749, tv: null }, { v: 'scifi', l: 'Sci-fi', movie: 878, tv: 10765 }, { v: 'thriller', l: 'Thriller', movie: 53, tv: null },
    { v: 'war', l: 'War', movie: 10752, tv: 10768 }, { v: 'western', l: 'Western', movie: 37, tv: 37 },
];
// Movies & TV tags. Regions: "o:KR" = made in that country (several: "o:SE|DK"), "l:hi" = original language.
// Themes: TMDB keyword ids.
const TV_REGION_TAGS = [['o:KR', 'K-drama (Korean)'], ['o:CN', 'C-drama (Chinese)'], ['o:JP', 'J-drama (Japanese live action)'], ['o:TW', 'Taiwanese'],
    ['o:TH', 'Thai'], ['o:TR', 'Turkish drama'], ['l:hi', 'Bollywood (Hindi)'], ['o:IN', 'Indian'], ['o:GB', 'British'], ['l:es', 'Spanish-language'],
    ['o:SE|DK|NO|FI|IS', 'Nordic noir'], ['o:FR', 'French'], ['o:DE', 'German'], ['o:PH', 'Filipino'], ['o:EG|SA|AE|LB|SY|JO', 'Arabic']].map(([v, l]) => ({ v, l }));
const TV_THEME_TAGS = [[818, 'Based on a book'], [9717, 'Based on a comic'], [9672, 'Based on a true story'], [41645, 'Based on a video game'], [9715, 'Superhero'], [4379, 'Time travel'],
    [4458, 'Post-apocalyptic'], [4565, 'Dystopia'], [12377, 'Zombies'], [3133, 'Vampires'], [1299, 'Monsters'], [9951, 'Aliens'], [12554, 'Dragons'],
    [2343, 'Magic'], [33465, 'Parallel world'], [9882, 'Space'], [12190, 'Cyberpunk'], [10714, 'Serial killer'], [703, 'Detective'], [10051, 'Heist'],
    [9748, 'Revenge'], [10349, 'Survival'], [779, 'Martial arts'], [10683, 'Coming of age'], [6270, 'High school'], [12565, 'Psychological thriller'],
    [10123, 'Dark comedy'], [193171, 'Sitcom'], [11800, 'Mockumentary'], [163053, 'Found footage'], [11162, 'Miniseries'], [9706, 'Anthology'],
    [222517, 'Legal drama'], [208788, 'Medical drama'], [383992, 'Romantic comedy'], [128, 'Love triangle'], [282986, 'Enemies to lovers'], [318482, 'Chaebol (rich heirs)'],
    [12339, 'Slasher'], [470, 'Spy'], [10391, 'Mafia'], [3149, 'Gangster'], [378, 'Prison'], [33519, 'Courtroom'], [3358, 'Haunted house'], [162846, 'Ghosts'],
    [15001, 'Demons'], [616, 'Witches'], [12564, 'Werewolves'], [161791, 'Kaiju'], [14544, 'Robots'], [10854, 'Time loop'], [10410, 'Conspiracy'], [782, 'Assassin'],
    [6149, 'Police'], [2157, 'Hacker'], [12988, 'Pirates'], [1462, 'Samurai'], [6158, 'Cult'], [6075, 'Sports'], [5565, 'Biography'], [4344, 'Musical'],
    [192772, 'Historical drama'], [33722, 'True crime'], [207046, 'Murder mystery'], [1918, 'Cooking'], [3205, 'Fairy tale'], [207317, 'Christmas'], [7312, 'Road trip'],
    [6054, 'Friendship'], [10235, 'Family'], [158718, 'LGBTQ+'], [6271, 'Boarding school'], [1415, 'Small town'], [1691, 'Dance'], [9714, 'Remake']]
    .map(([v, l]) => ({ v: String(v), l })).sort((a, b) => a.l.localeCompare(b.l));
const TV_TAG_GROUPS = [{ cat: 'Regions', list: TV_REGION_TAGS }, { cat: 'Themes', list: TV_THEME_TAGS }];
const TV_TAGS = [...TV_REGION_TAGS, ...TV_THEME_TAGS];
// Anime lives in the Anime section: Japanese animation (and anything TMDB tags "anime") is left out of Movies & TV
const TMDB_ANIME_KEYWORD = '210024';
const notAnimeTmdb = (x) => {
    const animated = (x.genre_ids || []).includes(16) || (x.genres || []).some(g => g.id === 16);
    const japanese = x.original_language === 'ja' || (x.origin_country || []).includes('JP');
    return !(animated && japanese);
};
const userRegion =() => ((/-([A-Z]{2})$/.exec(navigator.language || '') || [])[1] || 'US');
const tmdbCall = async (path, params = {}) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'tmdb', path, params: { language: 'en-US', ...params } } });
    if (error) { const e = await proxyErr(error); e.status = error.context?.status; throw e; }
    return typeof data === 'string' ? JSON.parse(data) : data;
};
const tvStatus = (x, kind) => {
    const date = kind === 'movie' ? x.release_date : x.first_air_date;
    if (!date || new Date(date).getTime() > Date.now()) return 'NOT_YET_RELEASED';
    if (kind === 'tv' && /returning|production|pilot/i.test(x.status || '')) return 'RELEASING';
    if (/cancel/i.test(x.status || '')) return 'CANCELLED';
    return 'FINISHED';
};
const normTmdb = (x, kind = x.media_type) => {
    const date = kind === 'movie' ? x.release_date : x.first_air_date;
    const title = x.title || x.name || 'Untitled', orig = x.original_title || x.original_name;
    return {
        id: (kind === 'movie' ? MOVIE_BASE : SHOW_BASE) + x.id, extId: x.id, kind, type: 'TV', format: kind === 'movie' ? 'MOVIE' : 'TV',
        title: { romaji: title, english: null, native: orig && orig !== title ? orig : null },
        coverImage: { large: TMDB_IMG(x.poster_path) }, bannerImage: TMDB_IMG(x.backdrop_path, 'w1280'),
        status: tvStatus(x, kind), seasonYear: date ? Number(date.slice(0, 4)) : null, releaseDate: date || null,
        episodes: kind === 'movie' ? 1 : (x.number_of_episodes || null), chapters: null, countryOfOrigin: (x.origin_country || [])[0] || null, nextAiringEpisode: null,
        averageScore: x.vote_count >= 5 && x.vote_average ? Math.round(x.vote_average * 10) : null, rating: x.vote_average ? x.vote_average * 10 : null, votes: x.vote_count || 0,
        genres: (x.genre_ids || (x.genres || []).map(g => g.id)).map(id => TMDB_GENRE_NAMES[id]).filter(Boolean),
        runtime: kind === 'movie' ? (x.runtime || null) : ((x.episode_run_time || [])[0] || null), adult: !!x.adult, trailer: null,
    };
};
const normTmdbDetail = (x, kind, collection) => {
    const m = normTmdb(x, kind);
    const vids = (x.videos?.results || []).filter(v => v.site === 'YouTube' && v.key)
        .sort((a, b) => (b.type === 'Trailer') - (a.type === 'Trailer') || (b.official - a.official) || String(b.published_at || '').localeCompare(String(a.published_at || '')));
    const cc = userRegion(); const prov = x['watch/providers']?.results?.[cc] || x['watch/providers']?.results?.US || null;
    const people = kind === 'movie' ? (x.credits?.cast || []) : (x.aggregate_credits?.cast || []);
    const crew = kind === 'movie' ? (x.credits?.crew || []) : [];
    const directors = crew.filter(c => c.job === 'Director').map(c => c.name);
    const cert = kind === 'movie'
        ? ((x.release_dates?.results || []).find(r => r.iso_3166_1 === cc) || (x.release_dates?.results || []).find(r => r.iso_3166_1 === 'US'))?.release_dates?.find(d => d.certification)?.certification
        : ((x.content_ratings?.results || []).find(r => r.iso_3166_1 === cc) || (x.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US'))?.rating;
    const money = (n) => n ? '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : Math.round(n / 1e6) + 'M') : null;
    const next = x.next_episode_to_air;
    const rows = [
        ['Type', kind === 'movie' ? 'Movie' : 'TV series'],
        m.releaseDate && [kind === 'movie' ? (m.status === 'NOT_YET_RELEASED' ? 'Releases' : 'Released') : 'First aired', new Date(m.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })],
        kind === 'tv' && x.last_air_date && m.status !== 'RELEASING' && ['Last aired', new Date(x.last_air_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })],
        next && ['Next episode', `S${next.season_number} E${next.episode_number}${next.air_date ? ' · ' + new Date(next.air_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}`, true],
        ['Status', x.status || (m.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Released'), m.status === 'RELEASING'],
        kind === 'tv' && x.number_of_seasons && ['Seasons', `${x.number_of_seasons} · ${x.number_of_episodes || '?'} episodes`],
        m.runtime && [kind === 'movie' ? 'Runtime' : 'Episode length', m.runtime >= 60 ? `${Math.floor(m.runtime / 60)} h ${m.runtime % 60 ? (m.runtime % 60) + ' min' : ''}` : m.runtime + ' min'],
        cert && ['Rated', cert],
        directors.length && ['Director', directors.join(', ')],
        (x.created_by || []).length && ['Created by', x.created_by.map(c => c.name).join(', ')],
        (x.networks || []).length && ['Network', x.networks.map(n => n.name).slice(0, 3).join(', ')],
        (x.production_companies || []).length && ['Studio', x.production_companies.map(c => c.name).slice(0, 3).join(', ')],
        x.budget > 0 && ['Budget', money(x.budget)], x.revenue > 0 && ['Box office', money(x.revenue)],
        x.vote_average && ['TMDB rating', `${(x.vote_average).toFixed(1)} / 10 · ${(x.vote_count || 0).toLocaleString()} votes`],
        m.title.native && ['Original title', m.title.native],
        (x.spoken_languages || []).length && ['Language', x.spoken_languages.map(l => l.english_name).slice(0, 3).join(', ')],
    ].filter(Boolean).map(([k, v, hot]) => ({ k, v, hot: !!hot }));
    const para = (t) => escapeHtml(t).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    const provList = (arr) => (arr || []).map(p => ({ id: p.provider_id, name: p.provider_name, logo: TMDB_IMG(p.logo_path, 'w92') }));
    return {
        ...m, genres: (x.genres || []).map(g => TMDB_GENRE_NAMES[g.id] || g.name),
        description: [x.tagline && `<i>${escapeHtml(x.tagline)}</i>`, x.overview && para(x.overview)].filter(Boolean).join('<br><br>') || null,
        trailer: vids[0] ? { id: vids[0].key, site: 'youtube' } : null,
        videos: vids.slice(0, 12).map(v => ({ id: v.key, name: v.name })),
        tvInfo: rows,
        providers: prov ? { link: prov.link, stream: provList(prov.flatrate), free: provList([...(prov.free || []), ...(prov.ads || [])]), rent: provList(prov.rent), buy: provList(prov.buy), region: x['watch/providers']?.results?.[cc] ? cc : 'US' } : null,
        cast: people.slice(0, 24).map(p => ({ id: PERSON_BASE + p.id, name: { full: (p.character || p.roles?.[0]?.character || p.name || '').slice(0, 60) || p.name }, actor: p.name,
            episodes: p.total_episode_count || null, image: { large: TMDB_IMG(p.profile_path, 'w185') }, section: 'TV', gameId: m.id })),
        seasons: kind === 'tv' ? (x.seasons || []).filter(s => s.season_number > 0).map(s => ({ n: s.season_number, name: s.name, episodes: s.episode_count, air: s.air_date, poster: TMDB_IMG(s.poster_path, 'w185') })) : [],
        imdb: x.external_ids?.imdb_id ? `https://www.imdb.com/title/${x.external_ids.imdb_id}/` : null,
        homepage: x.homepage || null,
        relations: { edges: (collection?.parts || []).filter(p => p.id !== x.id).sort((a, b) => String(a.release_date || '9').localeCompare(String(b.release_date || '9')))
            .map(p => ({ relationType: 'COLLECTION', node: normTmdb(p, 'movie') })) },
        collectionName: collection?.name || null,
        similar: (x.recommendations?.results || []).filter(r => r.poster_path && notAnimeTmdb(r) && !r.adult).slice(0, 14).map(r => normTmdb(r, r.media_type || kind)),
        nextEp: next ? { season: next.season_number, episode: next.episode_number, date: next.air_date } : null,
    };
};
// TMDB keywords for erotic titles: kept out of Movies & TV unless "18+ only" is on (then only these show)
const TMDB_EROTIC = ['190370', '155477', '325693', '207767', '364719', '170827', '445', '198385', '159551'];
const tvKeep = (o) => (x) => notAnimeTmdb(x) && (o.adult ? true : !x.adult);
const tvApi = {
    async browse(f, page = 1, o = {}) {
        const kinds = f.format === 'MOVIE' ? ['movie'] : f.format === 'TV' ? ['tv'] : ['movie', 'tv'];
        const q = (f.search || '').trim();
        const keep = tvKeep(o);
        if (q) {
            const d = kinds.length === 2 ? await tmdbCall('search/multi', { query: q, page, include_adult: !!o.adult }) : await tmdbCall(`search/${kinds[0]}`, { query: q, page, include_adult: !!o.adult });
            const items = (d.results || []).filter(x => (x.media_type || kinds[0]) !== 'person' && ['movie', 'tv'].includes(x.media_type || kinds[0]) && keep(x)).map(x => normTmdb(x, x.media_type || kinds[0]));
            return { items, hasNextPage: page < (d.total_pages || 1) };
        }
        const gs = splitMulti(f.genre).map(v => TV_GENRES.find(x => x.v === v)).filter(Boolean);
        const g = gs.length ? { movie: gs.every(x => x.movie) ? gs.map(x => x.movie).join(',') : null, tv: gs.every(x => x.tv) ? gs.map(x => x.tv).join(',') : null } : null;   // "a,b" = has all
        const filtered = f.genre || f.tag || f.year || f.status || f.sort || o.adult || (o.hidden || []).length;
        if (!filtered) {
            const d = await tmdbCall(`trending/${kinds.length === 2 ? 'all' : kinds[0]}/week`, { page });
            return { items: (d.results || []).filter(x => x.media_type !== 'person' && keep(x)).map(x => normTmdb(x, x.media_type || kinds[0])), hasNextPage: page < Math.min(d.total_pages || 1, 500) };
        }
        const today = new Date().toISOString().slice(0, 10);
        const sortBy = (k) => f.sort === 'rating_desc' ? 'vote_average.desc' : f.sort === 'rating_asc' ? 'vote_average.asc' : f.sort === 'new' ? (k === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc') : 'popularity.desc';
        const pages = await Promise.all(kinds.filter(k => !g || g[k]).map(async (k) => {
            const hidden = TV_GENRES.filter(x => (o.hidden || []).includes(x.v)).map(x => x[k]).filter(Boolean);
            const p = { page, sort_by: sortBy(k), include_adult: !!o.adult, with_genres: g ? g[k] : null, without_genres: hidden.join(',') || null };
            // tags: "a,b" = has all of them · 18+ only: has any of the erotic keywords · otherwise: none of them, and no anime
            const tags = splitMulti(f.tag), kw = tags.filter(t => /^\d+$/.test(t));
            const origins = tags.filter(t => t.startsWith('o:')).flatMap(t => t.slice(2).split('|')), langs = tags.filter(t => t.startsWith('l:')).map(t => t.slice(2));
            if (kw.length) p.with_keywords = kw.join(',');
            if (origins.length) p.with_origin_country = [...new Set(origins)].join('|');   // any of these countries
            if (langs.length) p.with_original_language = langs.join('|');
            if (origins.includes('JP')) p.without_genres = [p.without_genres, '16'].filter(Boolean).join(',');   // Japanese live action, not anime
            // K-/C-/J-/Thai/Turkish "drama" tags mean dramas: shows in the Drama genre, no variety / reality / talk shows
            if (k === 'tv' && origins.some(c => ['KR', 'CN', 'JP', 'TW', 'TH', 'TR'].includes(c))) {
                if (!p.with_genres) p.with_genres = '18';
                p.without_genres = [p.without_genres, '10764', '10767'].filter(Boolean).join(',');
            }
            if (o.adult) p.with_keywords = [p.with_keywords, TMDB_EROTIC.join('|')].filter(Boolean).join(',');
            p.without_keywords = [TMDB_ANIME_KEYWORD, ...(o.adult ? [] : TMDB_EROTIC)].join(',');
            if (f.sort?.startsWith('rating')) p['vote_count.gte'] = 500;
            if (f.year) p[k === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = f.year;
            const dateKey = k === 'movie' ? 'primary_release_date' : 'first_air_date';
            if (f.status === 'NOT_YET_RELEASED') p[dateKey + '.gte'] = today;
            if (f.status === 'FINISHED' || f.sort === 'new') p[dateKey + '.lte'] = today;
            if (f.status === 'RELEASING' && k === 'tv') p.with_status = '0';
            if (f.status === 'RELEASING' && k === 'movie') return { results: [], total_pages: 0 };
            const d = await tmdbCall(`discover/${k}`, p);
            return { ...d, results: (d.results || []).filter(keep).map(x => normTmdb(x, k)) };
        }));
        // two kinds: interleave so movies and shows mix
        const items = []; const max = Math.max(0, ...pages.map(p => p.results.length));
        for (let i = 0; i < max; i++) pages.forEach(p => p.results[i] && items.push(p.results[i]));
        return { items, hasNextPage: pages.some(p => page < Math.min(p.total_pages || 1, 500)) };
    },
    async search(q) { const d = await tmdbCall('search/multi', { query: q }); return (d.results || []).filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && tvKeep({})(x)).slice(0, 8).map(x => normTmdb(x, x.media_type)); },
    async details(id) {
        const kind = id >= SHOW_BASE ? 'tv' : 'movie'; const ext = id - (kind === 'tv' ? SHOW_BASE : MOVIE_BASE);
        const x = await tmdbCall(`${kind}/${ext}`, { append_to_response: kind === 'movie' ? 'videos,credits,watch/providers,recommendations,external_ids,release_dates' : 'videos,aggregate_credits,watch/providers,recommendations,external_ids,content_ratings' });
        const collection = kind === 'movie' && x.belongs_to_collection?.id ? await tmdbCall(`collection/${x.belongs_to_collection.id}`).catch(() => null) : null;
        return normTmdbDetail(x, kind, collection);
    },
    async random(o = {}) {
        const k = Math.random() < 0.5 ? 'movie' : 'tv';
        const d = await tmdbCall(`discover/${k}`, { sort_by: 'popularity.desc', 'vote_count.gte': 300, include_adult: !!o.adult, without_keywords: [TMDB_ANIME_KEYWORD, ...TMDB_EROTIC].join(','), page: 1 + Math.floor(Math.random() * 60) });
        const r = (d.results || []).filter(tvKeep(o)); return r.length ? normTmdb(r[Math.floor(Math.random() * r.length)], k) : null;
    },
    // leaderboard pool: well-voted titles, best first (re-ranked by weighted score in the app)
    // movies and series are separate leaderboards (o.kind)
    async top(page, o = {}) {
        const k = o.kind === 'tv' ? 'tv' : 'movie';
        const d = await tmdbCall(`discover/${k}`, { sort_by: 'vote_average.desc', 'vote_count.gte': k === 'tv' ? 1000 : 1500, include_adult: !!o.adult, without_keywords: [TMDB_ANIME_KEYWORD, ...TMDB_EROTIC].join(','), page: page + 1 });
        return { items: (d.results || []).filter(tvKeep(o)).map(x => normTmdb(x, k)), done: page + 1 >= Math.min(d.total_pages || 1, 500) };
    },
};

/* ------------------------------------------------------------------
   Spotify — the Songs section (through the proxy). Charts come from Apple Music's public "most played" list,
   matched to Spotify tracks on the server. Spotify ids are text, so each song gets a number id from its Spotify id.
   ------------------------------------------------------------------ */
const SONG_IDS_KEY = 'anicoop_songids_v1';
const songIds = readJSON(SONG_IDS_KEY) || {};   // number id → Spotify id (for opening a song from a link that only has the number)
const saveSongIds = debounce(() => { try { localStorage.setItem(SONG_IDS_KEY, JSON.stringify(songIds)); } catch {} }, 1500);
const songNum = (spotifyId) => { let h = 2166136261; for (let i = 0; i < spotifyId.length; i++) { h ^= spotifyId.charCodeAt(i); h = Math.imul(h, 16777619); } return SONG_BASE + ((h >>> 0) % 600000000); };
const SONG_GENRES = ['pop', 'hip-hop', 'rap', 'r&b', 'soul', 'rock', 'hard rock', 'soft rock', 'indie', 'alternative', 'grunge', 'emo', 'punk', 'metal', 'k-pop', 'j-pop', 'c-pop',
    'city pop', 'vocaloid', 'anime', 'latin', 'reggaeton', 'salsa', 'bachata', 'regional mexican', 'afrobeats', 'amapiano', 'reggae', 'dancehall', 'edm', 'house', 'techno',
    'trance', 'dubstep', 'drum and bass', 'dance', 'disco', 'funk', 'trap', 'drill', 'grime', 'phonk', 'country', 'folk', 'singer/songwriter', 'blues', 'gospel', 'christian',
    'jazz', 'bossa nova', 'classical', 'opera', 'ambient', 'new age', 'lo-fi', 'soundtrack', 'video game', 'musicals', 'children', 'arabic', 'turkish', 'persian', 'bollywood',
    'french pop', 'german pop', 'italian', 'flamenco']
    .map(v => ({ v, l: v === 'r&b' ? 'R&B' : v === 'edm' ? 'EDM' : v === 'lo-fi' ? 'Lo-fi' : v === 'singer/songwriter' ? 'Singer/Songwriter' : v.replace(/(^|[-\s])(\w)/g, (m, a, b) => a + b.toUpperCase()).replace(/^K-pop$|^J-pop$|^C-pop$/i, (x) => x[0].toUpperCase() + '-Pop') }));
// Song tags: "v:" a version that's in the title (acoustic, remix…), "k:" a mood / theme word to search by, "d:" a decade
const SONG_TAG_GROUPS = [
    { cat: 'Version', list: [['v:acoustic', 'Acoustic'], ['v:remix', 'Remix'], ['v:live', 'Live'], ['v:instrumental', 'Instrumental'], ['v:cover', 'Cover'], ['v:remastered', 'Remastered'],
        ['v:unplugged', 'Unplugged'], ['v:slowed', 'Slowed'], ['v:sped up', 'Sped up'], ['v:extended mix', 'Extended mix'], ['v:radio edit', 'Radio edit'], ['v:mashup', 'Mashup'], ['k:piano', 'Piano'], ['k:orchestral', 'Orchestral']] },
    { cat: 'Mood & moments', list: [['k:love', 'Love songs'], ['k:chill', 'Chill'], ['k:sad', 'Sad'], ['k:happy', 'Happy'], ['k:party', 'Party'], ['k:workout', 'Workout'], ['k:study', 'Study'],
        ['k:sleep', 'Sleep'], ['k:rain', 'Rainy day'], ['k:summer', 'Summer'], ['k:night', 'Late night'], ['k:road trip', 'Road trip'], ['k:christmas', 'Christmas'], ['k:wedding', 'Wedding']] },
    { cat: 'Anime, games & film', list: [['k:opening', 'Anime opening'], ['k:ending', 'Anime ending'], ['k:ost', 'OST'], ['k:theme', 'Theme song'], ['k:soundtrack', 'Soundtrack']] },
    { cat: 'Decade', list: [['d:1960', '60s'], ['d:1970', '70s'], ['d:1980', '80s'], ['d:1990', '90s'], ['d:2000', '2000s'], ['d:2010', '2010s'], ['d:2020', '2020s']] },
].map(g => ({ cat: g.cat, list: g.list.map(([v, l]) => ({ v, l })) }));
const SONG_TAGS = SONG_TAG_GROUPS.flatMap(g => g.list);
const CHART_COUNTRIES = [{ v: 'us', l: 'USA' }, { v: 'gb', l: 'UK' }, { v: 'ca', l: 'Canada' }, { v: 'au', l: 'Australia' }, { v: 'de', l: 'Germany' }, { v: 'fr', l: 'France' },
    { v: 'jp', l: 'Japan' }, { v: 'kr', l: 'Korea' }, { v: 'br', l: 'Brazil' }, { v: 'mx', l: 'Mexico' }, { v: 'in', l: 'India' }, { v: 'sa', l: 'Saudi Arabia' },
    { v: 'ae', l: 'UAE' }, { v: 'eg', l: 'Egypt' }, { v: 'tr', l: 'Turkey' }, { v: 'nl', l: 'Netherlands' }, { v: 'se', l: 'Sweden' }];
const spotifyCall = async (body) => {
    const { data, error } = await sb.functions.invoke('igdb', { body: { endpoint: 'spotify', market: userRegion(), ...body } });
    if (error) { const e = await proxyErr(error); e.status = error.context?.status; throw e; }
    return typeof data === 'string' ? JSON.parse(data) : data;
};
const normSong = (t, album = t.album) => {
    const id = songNum(t.id); if (songIds[id] !== t.id) { songIds[id] = t.id; saveSongIds(); }
    const date = album?.release_date || null;
    return {
        id, extId: t.id, spotifyId: t.id, type: 'SONG', format: 'SONG',
        title: { romaji: t.name || 'Untitled', english: null, native: null },
        coverImage: { large: album?.images?.[0]?.url || null }, bannerImage: null,
        status: 'FINISHED', seasonYear: date ? Number(date.slice(0, 4)) : null, releaseDate: date,
        episodes: null, chapters: null, countryOfOrigin: null, nextAiringEpisode: null, averageScore: null, genres: [],
        artists: (t.artists || []).map(a => a.name), artistIds: (t.artists || []).map(a => a.id), album: album?.name || null, albumId: album?.id || null,
        durationMs: t.duration_ms || null, explicit: !!t.explicit, trackNo: t.track_number || null, trailer: null,
    };
};
// Browsing, search, genres and charts come from Apple (free, no key, no rate-limit bans). Spotify's API is only asked
// for a song's Spotify id when you open it, for the player — the old "match every chart song on Spotify" approach
// sent ~100 Spotify calls per load and got the app blocked by Spotify for a whole day.
const APPLE_KEY = (appleId) => 'am:' + appleId;
const bigArt = (u) => u ? u.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.jpg') : null;
const normApple = (x) => {   // an iTunes search/lookup result or an Apple chart entry
    const appleId = String(x.trackId || x.id); const key = APPLE_KEY(appleId);
    const id = songNum(key); if (songIds[id] !== key) { songIds[id] = key; saveSongIds(); }
    const date = (x.releaseDate || '').slice(0, 10) || null;
    const genre = x.primaryGenreName || x.genres?.find(g => g.name !== 'Music')?.name || null;
    return {
        id, extId: key, appleId, spotifyId: /^[0-9A-Za-z]{22}$/.test(songSpotify[key] || '') ? songSpotify[key] : null, type: 'SONG', format: 'SONG',
        title: { romaji: x.trackName || x.name || 'Untitled', english: null, native: null },
        coverImage: { large: bigArt(x.artworkUrl100) }, bannerImage: null,
        status: 'FINISHED', seasonYear: date ? Number(date.slice(0, 4)) : null, releaseDate: date,
        episodes: null, chapters: null, countryOfOrigin: null, nextAiringEpisode: null, averageScore: null, genres: genre ? [genre] : [],
        artists: String(x.artistName || '').split(/\s*(?:,|&| x | feat\. )\s*/i).filter(Boolean), album: x.collectionName || null,
        durationMs: x.trackTimeMillis || null, explicit: x.trackExplicitness === 'explicit' || x.contentAdvisoryRating === 'Explict' || x.contentAdvisoryRating === 'Explicit',
        trackNo: x.trackNumber || null, discNo: x.discNumber || 1, albumId: x.collectionId || null, previewUrl: x.previewUrl || null, appleUrl: x.trackViewUrl || x.url || null, trailer: null, artistId: x.artistId || null,
    };
};
const SONG_SPOTIFY_KEY = 'anicoop_songspotify_v1';
const songSpotify = readJSON(SONG_SPOTIFY_KEY) || {};   // Apple key → Spotify id (or '' = not on Spotify), so each song is asked once
const saveSongSpotify = debounce(() => { try { localStorage.setItem(SONG_SPOTIFY_KEY, JSON.stringify(songSpotify)); } catch {} }, 1500);
// straight from the browser (spreads Apple's per-person limit); if that's blocked (an ad-blocker, a busy limit, a
// network that filters Apple) it goes through our server instead
const itunes = async (path, params) => {
    const url = `https://itunes.apple.com/${path}?` + new URLSearchParams(params);
    try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
    } catch { /* blocked: try the server */ }
    const d = await siteFetch(url);
    try { return JSON.parse(d.body || '{}'); } catch { throw new Error('Apple Music is busy — try again in a minute.'); }
};
const appleChartOne = async (cc) => {
    const d = await siteFetch(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/100/songs.json`);
    return JSON.parse(d.body || '{}')?.feed?.results || [];
};
// "Global" (the default): Apple has no worldwide chart, so the charts of 10 big music countries are combined —
// a song scores more the higher it is in each one, and the 100 best total scores make the list
const GLOBAL_CHART_CC = ['us', 'gb', 'br', 'mx', 'de', 'fr', 'jp', 'kr', 'in', 'es'];
let globalChartMemo = null;
const appleChart = async (cc = 'global') => {
    if (cc && cc !== 'global') return appleChartOne(cc);
    if (globalChartMemo && Date.now() - globalChartMemo.at < 30 * 60e3) return globalChartMemo.list;
    const lists = await Promise.all(GLOBAL_CHART_CC.map(c => appleChartOne(c).catch(() => [])));
    const score = new Map(), item = new Map();
    lists.forEach(l => l.forEach((x, n) => { score.set(x.id, (score.get(x.id) || 0) + (100 - n)); if (!item.has(x.id)) item.set(x.id, x); }));
    const list = [...item.values()].sort((a, b) => score.get(b.id) - score.get(a.id));   // every song of the 10 charts, best first
    if (list.length) globalChartMemo = { at: Date.now(), list };
    return list;
};
// one page (100 songs) of a chart. Global goes as deep as the 10 charts reach; a country has its top 200 (Apple's longest list)
const appleChartPage = async (cc = 'global', page = 1) => {
    if (!cc || cc === 'global') { const all = await appleChart('global'); return { list: all.slice((page - 1) * 100, page * 100), more: all.length > page * 100 }; }
    if (page === 1) return { list: await appleChartOne(cc), more: true };
    try {
        const d = await siteFetch(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/200/songs.json`);
        const all = JSON.parse(d.body || '{}')?.feed?.results || [];
        return { list: all.slice((page - 1) * 100, page * 100), more: all.length > page * 100 };
    } catch { return { list: [], more: false }; }
};
// the same song is often on a single and an album: keep the first (most relevant) one
const dedupeSongs = (list) => { const seen = new Set(); return list.filter(s => { const k = `${s.title.romaji.toLowerCase()}|${(s.artists[0] || '').toLowerCase()}`; return !seen.has(k) && seen.add(k); }); };
const genreMatch = (s, g) => { const a = (s.genres[0] || '').toLowerCase().replace(/[^a-z]/g, ''), b = g.toLowerCase().replace(/[^a-z]/g, ''); return a.includes(b) || b.includes(a.slice(0, 4)); };
// the artist a Songs search matched (shown as a card above the results)
const songSearchArtist = ref(null);
// a short "about" for an artist from Wikipedia (only if the page is really about a musician / band)
const wikiArtist = async (name) => {
    const MUSIC = /singer|rapper|band|musician|songwriter|\bdj\b|record producer|producer|group|duo|composer|vocalist|artist|idol|boy band|girl group/i;
    // all the likely page titles are asked at once (not one after another); the first one that's about a musician wins
    const titles = [`${name} (musician)`, `${name} (singer)`, `${name} (rapper)`, `${name} (band)`, `${name} (South Korean band)`, `${name} (group)`, name];
    const pages = await Promise.all(titles.map(t => fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`).then(r => r.ok ? r.json() : null).catch(() => null)));
    const d = pages.find(p => p && p.type !== 'disambiguation' && p.extract && MUSIC.test(`${p.description || ''} ${p.extract.slice(0, 300)}`));
    if (!d) return null;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return { html: d.extract.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join(''), description: d.description || null, url: d.content_urls?.desktop?.page || null };
};
// songs saved before v8 have a Spotify id as extId; newer ones an Apple key ("am:…") plus the Spotify id once it's known
const songPlayerId = (a) => a?.spotifyId || (a?.extId && !String(a.extId).startsWith('am:') ? a.extId : null);
const songSpotifyUrl = (a) => a?.spotifyUrl || (songPlayerId(a) ? `https://open.spotify.com/track/${songPlayerId(a)}` : `https://open.spotify.com/search/${encodeURIComponent(`${a?.title?.romaji || ''} ${(a?.artists || [])[0] || ''}`.trim())}`);
const songApi = {
    async browse(f, page = 1) {
        const q = (f.search || '').trim(); const genres = splitMulti(f.genre);
        const chartCc = f.country || 'global', country = f.country && f.country !== 'global' ? f.country : 'us';   // searches need a real store
        const tags = splitMulti(f.tag), versions = tags.filter(t => t.startsWith('v:')).map(t => t.slice(2));
        const words = [...versions, ...tags.filter(t => t.startsWith('k:')).map(t => t.slice(2))], decades = tags.filter(t => t.startsWith('d:')).map(t => Number(t.slice(2)));
        const inDecade = (s) => !decades.length || decades.some(d => s.seasonYear >= d && s.seasonYear < d + 10);
        // a version (acoustic, remix, live…) has to really be one: its name says so
        const hasWords = (s) => !versions.length || versions.every(w => `${s.title.romaji} ${s.album || ''}`.toLowerCase().includes(w));
        const clean = (list) => dedupeSongs(list.filter(s => (!f.hideExplicit || !s.explicit) && (!f.year || s.seasonYear === Number(f.year)) && inDecade(s)));
        if (page === 1) songSearchArtist.value = null;
        if (q || genres.length || tags.length) {
            // tags / decades are filtered here, so ask Apple for its biggest page (200) at once
            const per = tags.length ? 200 : 50; const offset = (page - 1) * per;
            // only a genre: Apple's genre index. Otherwise the words go in one search and the genre is checked on the results.
            const genreOnly = !q && !words.length && genres.length;
            const term = [q, ...words, genreOnly ? genres[0] : !q && !words.length ? `${decades[0] || ''}s hits` : ''].filter(Boolean).join(' ') || genres[0];
            const [d, artist] = await Promise.all([
                itunes('search', { term, media: 'music', entity: 'song', limit: per, offset, country, ...(genreOnly ? { attribute: 'genreIndex' } : {}) }),
                // an artist's name? then their whole catalogue comes first (a normal search only finds some of their songs)
                q && page === 1 ? songApi.findArtist(q, country) : null,
            ]);
            let items = (d.results || []).map(normApple);
            if (artist) {
                songSearchArtist.value = artist;
                const all = (await itunes('lookup', { id: artist.id, entity: 'song', limit: 200, country }).catch(() => null))?.results || [];
                const theirs = all.filter(x => x.wrapperType === 'track').map(normApple);
                items = [...theirs, ...items];
            }
            if (genres.length) { const g = items.filter(s => genres.some(x => genreMatch(s, x))); if (g.length >= 8 || q || words.length) items = g; }
            items = items.filter(hasWords);
            return { items: clean(items), hasNextPage: (d.results || []).length === per && offset + per < 200 };
        }
        // "trending": this week's most played in that country (100 at a time)
        const chart = await appleChartPage(chartCc, page);
        return { items: clean(chart.list.map(normApple)), hasNextPage: chart.more && chart.list.length > 0 };
    },
    // the artist a search means, if it clearly names one ("taylor swift" → Taylor Swift, not a song called that)
    async findArtist(q, country = 'us') {
        const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
        const d = await itunes('search', { term: q, media: 'music', entity: 'musicArtist', limit: 5, country }).catch(() => null);
        const a = (d?.results || []).find(x => norm(x.artistName) === norm(q)) || ((d?.results || [])[0] && norm(d.results[0].artistName).startsWith(norm(q)) && norm(q).length >= 4 ? d.results[0] : null);
        return a ? { id: a.artistId, name: a.artistName, genre: a.primaryGenreName || null } : null;
    },
    // an artist's page: Apple (songs, albums) + Deezer (picture, fans) + Wikipedia (about), all without leaving the site
    // Apple answers first and the page shows right away; the photo + fans (Deezer) and the bio (Wikipedia) arrive in
    // `extras` a moment later. With a name hint (opened from a song), those start at the same time as Apple.
    async artist(id, hint = null) {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const extrasFor = (name) => Promise.all([
            siteFetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`).then(r => JSON.parse(r.body || '{}').data || []).catch(() => []),
            wikiArtist(name).catch(() => null),
        ]).then(([dz, wiki]) => {
            const deezer = dz.find(x => norm(x.name) === norm(name)) || null;
            return { ...(deezer?.picture_xl ? { image: { large: deezer.picture_xl } } : {}), fans: deezer?.nb_fan || null,
                description: wiki?.html || '', about: wiki?.description || null, wikiUrl: wiki?.url || null };
        });
        const early = hint ? extrasFor(hint) : null;
        // Apple's full list of 200 songs is slow (~2 s): the page shows with the first 50, the rest swaps in after
        const fullSongs = itunes('lookup', { id, entity: 'song', limit: 200 }).catch(() => null);
        const [info, songs, albums] = await Promise.all([
            itunes('lookup', { id }), itunes('lookup', { id, entity: 'song', limit: 50 }), itunes('lookup', { id, entity: 'album', limit: 100 }),
        ]);
        const a = info?.results?.[0]; if (!a) return null;
        const name = a.artistName;
        const albumList = (albums?.results || []).filter(x => x.wrapperType === 'collection' && x.collectionType !== 'Compilation')
            .map(x => ({ id: x.collectionId, name: x.collectionName, cover: bigArt(x.artworkUrl100), year: (x.releaseDate || '').slice(0, 4), tracks: x.trackCount, kind: /- Single$/.test(x.collectionName) || x.trackCount <= 3 ? 'Single' : / - EP$/.test(x.collectionName) || x.trackCount <= 7 ? 'EP' : 'Album', url: x.collectionViewUrl }))
            .sort((p, q) => String(q.year).localeCompare(String(p.year)));
        const songFields = (res) => {
            const tracks = (res?.results || []).filter(x => x.wrapperType === 'track').map(normApple);   // every copy (album + single), for the discography
            const songList = dedupeSongs(tracks);   // each song once, most popular first (Apple's order)
            const years = songList.map(s => s.seasonYear).filter(Boolean);
            return { songs: songList, tracks, songCount: songList.length,
                active: years.length ? `${Math.min(...years)} – ${Math.max(...years) >= new Date().getFullYear() - 1 ? 'now' : Math.max(...years)}` : null };
        };
        const first = songFields(songs);
        return {
            id, isArtist: true, name: { full: name, native: null, alternative: [] },
            image: { large: albumList[0]?.cover || first.songs[0]?.coverImage?.large || null },
            description: '', about: null, wikiUrl: null, extrasPending: true,
            primaryOccupations: [], genre: a.primaryGenreName || null,
            fans: null, albumCount: albumList.filter(x => x.kind === 'Album').length, ...first,
            appleUrl: a.artistLinkUrl || null, albums: albumList,
            extras: early && norm(hint) === norm(name) ? early : extrasFor(name),
            more: fullSongs.then(r => r?.results?.length ? songFields(r) : null),
        };
    },
    async album(id) {
        const d = await itunes('lookup', { id, entity: 'song', limit: 200 });
        return (d?.results || []).filter(x => x.wrapperType === 'track').map(normApple);
    },
    // an album's own page: the release (cover, artist, date, label) + every song on it
    async albumPage(id) {
        const d = await itunes('lookup', { id, entity: 'song', limit: 200 });
        const res = d?.results || []; const c = res.find(x => x.wrapperType === 'collection'); if (!c) return null;
        const tracks = res.filter(x => x.wrapperType === 'track').map(normApple);
        const name = c.collectionName || '';
        return { isAlbum: true, id: c.collectionId, name: { full: name.replace(/ - (Single|EP)$/, '') }, kind: /- Single$/.test(name) ? 'Single' : / - EP$/.test(name) ? 'EP' : 'Album',
            artist: c.artistName || '', artistId: c.artistId || null, cover: bigArt(c.artworkUrl100), year: (c.releaseDate || '').slice(0, 4), releaseDate: c.releaseDate || null,
            genre: c.primaryGenreName || null, count: c.trackCount || tracks.length, label: c.copyright ? c.copyright.replace(/^[℗©]\s*\d{4}\s*/, '') : null, url: c.collectionViewUrl || null,
            tracks, lengthMs: tracks.reduce((a, t) => a + (t.durationMs || 0), 0) };
    },
    async search(q) { const d = await itunes('search', { term: q, media: 'music', entity: 'song', limit: 12 }); return dedupeSongs((d.results || []).map(normApple)).slice(0, 8); },
    // the Spotify id for the player: asked once per song, remembered in this browser
    async spotifyIdFor(s) {
        if (s.spotifyId) return s.spotifyId;
        const known = songSpotify[s.extId];
        if (known && !known.startsWith('-')) return known;
        if (known && Date.now() - Number(known.slice(1)) < 2 * 86400000) return null;   // "not found" is re-asked after 2 days (Spotify may just have been busy)
        try {
            const d = await spotifyCall({ kind: 'search', q: `track:${s.title.romaji.replace(/\s*[([].*?[)\]]/g, '')} artist:${s.artists[0] || ''}`, limit: 1 });
            const t = d.items?.[0]; songSpotify[s.extId] = t?.id || '-' + Date.now(); saveSongSpotify();
            return t?.id || null;
        } catch { return null; }   // Spotify busy: the Apple preview plays instead, and we ask again next time
    },
    async details(m) {
        const extId = typeof m === 'object' ? m.extId : songIds[m];
        if (!extId) return null;
        if (extId.startsWith('am:')) {
            const d = await itunes('lookup', { id: extId.slice(3), entity: 'song' });
            const x = d.results?.[0]; if (!x) return typeof m === 'object' ? { ...m } : null;
            const s = normApple(x);
            s.songInfo = [
                ['Artist', x.artistName],
                x.collectionName && ['Album', x.collectionName],
                s.releaseDate && ['Released', new Date(s.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })],
                x.trackTimeMillis && ['Length', fmtDuration(x.trackTimeMillis)],
                x.trackNumber && x.trackCount && ['Track', `${x.trackNumber} of ${x.trackCount}`],
                x.primaryGenreName && ['Genre', x.primaryGenreName],
                ['Explicit', s.explicit ? 'Yes' : 'No'],
                x.copyright && ['Label', x.copyright.replace(/^[℗©]\s*\d{4}\s*/, '')],
            ].filter(Boolean).map(([k, v]) => ({ k, v, hot: false }));
            s.artistInfo = x.artistName ? { name: x.artistName, id: x.artistId || null, image: null, url: x.artistViewUrl || null } : null;
            s.spotifyUrl = null;
            // more from this album
            if (x.collectionId) {
                const al = await itunes('lookup', { id: x.collectionId, entity: 'song' }).catch(() => null);
                s.similar = (al?.results || []).filter(r => r.wrapperType === 'track' && String(r.trackId) !== s.appleId).slice(0, 14).map(normApple);
                s.similarLabel = 'More from this album';
            }
            s.spotifyId = await songApi.spotifyIdFor(s);
            if (s.spotifyId) s.spotifyUrl = `https://open.spotify.com/track/${s.spotifyId}`;
            return s;
        }
        // songs added before v8 are Spotify ids: ask Spotify, and if it's busy show what the list already has
        const d = await spotifyCall({ kind: 'track', id: extId }).catch(() => null);
        if (!d?.track) return typeof m === 'object' ? { ...m, spotifyId: extId, spotifyUrl: `https://open.spotify.com/track/${extId}` } : null;
        const t = d.track, al = d.album || t.album, ar = d.artist;
        const s = normSong(t, al);
        s.spotifyId = t.id;
        const date = al?.release_date;
        s.songInfo = [
            ['Artist', (t.artists || []).map(a => a.name).join(', ')],
            al?.name && ['Album', `${al.name}${al.album_type && al.album_type !== 'album' ? ' (' + al.album_type + ')' : ''}`],
            date && ['Released', al.release_date_precision === 'day' ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : date],
            t.duration_ms && ['Length', fmtDuration(t.duration_ms)],
            t.track_number && al?.total_tracks && ['Track', `${t.track_number} of ${al.total_tracks}`],
            ['Explicit', t.explicit ? 'Yes' : 'No'],
            al?.label && ['Label', al.label],
            (ar?.genres || []).length && ['Artist genres', ar.genres.slice(0, 4).join(', ')],
            ar?.followers?.total && ['Artist followers', ar.followers.total.toLocaleString()],
        ].filter(Boolean).map(([k, v]) => ({ k, v, hot: false }));
        s.genres = (ar?.genres || []).slice(0, 3);
        s.artistInfo = ar ? { name: ar.name, image: ar.images?.[0]?.url || null, url: ar.external_urls?.spotify || null } : null;
        s.bannerImage = ar?.images?.[0]?.url || null;
        s.spotifyUrl = t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`;
        s.similar = (al?.tracks?.items || []).filter(x => x.id !== t.id).slice(0, 14).map(x => normSong(x, al));   // more from this album
        s.similarLabel = 'More from this album';
        return s;
    },
    async random(f = {}) { const r = (await appleChart(f.country || 'global')).slice(0, 100); return r.length ? normApple(r[Math.floor(Math.random() * r.length)]) : null; },
    async top(country = 'us') { return (await appleChart(country)).slice(0, 100).map(normApple); },
    // past the 100 on Wikipedia: kworb's full list of Spotify's most streamed songs (thousands), read through our server
    async allTimeMore() {
        if (kworbMemo) return kworbMemo;
        const saved = readJSON(KWORB_KEY);
        if (saved?.list?.length && Date.now() - (saved.at || 0) < 86400000) return (kworbMemo = saved.list);
        const d = await siteFetch('https://kworb.net/spotify/songs.html');
        const doc = new DOMParser().parseFromString(d.body || '', 'text/html');
        const list = [...doc.querySelectorAll('table tr')].map(tr => {
            const td = tr.querySelectorAll('td'); if (td.length < 2) return null;
            const text = td[0].textContent.replace(/\s+/g, ' ').trim(); const a = td[0].querySelector('a')?.textContent.trim();
            // "Artist - Title": the first link is the artist, the rest of the text is the title
            const artist = a && text.startsWith(a) ? a : text.split(' - ')[0];
            const title = text.slice(artist.length).replace(/^\s*-\s*/, '').trim();
            const n = parseInt(td[1].textContent.replace(/[^\d]/g, ''), 10);
            return title && artist && n ? { title, artist, streams: Math.round(n / 1e7) / 100 } : null;
        }).filter(Boolean).slice(0, 2000);
        if (!list.length) throw new Error('Couldn’t load more songs right now — try again in a minute.');
        try { localStorage.setItem(KWORB_KEY, JSON.stringify({ at: Date.now(), list })); } catch {}
        return (kworbMemo = list);
    },
    // The 100 most streamed songs of all time: Spotify's all-time list as kept on Wikipedia (rank, song, artists,
    // billions of streams). The list is re-read once a day; each song's Apple match is remembered for good.
    async allTime() {
        const saved = readJSON(ALLTIME_KEY) || {};
        let list = saved.list?.length && Date.now() - (saved.at || 0) < 86400000 ? saved.list : null;
        if (!list) {
            try {
                const r = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=List_of_Spotify_streaming_records&prop=text&section=1&format=json&formatversion=2&origin=*');
                const html = (await r.json())?.parse?.text || '';
                const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table.wikitable');
                list = [...(table?.querySelectorAll('tr') || [])].map(tr => {
                    const th = tr.querySelector('th[scope="row"]'), td = tr.querySelectorAll('td');
                    if (!th || td.length < 3) return null;
                    const clean = (el) => el.textContent.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
                    return { rank: parseInt(clean(td[0]), 10), title: clean(th).replace(/^["“]|["”]$/g, ''), artist: clean(td[1]), streams: parseFloat(clean(td[2])) || null };
                }).filter(x => x?.title && x.rank).slice(0, 100);
            } catch { list = null; }
            if (list?.length) { saved.list = list; saved.at = Date.now(); try { localStorage.setItem(ALLTIME_KEY, JSON.stringify(saved)); } catch {} }
            else list = saved.list || [];
            if (!list.length) throw new Error('Couldn’t load the all-time chart — try again in a minute.');
        }
        return list.map(x => { const raw = allTimeMatches[allTimeKey(x)]; return { ...x, song: raw ? normApple(raw) : null }; });
    },
    // find one all-time song on Apple Music (title + first artist), remembered so it's asked only once
    async matchAllTime(w) {
        const k = allTimeKey(w);
        if (allTimeMatches[k]) return normApple(allTimeMatches[k]);
        const first = w.artist.split(/,\s(?!the\b)| and | & | featuring | feat\. /i)[0].trim();   // "Tyler, the Creator" stays whole
        const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s*[([].*?[)\]]/g, '').replace(/[^a-z0-9]/g, '');
        // title + artist first; if Apple's search misses it that way, the title alone with more results
        let d = await itunes('search', { term: `${w.title} ${first}`, media: 'music', entity: 'song', limit: 10 });
        const has = (list) => list.some(x => norm(x.trackName).startsWith(norm(w.title)) && norm(x.artistName).includes(norm(first)));
        if (!has(d.results || [])) { const d2 = await itunes('search', { term: w.title, media: 'music', entity: 'song', limit: 50 }).catch(() => null); if (d2?.results?.length) d = { results: [...(d.results || []), ...d2.results] }; }
        if (!has(d.results || [])) {   // still nothing: look through the artist's own catalogue
            const a = await songApi.findArtist(first).catch(() => null);
            const d3 = a ? await itunes('lookup', { id: a.id, entity: 'song', limit: 200 }).catch(() => null) : null;
            if (d3?.results?.length) d = { results: [...(d.results || []), ...d3.results.filter(x => x.wrapperType === 'track')] };
        }
        const res = (d.results || []).filter(x => x.wrapperType === 'track' || x.kind === 'song');
        // best match: same title, same artist, and the original (not a remix / live / sped-up version)
        const VERSION = /remix|live|acoustic|instrumental|sped|slowed|karaoke|version|edit|mix\b|demo|cover/i;
        const score = (x) => (norm(x.trackName) === norm(w.title) ? 4 : norm(x.trackName).startsWith(norm(w.title)) ? 2 : 0)
            + (norm(x.artistName) === norm(first) ? 3 : norm(x.artistName).includes(norm(first)) ? 2 : -5)
            - (VERSION.test(x.trackName) && !VERSION.test(w.title) ? 4 : 0) - (/^\s*(.*?\bkaraoke|.*tribute)/i.test(x.artistName) ? 5 : 0);
        const hit = [...res].sort((a, b) => score(b) - score(a))[0];
        if (!hit || score(hit) < 1 || !norm(hit.trackName).startsWith(norm(w.title).slice(0, 6))) return null;   // the title has to match
        const keep = ['trackId', 'trackName', 'artistName', 'artistId', 'collectionName', 'collectionId', 'artworkUrl100', 'releaseDate', 'primaryGenreName', 'trackTimeMillis', 'trackExplicitness', 'previewUrl', 'trackViewUrl', 'trackNumber', 'discNumber'];
        allTimeMatches[k] = Object.fromEntries(keep.map(f => [f, hit[f]]));
        saveAllTime();
        return normApple(allTimeMatches[k]);
    },
};
const ALLTIME_KEY = 'anicoop_alltime_v1', ALLTIME_MATCH_KEY = 'anicoop_alltime_match_v3', KWORB_KEY = 'anicoop_kworb_v1';
let kworbMemo = null;
// the same song in two lists ("Shape of You" / "Shape of You (Remastered)", "Ed Sheeran" / "Ed Sheeran, X")
const songKey = (title, artist) => { const n = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/\s*[([].*?[)\]]/g, '').replace(/[^a-z0-9]/g, ''); return n(title) + '|' + n(String(artist || '').split(/,| & | and | feat/i)[0]); };
const allTimeKey = (w) => `${w.title}|${w.artist}`.toLowerCase();
const allTimeMatches = readJSON(ALLTIME_MATCH_KEY) || {};
const saveAllTime = debounce(() => { try { localStorage.setItem(ALLTIME_MATCH_KEY, JSON.stringify(allTimeMatches)); } catch {} }, 1200);

// Genres you filtered out (Settings or the "Hide genres" button): AniList names, IGDB genre ids for games
const hiddenOf = (t) => PREFS.hiddenGenres?.[t] || [];
const hiddenNames = (t) => t === 'GAME' ? hiddenOf(t).map(id => GAME_GENRES.find(g => g.v === Number(id))?.l).filter(Boolean)
    : t === 'TV' ? hiddenOf(t).flatMap(v => { const g = TV_GENRES.find(x => x.v === v); return g ? [g.movie, g.tv].filter(Boolean).map(id => TMDB_GENRE_NAMES[id]) : []; }) : hiddenOf(t);
const notHidden = (m) => { const h = hiddenNames(m?.type || 'ANIME'); return !h.length || !(m?.genres || []).some(g => h.includes(g)); };

/* ------------------------------------------------------------------
   <quick-add>: hover the + on a poster → quick actions for the SOLO list.
   Desktop: click + opens the full editor. Touch screens: tap + opens a bottom sheet.
   ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
   One song as a row (Songs browse list + artist pages): number, cover, title, artists, album, year, length,
   your status, and a quick "like" / edit button
   ------------------------------------------------------------------ */
const TrackRow = {
    props: { song: Object, n: [Number, String], entry: Object, album: { type: Boolean, default: true }, cover: { type: Boolean, default: true }, selectable: Boolean, selected: Boolean, playing: Boolean },
    emits: ['open', 'artist', 'action', 'edit', 'select', 'play'],
    setup() { return { STATUS_COLORS, LABEL_SETS, fmtDuration }; },
    template: `
    <div class="track-row group" :class="{ mine: entry, sel: selected }" role="button" tabindex="0" @click="selectable ? $emit('select') : $emit('open')" @keydown.enter="selectable ? $emit('select') : $emit('open')">
        <span class="tr-n" :class="{ playing }"><i v-if="selectable" class="fa-solid" :class="selected ? 'fa-square-check text-volt' : 'fa-square text-mute'"></i><template v-else><span class="tr-num">{{ n }}</span><button @click.stop="$emit('play')" class="tr-play" :title="playing ? 'Pause' : 'Play preview'"><i class="fa-solid" :class="playing ? 'fa-pause' : 'fa-play'"></i></button></template></span>
        <img v-if="cover" :src="song.coverImage?.large" class="tr-cover" loading="lazy" decoding="async" alt="">
        <span class="tr-main">
            <span class="tr-title">{{ song.title?.romaji }}<span v-if="song.explicit" class="tr-e" title="Explicit">E</span></span>
            <span class="tr-artists"><template v-for="(a, k) in song.artists || []" :key="k"><span v-if="k" class="text-mute">, </span><button @click.stop="$emit('artist', k)" class="tr-artist">{{ a }}</button></template></span>
        </span>
        <span v-if="album" class="tr-album" :title="song.album">{{ (song.album || '').replace(/ - (Single|EP)$/, '') }}</span>
        <span class="tr-year">{{ song.seasonYear || '' }}</span>
        <span class="tr-len">{{ song.durationMs ? fmtDuration(song.durationMs) : '' }}</span>
        <span v-if="entry" class="tr-status" :style="{ '--dot': STATUS_COLORS[entry.status] }"><span class="qa-dot"></span><span class="tr-status-l">{{ LABEL_SETS.SONG.short[entry.status] || entry.status }}</span></span>
        <button v-if="!selectable" @click.stop="entry ? $emit('edit') : $emit('action', 'COMPLETED')" class="tr-add" :title="entry ? 'Edit' : 'Like'"><i class="fa-solid" :class="entry ? 'fa-pen' : 'fa-heart'"></i></button>
    </div>`,
};
const QuickAdd = {
    props: { anime: Object, entry: Object, open: Boolean, onList: Boolean },
    emits: ['action', 'edit', 'toggle'],
    // The menu is drawn on top of the page (not inside the poster), so a small card never cuts it off.
    // It opens above the + (or below it when there's no room above) and stays inside the screen.
    setup() {
        const btn = ref(null), menu = ref(null);
        const pos = reactive({ show: false, ready: false, x: 0, y: 0, below: false });
        const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
        let hideT = null;
        const place = () => {
            const b = btn.value?.getBoundingClientRect(), m = menu.value; if (!b || !m) return;
            const mh = m.offsetHeight, mw = m.offsetWidth, gap = 8;
            const below = b.top - mh - gap < 8 && b.bottom + mh + gap < innerHeight;
            pos.x = clamp(b.right - mw, 8, innerWidth - mw - 8);
            pos.y = below ? b.bottom + gap : Math.max(8, b.top - mh - gap);
            pos.below = below; pos.ready = true;
        };
        const shut = () => { clearTimeout(hideT); pos.show = false; pos.ready = false; window.removeEventListener('scroll', shut, true); };
        const enter = () => {
            if (!canHover) return;
            clearTimeout(hideT);
            if (!pos.show) { pos.show = true; pos.ready = false; window.addEventListener('scroll', shut, true); nextTick(place); }
        };
        const leave = () => { clearTimeout(hideT); hideT = setTimeout(shut, 140); };
        return { STATUS_COLORS, STATUS_LABELS, UNIT, fmtChapter, lastChapterOf, MAX_REPEATS, btn, menu, pos, enter, leave, shut };
    },
    unmounted() { this.shut(); },
    template: `
    <div class="absolute bottom-3 right-3 z-20 group/qa flex flex-col items-end pointer-events-none" @click.stop @mouseenter="enter" @mouseleave="leave">
        <teleport to="body">
            <div v-if="pos.show" ref="menu" class="qa-float" :class="{ ready: pos.ready, below: pos.below }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }" @mouseenter="enter" @mouseleave="leave" @click.stop>
                <div class="qa-menu" @click="shut">
                    <p class="px-2.5 pt-1.5 pb-1 font-mono text-[9px] font-bold tracking-[.16em] text-mute">SOLO LIST</p>
                    <button @click="$emit('action', 'EP')" class="qa-row" title="Add one">
                        <span class="font-mono text-[11px] font-bold text-volt w-2.5">+1</span> {{ UNIT.ep }}
                        <span class="ml-auto font-mono text-[10px] text-mute"><template v-if="entry?.status === 'REPEATING'"><i class="fa-solid fa-rotate-right text-[8px]"></i>{{ (entry.repeats || []).length }} · {{ (entry.repeats || [])[(entry.repeats || []).length - 1] || 0 }}</template><template v-else>{{ entry?.progress || 0 }}</template>{{ anime.type === 'GAME' ? ' hrs' : '/' + (anime.type === 'MANGA' ? fmtChapter(lastChapterOf(anime)) : (anime.episodes || '?')) }}</span>
                    </button>
                    <button v-for="s in (anime.type === 'SONG' ? ['WATCHING', 'COMPLETED', 'DROPPED'] : ['PLANNING', 'WATCHING', 'COMPLETED'])" :key="s" @click="$emit('action', s)" class="qa-row" :class="entry?.status === s ? 'bg-overlay' : ''">
                        <span class="qa-dot" :style="{ '--dot': STATUS_COLORS[s] }"></span> {{ STATUS_LABELS[s] }}
                        <i v-if="entry?.status === s" class="fa-solid fa-check ml-auto text-[10px]"></i>
                    </button>
                    <button v-if="(anime.type || 'ANIME') === 'ANIME' && (entry?.status === 'COMPLETED' || entry?.status === 'REPEATING')" @click="$emit('action', 'REPEATING')" class="qa-row" :class="entry?.status === 'REPEATING' ? 'bg-overlay' : ''">
                        <span class="qa-dot" :style="{ '--dot': STATUS_COLORS.REPEATING }"></span> Rewatch
                        <span class="ml-auto font-mono text-[10px] text-mute">{{ (entry.repeats || []).length }}/{{ MAX_REPEATS }}</span>
                    </button>
                    <div class="h-px bg-line my-1 mx-1"></div>
                    <button @click="$emit('edit')" class="qa-row text-sub hover:text-ink"><i class="fa-solid fa-user-group text-[11px] w-2.5"></i> Squads & more…</button>
                    <button v-if="onList" @click="$emit('action', 'REMOVE')" class="qa-row text-rose-300 hover:!bg-rose-500/10"><i class="fa-solid fa-trash-can text-[11px] w-2.5"></i> Remove from all</button>
                </div>
            </div>
        </teleport>
        <button ref="btn" @click="$emit('toggle')" :aria-expanded="open"
            :class="open || pos.show ? 'bg-volt text-onvolt border-volt' : 'bg-base/80 text-ink border-line2 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-hover/qa:bg-volt group-hover/qa:text-onvolt group-hover/qa:border-volt'"
            class="pointer-events-auto w-10 h-10 rounded-full border flex items-center justify-center transition-[opacity,background-color,color,transform] duration-200 ease-expo active:scale-90 shadow-lg" title="Add to list">
            <i class="fa-solid" :class="entry ? 'fa-pen text-xs' : 'fa-plus'"></i>
        </button>
    </div>`
};

/* <poster-card>: one anime poster, used on Browse, lists and friend profiles */
const PosterCard = {
    props: { anime: Object, entry: Object, solo: Object, i: { type: Number, default: 0 }, tag: String, quick: Boolean, menuOpen: Boolean, selectable: Boolean, selected: Boolean, editable: { type: Boolean, default: true }, ownList: { type: Boolean, default: true } },
    emits: ['open', 'action', 'edit', 'toggle', 'trailer', 'select'],
    setup(props, { emit }) {
        const rating = computed(() => {
            if (props.entry?.score > 0) return { value: formatScore(props.entry.score), mine: true, star: !/POINT_[35]$/.test(PREFS.scoreFormat) };
            if (props.anime?.averageScore) return { value: formatAvg(props.anime.averageScore), mine: false, star: true };
            return null;
        });
        const badge = computed(() => epBadge(props.anime));
        const mStatus = computed(() => mangaStatusOf(props.anime));
        const total = computed(() => props.anime?.type === 'MANGA' ? lastChapterOf(props.anime) : props.anime?.episodes);
        const pct = computed(() => total.value ? Math.min(100, (props.entry?.progress || 0) / total.value * 100) : 0);
        // manga posters ask MangaDex for their latest chapter + status once they scroll into view
        const root = ref(null);
        onMounted(() => { if (props.anime?.type === 'MANGA' && root.value) { root.value._manga = props.anime; mdSeen.observe(root.value); } });
        Vue.onBeforeUnmount(() => { if (root.value) mdSeen.unobserve(root.value); });
        const onClick = () => emit(props.selectable ? 'select' : 'open');
        return { STATUS_COLORS, STATUS_SHORT, UNIT, titleOf, rating, badge, pct, onClick, mStatus, total, root, fmtChapter };
    },
    template: `
    <div class="poster-hit group" @click.self="onClick">
    <div ref="root" class="poster poster-in" :class="{ 'is-selected': selected, 'is-selecting': selectable, 'is-square': anime.type === 'SONG' }" :style="{ '--i': i }" tabindex="0" role="button" @click="onClick" @keydown.enter.self="onClick">
        <img v-if="anime.coverImage?.large" :src="anime.coverImage.large" class="art" loading="lazy" decoding="async" alt="">
        <div class="scrim"></div>
        <div class="poster-top-l z-10 flex flex-col items-start gap-1.5">
            <span v-if="entry" class="status-pill" :title="STATUS_SHORT[entry.status]"><span class="status-dot" :style="{ '--dot': STATUS_COLORS[entry.status] }"></span><span class="st-text">{{ STATUS_SHORT[entry.status] }}</span></span>
            <span v-if="tag" class="max-w-full truncate px-2 py-1 rounded-md bg-base/80 font-mono text-[9px] font-bold tracking-widest uppercase text-ink"><i class="fa-solid fa-user-group mr-1"></i>{{ tag }}</span>
            <span v-if="mStatus" class="mstat" :style="{ '--c': mStatus.color }" :title="'Publishing status: ' + mStatus.label"><i></i>{{ mStatus.label }}</span>
        </div>
        <div class="poster-top-r z-10">
            <div v-if="rating" :class="{ mine: rating.mine }" class="rating" :title="rating.mine ? 'Your score' : anime.type === 'GAME' ? 'IGDB rating' : 'AniList average'"><i v-if="rating.star" class="fa-solid fa-star star"></i>{{ rating.value }}</div>
            <div v-if="badge" class="ep-badge" :title="anime.type === 'MANGA' ? 'Latest chapter' : anime.status === 'RELEASING' ? 'Released so far / total' : 'Length'">{{ badge }}</div>
        </div>
        <div class="absolute bottom-0 inset-x-0 p-3.5 pr-14 z-10 pointer-events-none">
            <p class="text-ink font-semibold text-sm leading-snug line-clamp-2">{{ titleOf(anime) }}</p>
            <template v-if="entry">
                <p v-if="anime.type === 'GAME'" class="mt-1 font-mono text-[10px] font-bold tracking-wide" :style="{ color: STATUS_COLORS[entry.status] }">{{ entry.progress || 0 }} HRS</p>
                <p v-else class="mt-1 font-mono text-[10px] font-bold tracking-wide" :style="{ color: STATUS_COLORS[entry.status] }">{{ entry.progress || 0 }}/{{ total ? fmtChapter(total) : '?' }} {{ UNIT.unit }}</p>
                <div v-if="total" class="mt-2 h-[3px] rounded-full bg-white/10 overflow-hidden">
                    <div class="h-full rounded-full transition-[width] duration-500 ease-expo" :style="{ width: pct + '%', background: STATUS_COLORS[entry.status] }"></div>
                </div>
            </template>
        </div>
        <template v-if="selectable">
            <div class="absolute inset-0 z-20 transition-colors" :class="selected ? 'bg-lilac/15' : 'bg-transparent'"></div>
            <span class="select-check" :class="{ on: selected }"><i class="fa-solid fa-check"></i></span>
        </template>
        <template v-else>
            <button v-if="anime.trailer?.id || anime.type === 'SONG'" @click.stop="$emit('trailer')" :title="anime.type === 'SONG' ? 'Play preview' : 'Play trailer'" class="trailer-btn"><i class="fa-solid fa-play text-[13px] ml-0.5"></i></button>
            <quick-add v-if="quick" :anime="anime" :entry="solo" :open="menuOpen" :on-list="ownList ? !!entry : !!solo" @action="$emit('action', $event)" @edit="$emit('edit')" @toggle="$emit('toggle')"></quick-add>
            <button v-else-if="editable" @click.stop="$emit('edit')" title="Edit" class="absolute bottom-3 right-3 z-20 w-10 h-10 rounded-full bg-base/80 border border-line2 text-ink flex items-center justify-center [@media(hover:hover)]:opacity-0 group-hover:opacity-100 hover:bg-volt hover:text-onvolt hover:border-volt transition-[opacity,background-color,color] duration-200"><i class="fa-solid fa-pen text-xs"></i></button>
        </template>
    </div>
    </div>`
};

/* <user-avatar>: round avatar with accent ring */
const UserAvatar = {
    props: { user: Object, size: { type: Number, default: 36 } },
    setup(props) {
        const initial = computed(() => (props.user?.username || '?').charAt(0).toUpperCase());
        const frame = computed(() => { const f = props.user?.decor?.frame; return f && f !== 'none' ? f : ''; });
        return { initial, frame };
    },
    template: `
    <span class="relative inline-flex shrink-0 rounded-full" :class="frame ? 'av-frame f-' + frame : ''" :style="{ width: size + 'px', height: size + 'px', '--fw': Math.max(2, Math.round(size / 16)) + 'px', boxShadow: frame ? 'none' : '0 0 0 2px ' + (user?.accent || '#3A3A46') }">
        <img v-if="user?.avatar_url" :src="user.avatar_url" class="w-full h-full rounded-full object-cover" alt="">
        <span v-else class="w-full h-full rounded-full flex items-center justify-center font-semibold text-onaccent" :style="{ background: 'linear-gradient(135deg,' + (user?.accent || '#B490F5') + ',#FF4D8D)', fontSize: Math.round(size * .42) + 'px' }">{{ initial }}</span>
    </span>`
};

/* <score-input v-model="form.score">: shows the right control for your scoring system (score is stored 0–10) */
const ScoreInput = {
    props: { modelValue: { type: Number, default: 0 }, big: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const fmt = computed(() => PREFS.scoreFormat);
        const shown = computed(() => {
            const v = Number(props.modelValue) || 0;
            if (fmt.value === 'POINT_100') return v ? Math.round(v * 10) : '';
            if (fmt.value === 'POINT_10') return v ? Math.round(v) : '';
            return v ? Math.round(v * 10) / 10 : '';
        });
        const max = computed(() => fmt.value === 'POINT_100' ? 100 : 10);
        const step = computed(() => fmt.value === 'POINT_10_DECIMAL' ? 0.1 : 1);
        const onInput = (e) => {
            const n = Number(e.target.value);
            if (!e.target.value || Number.isNaN(n)) { emit('update:modelValue', 0); return; }
            emit('update:modelValue', clamp(fmt.value === 'POINT_100' ? n / 10 : n, 0, 10));
        };
        const stars = computed(() => Math.round((Number(props.modelValue) || 0) / 2));
        const setStars = (n) => emit('update:modelValue', stars.value === n ? 0 : n * 2);
        const smiley = computed(() => (Number(props.modelValue) || 0) > 0 ? smileyOf(props.modelValue).v : 0);
        const setSmiley = (v) => emit('update:modelValue', smiley.value === v ? 0 : v);
        return { fmt, shown, max, step, onInput, stars, setStars, smiley, setSmiley, SMILEYS };
    },
    template: `
    <div class="score-input" :class="{ big }">
        <div v-if="fmt === 'POINT_5'" class="flex items-center justify-center gap-1 h-full">
            <button v-for="n in 5" :key="n" type="button" @click="setStars(n)" class="star-btn" :class="{ on: n <= stars }" :title="n + ' / 5'"><i class="fa-star" :class="n <= stars ? 'fa-solid' : 'fa-regular'"></i></button>
        </div>
        <div v-else-if="fmt === 'POINT_3'" class="flex items-center justify-center gap-2 h-full">
            <button v-for="f in SMILEYS" :key="f.v" type="button" @click="setSmiley(f.v)" class="star-btn" :class="{ on: smiley === f.v }" :title="f.l"><i class="fa-regular" :class="f.icon"></i></button>
        </div>
        <label v-else class="flex items-center h-full">
            <input :value="shown" @change="onInput" type="number" min="0" :max="max" :step="step" placeholder="–" class="score-num">
            <span class="pr-3 font-mono text-xs text-mute whitespace-nowrap">/ {{ max }}</span>
        </label>
    </div>`
};

/* v-infinite="fn": calls fn when the element comes near the screen (Browse infinite scroll) */
const INF_ELS = new Set();
const recheckInfinite = () => nextTick(() => INF_ELS.forEach(el => el._recheck?.()));
/* ------------------------------------------------------------------
   Dropdowns in the site's own style. Every <select class="chip"> keeps working as a normal select (Vue's v-model and
   @change don't change), but instead of the browser's plain list it opens this themed menu, built from the select's
   current options each time. Picking writes the value back and fires "change"/"input" like a real pick.
   <select data-multi> menus stay open, so you can tick several genres / tags in a row.
   ------------------------------------------------------------------ */
const Dropdowns = (() => {
    let pop = null, sel = null, items = [], active = -1, query = '';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const close = () => {
        if (!pop) return;
        pop.remove(); pop = null; sel?.closest('.chip-wrap')?.classList.remove('dd-open'); sel?.classList.remove('dd-open');
        sel = null; items = []; active = -1; query = '';
    };
    const place = () => {
        if (!pop || !sel) return;
        const r = sel.getBoundingClientRect(), w = Math.max(r.width, 220), h = pop.offsetHeight;
        const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
        const below = window.innerHeight - r.bottom - 8, top = below >= Math.min(h, 240) || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
        Object.assign(pop.style, { left: left + 'px', top: top + 'px', minWidth: w + 'px', maxHeight: Math.max(160, (top > r.top ? below : r.top - 14)) + 'px' });
    };
    const render = () => {
        const multi = sel.hasAttribute('data-multi'); const q = query.trim().toLowerCase();
        const rows = []; items = [];
        [...sel.children].forEach((node) => {
            const opts = node.tagName === 'OPTGROUP' ? [...node.children] : [node];
            const shown = opts.filter(o => o.value !== '' || !multi).filter(o => !q || o.textContent.toLowerCase().includes(q));
            if (!shown.length) return;
            if (node.tagName === 'OPTGROUP') rows.push(`<div class="dd-group">${esc(node.label)}</div>`);
            shown.forEach(o => {
                const text = o.textContent.replace(/^✓\s*/, ''); const on = multi ? /^✓/.test(o.textContent) : o.value === sel.value;
                const i = items.push(o) - 1;
                rows.push(`<button type="button" class="dd-opt${on ? ' on' : ''}${o.disabled ? ' off' : ''}" data-i="${i}"${o.disabled ? ' disabled' : ''}><span class="dd-tick">${on ? '<i class="fa-solid fa-check"></i>' : ''}</span><span class="dd-text">${esc(text || '—')}</span></button>`);
            });
        });
        const list = pop.querySelector('.dd-list');
        list.innerHTML = rows.join('') || '<p class="dd-empty">Nothing matches</p>';
        if (active < 0) active = items.findIndex(o => (multi ? /^✓/.test(o.textContent) : o.value === sel.value));
        mark();
    };
    const mark = () => {
        pop?.querySelectorAll('.dd-opt').forEach(b => b.classList.toggle('kb', Number(b.dataset.i) === active));
        pop?.querySelector('.dd-opt.kb')?.scrollIntoView({ block: 'nearest' });
    };
    const pick = (i) => {
        const o = items[i]; if (!o || o.disabled || !sel) return;
        const s = sel, multi = s.hasAttribute('data-multi');
        s.value = o.value;
        s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
        if (multi) { active = i; setTimeout(() => { if (pop && sel === s) { render(); place(); } }, 0); }   // the ✓ list refreshes after Vue updates
        else { close(); s.focus({ preventScroll: true }); }
    };
    const open = (s) => {
        if (sel === s) { close(); return; }
        close(); if (s.disabled) return;
        sel = s; s.classList.add('dd-open'); s.closest('.chip-wrap')?.classList.add('dd-open');
        const count = s.querySelectorAll('option').length;
        pop = document.createElement('div'); pop.className = 'dd-pop'; pop.setAttribute('role', 'listbox');
        pop.innerHTML = (count > 12 ? '<div class="dd-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" placeholder="Search…" aria-label="Search options"></div>' : '') + '<div class="dd-list"></div>';
        document.body.appendChild(pop);
        render(); place();
        const input = pop.querySelector('.dd-search input');
        if (input) { input.addEventListener('input', () => { query = input.value; active = -1; render(); place(); }); setTimeout(() => input.focus({ preventScroll: true }), 10); }
        pop.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });   // keep focus where it is
        pop.addEventListener('click', (e) => { const b = e.target.closest('.dd-opt'); if (b) pick(Number(b.dataset.i)); });
    };
    const key = (e) => {
        if (!pop) {
            if (e.target.matches?.('select.chip') && (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); open(e.target); }
            return;
        }
        if (e.key === 'Escape') { e.preventDefault(); const s = sel; close(); s?.focus({ preventScroll: true }); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const d = e.key === 'ArrowDown' ? 1 : -1; let i = active; do { i = (i + d + items.length) % items.length; } while (items[i]?.disabled && i !== active); active = i; mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(active); }
        else if (e.key === 'Tab') close();
    };
    let touchY = 0, touchX = 0;
    return {
        init() {
            // mouse: stop the browser's own list and show ours
            document.addEventListener('mousedown', (e) => {
                const s = e.target.closest?.('select.chip');
                if (s && e.button === 0) { e.preventDefault(); s.focus({ preventScroll: true }); open(s); return; }
                if (pop && !pop.contains(e.target)) close();
            }, true);
            // touch: a tap (not a scroll of the filter row) opens ours instead of the phone's picker
            document.addEventListener('touchstart', (e) => { const t = e.touches[0]; touchX = t.clientX; touchY = t.clientY; if (pop && !pop.contains(e.target) && !e.target.closest?.('select.chip')) close(); }, { passive: true, capture: true });
            document.addEventListener('touchend', (e) => {
                const s = e.target.closest?.('select.chip'); if (!s) return;
                const t = e.changedTouches[0]; if (Math.abs(t.clientX - touchX) > 8 || Math.abs(t.clientY - touchY) > 8) return;
                e.preventDefault(); open(s);
            }, { capture: true });
            document.addEventListener('keydown', key, true);
            window.addEventListener('resize', close);
            window.addEventListener('scroll', (e) => { if (pop && !pop.contains(e.target)) place(); }, true);
            // if Vue removes the select (you changed page) the menu goes too
            setInterval(() => { if (sel && !document.body.contains(sel)) close(); }, 500);
        },
        close,
    };
})();
Dropdowns.init();

// v-dock-height: the pinned filter bar tells the page how tall it is (--dock-h), so the sidebar can stick just below it
const DockHeight = {
    mounted(el) {
        const set = () => document.documentElement.style.setProperty('--dock-h', el.offsetHeight + 'px');
        el._dockRO = new ResizeObserver(set); el._dockRO.observe(el); set();
    },
    unmounted(el) { el._dockRO?.disconnect(); document.documentElement.style.setProperty('--dock-h', '0px'); },
};
const InfiniteScroll = {
    mounted(el, binding) {
        el._fn = binding.value;
        el._io = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) el._fn?.(); }, { rootMargin: '900px 0px' });
        el._io.observe(el);
        el._recheck = () => { el._io.unobserve(el); el._io.observe(el); };   // re-observing reports the current state again
        INF_ELS.add(el);
    },
    updated(el, binding) { el._fn = binding.value; },
    unmounted(el) { el._io?.disconnect(); INF_ELS.delete(el); },
};

createApp({
    setup() {
        // ---------- state ----------
        const authReady = ref(false);
        const currentUser = ref(null);
        const currentProfile = ref(null);
        const isSignUp = ref(false);
        const authLoading = ref(false);
        const authForm = ref({ email: '', password: '', username: '' });

        const currentAppView = ref('home');
        const activeTab = ref('browse');
        const section = ref('anime');
        const sectionMenu = ref(false);
        const viewUserId = ref(null);             // friend profile being viewed
        const currentSection = computed(() => SECTIONS[section.value] || SECTIONS.anime);
        const mediaType = computed(() => currentSection.value.type || 'ANIME');
        const sectionList = SECTION_LIST;
        const tabs = [
            { id: 'browse', label: 'Browse', icon: 'fa-compass' },
            { id: 'top', label: 'Top 100', icon: 'fa-trophy' },
            { id: 'feed', label: 'Feed', icon: 'fa-bolt' },
            { id: 'coop', label: 'Squads', icon: 'fa-user-group' },
            { id: 'solo', label: 'Solo', icon: 'fa-user' },
            { id: 'profile', label: 'Profile', icon: 'fa-circle-user' },
        ];

        const results = ref([]);
        const trendingTop = ref([]);
        const isLoading = ref(false);
        const isLoadingMore = ref(false);
        const browseError = ref('');
        const currentPage = ref(1);
        const hasNextPage = ref(false);
        const selectedAnime = ref(null);
        const detailLoading = ref(false);
        const defaultFilters = () => ({ search: '', genre: '', tag: '', year: '', season: '', status: '', format: '', country: '', platform: '', coop: false, sort: '', hideExplicit: false, isAdult: false, hideMyAnime: false });
        const tagCollection = ref([]);
        const fetchTags = async () => {
            if (tagCollection.value.length) return;
            try { const data = await anilistLow('query { MediaTagCollection { name category isAdult } }', {}); tagCollection.value = data?.MediaTagCollection || []; } catch {}
        };
        const tagGroups = computed(() => {
            const g = {};
            tagCollection.value.filter(t => filters.value.isAdult || !t.isAdult).forEach(t => { const c = (t.category || 'Other').split('-')[0]; (g[c] = g[c] || []).push(t.name); });
            return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, names]) => ({ cat, names: names.sort() }));
        });
        const filters = ref(defaultFilters());

        const listFilterStatus = ref('ALL');
        const listFilterGroup = ref('ALL');       // squad id on the Squads tab
        const listSearchQuery = ref('');

        const currentYear = new Date().getFullYear();
        const availableYears = Array.from({ length: 60 }, (_, i) => currentYear + 1 - i);
        const availableGenres = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

        const soloList = ref([]);                 // your list (cloud)
        const favCharacters = ref([]);            // your favourite characters (cloud)
        const squads = ref([]);                   // [{ id, name, color, created_by, members: [profile] }]
        const coopList = ref([]);                 // squad entries
        const friendsList = ref([]);
        const pendingRequests = ref([]);
        const sentRequests = ref([]);
        const friendEntries = ref([]);            // friends' lists (for "trending among friends")
        const notifications = ref([]);
        const daysActive = ref(0);
        const friendUsername = ref('');
        const friendBusy = ref(false);
        const isSaving = ref(false);

        const secSolo = computed(() => soloList.value.filter(i => typeOf(i) === mediaType.value));
        const secCoop = computed(() => coopList.value.filter(i => typeOf(i) === mediaType.value));

        const editForm = ref(emptyForm());
        const inlineForm = ref(emptyForm());

        const toast = ref({ message: '', type: 'success' });
        let toastTimer;
        const showToast = (message, type = 'success') => {
            toast.value = { message, type };
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.value.message = ''; }, type === 'error' ? 4000 : 2400);
        };
        // In-app confirm dialog (replaces the browser's confirm() pop-up). Resolves true/false.
        // `input` is null for a yes/no question, or the text of the box when it asks for a name (askText)
        const confirmBox = reactive({ open: false, title: '', body: '', ok: 'Confirm', danger: true, resolve: null, input: null, max: 40, placeholder: '' });
        const askConfirm = ({ title, body = '', ok = 'Confirm', danger = true }) => new Promise((resolve) => {
            if (confirmBox.resolve) confirmBox.resolve(false);
            Object.assign(confirmBox, { open: true, title, body, ok, danger, resolve, input: null });
        });
        // in-app text pop-up (replaces the browser's prompt()). Resolves the trimmed text, or null if cancelled.
        const askText = ({ title, body = '', value = '', ok = 'Save', max = 40, placeholder = '' }) => new Promise((resolve) => {
            if (confirmBox.resolve) confirmBox.resolve(false);
            Object.assign(confirmBox, { open: true, title, body, ok, danger: false, input: value, max, placeholder,
                resolve: (yes) => resolve(yes ? (confirmBox.input || '').trim().slice(0, max) || null : null) });
        });
        const closeConfirm = (answer) => {
            const r = confirmBox.resolve;
            Object.assign(confirmBox, { open: false, resolve: null });
            r?.(!!answer);
        };

        // Supabase returns at most 1000 rows per request, so big lists (1000+ titles) are read in pages.
        const selectAll = async (build, max = 20000) => {
            const out = [];
            for (let from = 0; from < max; from += 1000) {
                const { data, error } = await build().range(from, from + 999);
                if (error) return { data: out.length ? out : null, error };
                out.push(...(data || []));
                if (!data || data.length < 1000) break;
            }
            return { data: out, error: null };
        };
        const initialOf = (name) => (name || '?').charAt(0).toUpperCase();
        const uid = () => currentUser.value?.id;

        // everyone we know about (me, friends, squad members) by id
        const profileById = computed(() => {
            const m = new Map();
            friendsList.value.forEach(f => m.set(f.id, f));
            squads.value.forEach(s => s.members.forEach(p => { if (!m.has(p.id)) m.set(p.id, p); }));
            extraProfiles.value.forEach(p => { if (!m.has(p.id)) m.set(p.id, p); });
            if (currentProfile.value) m.set(currentProfile.value.id, currentProfile.value);
            return m;
        });
        const extraProfiles = ref([]);
        const ensureProfiles = async (ids) => {
            const missing = [...new Set(ids.filter(id => id && !profileById.value.has(id)))];
            if (!missing.length) return;
            const { data } = await sb.from('profiles').select('*').in('id', missing);
            if (data?.length) extraProfiles.value = [...extraProfiles.value, ...data];
        };
        const personOf = (id) => profileById.value.get(id) || { id, username: 'Someone' };

        // ---------- INTRO ----------
        const introMode = ref('done');
        let introTimer;
        const INTRO_KEY = 'anicoop_intro_at';
        const playIntro = () => {
            let last = 0; try { last = Number(localStorage.getItem(INTRO_KEY)) || 0; } catch {}
            const full = Date.now() - last > 6 * 3600 * 1000;
            try { localStorage.setItem(INTRO_KEY, String(Date.now())); } catch {}
            introMode.value = full ? 'full' : 'quick';
            clearTimeout(introTimer);
            introTimer = setTimeout(() => { introMode.value = 'done'; }, full ? 3600 : 1100);
        };
        const skipIntro = () => { if (introMode.value !== 'done') { clearTimeout(introTimer); introMode.value = 'done'; } };
        watch(() => currentAppView.value === 'home' && !!currentUser.value, (on) => { if (on) playIntro(); }, { immediate: true });

        // ---------- load everything for the signed-in user ----------
        let loadedUserId = null;
        const loadUserData = async () => {
            if (!uid() || loadedUserId === uid()) return;
            loadedUserId = uid();
            await fetchProfile();
            await fetchSettings();
            markActive();
            await fetchFriends();
            await Promise.all([fetchSolo(), fetchFavs(), fetchFavStaff(), fetchSquads(), fetchNotifications()]);
            migrateLocalData();
            fetchFriendEntries();
            setupRealtimeSync();
            fetchPrivacy();
            fetchStatPrivacy();
            loadRoles().then(loadOwnerState, loadOwnerState);
            fetchChats();
            fetchRankOrders(uid(), myRankOrders);
            fetchBuddies();
            fetchOwnerId(); fetchPlaylists();
            startPresence(); touchLastSeen();
            fetchFollows().then(() => setTimeout(checkFollowed, 6000));
            loadAniListLink();
            setTimeout(checkListMedia, 8000); setTimeout(checkGames, 11000);
        };
        const clearUserData = () => {
            loadedUserId = null;
            teardownRealtime();
            currentProfile.value = null;
            soloList.value = []; coopList.value = []; favCharacters.value = []; squads.value = [];
            friendsList.value = []; pendingRequests.value = []; sentRequests.value = []; friendEntries.value = [];
            notifications.value = []; daysActive.value = 0; feed.value = []; favStaff.value = []; entity.value = null; chats.value = []; chatWith.value = null; chatMessages.value = []; adultAllowed.value = false; isOwner.value = false; extraProfiles.value = []; settingsLoaded = false; settingsOpen.value = false;
            selectedAnime.value = null; editForm.value = emptyForm();
            follows.value = []; buddies.value = []; playlists.value = []; plOpen.value = null; closePlayer(); alLink.value = null; mediaLinks.value = [];
            stopPresence(); people.value = [];
            randomOpen.value = false; quickMenuFor.value = null; selectMode.value = false; selected.value = new Map();
            currentAppView.value = 'home'; viewUserId.value = null; entity.value = null;
            navIndex.value = 0;
            try { history.replaceState(navState(), ''); } catch {}
            try { sessionStorage.removeItem('anicoop_nav_v1'); } catch {}
        };

        const handleAuth = async () => {
            authLoading.value = true;
            try {
                const email = authForm.value.email.trim();
                const password = authForm.value.password;
                if (isSignUp.value) {
                    const username = authForm.value.username.trim();
                    if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) { showToast('Username: 3–20 letters, numbers, _ or .', 'error'); return; }
                    const { data: taken } = await sb.from('profiles').select('id').ilike('username', escapeLike(username)).maybeSingle();
                    if (taken) { showToast('That username is already taken', 'error'); return; }
                    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
                    if (error) { showToast(/database error/i.test(error.message) ? 'That username is already taken' : error.message, 'error'); return; }
                    if (!data.session) { showToast('Account created! Check your email to confirm, then sign in.'); isSignUp.value = false; }
                    else showToast('Account created!');
                } else {
                    const { error } = await sb.auth.signInWithPassword({ email, password });
                    if (error) { showToast(error.message, 'error'); return; }
                    showToast('Logged in — welcome back!');
                }
                authForm.value.password = '';
            } finally {
                authLoading.value = false;
            }
        };
        const signOut = async () => { await sb.auth.signOut(); showToast('Signed out'); };

        const fetchProfile = async () => {
            const { data, error } = await sb.from('profiles').select('*').eq('id', uid()).maybeSingle();   // includes banner_url
            if (error) { console.error(error); return; }
            if (data) { currentProfile.value = data; return; }
            const username = currentUser.value.user_metadata?.username || currentUser.value.email.split('@')[0];
            const { data: created, error: insErr } = await sb.from('profiles').insert({ id: uid(), username }).select().single();
            if (insErr) showToast('Could not create your profile: ' + insErr.message, 'error');
            else currentProfile.value = created;
        };

        // ---------- days active ----------
        const countDays = async (userId) => {
            const { count } = await sb.from('user_activity').select('day', { count: 'exact', head: true }).eq('user_id', userId);
            return count || 0;
        };
        const markActive = async () => {
            await sb.from('user_activity').upsert({ user_id: uid(), day: localDay() }, { onConflict: 'user_id,day', ignoreDuplicates: true });
            daysActive.value = await countDays(uid());
        };

        // ---------- solo list + favourites (cloud) ----------
        const fetchSolo = async () => {
            const { data, error } = await selectAll(() => sb.from('list_entries').select('*').eq('user_id', uid()).order('updated_at', { ascending: false }).order('media_id'));
            if (error) { console.error(error); showToast('Could not load your list: ' + error.message, 'error'); return; }
            soloList.value = (data || []).filter(r => r.media_data?.id).map(listRow);
        };
        const fetchFavs = async () => {
            const { data } = await sb.from('favorite_characters').select('*').eq('user_id', uid()).order('created_at');
            favCharacters.value = (data || []).map(r => r.data);
        };
        // saves that don't mention the repeat counters (status buttons, batch edits…) keep the ones already saved
        const withRepeats = (e) => {
            if (e.repeats !== undefined && e.lilbro !== undefined) return e;
            const o = soloList.value.find(i => i.anime?.id === e.anime.id);
            return { ...e, repeats: e.repeats ?? o?.repeats ?? [], lilbro: e.lilbro ?? o?.lilbro ?? false };
        };
        const soloRow = (e) => { e = withRepeats(e); return { user_id: uid(), media_id: e.anime.id, media_type: e.anime.type || 'ANIME', media_data: entryData(e), status: e.status, score: e.score || 0, progress: e.progress || 0, updated_at: new Date().toISOString() }; };
        const upsertSolo = async (entries) => {
            const list = (Array.isArray(entries) ? entries : [entries]).map(withRepeats);
            const { error } = await sb.from('list_entries').upsert(list.map(soloRow), { onConflict: 'user_id,media_id' });
            if (error) throw error;
            list.forEach(e => alEnqueue(e.anime.id, alSaveOp(e)));
        };
        // AniList counts a rewatch's episodes in "progress" and the finished rewatches in "repeat"
        const alSaveOp = (e) => {
            const reps = e.repeats || [], full = e.anime?.episodes || 0;
            return { kind: 'save', status: e.status, progress: e.status === 'REPEATING' ? (reps[reps.length - 1] || 0) : e.progress, score: e.score, repeat: full ? reps.filter(n => n >= full).length : 0 };
        };
        const deleteSolo = async (ids) => {
            const list = Array.isArray(ids) ? ids : [ids];
            const { error } = await sb.from('list_entries').delete().eq('user_id', uid()).in('media_id', list);
            if (error) throw error;
            list.forEach(id => alEnqueue(id, { kind: 'delete' }));
        };
        const setSoloLocal = (entry) => {
            const idx = soloList.value.findIndex(i => i.anime.id === entry.anime.id);
            if (idx !== -1) soloList.value[idx] = entry; else soloList.value.unshift(entry);
        };

        // Lists used to live in this browser only → copy them to the cloud once
        const migrateLocalData = async () => {
            const flag = `anicoop_migrated:${uid()}`;
            try { if (localStorage.getItem(flag)) return; } catch { return; }
            const localSolo = readJSON(`aniSoloList:${uid()}`) || readJSON('aniSoloListPro') || [];
            const localFavs = readJSON(`aniFavChars:${uid()}`) || readJSON('aniFavChars') || [];
            const have = new Set(soloList.value.map(i => i.anime.id));
            const toAdd = localSolo.filter(i => i?.anime?.id && !have.has(i.anime.id));
            try {
                if (toAdd.length) { await upsertSolo(toAdd.map(i => ({ ...i, anime: normMedia(i.anime) }))); await fetchSolo(); }
                const favHave = new Set(favCharacters.value.map(c => c.id));
                const favAdd = localFavs.filter(c => c?.id && !favHave.has(c.id));
                if (favAdd.length) { await sb.from('favorite_characters').upsert(favAdd.map(c => ({ user_id: uid(), character_id: c.id, data: c })), { onConflict: 'user_id,character_id' }); await fetchFavs(); }
                localStorage.setItem(flag, '1');
                if (toAdd.length || favAdd.length) showToast(`Moved ${toAdd.length} saved shows to the cloud — friends can see your profile now`);
            } catch (err) { console.error('migration failed', err); }
        };

        // ---------- photo cropper (profile picture = circle, banner = 3:1) ----------
        const avatarInput = ref(null);
        const avatarUploading = ref(false);
        const CROP_VIEW = 280;
        const cropper = reactive({ open: false, src: '', w: 0, h: 0, zoom: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0, target: 'profile', kind: 'avatar' });
        const cropVW = computed(() => cropper.kind === 'banner' ? 336 : CROP_VIEW);
        const cropVH = computed(() => cropper.kind === 'banner' ? 112 : CROP_VIEW);
        let cropImg = null;
        const cropBase = computed(() => cropper.w ? Math.max(cropVW.value / cropper.w, cropVH.value / cropper.h) : 1);
        const cropScale = computed(() => cropBase.value * cropper.zoom);
        const clampCrop = () => {
            const mx = Math.max(0, (cropper.w * cropScale.value - cropVW.value) / 2);
            const my = Math.max(0, (cropper.h * cropScale.value - cropVH.value) / 2);
            cropper.x = clamp(cropper.x, -mx, mx); cropper.y = clamp(cropper.y, -my, my);
        };
        const cropImgStyle = computed(() => ({
            width: cropper.w * cropScale.value + 'px', height: cropper.h * cropScale.value + 'px',
            transform: `translate(calc(-50% + ${cropper.x}px), calc(-50% + ${cropper.y}px))`,
        }));
        watch(() => cropper.zoom, clampCrop);
        const pickImage = (target, kind) => { cropper.target = target; cropper.kind = kind; avatarInput.value?.click(); };
        const changeProfilePic = (target = 'profile') => pickImage(target, 'avatar');
        const changeBanner = (target = 'edit') => pickImage(target, 'banner');
        // GIFs can't go through the canvas cropper without losing their animation, so they're
        // uploaded as-is (object-cover in the CSS handles the crop visually).
        const useAnimatedImage = async (file) => {
            const banner = cropper.kind === 'banner';
            const target = settingsOpen.value && settingsTab.value === 'profile' ? 'edit' : cropper.target;
            avatarUploading.value = true;
            try {
                const path = `${uid()}/${banner ? 'banner' : 'avatar'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.gif`;
                const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: 'image/gif', upsert: false });
                if (error) throw error;
                const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
                const url = data.publicUrl;
                if (target === 'edit') { if (banner) profileEdit.banner_url = url; else profileEdit.avatar_url = url; return; }
                await saveProfileFields(banner ? { banner_url: url } : { avatar_url: url });
                showToast(banner ? 'Banner updated!' : 'Profile picture updated!');
            } catch (err) {
                showToast('Could not upload GIF: ' + (err.message || err) + (/bucket/i.test(err.message || '') ? ' — run the v7 SQL in Supabase' : ''), 'error');
            } finally { avatarUploading.value = false; }
        };
        const onAvatarFile = (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
            if (file.type === 'image/gif') {
                if (file.size > 8 * 1024 * 1024) { showToast('GIF is too large (max 8 MB)', 'error'); return; }
                useAnimatedImage(file);
                return;
            }
            if (file.size > 20 * 1024 * 1024) { showToast('Image is too large (max 20 MB)', 'error'); return; }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { cropImg = img; Object.assign(cropper, { open: true, src: url, w: img.naturalWidth, h: img.naturalHeight, zoom: 1, x: 0, y: 0 }); };
            img.onerror = () => showToast('That file could not be read as an image', 'error');
            img.src = url;
        };
        const cropDown = (e) => { cropper.dragging = true; cropper.sx = e.clientX; cropper.sy = e.clientY; cropper.ox = cropper.x; cropper.oy = cropper.y; e.currentTarget.setPointerCapture?.(e.pointerId); };
        const cropMove = (e) => { if (!cropper.dragging) return; cropper.x = cropper.ox + (e.clientX - cropper.sx); cropper.y = cropper.oy + (e.clientY - cropper.sy); clampCrop(); };
        const cropUp = () => { cropper.dragging = false; };
        const cropWheel = (e) => { cropper.zoom = clamp(cropper.zoom + (e.deltaY < 0 ? 0.08 : -0.08), 1, 4); };
        const closeCropper = () => { if (cropper.src) URL.revokeObjectURL(cropper.src); cropper.open = false; cropper.src = ''; cropImg = null; };
        const renderCrop = (outW, outH) => {
            const canvas = document.createElement('canvas'); canvas.width = outW; canvas.height = outH;
            const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
            const s = cropScale.value, vw = cropVW.value / s, vh = cropVH.value / s;
            const cx = cropper.w / 2 - cropper.x / s, cy = cropper.h / 2 - cropper.y / s;
            ctx.drawImage(cropImg, cx - vw / 2, cy - vh / 2, vw, vh, 0, 0, outW, outH);
            return canvas.toDataURL('image/jpeg', cropper.kind === 'banner' ? 0.8 : 0.86);
        };
        const applyCrop = async () => {
            if (!cropImg) return;
            const banner = cropper.kind === 'banner';
            const dataUrl = banner ? renderCrop(1200, 400) : renderCrop(320, 320);
            const target = settingsOpen.value && settingsTab.value === 'profile' ? 'edit' : cropper.target;
            closeCropper();
            if (target === 'edit') { if (banner) profileEdit.banner_url = dataUrl; else profileEdit.avatar_url = dataUrl; return; }
            avatarUploading.value = true;
            try { await saveProfileFields(banner ? { banner_url: dataUrl } : { avatar_url: dataUrl }); showToast(banner ? 'Banner updated!' : 'Profile picture updated!'); }
            catch (err) { showToast('Could not update picture: ' + (err.message || err), 'error'); }
            finally { avatarUploading.value = false; }
        };
        const saveProfileFields = async (fields) => {
            const { error } = await sb.from('profiles').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', uid());
            if (error) throw error;
            currentProfile.value = { ...currentProfile.value, ...fields };
        };
        const removeProfilePic = async () => {
            try { await saveProfileFields({ avatar_url: null }); showToast('Profile picture removed'); }
            catch (err) { showToast(err.message || String(err), 'error'); }
        };

        // ---------- SETTINGS ----------
        const settingsOpen = ref(false);
        const settingsTab = ref('account');
        const SETTINGS_TABS = [
            { id: 'account', label: 'Account', icon: 'fa-user-gear' },
            { id: 'theme', label: 'Theme', icon: 'fa-palette' },
            { id: 'profile', label: 'Profile', icon: 'fa-id-badge' },
            { id: 'lists', label: 'Lists', icon: 'fa-list-ul' },
            { id: 'privacy', label: 'Privacy', icon: 'fa-user-shield' },
            { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
            { id: 'import', label: 'Import & sync', icon: 'fa-file-import' },
            { id: 'owner', label: 'Admin', icon: 'fa-crown', owner: true },
        ];
        const notifPrefs = reactive({});
        let settingsLoaded = false;
        const fetchSettings = async () => {
            const { data, error } = await sb.from('user_settings').select('settings, notif_prefs').eq('user_id', uid()).maybeSingle();
            if (error) { console.warn('settings', error.message); settingsLoaded = true; return; }   // v3 database: keep local settings
            if (data) {
                Object.assign(PREFS, mergePrefs(defaultPrefs(), data.settings));
                Object.keys(notifPrefs).forEach(k => delete notifPrefs[k]);
                Object.assign(notifPrefs, data.notif_prefs || {});
                applyTheme();
            }
            settingsLoaded = true;
            if (!data) saveSettings();   // first time: upload what this browser had
        };
        const saveSettings = debounce(async () => {
            if (!uid() || !settingsLoaded) return;
            const { error } = await sb.from('user_settings').upsert({ user_id: uid(), settings: JSON.parse(JSON.stringify(PREFS)), notif_prefs: { ...notifPrefs }, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (error) console.warn('Could not save settings:', error.message);
        }, 700);
        watch(PREFS, () => { applyTheme(); saveSettings(); }, { deep: true });
        watch(notifPrefs, saveSettings, { deep: true });
        const notifOn = (key) => notifPrefs[key] !== false;
        const toggleNotif = (key) => { notifPrefs[key] = !notifOn(key); };

        const account = reactive({ username: '', email: '', curPass: '', newPass: '', newPass2: '', busy: '' });
        const profileEdit = reactive({ username: '', bio: '', accent: '', avatar_url: null, banner_url: null, saving: false });
        const openSettings = (tab = 'account') => {
            settingsTab.value = SETTINGS_TABS.some(t => t.id === tab) ? tab : 'account';
            const p = currentProfile.value || {};
            Object.assign(account, { username: p.username || '', email: currentUser.value?.email || '', curPass: '', newPass: '', newPass2: '', busy: '' });
            Object.assign(profileEdit, { username: p.username || '', bio: p.bio || '', accent: p.accent || ACCENTS[0], avatar_url: p.avatar_url || null, banner_url: p.banner_url || null, saving: false });
            customAccent.value = PREFS.accent;
            notifOpen.value = false;
            settingsOpen.value = true;
            fetchPrivacy();
        };
        const openProfileEdit = () => openSettings('profile');
        const profileDirty = computed(() => {
            const p = currentProfile.value || {};
            return (profileEdit.bio || '') !== (p.bio || '') || profileEdit.accent !== (p.accent || ACCENTS[0]) || profileEdit.avatar_url !== (p.avatar_url || null) || profileEdit.banner_url !== (p.banner_url || null);
        });
        const saveProfileEdit = async () => {
            profileEdit.saving = true;
            try {
                await saveProfileFields({ bio: profileEdit.bio.trim().slice(0, 160) || null, accent: profileEdit.accent, avatar_url: profileEdit.avatar_url, banner_url: profileEdit.banner_url });
                showToast('Profile saved!');
            } catch (err) {
                showToast('Could not save: ' + (err.message || err) + (/banner_url/.test(err.message || '') ? ' — run the v4 SQL in Supabase' : ''), 'error');
            } finally { profileEdit.saving = false; }
        };
        const saveUsername = async () => {
            const username = account.username.trim();
            if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) { showToast('Username: 3–20 letters, numbers, _ or .', 'error'); return; }
            if (username === currentProfile.value?.username) { showToast('That is already your username', 'error'); return; }
            account.busy = 'username';
            try {
                if (username.toLowerCase() !== (currentProfile.value?.username || '').toLowerCase()) {
                    const { data: taken } = await sb.from('profiles').select('id').ilike('username', escapeLike(username)).maybeSingle();
                    if (taken && taken.id !== uid()) { showToast('That username is already taken', 'error'); return; }
                }
                await saveProfileFields({ username });
                showToast('Username changed to ' + username);
            } catch (err) { showToast(err.code === '23505' ? 'That username is already taken' : 'Could not save: ' + (err.message || err), 'error'); }
            finally { account.busy = ''; }
        };
        const saveEmail = async () => {
            const email = account.email.trim();
            if (!/^\S+@\S+\.\S+$/.test(email)) { showToast('Enter a valid email', 'error'); return; }
            if (email.toLowerCase() === (currentUser.value?.email || '').toLowerCase()) { showToast('That is already your email', 'error'); return; }
            account.busy = 'email';
            try {
                const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
                if (error) throw error;
                showToast('Almost done — click the confirmation links sent to your old and new email');
            } catch (err) { showToast('Could not change email: ' + (err.message || err), 'error'); }
            finally { account.busy = ''; }
        };
        const savePassword = async () => {
            if (account.newPass.length < 6) { showToast('New password needs at least 6 characters', 'error'); return; }
            if (account.newPass !== account.newPass2) { showToast('The new passwords don’t match', 'error'); return; }
            account.busy = 'password';
            try {
                const { error: wrong } = await sb.auth.signInWithPassword({ email: currentUser.value.email, password: account.curPass });
                if (wrong) { showToast('Your current password is wrong', 'error'); return; }
                const { error } = await sb.auth.updateUser({ password: account.newPass });
                if (error) throw error;
                Object.assign(account, { curPass: '', newPass: '', newPass2: '' });
                showToast('Password changed!');
            } catch (err) { showToast('Could not change password: ' + (err.message || err), 'error'); }
            finally { account.busy = ''; }
        };

        // theme
        const customAccent = ref(PREFS.accent);
        const setAccent = (c) => { if (hexToRgb(c)) { PREFS.accent = c.toUpperCase(); customAccent.value = PREFS.accent; } };

        // lists: privacy + reset scores
        const PRIVACY_TYPES = [{ type: 'ANIME', label: 'Anime' }, { type: 'MANGA', label: 'Manga & Manhwa' }, { type: 'TV', label: 'Movies & TV' }, { type: 'GAME', label: 'Games' }, { type: 'SONG', label: 'Songs' }];
        const privacy = reactive({ ANIME: { mode: 'friends', hidden_from: [] }, MANGA: { mode: 'friends', hidden_from: [] }, TV: { mode: 'friends', hidden_from: [] }, GAME: { mode: 'friends', hidden_from: [] }, SONG: { mode: 'friends', hidden_from: [] } });
        const fetchPrivacy = async () => {
            if (!uid()) return;
            const { data, error } = await sb.from('list_privacy').select('*').eq('user_id', uid());
            if (error) return;
            (data || []).forEach(r => { privacy[r.media_type] = { mode: r.mode, hidden_from: [...(r.hidden_from || [])] }; });
        };
        const savePrivacy = async (type) => {
            const p = privacy[type];
            const { error } = await sb.from('list_privacy').upsert({ user_id: uid(), media_type: type, mode: p.mode, hidden_from: p.hidden_from, updated_at: new Date().toISOString() }, { onConflict: 'user_id,media_type' });
            if (error) showToast('Could not save privacy: ' + error.message, 'error');
            else showToast(p.mode === 'private' ? 'List is now private' : p.mode === 'except' ? `Hidden from ${p.hidden_from.length} friend${p.hidden_from.length === 1 ? '' : 's'}` : 'Visible to all friends');
        };
        const setPrivacyMode = (type, mode) => { privacy[type].mode = mode; savePrivacy(type); };
        const togglePrivacyFriend = (type, id) => {
            const list = privacy[type].hidden_from; const i = list.indexOf(id);
            if (i === -1) list.push(id); else list.splice(i, 1);
            privacy[type].mode = 'except';
            savePrivacy(type);
        };
        const resetScores = async (type, label) => {
            const n = soloList.value.filter(i => typeOf(i) === type && i.score > 0).length;
            if (!n) { showToast(`No ${label.toLowerCase()} scores to reset`, 'error'); return; }
            if (!(await askConfirm({ title: `Reset ${n} ${label} score${n === 1 ? '' : 's'} to 0?`, body: 'This can’t be undone.', ok: 'Reset scores' }))) return;
            const { error } = await sb.from('list_entries').update({ score: 0 }).eq('user_id', uid()).eq('media_type', type).gt('score', 0);
            if (error) { showToast('Could not reset: ' + error.message, 'error'); return; }
            await fetchSolo();
            showToast(`Reset ${n} ${label} score${n === 1 ? '' : 's'}`);
        };

        // notifications settings (keys match the database triggers)
        const NOTIF_GROUPS = [
            { title: 'Social', items: [
                { key: 'follow', label: 'When someone follows me', hint: 'friend requests + accepted requests' },
                { key: 'message', label: 'When I receive a message', hint: 'chat messages + message requests' },
                { key: 'activity_mention', label: 'When I am @ mentioned in an activity or activity reply' },
                { key: 'activity_like', label: 'When someone likes my activity' },
                { key: 'reply_like', label: 'When someone likes my activity reply' },
                { key: 'comment_reply', label: 'When someone replies to my forum comment', hint: 'forum = the Comments on a show or episode' },
                { key: 'comment_mention', label: 'When I am @ mentioned in a forum comment' },
            ] },
            { title: 'More from anicoop', items: [
                { key: 'activity_reply', label: 'When someone replies to my activity' },
                { key: 'comment_like', label: 'When someone likes my forum comment' },
                { key: 'friend_comment', label: 'When a friend posts in the Comments' },
                { key: 'squad', label: 'When I’m added to a squad, or a squad list gets a new show' },
                { key: 'friend_post', label: 'When a friend posts, starts a poll or asks a question' },
                { key: 'poll_ended', label: 'When a poll I made or voted in ends (with the winner)' },
            ] },
            { title: 'Site Data Changes', note: 'anicoop checks the shows on your lists against AniList once a day.', items: [
                { key: 'media_related', label: 'When an anime or manga in my list has a new related entry created' },
                { key: 'media_changed', label: 'When an anime or manga in my list has its data changed that affects my list' },
                { key: 'media_merged', label: 'When one or more anime or manga in my list are merged into another' },
                { key: 'media_deleted', label: 'When an anime or manga in my list is deleted from the site' },
            ] },
            { title: 'Submissions', note: 'anicoop has no submission system (that’s an AniList feature), so these never fire.', items: [
                { key: 'sub_media', label: 'When the status of my media submission is updated', off: 'not in anicoop' },
                { key: 'sub_staff', label: 'When the status of my staff submission is updated', off: 'not in anicoop' },
                { key: 'sub_character', label: 'When the status of my character submission is updated', off: 'not in anicoop' },
            ] },
        ];

        // ---------- IMPORT (MyAnimeList XML + AniList username) ----------
        const importState = reactive({ busy: false, step: '', done: 0, total: 0, result: null, overwrite: false, anilistUser: '', anilistTypes: { ANIME: true, MANGA: true } });
        const importProgress = computed(() => importState.total ? Math.round(importState.done / importState.total * 100) : 0);
        const readImportFile = async (file) => {
            if (/\.gz$/i.test(file.name)) {
                if (typeof DecompressionStream === 'undefined') throw new Error('Unzip the .xml.gz file first, then pick the .xml');
                return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
            }
            return await file.text();
        };
        const saveImported = async (entries) => {
            alSuppress = true;
            try { return await saveImportedInner(entries); } finally { alSuppress = false; }
        };
        const saveImportedInner = async (entries) => {
            const have = new Map(soloList.value.map(i => [i.anime.id, i]));
            // without "overwrite", titles already on your list are left alone, unless the import is further along
            // (e.g. it's Completed there but still Watching / Planning here), so a finished show never goes missing
            const rank = { PLANNING: 0, DROPPED: 1, PAUSED: 2, WATCHING: 3, COMPLETED: 4, REPEATING: 5 };
            const ahead = (e, o) => (rank[e.status] ?? 0) > (rank[o.status] ?? 0) || (e.status === o.status && e.progress > o.progress);
            const fresh = entries.filter(e => importState.overwrite || !have.has(e.anime.id) || ahead(e, have.get(e.anime.id)));
            const updated = fresh.filter(e => have.has(e.anime.id)).length;
            fresh.forEach(e => { const o = have.get(e.anime.id); if (o?.repeats?.length && !(e.repeats?.length >= o.repeats.length)) e.repeats = o.repeats; if (o?.lilbro) e.lilbro = true; });
            for (let i = 0; i < fresh.length; i += 200) {
                importState.step = `Saving ${Math.min(i + 200, fresh.length)} / ${fresh.length}…`;
                await upsertSolo(fresh.slice(i, i + 200));
            }
            await fetchSolo();
            return { added: fresh.length - updated, updated, skipped: entries.length - fresh.length };
        };
        const anilistRetry = async (query, vars) => {
            for (let attempt = 0; ; attempt++) {
                try { return await anilist(query, vars); }
                catch (err) {
                    if (attempt < 2 && /rate limit/i.test(err.message)) { importState.step = 'AniList says slow down — waiting a minute…'; await sleep(62000); }
                    else throw err;
                }
            }
        };
        const importMal = async (e) => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (!file || importState.busy) return;
            Object.assign(importState, { busy: true, step: 'Reading file…', done: 0, total: 0, result: null });
            try {
                const text = await readImportFile(file);
                const xml = new DOMParser().parseFromString(text, 'text/xml');
                if (xml.getElementsByTagName('parsererror').length) throw new Error('That file is not valid XML — export your list from MyAnimeList again');
                const pick = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
                const rows = [];
                // MAL writes status as words ("Completed") in new exports and as numbers in old ones; both are handled
                const statusOf = (el) => { const v = pick(el, 'my_status').toLowerCase().replace(/[_\s]+/g, ' ').trim(); return MAL_STATUS[v] || MAL_STATUS[v.replace(/ /g, '-')] || 'PLANNING'; };
                const repeatInfo = (el) => ({ times: +pick(el, 'my_times_watched') || +pick(el, 'my_times_read') || 0, now: pick(el, 'my_rewatching') === '1' || pick(el, 'my_rereading') === '1', nowAt: +pick(el, 'my_rewatching_ep') || 0 });
                [...xml.getElementsByTagName('anime')].forEach(el => rows.push({ type: 'ANIME', malId: +pick(el, 'series_animedb_id'), title: pick(el, 'series_title'), total: +pick(el, 'series_episodes') || 0, kind: pick(el, 'series_type'), progress: +pick(el, 'my_watched_episodes') || 0, score: +pick(el, 'my_score') || 0, status: statusOf(el), rep: repeatInfo(el) }));
                [...xml.getElementsByTagName('manga')].forEach(el => rows.push({ type: 'MANGA', malId: +pick(el, 'manga_mangadb_id'), title: pick(el, 'manga_title'), total: +pick(el, 'manga_chapters') || 0, progress: +pick(el, 'my_read_chapters') || 0, score: +pick(el, 'my_score') || 0, status: statusOf(el), rep: repeatInfo(el) }));
                const valid = rows.filter(r => r.malId);
                if (!valid.length) throw new Error('No anime or manga found in that file');
                importState.total = valid.length;
                const entries = []; const missingTitles = [];
                const toEntry = (r, media) => {
                    const eps = media.episodes || null;
                    const e = { anime: media, status: r.status, score: clamp(r.score, 0, 10), progress: r.status === 'COMPLETED' && eps ? eps : (eps ? Math.min(r.progress, eps) : r.progress) };
                    // MAL's "times rewatched" + "rewatching now" → our repeat counters (up to 5)
                    if (r.type === 'ANIME' && (r.rep.times || r.rep.now)) {
                        const full = eps || r.total || r.progress || 0;
                        e.repeats = Array.from({ length: Math.min(r.rep.times, MAX_REPEATS) }, () => full);
                        if (r.rep.now && e.repeats.length < MAX_REPEATS) { e.status = 'REPEATING'; e.progress = full; e.repeats.push(Math.min(r.rep.nowAt || r.progress || 0, full || 99999)); }
                    }
                    return e;
                };
                for (const type of ['ANIME', 'MANGA']) {
                    const list = valid.filter(r => r.type === type);
                    // 25 ids per request with room for 50 answers: when AniList has two entries for the same MAL id the page
                    // used to fill up and silently drop the last titles of the chunk
                    for (let i = 0; i < list.length; i += 25) {
                        const chunk = list.slice(i, i + 25);
                        importState.step = `Matching ${type === 'ANIME' ? 'anime' : 'manga'} with AniList…`;
                        const data = await anilistRetry(`query ($ids: [Int], $type: MediaType) { Page(perPage: 50) { media(idMal_in: $ids, type: $type) { idMal ${MEDIA_FIELDS} } } }`, { ids: chunk.map(r => r.malId), type });
                        const byMal = new Map();
                        (data?.Page?.media || []).forEach(m => { if (!byMal.has(m.idMal)) byMal.set(m.idMal, normMedia(m)); });
                        chunk.forEach(r => {
                            const media = byMal.get(r.malId);
                            if (media) entries.push(toEntry(r, media)); else missingTitles.push(r);
                        });
                        importState.done += chunk.length;
                        await sleep(900);
                    }
                }
                // Titles AniList doesn't link to that MAL id (new or merged entries, some specials/music videos):
                // look them up by name instead, and only take a result whose title really matches
                const stillMissing = [];
                for (const r of missingTitles) {
                    importState.step = `Finding by name: ${r.title || 'MAL #' + r.malId}…`;
                    let media = null;
                    if (r.title) {
                        try {
                            const d = await anilistRetry(`query ($q: String, $type: MediaType) { Page(perPage: 8) { media(search: $q, type: $type) { idMal synonyms ${MEDIA_FIELDS} } } }`, { q: r.title, type: r.type });
                            const want = normTitle(r.title);
                            const list = d?.Page?.media || [];
                            const exact = list.find(m => [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].some(t => t && normTitle(t) === want));
                            const close = !exact && list.find(m => r.total && (m.episodes || m.chapters) === r.total && normTitle(m.title?.romaji || '').startsWith(want.slice(0, 12)));
                            media = normMedia(exact || close || null);
                        } catch {}
                        await sleep(700);
                    }
                    if (media) entries.push(toEntry(r, media)); else stillMissing.push(r.title || `MAL #${r.malId}`);
                }
                // two MAL entries can point at the same AniList title: keep the one that's furthest along
                const rank = { REPEATING: 5, COMPLETED: 4, WATCHING: 3, PAUSED: 2, DROPPED: 1, PLANNING: 0 };
                const byId = new Map();
                entries.forEach(e => { const o = byId.get(e.anime.id); if (!o || rank[e.status] > rank[o.status] || (rank[e.status] === rank[o.status] && e.progress > o.progress)) byId.set(e.anime.id, e); });
                const res = await saveImported([...byId.values()]);
                importState.result = { source: 'MyAnimeList', ...res, missing: stillMissing.length, missingTitles: stillMissing };
                showToast(`Imported ${res.added} from MyAnimeList`);
            } catch (err) { showToast('Import failed: ' + (err.message || err), 'error'); importState.result = { error: err.message || String(err) }; }
            finally { importState.busy = false; importState.step = ''; }
        };
        const importAniList = async () => {
            const name = importState.anilistUser.trim();
            const types = Object.keys(importState.anilistTypes).filter(t => importState.anilistTypes[t]);
            if (!name) { showToast('Enter your AniList username', 'error'); return; }
            if (!types.length) { showToast('Pick anime, manga or both', 'error'); return; }
            if (importState.busy) return;
            Object.assign(importState, { busy: true, step: 'Loading your AniList…', done: 0, total: 0, result: null });
            try {
                const entries = [];
                for (const type of types) {
                    for (let chunk = 1; chunk < 40; chunk++) {
                        importState.step = `Loading ${type === 'ANIME' ? 'anime' : 'manga'} list from AniList…`;
                        const data = await anilistRetry(`query ($name: String, $type: MediaType, $chunk: Int) { MediaListCollection(userName: $name, type: $type, chunk: $chunk, perChunk: 500) {
                            hasNextChunk lists { isCustomList entries { status score(format: POINT_10_DECIMAL) progress repeat media { ${MEDIA_FIELDS} } } } } }`, { name, type, chunk });
                        const col = data?.MediaListCollection;
                        (col?.lists || []).forEach(l => (l.entries || []).forEach(en => {   // custom lists too: entries hidden from the status lists only live there
                            if (!en.media?.id) return;
                            const e = { anime: normMedia(en.media), status: ANILIST_STATUS[en.status] || 'PLANNING', score: clamp(Number(en.score) || 0, 0, 10), progress: en.progress || 0 };
                            if (e.anime.type !== 'ANIME' && e.status === 'REPEATING') e.status = 'WATCHING';
                            if (e.anime.type === 'ANIME' && (en.repeat > 0 || e.status === 'REPEATING')) {   // AniList's rewatch count → our repeat counters
                                const full = e.anime.episodes || e.progress || 0;
                                e.repeats = Array.from({ length: Math.min(en.repeat || 0, MAX_REPEATS) }, () => full);
                                if (e.status === 'REPEATING') { if (e.repeats.length < MAX_REPEATS) { e.repeats.push(Math.min(e.progress, full || 99999)); e.progress = full; } else { e.status = 'COMPLETED'; e.progress = full; } }
                            }
                            entries.push(e);
                        }));
                        importState.done = importState.total = entries.length;
                        if (!col?.hasNextChunk) break;
                        await sleep(900);
                    }
                }
                const unique = [...new Map(entries.map(e => [e.anime.id, e])).values()];
                if (!unique.length) throw new Error('That AniList list is empty');
                const res = await saveImported(unique);
                importState.result = { source: 'AniList', ...res, missing: 0 };
                showToast(`Imported ${res.added} from AniList`);
            } catch (err) {
                const msg = /not found|private/i.test(err.message || '') ? 'AniList user not found, or their list is private' : (err.message || String(err));
                showToast('Import failed: ' + msg, 'error'); importState.result = { error: msg };
            } finally { importState.busy = false; importState.step = ''; }
        };

        // ---------- friends ----------
        const fetchFriends = async () => {
            const me = uid(); if (!me) return;
            const { data: rows, error } = await sb.from('friendships').select('*').or(`sender_id.eq.${me},receiver_id.eq.${me}`);
            if (error) { console.error(error); showToast('Could not load friends: ' + error.message, 'error'); return; }
            const otherId = (f) => (f.sender_id === me ? f.receiver_id : f.sender_id);
            const ids = [...new Set(rows.map(otherId))];
            let byId = {};
            if (ids.length) {
                const { data: profiles } = await sb.from('profiles').select('*').in('id', ids);
                byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
            }
            const withProfile = (f) => ({ id: otherId(f), username: 'Unknown user', ...byId[otherId(f)], friendshipId: f.id, since: f.created_at });
            friendsList.value = rows.filter(f => f.status === 'accepted').map(withProfile).sort((a, b) => a.username.localeCompare(b.username));
            pendingRequests.value = rows.filter(f => f.status === 'pending' && f.receiver_id === me).map(withProfile);
            sentRequests.value = rows.filter(f => f.status === 'pending' && f.sender_id === me).map(withProfile);
        };
        const addFriend = async () => {
            const name = friendUsername.value.trim();
            if (!name || friendBusy.value) return;
            friendBusy.value = true;
            try {
                const { data: target, error: findErr } = await sb.from('profiles').select('id, username').ilike('username', escapeLike(name)).maybeSingle();
                if (findErr) { showToast('Lookup failed: ' + findErr.message, 'error'); return; }
                if (!target) { showToast('Username not found', 'error'); return; }
                if (target.id === uid()) { showToast('You cannot add yourself!', 'error'); return; }
                if (friendsList.value.some(f => f.id === target.id)) { showToast(`You're already friends with ${target.username}`, 'error'); return; }
                if (sentRequests.value.some(f => f.id === target.id)) { showToast(`Request to ${target.username} is already pending`, 'error'); return; }
                const incoming = pendingRequests.value.find(f => f.id === target.id);
                if (incoming) { await acceptRequest(incoming.friendshipId); friendUsername.value = ''; return; }
                const { error } = await sb.from('friendships').insert({ sender_id: uid(), receiver_id: target.id, status: 'pending' });
                if (error) { showToast(error.code === '23505' ? 'A request already exists between you two' : 'Could not send request: ' + error.message, 'error'); return; }
                showToast(`Friend request sent to ${target.username}!`);
                friendUsername.value = '';
                await fetchFriends();
            } finally {
                friendBusy.value = false;
            }
        };
        const acceptRequest = async (friendshipId) => {
            const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
            if (error) { showToast('Could not accept: ' + error.message, 'error'); return; }
            showToast('Friend request accepted!');
            await fetchFriends(); fetchFriendEntries();
        };
        const deleteFriendship = async (friendshipId, message) => {
            const { error } = await sb.from('friendships').delete().eq('id', friendshipId);
            if (error) { showToast(error.message, 'error'); return; }
            showToast(message);
            await fetchFriends(); fetchFriendEntries();
        };
        const removeFriend = async (friend) => {
            if (!(await askConfirm({ title: `Remove ${friend.username} from your friends?`, ok: 'Remove friend' }))) return;
            deleteFriendship(friend.friendshipId, `Removed ${friend.username}`);
        };
        const fetchFriendEntries = async () => {
            const ids = friendsList.value.map(f => f.id);
            if (!ids.length) { friendEntries.value = []; return; }
            const { data } = await selectAll(() => sb.from('list_entries').select('user_id, media_id, media_type, media_data, status, score, progress, updated_at').in('user_id', ids).order('updated_at', { ascending: false }).order('user_id').order('media_id'), 8000);
            friendEntries.value = data || [];
        };

        // ---------- favorite characters ----------
        const isFavChar = (id) => favCharacters.value.some(c => c.id === id);
        const toggleFavChar = async (char) => {
            const idx = favCharacters.value.findIndex(c => c.id === char.id);
            try {
                if (idx !== -1) {
                    favCharacters.value.splice(idx, 1);
                    await sb.from('favorite_characters').delete().eq('user_id', uid()).eq('character_id', char.id);
                    showToast('Removed from favorites');
                } else {
                    // which shelf it goes on (anime / manga / games / movies & TV); game characters also remember their game
                    const sectionOf = char.section || (selectedAnime.value?.type) || (entity.value ? 'ANIME' : null) || mediaType.value || 'ANIME';
                    const data = { id: char.id, name: { full: char.name?.full }, image: { large: char.image?.large }, section: sectionOf, ...(char.gameId ? { gameId: char.gameId } : {}) };
                    favCharacters.value.push(data);
                    const { error } = await sb.from('favorite_characters').insert({ user_id: uid(), character_id: char.id, data });
                    if (error) throw error;
                    showToast('Added to favorite characters!');
                }
            } catch (err) { showToast('Could not update favorites: ' + (err.message || err), 'error'); fetchFavs(); }
        };

        // ---------- squads (co-op groups with any number of friends) ----------
        const fetchSquads = async () => {
            const me = uid(); if (!me) return;
            const { data: mine, error } = await sb.from('squad_members').select('squad_id').eq('user_id', me);
            if (error) { console.error(error); showToast('Could not load squads: ' + error.message, 'error'); return; }
            const ids = (mine || []).map(r => r.squad_id);
            if (!ids.length) { squads.value = []; coopList.value = []; return; }
            const [{ data: sq }, { data: members }] = await Promise.all([
                sb.from('squads').select('*').in('id', ids),
                sb.from('squad_members').select('squad_id, user_id').in('squad_id', ids),
            ]);
            const memberIds = [...new Set((members || []).map(m => m.user_id))];
            const { data: profs } = memberIds.length ? await sb.from('profiles').select('*').in('id', memberIds) : { data: [] };
            const pById = Object.fromEntries((profs || []).map(p => [p.id, p]));
            squads.value = (sq || []).map(s => ({
                ...s,
                members: (members || []).filter(m => m.squad_id === s.id).map(m => pById[m.user_id] || { id: m.user_id, username: 'Unknown' }),
            })).sort((a, b) => a.name.localeCompare(b.name));
            await fetchSquadEntries();
        };
        const squadById = computed(() => new Map(squads.value.map(s => [s.id, s])));
        const squadLabel = (s) => s ? s.name : 'Squad';
        const fetchSquadEntries = async () => {
            const ids = squads.value.map(s => s.id);
            if (!ids.length) { coopList.value = []; return; }
            const { data, error } = await selectAll(() => sb.from('squad_entries').select('*').in('squad_id', ids).order('updated_at', { ascending: false }).order('squad_id').order('media_id'));
            if (error) { console.error(error); return; }
            coopList.value = (data || []).filter(r => r.media_data?.id).map(r => ({
                ...listRow(r), squadId: r.squad_id, group: squadLabel(squadById.value.get(r.squad_id)), key: r.squad_id + ':' + r.media_id,
            }));
        };
        const squadRow = (squadId, anime, fields, isNew) => ({
            squad_id: squadId, media_id: anime.id, media_type: anime.type || 'ANIME', media_data: slimAnime(anime),
            status: fields.status === 'REPEATING' ? 'COMPLETED' : fields.status, score: fields.score || 0, progress: fields.progress || 0,
            updated_by: uid(), updated_at: new Date().toISOString(), ...(isNew ? { added_by: uid() } : {}),
        });
        const upsertSquadEntry = async (squadId, anime, fields) => {
            const isNew = !coopList.value.some(i => i.squadId === squadId && i.anime.id === anime.id);
            const { error } = isNew
                ? await sb.from('squad_entries').insert(squadRow(squadId, anime, fields, true))
                : await sb.from('squad_entries').update(squadRow(squadId, anime, fields, false)).eq('squad_id', squadId).eq('media_id', anime.id);
            if (error) throw error;
        };
        const deleteSquadEntry = async (squadId, mediaId) => {
            const { error } = await sb.from('squad_entries').delete().eq('squad_id', squadId).eq('media_id', mediaId);
            if (error) throw error;
        };

        // squad create / manage
        const squadDraft = reactive({ open: false, name: '', members: [], busy: false, forForm: null });
        const openSquadDraft = (forForm = null) => Object.assign(squadDraft, { open: true, name: '', members: [], busy: false, forForm });
        const toggleDraftMember = (id) => { const i = squadDraft.members.indexOf(id); if (i === -1) squadDraft.members.push(id); else squadDraft.members.splice(i, 1); };
        const draftAutoName = computed(() => {
            const names = squadDraft.members.map(id => personOf(id).username);
            if (!names.length) return '';
            return [currentProfile.value?.username || 'Me', ...names].slice(0, 4).join(', ').replace(/, ([^,]*)$/, ' & $1');
        });
        const createSquad = async () => {
            if (!squadDraft.members.length) { showToast('Pick at least one friend', 'error'); return; }
            const name = (squadDraft.name.trim() || draftAutoName.value).slice(0, 40);
            squadDraft.busy = true;
            try {
                const { data: sid, error } = await sb.rpc('create_squad', { p_name: name, p_members: squadDraft.members, p_color: ACCENTS[Math.floor(Math.random() * ACCENTS.length)] });
                if (error) throw error;
                await fetchSquads();
                if (squadDraft.forForm && sid && !squadDraft.forForm.squadIds.includes(sid)) squadDraft.forForm.squadIds.push(sid);
                squadDraft.open = false;
                showToast(`Squad "${name}" created!`);
            } catch (err) { showToast('Could not create squad: ' + (err.message || err), 'error'); }
            finally { squadDraft.busy = false; }
        };
        const squadAddMember = async (squad, friendId) => {
            const { error } = await sb.from('squad_members').insert({ squad_id: squad.id, user_id: friendId, added_by: uid() });
            if (error) { showToast('Could not add: ' + error.message, 'error'); return; }
            showToast(`${personOf(friendId).username} joined ${squad.name}`);
            await fetchSquads();
        };
        const renameSquad = async (squad) => {
            const name = await askText({ title: 'Rename squad', body: 'Everyone in the squad sees the new name.', value: squad.name, ok: 'Rename', max: 40, placeholder: 'Squad name' });
            if (!name || name === squad.name) return;
            const { error } = await sb.from('squads').update({ name }).eq('id', squad.id);
            if (error) { showToast(error.message, 'error'); return; }
            await fetchSquads();
            showToast(`Squad renamed to ${name}`);
        };
        // Leave = only you go (the squad + its list stay for the others). Delete = creator removes it for everyone.
        const leaveSquad = async (squad, mode = 'leave') => {
            if (!squad) return;
            const del = mode === 'delete';
            if (del && squad.created_by !== uid()) { showToast('Only the person who made the squad can delete it', 'error'); return; }
            const others = squad.members.filter(m => m.id !== uid()).length;
            if (!(await askConfirm(del ? { title: `Delete the squad “${squad.name}”?`, body: 'Its list is deleted for everyone in it.', ok: 'Delete squad' }
                : { title: `Leave “${squad.name}”?`, body: others ? `The other ${others} member${others === 1 ? '' : 's'} keep the squad and its list.` : 'You are the last member, so the squad will be empty.', ok: 'Leave squad' }))) return;
            const { error } = del
                ? await sb.from('squads').delete().eq('id', squad.id)
                : await sb.from('squad_members').delete().eq('squad_id', squad.id).eq('user_id', uid());
            if (error) { showToast(error.message, 'error'); return; }
            showToast(del ? 'Squad deleted' : `You left ${squad.name}`);
            if (listFilterGroup.value === squad.id) listFilterGroup.value = 'ALL';
            await fetchSquads();
        };
        const friendsNotIn = (squad) => friendsList.value.filter(f => !squad.members.some(m => m.id === f.id));
        const squadAddOpen = ref(null);

        // ---------- realtime ----------
        let realtimeChannel = null;
        const teardownRealtime = () => { if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; } };
        const refreshSoloSoon = debounce(() => fetchSolo(), 1500);   // a watch buddy's sync changed your list
        const setupRealtimeSync = () => {
            teardownRealtime();
            const me = uid();
            const refreshFriends = debounce(async () => { await fetchFriends(); fetchFriendEntries(); }, 300);
            const refreshSquads = debounce(fetchSquads, 300);
            const refreshEntries = debounce(fetchSquadEntries, 300);
            realtimeChannel = sb.channel(`user-${me}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `receiver_id=eq.${me}` }, (p) => {
                    refreshFriends();
                    if (p.new?.status === 'pending') showToast('You got a new friend request!');
                })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `sender_id=eq.${me}` }, (p) => {
                    refreshFriends();
                    if (p.new?.status === 'accepted') showToast('Your friend request was accepted!');
                })
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, refreshFriends)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'squad_members' }, refreshSquads)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'squads' }, refreshSquads)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'squad_entries' }, refreshEntries)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, (p) => onNewNotification(p.new))
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (p) => { if (selectedAnime.value?.id === p.new?.media_id) fetchComments(); })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, onActivityRealtime)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_replies' }, (p) => onReplyRealtime(p.new))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, (p) => onVoteRealtime(p))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => onMessageRealtime(p))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, refreshChats)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_groups' }, refreshGroups)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_group_members' }, refreshGroups)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'watch_buddies' }, () => fetchBuddies())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'list_entries', filter: `user_id=eq.${me}` }, refreshSoloSoon)
                .subscribe();
        };

        // ---------- notifications ----------
        const notifOpen = ref(false);
        const unreadCount = computed(() => notifications.value.filter(n => !n.read).length);
        const fetchNotifications = async () => {
            const { data } = await sb.from('notifications').select('*').eq('user_id', uid()).order('created_at', { ascending: false }).limit(60);
            notifications.value = data || [];
            ensureProfiles(notifications.value.map(n => n.actor_id));
        };
        const epTag = (n) => n.episode ? ' · ' + (n.media_type === 'MANGA' ? 'Ch ' : n.media_type === 'GAME' ? 'Hour ' : 'Ep ') + n.episode : '';
        const notifText = (n) => {
            const who = personOf(n.actor_id).username;
            const title = n.media_title || 'a show';
            switch (n.kind) {
                case 'comment': return `${who} commented on ${title}${epTag(n)}`;
                case 'comment_reply': return `${who} replied to your comment on ${title}${epTag(n)}`;
                case 'comment_mention': return `${who} mentioned you in the comments on ${title}${epTag(n)}`;
                case 'comment_like': return `${who} liked your comment on ${title}`;
                case 'activity_like': return `${who} liked your activity on ${title}`;
                case 'activity_reply': return `${who} replied to your activity on ${title}`;
                case 'activity_mention': return `${who} mentioned you in an activity reply`;
                case 'reply_like': return `${who} liked your activity reply`;
                case 'follow': return `${who} sent you a friend request`;
                case 'friend_accept': return `${who} accepted your friend request`;
                case 'squad_added': return `${who} added you to the squad “${n.text}”`;
                case 'squad_entry': return `${who} added ${title} to “${n.text}”`;
                case 'media_related': return `${title} has a new related entry`;
                case 'media_changed': return `${title} was updated on AniList`;
                case 'media_removed': return `${title} was merged or removed on AniList`;
                case 'message': return `${who}: ${n.text || 'sent you a message'}`;
                case 'message_request': return `${who} wants to chat: ${n.text || ''}`;
                case 'group_message': return `${who} (${groupById.value.get(n.group_id)?.name || 'group'}): ${n.text || 'sent a message'}`;
                case 'friend_post': return `${who} shared a post`;
                case 'friend_poll': return `${who} started a poll`;
                case 'friend_question': return `${who} asked a question about ${title}`;
                case 'poll_ended': return n.actor_id ? `${who}’s poll ended` : 'Your poll ended';
                case 'best_answer': return `${who} picked your answer as the best one`;
                case 'buddy_request': return `${who} wants to be your watch buddy (your Plan to watch lists would stay in sync)`;
                case 'buddy_accept': return `${who} is now your watch buddy — your Plan to watch lists are synced`;
                case 'media_episode': return `${title}: ${n.text || 'new episode'}`;
                case 'friend_tierlist': return `${who} made a tier list`;
                case 'friend_debate': return `${who} started a debate`;
                default: return n.text || 'New activity';
            }
        };
        const NOTIF_QUOTE = ['friend_tierlist', 'friend_debate', 'comment', 'comment_reply', 'comment_mention', 'comment_like', 'activity_reply', 'activity_mention', 'reply_like', 'friend_post', 'friend_poll', 'friend_question', 'best_answer'];
        const notifQuote = (n) => n.text && NOTIF_QUOTE.includes(n.kind) ? `“${n.text}”` : ((n.kind?.startsWith('media_') || n.kind === 'poll_ended') ? n.text : '');
        const notifIcon = (n) => ({ media_related: 'fa-diagram-project', media_changed: 'fa-rotate', media_removed: 'fa-triangle-exclamation', poll_ended: 'fa-square-poll-horizontal', media_episode: 'fa-tv' })[n.kind] || 'fa-bell';
        const systemNotifOn = ref(typeof Notification !== 'undefined' && Notification.permission === 'granted');
        const enableSystemNotifs = async () => {
            if (typeof Notification === 'undefined') { showToast('This browser does not support notifications', 'error'); return; }
            const p = await Notification.requestPermission();
            systemNotifOn.value = p === 'granted';
            showToast(p === 'granted' ? 'Desktop notifications on' : 'Notifications were blocked', p === 'granted' ? 'success' : 'error');
        };
        const onNewNotification = async (n) => {
            if (!n) return;
            await ensureProfiles([n.actor_id]);
            notifications.value = [n, ...notifications.value.filter(x => x.id !== n.id)].slice(0, 80);
            const text = notifText(n);
            const chatting = ((n.kind === 'message' || n.kind === 'message_request') && activeTab.value === 'chat' && chatWith.value === n.actor_id)
                || (n.kind === 'group_message' && activeTab.value === 'chat' && groupWith.value === n.group_id);
            if (chatting) { n.read = true; sb.from('notifications').update({ read: true }).eq('id', n.id).then(() => {}, () => {}); return; }
            showToast(text);
            if (n.kind.startsWith('comment') && selectedAnime.value?.id === n.media_id) fetchComments();
            if (n.kind.startsWith('squad')) fetchSquads();
            if (n.kind === 'follow' || n.kind === 'friend_accept') { await fetchFriends(); fetchFriendEntries(); }
            if (n.kind?.startsWith('buddy_')) { fetchBuddies(); if (n.kind === 'buddy_accept') fetchSolo(); }
            if (systemNotifOn.value && document.hidden) {
                const opts = { body: notifQuote(n) || '', icon: 'icons/icon-192.png', tag: 'anicoop-' + n.id };
                navigator.serviceWorker?.ready.then(r => r.showNotification('anicoop — ' + text, opts)).catch(() => { try { new Notification('anicoop — ' + text, opts); } catch {} });
            }
        };
        const markAllRead = async () => {
            notifications.value = notifications.value.map(n => ({ ...n, read: true }));
            await sb.from('notifications').update({ read: true }).eq('user_id', uid()).eq('read', false);
        };
        const highlightActivity = ref(null);
        const openNotification = async (n) => {
            notifOpen.value = false;
            if (!n.read) { n.read = true; sb.from('notifications').update({ read: true }).eq('id', n.id).then(() => {}, () => {}); }
            if (n.kind === 'message' || n.kind === 'message_request') { openChat(n.actor_id); return; }
            if (n.kind === 'group_message') { openGroup(n.group_id); return; }
            if (n.kind === 'buddy_request' || n.kind === 'buddy_accept') { fetchBuddies(); openUser(n.actor_id); return; }
            if (n.kind === 'follow' || n.kind === 'friend_accept') { openTracker('profile'); setTimeout(() => document.getElementById('friends')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); return; }
            if (n.activity_id) {
                // go to the feed of the post's own section (a manga poll lives in the Manga feed), with the whole feed
                // loaded around it, then scroll to it once it's really on screen
                const { data: act } = await sb.from('activities').select('*').eq('id', n.activity_id).maybeSingle();
                if (!act) { showToast('That post was deleted', 'error'); return; }
                const sec = Object.values(SECTIONS).find(s => s.type === (act.media_type || 'ANIME'))?.id || 'anime';
                highlightActivity.value = n.activity_id;
                openReplies.add(n.activity_id);
                Object.assign(feedFilter, { who: 'all', kind: 'ALL' });
                navigate(() => { section.value = sec; currentAppView.value = 'tracker'; activeTab.value = 'feed'; selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
                await nextTick();
                await fetchFeed(false);   // newest request: whatever the tab switch started is ignored
                if (!feed.value.some(a => a.id === act.id)) {
                    // older than the first page: put it where it belongs by date, so the rest of the feed stays too
                    const list = [...feed.value, act].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    feed.value = list; await loadFeedExtras([act]);
                }
                let tries = 0;
                const go = () => { const el = document.getElementById('act-' + act.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); else if (++tries < 20) setTimeout(go, 150); };
                nextTick(() => setTimeout(go, 100));
                return;
            }
            if (n.media_id) {
                pendingCommentFocus = n.kind.startsWith('comment') ? (n.episode ?? 'GEN') : null;
                await fetchAnimeDetails(n.media_id);
            } else if (n.squad_id) {
                navigate(() => { currentAppView.value = 'tracker'; activeTab.value = 'coop'; selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
                listFilterStatus.value = 'ALL'; listSearchQuery.value = ''; listFilterGroup.value = n.squad_id;
            }
        };

        // ---------- likes (activities, activity replies, comments) ----------
        const likes = reactive({});              // 'activity:12' → { n, mine, users: [] }
        const likeOf = (type, id) => likes[type + ':' + id] || { n: 0, mine: false, users: [] };
        const loadLikes = async (type, ids) => {
            if (!ids.length) return;
            const { data } = await sb.from('likes').select('user_id, target_id').eq('target_type', type).in('target_id', ids);
            ids.forEach(id => { likes[type + ':' + id] = { n: 0, mine: false, users: [] }; });
            (data || []).forEach(r => { const l = likes[type + ':' + r.target_id]; l.n++; l.users.push(r.user_id); if (r.user_id === uid()) l.mine = true; });
        };
        const toggleLike = async (type, id) => {
            const key = type + ':' + id;
            const cur = likeOf(type, id);
            const next = cur.mine ? { n: cur.n - 1, mine: false, users: cur.users.filter(u => u !== uid()) } : { n: cur.n + 1, mine: true, users: [...cur.users, uid()] };
            likes[key] = next;
            const { error } = cur.mine
                ? await sb.from('likes').delete().eq('user_id', uid()).eq('target_type', type).eq('target_id', id)
                : await sb.from('likes').insert({ user_id: uid(), target_type: type, target_id: id });
            if (error) { likes[key] = cur; showToast('Could not like: ' + error.message, 'error'); }
        };
        const likeNames = (type, id) => likeOf(type, id).users.map(u => u === uid() ? 'You' : personOf(u).username).join(', ');

        // ---------- @mentions ----------
        const mentionQuery = (text) => { const m = /(^|\s)@([A-Za-z0-9_.]{0,20})$/.exec(text || ''); return m ? m[2].toLowerCase() : null; };
        const mentionSuggestions = (text) => {
            const q = mentionQuery(text); if (q === null) return [];
            return friendsList.value.filter(f => f.username.toLowerCase().startsWith(q)).slice(0, 6);
        };
        const applyMention = (text, username) => (text || '').replace(/@([A-Za-z0-9_.]{0,20})$/, '@' + username + ' ');
        const byUsername = computed(() => new Map([...profileById.value.values()].map(p => [String(p.username || '').toLowerCase(), p])));
        const bodyParts = (text) => String(text || '').split(/(@[A-Za-z0-9_.]{3,20})/g).filter(Boolean).map(t => {
            const u = t.startsWith('@') ? byUsername.value.get(t.slice(1).replace(/\.+$/, '').toLowerCase()) : null;
            return { t, user: u || null };
        });

        // ---------- comments (Squad talk) with replies + likes ----------
        const comments = ref([]);
        const commentsLoading = ref(false);
        const commentFilter = ref('ALL');       // 'ALL' | 'GEN' | episode number
        const commentDraft = ref('');
        const commentEp = ref('');               // '' = whole show
        const commentPosting = ref(false);
        const replyTo = ref(null);               // comment id being replied to
        const replyDraft = ref('');
        const revealed = reactive(new Set());
        let pendingCommentFocus = null;
        const fetchComments = async () => {
            const id = selectedAnime.value?.id; if (!id) return;
            commentsLoading.value = true;
            const { data } = await sb.from('comments').select('*').eq('media_id', id).order('created_at', { ascending: false }).limit(300);
            if (selectedAnime.value?.id === id) {
                comments.value = data || [];
                ensureProfiles(comments.value.map(c => c.user_id));
                loadLikes('comment', comments.value.map(c => c.id));
            }
            commentsLoading.value = false;
        };
        const topComments = computed(() => comments.value.filter(c => !c.parent_id || !comments.value.some(p => p.id === c.parent_id)));
        const repliesOf = (id) => comments.value.filter(c => c.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const commentEpisodes = computed(() => {
            const set = new Set(topComments.value.filter(c => c.episode != null).map(c => c.episode));
            const mine = myEntry(selectedAnime.value?.id)?.progress;
            if (mine) set.add(mine);
            if (typeof commentFilter.value === 'number') set.add(commentFilter.value);
            return [...set].sort((a, b) => a - b);
        });
        const countFor = (f) => { const t = topComments.value; return f === 'ALL' ? t.length : f === 'GEN' ? t.filter(c => c.episode == null).length : t.filter(c => c.episode === f).length; };
        const shownComments = computed(() => {
            const f = commentFilter.value, t = topComments.value;
            if (f === 'ALL') return t;
            if (f === 'GEN') return t.filter(c => c.episode == null);
            return t.filter(c => c.episode === f);
        });
        const isSpoiler = (c) => {
            if (c.episode == null || c.user_id === uid() || revealed.has(c.id)) return false;
            const p = myEntry(selectedAnime.value?.id);
            if (p?.status === 'COMPLETED') return false;
            return c.episode > (p?.progress || 0);
        };
        const setCommentFilter = (f) => { commentFilter.value = f; commentEp.value = typeof f === 'number' ? f : ''; };
        const startReply = (c) => { replyTo.value = replyTo.value === c.id ? null : c.id; replyDraft.value = c.user_id !== uid() ? '@' + personOf(c.user_id).username + ' ' : ''; };
        const postComment = async (parent = null) => {
            const body = (parent ? replyDraft.value : commentDraft.value).trim();
            const a = selectedAnime.value;
            if (!body || !a || commentPosting.value) return;
            const ep = parent ? parent.episode : (commentEp.value === '' || commentEp.value == null ? null : Math.max(1, Math.floor(Number(commentEp.value))));
            commentPosting.value = true;
            try {
                const row = { user_id: uid(), media_id: a.id, media_type: a.type || 'ANIME', media_title: titleOf(a), media_cover: a.coverImage?.large || null, episode: ep, body };
                if (parent) row.parent_id = parent.id;
                const { data, error } = await sb.from('comments').insert(row).select().single();
                if (error) throw error;
                if (data) { comments.value = [data, ...comments.value.filter(c => c.id !== data.id)]; likes['comment:' + data.id] = { n: 0, mine: false, users: [] }; }
                if (parent) { replyDraft.value = ''; replyTo.value = null; showToast('Reply posted'); }
                else { commentDraft.value = ''; showToast(friendsList.value.length ? `Posted — ${friendsList.value.length} friend${friendsList.value.length === 1 ? '' : 's'} notified` : 'Posted'); }
            } catch (err) { showToast('Could not post: ' + (err.message || err) + (/parent_id/.test(err.message || '') ? ' — run the v4 SQL in Supabase' : ''), 'error'); }
            finally { commentPosting.value = false; }
        };
        const deleteComment = async (c) => {
                        const { error } = await sb.from('comments').delete().eq('id', c.id);
            if (error) { showToast(error.message, 'error'); return; }
            comments.value = comments.value.filter(x => x.id !== c.id && x.parent_id !== c.id);
        };
        const epLabel = (ep, type) => { const t = type || selectedAnime.value?.type; return ep == null ? (t === 'GAME' ? 'Whole game' : t === 'SONG' ? 'Whole song' : selectedAnime.value?.format === 'MOVIE' ? 'Whole movie' : 'Whole show') : (t === 'MANGA' ? 'Ch ' : t === 'GAME' ? 'Hour ' : 'Ep ') + ep; };

        // ---------- ACTIVITY FEED ----------
        const feed = ref([]);
        const feedLoading = ref(false);
        const feedEnd = ref(false);
        const feedFilter = reactive({ who: 'all', type: 'ALL', kind: 'ALL' });
        const feedReplies = ref({});             // activity id → replies
        const replyDrafts = reactive({});
        const openReplies = reactive(new Set());
        const FEED_PAGE = 30;
        const loadFeedExtras = async (acts) => {
            const ids = acts.map(a => a.id);
            if (!ids.length) return;
            const { data: reps } = await sb.from('activity_replies').select('*').in('activity_id', ids).order('created_at', { ascending: true });
            const map = { ...feedReplies.value };
            ids.forEach(id => { map[id] = []; });
            (reps || []).forEach(r => map[r.activity_id].push(r));
            feedReplies.value = map;
            const polls = acts.filter(a => a.kind === 'poll' || a.kind === 'debate').map(a => a.id);
            await Promise.all([loadLikes('activity', ids), loadLikes('reply', (reps || []).map(r => r.id)), loadPollVotes(polls),
                ensureProfiles([...acts.map(a => a.user_id), ...(reps || []).map(r => r.user_id)])]);
            closeEndedPolls(acts);
        };
        let feedTok = 0;   // only the newest feed request may fill the feed (two at once used to overwrite each other)
        const fetchFeed = async (more = false) => {
            if (!uid() || (more && (feedEnd.value || feedLoading.value))) return;
            const tok = ++feedTok;
            feedLoading.value = true;
            try {
                let q = sb.from('activities').select('*').order('created_at', { ascending: false }).limit(FEED_PAGE);
                if (feedFilter.who === 'me') q = q.eq('user_id', uid());
                // each section (anime, manga, games, movies & TV) has its own feed; old posts with no section count as anime
                q = mediaType.value === 'ANIME' ? q.or('media_type.eq.ANIME,media_type.is.null') : q.eq('media_type', mediaType.value);
                q = feedFilter.kind !== 'ALL' ? q.eq('kind', feedFilter.kind) : q.in('kind', ['post', 'poll', 'question', 'tierlist', 'debate']);   // list updates live on profiles now
                if (more && feed.value.length) q = q.lt('created_at', feed.value[feed.value.length - 1].created_at);
                const { data, error } = await q;
                if (tok !== feedTok) return;   // a newer request is on its way
                if (error) throw error;
                let rows = data || [];
                if (feedFilter.who === 'friends') rows = rows.filter(a => a.user_id !== uid());
                feedEnd.value = (data || []).length < FEED_PAGE;
                feed.value = more ? [...feed.value, ...rows.filter(r => !feed.value.some(x => x.id === r.id))] : rows;
                await loadFeedExtras(rows);
            } catch (err) {
                if (tok !== feedTok) return;
                if (!more) feed.value = [];
                feedEnd.value = true;
                console.warn('feed', err.message || err);
            } finally { if (tok === feedTok) { feedLoading.value = false; recheckInfinite(); } }
        };
        const loadMoreFeed = () => { if (!feedEnd.value && !feedLoading.value && feed.value.length) fetchFeed(true); };
        watch(feedFilter, () => fetchFeed(false));
        watch(mediaType, () => { if (activeTab.value === 'feed') fetchFeed(false); });
        watch(() => currentAppView.value === 'tracker' && activeTab.value === 'feed' && !selectedAnime.value && !viewUserId.value, (on) => { if (on) fetchFeed(false); });
        const activityVerb = (a) => {
            const m = a.media_type === 'MANGA';
            const from = a.progress_from, to = a.progress_to;
            if (a.media_type === 'SONG') switch (a.status) {
                case 'WATCHING': return 'Is in love with';
                case 'PLANNING': return 'Saved';
                case 'COMPLETED': return 'Liked';
                case 'PAUSED': return 'Took a break from';
                case 'DROPPED': return 'Disliked';
                default: return 'Updated';
            }
            if (a.media_type === 'GAME') switch (a.status) {
                case 'WATCHING': return to ? `Played ${to} ${to === 1 ? 'hour' : 'hours'} of` : 'Started playing';
                case 'PLANNING': return 'Plans to play';
                case 'COMPLETED': return 'Beat';
                case 'PAUSED': return 'Put on hold:';
                case 'DROPPED': return 'Dropped';
                default: return 'Updated';
            }
            switch (a.status) {
                case 'WATCHING':
                    if (to && from && from !== to) return `${m ? 'Read chapters' : 'Watched episodes'} ${from} - ${to} of`;
                    if (to) return `${m ? 'Read chapter' : 'Watched episode'} ${to} of`;
                    return m ? 'Started reading' : 'Started watching';
                case 'REPEATING':
                    if (to && from && from !== to) return `Rewatched episodes ${from} - ${to} of`;
                    if (to) return `Rewatched episode ${to} of`;
                    return 'Started rewatching';
                case 'PLANNING': return m ? 'Plans to read' : 'Plans to watch';
                case 'COMPLETED': return 'Completed';
                case 'PAUSED': return (m ? 'Paused reading' : 'Paused watching') + (to ? ` at ${m ? 'ch' : 'ep'} ${to} of` : '');
                case 'DROPPED': return 'Dropped' + (to ? ` at ${m ? 'ch' : 'ep'} ${to}:` : '');
                default: return 'Updated';
            }
        };
        const toggleReplies = (a) => { if (openReplies.has(a.id)) openReplies.delete(a.id); else openReplies.add(a.id); };
        const postReply = async (a) => {
            const body = (replyDrafts[a.id] || '').trim();
            if (!body) return;
            const row = { activity_id: a.id, user_id: uid(), body };
            if (a.kind === 'debate') { const mine = pollVotes[a.id]?.mine; if (!mine) { showToast('Pick a side first, then argue it', 'error'); return; } row.side = mine; }
            const { data, error } = await sb.from('activity_replies').insert(row).select().single();
            if (error) { showToast('Could not reply: ' + error.message, 'error'); return; }
            replyDrafts[a.id] = '';
            feedReplies.value = { ...feedReplies.value, [a.id]: [...(feedReplies.value[a.id] || []).filter(r => r.id !== data.id), data] };
            likes['reply:' + data.id] = { n: 0, mine: false, users: [] };
        };
        const deleteReply = async (a, r) => {
                        const { error } = await sb.from('activity_replies').delete().eq('id', r.id);
            if (error) { showToast(error.message, 'error'); return; }
            feedReplies.value = { ...feedReplies.value, [a.id]: (feedReplies.value[a.id] || []).filter(x => x.id !== r.id) };
        };
        const deleteActivity = async (a) => {
                        const { error } = await sb.from('activities').delete().eq('id', a.id);
            if (error) { showToast(error.message, 'error'); return; }
            feed.value = feed.value.filter(x => x.id !== a.id);
        };
        const onActivityRealtime = debounce(() => { if (activeTab.value === 'feed' && !selectedAnime.value && !viewUserId.value) fetchFeed(false); }, 1200);
        const onReplyRealtime = async (r) => {
            if (!r?.activity_id || !feed.value.some(a => a.id === r.activity_id)) return;
            const list = feedReplies.value[r.activity_id] || [];
            if (list.some(x => x.id === r.id)) return;
            await ensureProfiles([r.user_id]);
            feedReplies.value = { ...feedReplies.value, [r.activity_id]: [...list, r] };
        };

        // ---------- ACTIVITIES: posts, polls, questions ----------
        const MEDIA_BUCKET = 'anicoop-media';
        const COMPOSER_KINDS = [
            { v: 'post', l: 'Post', icon: 'fa-pen-nib', hint: 'Share a thought, images, a clip or a title' },
            { v: 'poll', l: 'Poll', icon: 'fa-square-poll-horizontal', hint: 'Character vs character, anime vs anime…' },
            { v: 'question', l: 'Question', icon: 'fa-circle-question', hint: 'Ask about a show or a specific episode' },
            { v: 'tierlist', l: 'Tier list', icon: 'fa-layer-group', hint: 'Rank characters or anime into S–D tiers — pick an anime, a genre or a tag and the items fill in for you' },
            { v: 'debate', l: 'Debate', icon: 'fa-scale-balanced', hint: 'Make a claim, everyone picks a side and argues it in the replies' },
        ];
        const POLL_DURATIONS = [{ v: 1, l: '1 hour' }, { v: 6, l: '6 hours' }, { v: 24, l: '1 day' }, { v: 72, l: '3 days' }, { v: 168, l: '1 week' }];
        const FEED_KINDS = [{ v: 'ALL', l: 'All' }, { v: 'post', l: 'Posts' }, { v: 'poll', l: 'Polls' }, { v: 'question', l: 'Questions' }, { v: 'tierlist', l: 'Tier lists' }, { v: 'debate', l: 'Debates' }];
        const newOption = () => ({ id: Math.random().toString(36).slice(2, 8), label: '', image: null, media_id: null, media_type: null, character_id: null });
        const composer = reactive({ open: false, kind: 'post', body: '', attachments: [], media: null, episode: '', spoiler: false, question: '', options: [newOption(), newOption()], hours: 24, posting: false, uploading: 0, link: '', audience: 'friends', sides: ['Agree', 'Disagree'] });
        const resetComposer = () => Object.assign(composer, { open: false, body: '', attachments: [], media: null, episode: '', spoiler: false, question: '', options: [newOption(), newOption()], hours: 24, posting: false, link: '', sides: ['Agree', 'Disagree'] });
        const openComposer = (kind = 'post') => { composer.kind = kind; composer.open = true; picker.target = null; };
        const mediaInput = ref(null);
        const compressImage = (file) => new Promise((resolve) => {
            if (file.type === 'image/gif' || file.size < 500 * 1024) { resolve(file); return; }
            const url = URL.createObjectURL(file); const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
                const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                c.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
        const onMediaFiles = async (e) => {
            const files = [...(e.target.files || [])]; e.target.value = '';
            for (const f of files) {
                if (composer.attachments.length + composer.uploading >= 4) { showToast('Up to 4 images/videos per post', 'error'); break; }
                const isVideo = f.type.startsWith('video/'), isImg = f.type.startsWith('image/');
                if (!isVideo && !isImg) { showToast(`${f.name} isn’t an image or video`, 'error'); continue; }
                if (f.size > (isVideo ? 50 : 15) * 1024 * 1024) { showToast(`${f.name} is too big (max ${isVideo ? 50 : 15} MB)`, 'error'); continue; }
                composer.uploading++;
                try {
                    const up = isImg ? await compressImage(f) : f;
                    const ext = ((up.name || '').split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
                    const path = `${uid()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, up, { contentType: up.type, upsert: false });
                    if (error) throw error;
                    const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
                    composer.attachments.push({ type: isVideo ? 'video' : 'image', url: data.publicUrl, path });
                } catch (err) {
                    showToast('Upload failed: ' + (err.message || err) + (/bucket/i.test(err.message || '') ? ' — run the v5 SQL in Supabase' : ''), 'error');
                } finally { composer.uploading--; }
            }
        };
        const parseLink = (url) => {
            const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i.exec(url);
            if (yt) return { type: 'youtube', id: yt[1], url };
            if (/\.(mp4|webm|mov)(\?|#|$)/i.test(url)) return { type: 'video', url };
            if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url)) return { type: 'image', url };
            return { type: 'link', url };
        };
        const addLink = () => {
            const u = composer.link.trim();
            if (!/^https?:\/\/\S+$/i.test(u)) { showToast('Paste a full link (https://…)', 'error'); return; }
            if (composer.attachments.length >= 4) { showToast('Up to 4 attachments per post', 'error'); return; }
            composer.attachments.push(parseLink(u)); composer.link = '';
        };
        const removeAttachment = (i) => {
            const [a] = composer.attachments.splice(i, 1);
            if (a?.path) sb.storage.from(MEDIA_BUCKET).remove([a.path]).catch(() => {});
        };
        const linkHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

        // search AniList for a title or character (attach to a post / poll option / question)
        const picker = reactive({ target: null, mode: 'ANIME', q: '', results: [], loading: false });
        const openPicker = (target, mode) => Object.assign(picker, { target, mode: mode || mediaType.value || 'ANIME', q: '', results: [], loading: false });
        let pickerReq = 0;
        const runPicker = debounce(async () => {
            const q = picker.q.trim(); const id = ++pickerReq;
            if (!q || picker.target === null) { picker.results = []; picker.loading = false; return; }
            picker.loading = true;
            try {
                if (picker.mode === 'GAME' || picker.mode === 'TV' || picker.mode === 'SONG') {
                    const games = picker.mode === 'GAME' ? await gameApi.search(q) : picker.mode === 'TV' ? await tvApi.search(q) : await songApi.search(q);
                    if (id === pickerReq) picker.results = games;
                    return;
                }
                const data = picker.mode === 'CHARACTER'
                    ? await anilist('query ($q: String) { Page(perPage: 8) { characters(search: $q, sort: SEARCH_MATCH) { id name { full } image { large } media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji english native } } } } } }', { q })
                    : await anilist(`query ($q: String, $t: MediaType) { Page(perPage: 8) { media(search: $q, type: $t, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } } }`, { q, t: picker.mode });
                if (id !== pickerReq) return;
                picker.results = picker.mode === 'CHARACTER' ? (data?.Page?.characters || []) : (data?.Page?.media || []).map(normMedia);
            } catch (err) { if (id === pickerReq) picker.results = []; }
            finally { if (id === pickerReq) picker.loading = false; }
        }, 350);
        watch(() => [picker.q, picker.mode], runPicker);
        const choosePick = (item) => {
            if (picker.target === 'chat') { recommendToChat(item); picker.target = null; picker.q = ''; picker.results = []; return; }
            if (picker.target === 'attach') composer.media = { id: item.id, type: item.type, title: titleOf(item), cover: item.coverImage?.large || null };
            else if (typeof picker.target === 'number' && composer.options[picker.target]) {
                Object.assign(composer.options[picker.target], picker.mode === 'CHARACTER'
                    ? { label: item.name?.full, image: item.image?.large || null, character_id: item.id, media_id: null, media_type: null }
                    : { label: titleOf(item), image: item.coverImage?.large || null, media_id: item.id, media_type: item.type, character_id: null });
            }
            picker.target = null; picker.q = ''; picker.results = [];
        };
        const clearOption = (o) => Object.assign(o, { label: '', image: null, media_id: null, media_type: null, character_id: null });
        const addOption = () => { if (composer.options.length < 6) composer.options.push(newOption()); };
        const removeOption = (i) => { if (composer.options.length > 2) composer.options.splice(i, 1); };
        const canPost = computed(() => {
            if (composer.uploading) return false;
            if (composer.kind === 'poll') return !!composer.question.trim() && composer.options.filter(o => o.label?.trim()).length >= 2;
            if (composer.kind === 'question') return !!composer.body.trim() && !!composer.media;
            if (composer.kind === 'debate') return !!composer.body.trim() && composer.sides.every(x => x.trim());
            if (composer.kind === 'tierlist') return false;   // tier lists are posted from the tier list maker
            return !!(composer.body.trim() || composer.attachments.length || composer.media);
        });
        const submitComposer = async () => {
            if (!canPost.value || composer.posting) return;
            composer.posting = true;
            const k = composer.kind;
            const opts = composer.options.filter(o => o.label?.trim()).map(o => ({ id: o.id, label: o.label.trim().slice(0, 80), image: o.image, media_id: o.media_id, media_type: o.media_type, character_id: o.character_id }));
            const row = {
                user_id: uid(), kind: k, body: composer.body.trim().slice(0, 2000) || null,
                attachments: k === 'poll' ? [] : composer.attachments.map(a => ({ type: a.type, url: a.url, ...(a.id ? { id: a.id } : {}) })),
                spoiler: !!composer.spoiler, audience: composer.audience === 'everyone' ? 'everyone' : 'friends',
                media_id: composer.media?.id || null, media_type: composer.media?.type || mediaType.value, media_title: composer.media?.title || null, media_cover: composer.media?.cover || null,
                episode: k === 'question' && composer.episode ? Math.max(1, Math.floor(Number(composer.episode))) : null,
                extra: k === 'debate' ? { sides: composer.sides.map((l, n) => ({ id: n ? 'b' : 'a', label: l.trim().slice(0, 40) })) } : null,
                poll: k === 'poll' ? { question: composer.question.trim().slice(0, 200), ends_at: new Date(Date.now() + composer.hours * 3600e3).toISOString(), options: opts } : null,
            };
            Object.keys(row).forEach(k => { if (row[k] === null && (k.startsWith('media_') || k === 'extra')) delete row[k]; });
            try {
                const { data, error } = await sb.from('activities').insert(row).select().single();
                if (error) throw error;
                feed.value = [data, ...feed.value.filter(x => x.id !== data.id)];
                feedReplies.value = { ...feedReplies.value, [data.id]: [] };
                likes['activity:' + data.id] = { n: 0, mine: false, users: [] };
                if (k === 'poll') pollVotes[data.id] = { counts: {}, total: 0, mine: null, voters: {} };
                resetComposer();
                showToast(k === 'poll' ? 'Poll is live!' : k === 'question' ? 'Question posted' : 'Posted!');
            } catch (err) {
                showToast('Could not post: ' + (err.message || err) + (/kind|column|audience/i.test(err.message || '') ? ' — run the v7 SQL in Supabase' : ''), 'error');
            } finally { composer.posting = false; }
        };

        // polls
        const nowTick = ref(Date.now());
        const pollVotes = reactive({});           // activity id → { counts: { optionId: n }, total, mine, voters: { optionId: [user ids] } }
        const loadPollVotes = async (ids) => {
            if (!ids.length) return;
            const { data } = await sb.from('poll_votes').select('activity_id, option_id, user_id').in('activity_id', ids);
            ids.forEach(id => { pollVotes[id] = { counts: {}, total: 0, mine: null, voters: {} }; });
            (data || []).forEach(v => { const p = pollVotes[v.activity_id]; p.counts[v.option_id] = (p.counts[v.option_id] || 0) + 1; p.total++; (p.voters[v.option_id] = p.voters[v.option_id] || []).push(v.user_id); if (v.user_id === uid()) p.mine = v.option_id; });
        };
        const pollEnded = (a) => a.closed || (a.poll?.ends_at && new Date(a.poll.ends_at).getTime() <= nowTick.value);
        const pollInfo = (a) => {
            const v = pollVotes[a.id] || { counts: {}, total: 0, mine: null, voters: {} };
            const ended = pollEnded(a);
            const max = Math.max(0, ...Object.values(v.counts));
            const opts = (a.poll?.options || []).map(o => {
                const n = v.counts[o.id] || 0;
                return { ...o, n, pct: v.total ? Math.round(n / v.total * 100) : 0, win: ended && max > 0 && n === max, mine: v.mine === o.id, voters: (v.voters[o.id] || []).map(personOf) };
            });
            const left = a.poll?.ends_at ? Math.max(0, new Date(a.poll.ends_at).getTime() - nowTick.value) / 1000 : 0;
            return { ...v, ended, opts, show: ended || !!v.mine || a.user_id === uid(), winners: opts.filter(o => o.win), left: countdown(left) };
        };
        const votePoll = async (a, optId) => {
            if (pollEnded(a)) { showToast('This poll has ended', 'error'); return; }
            const before = JSON.parse(JSON.stringify(pollVotes[a.id] || { counts: {}, total: 0, mine: null, voters: {} }));
            const p = pollVotes[a.id] = pollVotes[a.id] || { counts: {}, total: 0, mine: null, voters: {} };
            const undo = p.mine === optId;
            if (p.mine) { p.counts[p.mine]--; p.total--; p.voters[p.mine] = (p.voters[p.mine] || []).filter(u => u !== uid()); }
            p.mine = undo ? null : optId;
            if (!undo) { p.counts[optId] = (p.counts[optId] || 0) + 1; p.total++; (p.voters[optId] = p.voters[optId] || []).push(uid()); }
            const { error } = undo
                ? await sb.from('poll_votes').delete().eq('activity_id', a.id).eq('user_id', uid())
                : await sb.from('poll_votes').upsert({ activity_id: a.id, user_id: uid(), option_id: optId }, { onConflict: 'activity_id,user_id' });
            if (error) { pollVotes[a.id] = before; showToast('Could not vote: ' + error.message, 'error'); }
        };
        const closeEndedPolls = async (acts) => {
            for (const a of acts) {
                if (a.kind !== 'poll' || a.closed || !pollEnded(a)) continue;
                a.closed = true;
                try { await sb.rpc('close_poll', { aid: a.id }); } catch {}
                loadPollVotes([a.id]);
            }
        };
        setInterval(() => { nowTick.value = Date.now(); if (feed.value.length) closeEndedPolls(feed.value); }, 30000);
        const onVoteRealtime = debounce((p) => { const id = p?.new?.activity_id || p?.old?.activity_id; if (id && feed.value.some(a => a.id === id)) loadPollVotes([id]); }, 600);

        // debates: two sides, a vote bar, and replies tagged with the side you picked
        const debateInfo = (a) => {
            const v = pollVotes[a.id] || { counts: {}, total: 0, mine: null };
            const sides = (a.extra?.sides || [{ id: 'a', label: 'Agree' }, { id: 'b', label: 'Disagree' }]).map(sd => ({ ...sd, n: v.counts[sd.id] || 0, pct: v.total ? Math.round((v.counts[sd.id] || 0) / v.total * 100) : 50 }));
            return { sides, total: v.total, mine: v.mine };
        };
        const sideLabel = (a, id) => (a.extra?.sides || []).find(x => x.id === id)?.label || '';

        // ---------- tier list maker ----------
        const TIER_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf80', '#bfff7f', '#7fbfff', '#bf7fff'];
        const newTiers = () => ['S', 'A', 'B', 'C', 'D'].map((l, n) => ({ label: l, color: TIER_COLORS[n], items: [] }));
        const TIER_SOURCES = [
            { v: 'anime', l: 'Characters from an anime' }, { v: 'tag', l: 'By tag (tsundere, isekai…)' }, { v: 'genre', l: 'By genre' },
            { v: 'mine', l: 'From my list' }, { v: 'search', l: 'Pick one by one' },
        ];
        const tier = reactive({ open: false, title: '', source: 'anime', what: 'CHARACTER', q: '', results: [], media: null, genre: '', tag: '', loading: false, pool: [], tiers: newTiers(), sel: null, posting: false, drag: null });
        const openTierMaker = (from = null) => {
            Object.assign(tier, { open: true, title: '', source: 'anime', what: 'CHARACTER', q: '', results: [], media: null, genre: '', tag: '', loading: false, pool: [], tiers: newTiers(), sel: null, posting: false, drag: null });
            if (from?.extra?.tiers) {   // "make my own version" of someone's tier list: same items, empty tiers
                tier.title = from.extra.title || from.body || '';
                tier.pool = from.extra.tiers.flatMap(t => t.items).map(x => ({ ...x }));
                tier.tiers = from.extra.tiers.map((t, n) => ({ label: t.label, color: t.color || TIER_COLORS[n % 6], items: [] }));
                tier.sourceLabel = from.extra.source || '';
            }
            composer.open = false;
        };
        const tierItemKey = (x) => (x.kind === 'CHARACTER' ? 'c' : 'm') + x.id;
        const placedKeys = computed(() => new Set(tier.tiers.flatMap(t => t.items.map(tierItemKey))));
        const addToPool = (items) => {
            const have = new Set([...tier.pool.map(tierItemKey), ...placedKeys.value]);
            const fresh = items.filter(x => x?.id && !have.has(tierItemKey(x)));
            tier.pool = [...tier.pool, ...fresh].slice(0, 80);
            return fresh.length;
        };
        const charItem = (c) => ({ kind: 'CHARACTER', id: c.id, name: c.name?.full || '?', image: c.image?.large || null });
        const mediaItem = (m) => ({ kind: m.type || 'ANIME', id: m.id, name: titleOf(m), image: m.coverImage?.large || null });
        // one search box: anime (for "characters from an anime"), or a single character/anime to add
        const runTierSearch = debounce(async () => {
            const q = tier.q.trim(); if (!q) { tier.results = []; return; }
            try {
                if (tier.source === 'search' && tier.what === 'CHARACTER') {
                    const d = await anilist('query ($q: String) { Page(perPage: 8) { characters(search: $q, sort: SEARCH_MATCH) { id name { full } image { large } } } }', { q });
                    tier.results = (d?.Page?.characters || []).map(charItem);
                } else {
                    const d = await anilist(`query ($q: String) { Page(perPage: 8) { media(search: $q, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } } }`, { q });
                    tier.results = (d?.Page?.media || []).map(normMedia);
                }
            } catch { tier.results = []; }
        }, 350);
        watch(() => [tier.q, tier.source, tier.what], runTierSearch);
        const pickTierResult = async (r) => {
            if (tier.source === 'search') { addToPool([r.kind ? r : mediaItem(r)]); tier.q = ''; tier.results = []; return; }
            // characters from an anime: fill the pool with its cast
            tier.media = r; tier.q = ''; tier.results = []; tier.loading = true;
            if (!tier.title) tier.title = `${titleOf(r)} characters`;
            try {
                const out = [];
                for (let p = 1; p <= 2; p++) {
                    const d = await anilist('query ($id: Int, $p: Int) { Media(id: $id) { characters(page: $p, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) { pageInfo { hasNextPage } nodes { id name { full } image { large } } } } }', { id: r.id, p });
                    const c = d?.Media?.characters; out.push(...(c?.nodes || []).map(charItem));
                    if (!c?.pageInfo?.hasNextPage) break;
                }
                const n = addToPool(out); showToast(`${n} characters added — drag them into tiers`);
            } catch (err) { showToast(err.message || 'Could not load characters', 'error'); }
            finally { tier.loading = false; }
        };
        // a genre or tag: either the most popular anime with it, or the main characters of those anime
        const loadTierGroup = async () => {
            const key = tier.source === 'genre' ? tier.genre : tier.tag; if (!key) return;
            tier.loading = true;
            if (!tier.title) tier.title = tier.what === 'CHARACTER' ? `${key} characters` : `${key} anime`;
            try {
                const arg = tier.source === 'genre' ? 'genre: $k' : 'tag: $k';
                if (tier.what === 'CHARACTER') {
                    const d = await anilist(`query ($k: String) { Page(perPage: 25) { media(${arg}, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { id characters(role: MAIN, perPage: 3, sort: FAVOURITES_DESC) { nodes { id name { full } image { large } } } } } }`, { k: key });
                    const n = addToPool((d?.Page?.media || []).flatMap(m => (m.characters?.nodes || []).map(charItem)));
                    showToast(`${n} main characters from popular ${key} anime`);
                } else {
                    const d = await anilist(`query ($k: String) { Page(perPage: 40) { media(${arg}, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`, { k: key });
                    const n = addToPool((d?.Page?.media || []).map(normMedia).map(mediaItem));
                    showToast(`${n} anime added`);
                }
            } catch (err) { showToast(err.message || 'Could not load', 'error'); }
            finally { tier.loading = false; }
        };
        const loadTierMine = (status = 'COMPLETED') => {
            const items = uniqueItems.value.filter(i => typeOf(i) === 'ANIME' && i.status === status).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 80).map(i => mediaItem(i.anime));
            if (!tier.title) tier.title = 'My ' + (status === 'COMPLETED' ? 'completed' : STATUS_LABELS[status].toLowerCase()) + ' anime';
            const n = addToPool(items); showToast(n ? `${n} added from your list` : 'Nothing new to add', n ? 'success' : 'error');
        };
        // moving items: drag (mouse) or tap an item, then tap a tier (phone)
        const findItem = (key) => {
            let i = tier.pool.findIndex(x => tierItemKey(x) === key); if (i !== -1) return { list: tier.pool, i };
            for (const t of tier.tiers) { i = t.items.findIndex(x => tierItemKey(x) === key); if (i !== -1) return { list: t.items, i }; }
            return null;
        };
        const moveTierItem = (key, to, before = null) => {   // to: tier index or -1 for the pool
            const f = findItem(key); if (!f) return;
            const [item] = f.list.splice(f.i, 1);
            const dest = to === -1 ? tier.pool : tier.tiers[to].items;
            const at = before ? dest.findIndex(x => tierItemKey(x) === before) : -1;
            if (at === -1) dest.push(item); else dest.splice(at, 0, item);
            tier.sel = null;
        };
        const tapTierItem = (key) => { tier.sel = tier.sel === key ? null : key; };
        const tapTierRow = (to) => { if (tier.sel) moveTierItem(tier.sel, to); };
        const onTierDrop = (to, before = null) => { if (tier.drag) moveTierItem(tier.drag, to, before); tier.drag = null; };
        const removeTierItem = (key) => { const f = findItem(key); if (f) f.list.splice(f.i, 1); if (tier.sel === key) tier.sel = null; };
        const addTierRow = () => { if (tier.tiers.length < 8) tier.tiers.push({ label: String.fromCharCode(65 + tier.tiers.length - 1), color: TIER_COLORS[tier.tiers.length % 6], items: [] }); };
        const removeTierRow = (n) => { if (tier.tiers.length <= 2) return; tier.pool.push(...tier.tiers[n].items); tier.tiers.splice(n, 1); };
        const tierPlacedCount = computed(() => tier.tiers.reduce((n, t) => n + t.items.length, 0));
        const postTierList = async () => {
            if (!tierPlacedCount.value || tier.posting) return;
            tier.posting = true;
            const srcLabel = tier.source === 'anime' && tier.media ? titleOf(tier.media) : tier.source === 'genre' ? tier.genre : tier.source === 'tag' ? tier.tag : (tier.sourceLabel || '');
            const row = {
                user_id: uid(), kind: 'tierlist', media_type: mediaType.value, body: tier.title.trim().slice(0, 120) || 'My tier list', attachments: [], spoiler: false,
                audience: composer.audience === 'everyone' ? 'everyone' : 'friends',
                extra: { title: tier.title.trim().slice(0, 120) || 'My tier list', source: srcLabel, tiers: tier.tiers.map(t => ({ label: t.label.slice(0, 12), color: t.color, items: t.items.map(x => ({ kind: x.kind, id: x.id, name: x.name, image: x.image })) })) },
            };
            if (tier.media) Object.assign(row, { media_id: tier.media.id, media_type: tier.media.type || 'ANIME', media_title: titleOf(tier.media), media_cover: tier.media.coverImage?.large || null });
            try {
                const { data, error } = await sb.from('activities').insert(row).select().single();
                if (error) throw error;
                feed.value = [data, ...feed.value.filter(x => x.id !== data.id)];
                feedReplies.value = { ...feedReplies.value, [data.id]: [] };
                likes['activity:' + data.id] = { n: 0, mine: false, users: [] };
                tier.open = false;
                showToast('Tier list posted!');
            } catch (err) { showToast('Could not post: ' + (err.message || err) + (/kind|extra|check/i.test(err.message || '') ? ' — run the v7.2 SQL in Supabase' : ''), 'error'); }
            finally { tier.posting = false; }
        };

        // questions: best answer + spoilers
        const revealedActs = reactive(new Set());
        const isActSpoiler = (a) => {
            if (a.user_id === uid() || revealedActs.has(a.id)) return false;
            if (a.spoiler) return true;
            if (a.kind === 'question' && a.episode) { const e = myEntry(a.media_id); return !(e?.status === 'COMPLETED') && a.episode > (e?.progress || 0); }
            return false;
        };
        const repliesSorted = (a) => { const list = feedReplies.value[a.id] || []; return a.best_reply_id ? [...list].sort((x, y) => (y.id === a.best_reply_id) - (x.id === a.best_reply_id)) : list; };
        const markBest = async (a, r) => {
            const next = a.best_reply_id === r.id ? null : r.id;
            const prev = a.best_reply_id;
            a.best_reply_id = next;
            const { error } = await sb.from('activities').update({ best_reply_id: next }).eq('id', a.id);
            if (error) { a.best_reply_id = prev; showToast(error.message, 'error'); } else if (next) showToast('Marked as best answer');
        };
        const lightbox = ref(null);
        const playVideoLink = (att) => { trailerOf.value = { title: { romaji: 'Video' }, trailer: { id: att.id, site: 'youtube' } }; };

        // Create a feed entry when your list changes (Settings → Lists → Activity)
        const lastActs = new Map();
        const logActivity = async (anime, before, after, squadId = null) => {
            const pref = PREFS.activity;
            if (!pref.enabled || !uid() || !anime?.id || !after) return;
            const bStatus = before?.status || null, bProg = before?.progress || 0, aProg = Number(after.progress) || 0;
            let row = null;
            const repAt = (x) => x?.status === 'REPEATING' ? (x.repeats?.[x.repeats.length - 1] || 0) : 0;
            if (after.status === 'REPEATING') {   // rewatch: its own episode counter
                const aR = repAt(after), bR = bStatus === 'REPEATING' && before?.repeats?.length === after.repeats?.length ? repAt(before) : 0;
                if (aR > bR) { if (pref.progress) row = { status: 'REPEATING', progress_from: bR + 1, progress_to: aR }; }
                else if (bStatus !== 'REPEATING' && pref.REPEATING !== false) row = { status: 'REPEATING', progress_from: null, progress_to: null };
            }
            else if (after.status === 'WATCHING' && aProg > bProg) { if (pref.progress) row = { status: 'WATCHING', progress_from: bProg + 1, progress_to: aProg }; }
            else if (after.status !== bStatus && pref[after.status] !== false) {
                row = { status: after.status, progress_from: null, progress_to: ['PAUSED', 'DROPPED', 'WATCHING'].includes(after.status) && aProg ? aProg : null };
            }
            if (!row) return;
            try {
                const now = new Date().toISOString();
                if ((row.status === 'WATCHING' || row.status === 'REPEATING') && row.progress_from != null) {
                    let last = lastActs.get(anime.id);
                    if (!last) {
                        const { data } = await sb.from('activities').select('*').eq('user_id', uid()).eq('media_id', anime.id).order('created_at', { ascending: false }).limit(1);
                        last = data?.[0];
                    }
                    if (last && last.status === row.status && last.progress_to != null && Date.now() - new Date(last.created_at).getTime() < 3600e3
                        && row.progress_from <= last.progress_to + 1 && row.progress_to > last.progress_to) {
                        const merged = { ...last, progress_to: row.progress_to, progress_from: last.progress_from ?? row.progress_from, updated_at: now };
                        await sb.from('activities').update({ progress_to: merged.progress_to, updated_at: now }).eq('id', last.id);
                        lastActs.set(anime.id, merged);
                        myRecent.value = myRecent.value.map(x => x.id === last.id ? merged : x);
                        return;
                    }
                }
                const { data, error } = await sb.from('activities').insert({
                    user_id: uid(), kind: 'list', media_id: anime.id, media_type: anime.type || 'ANIME',
                    media_title: anime.title?.romaji || anime.title?.english || anime.title?.native || 'Untitled', media_cover: anime.coverImage?.large || null,
                    squad_id: squadId, ...row,
                }).select().single();
                if (error) throw error;
                lastActs.set(anime.id, data);
                myRecent.value = [data, ...myRecent.value.filter(x => x.id !== data.id)].slice(0, 12);
            } catch (err) { console.warn('activity not saved', err.message || err); }
        };

        // ---------- editing entries ----------
        const buildForm = (anime) => {
            const solo = soloList.value.find(i => i.anime?.id === anime.id);
            const squadIds = coopList.value.filter(i => i.anime?.id === anime.id).map(i => i.squadId);
            const existing = solo || coopList.value.find(i => i.anime?.id === anime.id);
            const repeats = [...(solo?.repeats || [])];
            return {
                anime, status: existing?.status || (anime.type === 'SONG' ? 'COMPLETED' : 'PLANNING'),   // songs start as Liked score: existing?.score || 0, progress: existing?.progress || 0,
                inSolo: !!solo || !squadIds.length, wasSolo: !!solo, squadIds: [...squadIds], originalSquadIds: [...squadIds],
                savedRepeats: [...repeats], repeats, repProgress: existing?.status === 'REPEATING' ? (repeats[repeats.length - 1] || 0) : 0,
            };
        };
        const toggleFormSquad = (form, sid) => { const i = form.squadIds.indexOf(sid); if (i === -1) form.squadIds.push(sid); else form.squadIds.splice(i, 1); };
        const stepProgress = (form, delta) => {
            const max = form.anime?.episodes || 99999;
            if (form.status === 'REPEATING') { form.repProgress = clamp((Number(form.repProgress) || 0) + delta, 0, max); return; }   // the rewatch's own counter
            form.progress = clamp((Number(form.progress) || 0) + delta, 0, max);
            if (form.anime?.episodes && form.progress === form.anime.episodes) form.status = 'COMPLETED';
            else if (form.progress > 0 && form.status === 'PLANNING') form.status = 'WATCHING';
        };

        // ---------- repeats: rewatching an anime you finished ----------
        // Every rewatch gets its own episode counter (entry.repeats = [eps of rewatch 1, eps of rewatch 2, …], max 5).
        // Stats count each episode once; hovering "Episodes watched" shows the total with rewatches.
        const LILBRO = 'lilbro';
        const lilBro = reactive({ open: false, title: '', fresh: false });
        const repeatNow = (e) => e?.status === 'REPEATING' ? ((e.repeats || [])[(e.repeats || []).length - 1] || 0) : null;
        const repeatsDone = (e) => { const full = e?.anime?.episodes; return (e?.repeats || []).filter(n => full ? n >= full : n > 0).length; };
        // start a rewatch (or carry on with an unfinished one). null = all 5 used up
        const startRepeat = (repeats, eps) => {
            const r = [...(repeats || [])];
            if (r.length && eps && r[r.length - 1] < eps) return r;
            if (r.length >= MAX_REPEATS) return null;
            r.push(0); return r;
        };
        // the 6th rewatch: a hidden badge and a gentle suggestion
        const triggerLilBro = async (anime) => {
            const e = soloList.value.find(i => i.anime?.id === anime?.id);
            const already = soloList.value.some(i => i.lilbro);
            Object.assign(lilBro, { open: true, title: titleOf(anime), fresh: !already });
            if (e && !e.lilbro) { const n = { ...e, lilbro: true }; setSoloLocal(n); try { await upsertSolo(n); } catch (err) { console.warn(err); } }
        };
        const setFormStatus = (form, s) => {
            if (s === form.status) return;
            if (s === 'REPEATING') {
                const eps = form.anime?.episodes || null;
                const r = startRepeat(form.savedRepeats, eps);
                if (!r) { triggerLilBro(form.anime); return; }
                form.repeats = r; form.repProgress = r[r.length - 1] || 0;
                if (eps) form.progress = eps;                  // rewatching means the first watch is done
            } else if (form.status === 'REPEATING') {
                form.repeats = [...form.savedRepeats];         // changed your mind: no new rewatch
            }
            form.status = s;
        };
        const saveEntry = async (form) => {
            const anime = form.anime;
            if (!anime || isSaving.value) return false;
            const episodes = anime.episodes || null;
            let progress = clamp(Math.floor(Number(form.progress) || 0), 0, episodes || 99999);
            if (form.status === 'COMPLETED' && episodes) progress = episodes;
            const fields = { status: form.status, score: clamp(Number(form.score) || 0, 0, 10), progress, repeats: [...(form.repeats || [])] };
            let finishedRepeat = 0;
            if (form.status === 'REPEATING') {
                const r = fields.repeats.length ? fields.repeats : [0];
                const cur = clamp(Math.floor(Number(form.repProgress) || 0), 0, episodes || 99999);
                r[r.length - 1] = cur; fields.repeats = r;
                if (episodes) fields.progress = episodes;
                if (episodes && cur >= episodes) { fields.status = 'COMPLETED'; finishedRepeat = r.length; }   // rewatch done → back to Completed
            }
            const prev = myEntry(anime.id);
            const before = prev ? { status: prev.status, progress: prev.progress, repeats: prev.repeats } : null;
            if (finishedRepeat) setTimeout(() => showToast(`Finished rewatch #${finishedRepeat} of ${titleOf(anime)}!`), 900);
            isSaving.value = true;
            try {
                if (form.inSolo) { await upsertSolo({ anime, ...fields }); }
                else if (soloList.value.some(i => i.anime.id === anime.id)) { await deleteSolo(anime.id); }
                for (const sid of form.squadIds) await upsertSquadEntry(sid, anime, fields);
                for (const sid of form.originalSquadIds.filter(s => !form.squadIds.includes(s))) await deleteSquadEntry(sid, anime.id);
                await Promise.all([fetchSolo(), fetchSquadEntries()]);
                logActivity(anime, before, fields, form.inSolo ? null : (form.squadIds[0] || null));
                return true;
            } catch (err) {
                console.error(err);
                showToast('Save failed: ' + (err.message || err), 'error');
                return false;
            } finally {
                isSaving.value = false;
            }
        };
        const openEditor = (anime) => { if (anime) { quickMenuFor.value = null; squadDraft.open = false; editForm.value = buildForm(anime); } };
        const closeEditor = () => { editForm.value = emptyForm(); squadDraft.open = false; };
        const saveEditor = async () => { if (await saveEntry(editForm.value)) { showToast('Saved!'); closeEditor(); } };
        const saveInline = async () => { if (await saveEntry(inlineForm.value)) { showToast('Saved!'); inlineForm.value = buildForm(selectedAnime.value); } };

        // Removes titles from your solo list AND every squad list they're on — in a few bulk requests
        // (one delete per 200 titles, one per squad) instead of one request per title.
        const removeMany = async (animes) => {
            const ids = [...new Set(animes.map(a => a?.id).filter(Boolean))];
            if (!ids.length) return 0;
            const idSet = new Set(ids);
            const soloIds = soloList.value.filter(i => idSet.has(i.anime.id)).map(i => i.anime.id);
            const bySquad = new Map();
            coopList.value.forEach(i => { if (idSet.has(i.anime.id)) { if (!bySquad.has(i.squadId)) bySquad.set(i.squadId, []); bySquad.get(i.squadId).push(i.anime.id); } });
            const jobs = [];
            for (let k = 0; k < soloIds.length; k += 200) jobs.push(deleteSolo(soloIds.slice(k, k + 200)));
            bySquad.forEach((mids, sq) => { for (let k = 0; k < mids.length; k += 200) jobs.push(sb.from('squad_entries').delete().eq('squad_id', sq).in('media_id', mids.slice(k, k + 200)).then(({ error }) => { if (error) throw error; })); });
            // update the screen right away; put things back if the server says no
            const prevSolo = soloList.value, prevCoop = coopList.value;
            soloList.value = prevSolo.filter(i => !idSet.has(i.anime.id));
            coopList.value = prevCoop.filter(i => !idSet.has(i.anime.id));
            if (editForm.value.anime && idSet.has(editForm.value.anime.id)) closeEditor();
            if (selectedAnime.value && idSet.has(selectedAnime.value.id)) inlineForm.value = buildForm(selectedAnime.value);
            try { await Promise.all(jobs); return ids.length; }
            catch (err) { soloList.value = prevSolo; coopList.value = prevCoop; throw err; }
        };
        // One title → removed instantly, no pop-up
        const removeEverywhere = async (anime, { silent = false } = {}) => {
            if (!anime?.id) return false;
            try {
                await removeMany([anime]);
                if (!silent) showToast(`Removed ${titleOf(anime)} from all lists`);
                return true;
            } catch (err) {
                showToast('Could not remove: ' + (err.message || err), 'error');
                return false;
            }
        };

        // ---------- trailers ----------
        const trailerOf = ref(null);
        const trailerUrl = computed(() => {
            const t = trailerOf.value?.trailer; if (!t?.id) return '';
            if (t.site === 'dailymotion') return `https://www.dailymotion.com/embed/video/${t.id}?autoplay=1`;
            // no YouTube controls/keyboard/annotations: our own controls sit on top (see yt below)
            return `https://www.youtube-nocookie.com/embed/${t.id}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
        });
        const isYouTube = computed(() => !!trailerOf.value?.trailer?.id && trailerOf.value.trailer.site !== 'dailymotion');
        // Our own trailer controls. YouTube's title bar, "More videos" and logo live in the empty bars above/below the
        // video, which are cropped away; clicks go to our layer, so YouTube's hover UI never shows.
        const yt = reactive({ state: -1, time: 0, dur: 0, muted: false, started: false, heard: false, error: false });
        const ytFrame = ref(null); const ytBox = ref(null);
        // same message format as YouTube's own iframe API (channel "widget"); no extra script needed
        const ytPost = (msg) => { try { ytFrame.value?.contentWindow?.postMessage(JSON.stringify({ ...msg, id: 1, channel: 'widget' }), '*'); } catch {} };
        const ytCmd = (func, args = []) => ytPost({ event: 'command', func, args });
        let ytHello = null;
        const onYtLoad = () => {
            // keep saying hello until the player answers (it ignores messages sent before it's ready)
            clearInterval(ytHello); let tries = 0;
            ytHello = setInterval(() => {
                if (yt.heard || ++tries > 40 || !ytFrame.value) { clearInterval(ytHello); return; }
                ytPost({ event: 'listening' }); ytCmd('addEventListener', ['onStateChange']);
            }, 250);
        };
        window.addEventListener('message', (e) => {
            if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin || '')) return;
            if (!ytFrame.value || e.source !== ytFrame.value.contentWindow) return;   // only the trailer's player (the song player talks to its own)
            let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
            yt.heard = true;
            const i = d?.info;
            if (d?.event === 'onStateChange' && typeof i === 'number') yt.state = i;
            if (d?.event === 'onError') yt.error = true;   // 101 / 150: the owner doesn't allow playing it outside YouTube
            if (d?.event === 'infoDelivery' && i) {
                if (i.playerState != null) yt.state = i.playerState;
                if (i.currentTime != null) yt.time = i.currentTime;
                if (i.duration) yt.dur = i.duration;
                if (i.muted != null) yt.muted = i.muted;
            }
            if (yt.state === 1) yt.started = true;
        });
        const ytToggle = () => { if (yt.state === 1 || yt.state === 3) ytCmd('pauseVideo'); else ytCmd('playVideo'); };
        const ytSeek = (e) => { if (!yt.dur) return; const r = e.currentTarget.getBoundingClientRect(); const t = clamp((e.clientX - r.left) / r.width, 0, 1) * yt.dur; yt.time = t; ytCmd('seekTo', [t, true]); };
        const ytMute = () => { ytCmd(yt.muted ? 'unMute' : 'mute'); yt.muted = !yt.muted; };
        const ytFull = () => { const el = ytBox.value; if (!el) return; if (document.fullscreenElement) document.exitFullscreen?.(); else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); };
        const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
        watch(trailerOf, () => Object.assign(yt, { state: -1, time: 0, dur: 0, muted: false, started: false, heard: false, error: false }));
        window.addEventListener('keydown', (e) => { if (!trailerOf.value || !isYouTube.value || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return; if (e.key === ' ' || e.key === 'k') { e.preventDefault(); ytToggle(); } else if (e.key === 'm') ytMute(); else if (e.key === 'f') ytFull(); });
        const trailerExternal = computed(() => {
            const t = trailerOf.value?.trailer; if (!t?.id) return '';
            return t.site === 'dailymotion' ? `https://www.dailymotion.com/video/${t.id}` : `https://www.youtube.com/watch?v=${t.id}`;
        });
        const playTrailer = (anime) => { if (anime?.type === 'SONG') { const grid = (gridResults.value || []).map(x => x?.anime || x); playPreview(anime, grid.some(x => x?.id === anime.id) ? grid : null); return; } if (anime?.trailer?.id) { quickMenuFor.value = null; pauseSong(); trailerOf.value = anime; } };

        // ---------- playlists: your own "albums" of songs (Songs → Solo list) ----------
        // Saved in the playlists table (songs kept inside it, in order). Friends who can see your songs can see them.
        const playlists = ref([]);
        const plOpen = ref(null);           // open playlist id
        const plMissing = ref(false);       // the table isn't in the database yet (the SQL update wasn't run)
        const plAddPick = ref('');
        const fetchPlaylists = async () => {
            if (!uid()) return;
            const { data, error } = await sb.from('playlists').select('*').eq('user_id', uid()).order('created_at');
            if (error) { plMissing.value = /playlists|schema cache|does not exist/i.test(error.message || ''); return; }
            plMissing.value = false; playlists.value = data || [];
        };
        const plNeedsSql = () => showToast('Playlists need the latest database update: run the whole supabase_setup.sql in Supabase again', 'error');
        const createPlaylist = async (withSong = null) => {
            if (plMissing.value) { plNeedsSql(); return null; }
            const name = await askText({ title: 'New playlist', body: 'Give it a name — you can add songs to it from any song.', ok: 'Create', max: 60, placeholder: 'e.g. late night drives' });
            if (!name) return null;
            const songs = withSong ? [slimAnime(withSong)] : [];
            const { data, error } = await sb.from('playlists').insert({ user_id: uid(), name, songs }).select().single();
            if (error) { if (/playlists|schema cache/i.test(error.message)) { plMissing.value = true; plNeedsSql(); } else showToast('Could not create it: ' + error.message, 'error'); return null; }
            playlists.value = [...playlists.value, data];
            showToast(withSong ? `Made “${name}” with ${titleOf(withSong)}` : `Made “${name}”`);
            return data;
        };
        const savePlaylist = async (p, fields) => {
            const before = { ...p };
            Object.assign(p, fields);
            const { error } = await sb.from('playlists').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', p.id);
            if (error) { Object.assign(p, before); showToast('Could not save the playlist: ' + error.message, 'error'); return false; }
            return true;
        };
        const inPlaylist = (p, song) => (p?.songs || []).some(s => s.id === song?.id);
        const togglePlaylistSong = async (p, song) => {
            if (!p || !song) return;
            const has = inPlaylist(p, song);
            const songs = has ? p.songs.filter(s => s.id !== song.id) : [...(p.songs || []), slimAnime(song)];
            if (await savePlaylist(p, { songs })) showToast(has ? `Removed from “${p.name}”` : `Added to “${p.name}”`);
        };
        const addPickToPlaylist = (p) => { const e = soloList.value.find(i => String(i.anime.id) === String(plAddPick.value)); plAddPick.value = ''; if (e) togglePlaylistSong(p, e.anime); };
        const renamePlaylist = async (p) => { const name = await askText({ title: 'Rename playlist', value: p.name, ok: 'Rename', max: 60 }); if (name) savePlaylist(p, { name }); };
        const deletePlaylist = async (p) => {
            if (!(await askConfirm({ title: `Delete “${p.name}”?`, body: 'The songs stay on your list; only the playlist goes.', ok: 'Delete' }))) return;
            const { error } = await sb.from('playlists').delete().eq('id', p.id);
            if (error) { showToast('Could not delete it: ' + error.message, 'error'); return; }
            playlists.value = playlists.value.filter(x => x.id !== p.id); if (plOpen.value === p.id) plOpen.value = null;
        };
        const movePlaylistSong = (p, i, d) => { const s = [...p.songs]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; savePlaylist(p, { songs: s }); };
        const openPlaylist = (p) => { plOpen.value = plOpen.value === p.id ? null : p.id; nextTick(() => document.getElementById('pl-open')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); };
        const plOpenList = computed(() => playlists.value.find(p => p.id === plOpen.value) || null);
        const plCovers = (p) => [...new Set((p.songs || []).map(s => s.coverImage?.large).filter(Boolean))].slice(0, 4);
        const plLength = (p) => { const ms = (p.songs || []).reduce((a, s) => a + (s.durationMs || 0), 0); const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
        // the song editor's "Add to playlist" picker
        const plAddSongs = computed(() => { const p = plOpenList.value; return p ? soloList.value.filter(i => typeOf(i) === 'SONG' && !inPlaylist(p, i.anime)) : []; });

        // ---------- the song player: one for the whole site (bar at the bottom) ----------
        // Full songs: each song is looked up on YouTube and played in YouTube's own player, kept out of sight (sound only;
        // "Video" shows it). Nothing is downloaded or converted. If YouTube has no match (or the owner blocks playing it
        // outside YouTube), Apple's 30-second preview plays instead. Volume, shuffle, repeat and "full songs" are remembered.
        const VOL_KEY = 'anicoop_song_volume', PLAYER_KEY = 'anicoop_player_v1', YT_SONGS_KEY = 'anicoop_yt_songs_v1';
        const pPrefs = readJSON(PLAYER_KEY) || {};
        const player = reactive({
            song: null, playing: false, loading: false, t: 0, dur: 30, muted: false,
            vol: (() => { try { const v = parseFloat(localStorage.getItem(VOL_KEY)); return isNaN(v) ? 0.7 : clamp(v, 0, 1); } catch { return 0.7; } })(),
            queue: [], qi: -1, shuffle: !!pPrefs.shuffle, repeat: ['off', 'all', 'one'].includes(pPrefs.repeat) ? pPrefs.repeat : 'off',
            full: pPrefs.full !== false, mode: null, video: false, queueOpen: false, hidden: false,
        });
        const savePlayerPrefs = () => { try { localStorage.setItem(PLAYER_KEY, JSON.stringify({ shuffle: player.shuffle, repeat: player.repeat, full: player.full })); } catch {} };
        const saveVol = () => { try { localStorage.setItem(VOL_KEY, String(player.vol)); } catch {} };
        let playTok = 0, backStack = [], loadStart = 0;
        // --- engine 1: Apple previews (a plain <audio>) ---
        const audio = new Audio(); audio.preload = 'none'; audio.volume = player.vol;
        audio.addEventListener('timeupdate', () => { if (player.mode !== 'preview') return; player.t = audio.currentTime; if (audio.duration) player.dur = audio.duration; });
        audio.addEventListener('play', () => { if (player.mode === 'preview') player.playing = true; });
        audio.addEventListener('pause', () => { if (player.mode === 'preview') player.playing = false; });
        audio.addEventListener('ended', () => { if (player.mode === 'preview') songEnded(); });
        // --- engine 2: YouTube's player (official IFrame API) ---
        let ytP = null, ytReady = null, ytTimer = null, ytStartCheck = null;
        const loadYtApi = () => window.YT?.Player ? Promise.resolve(window.YT) : new Promise((ok, bad) => {
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => { prev?.(); ok(window.YT); };
            const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.onerror = () => bad(new Error('YouTube’s player didn’t load'));
            document.head.appendChild(sc);
        });
        const ytTick = () => { clearInterval(ytTimer); ytTimer = setInterval(() => { if (player.mode !== 'yt' || !ytP?.getCurrentTime) return; player.t = ytP.getCurrentTime() || 0; const d = ytP.getDuration?.(); if (d) player.dur = d; }, 250); };
        // YouTube's player lives outside the app's own page (Vue never redraws it); it's see-through unless "Video" is on
        const ytHolder = () => {
            let box = document.getElementById('song-yt-box');
            if (!box) { box = document.createElement('div'); box.id = 'song-yt-box'; box.className = 'song-yt'; box.setAttribute('aria-hidden', 'true'); box.innerHTML = '<div id="song-yt"></div>'; document.body.appendChild(box); }
            return box;
        };
        // every step gives up after a while, so a song never keeps loading forever (the preview plays instead)
        const withTimeout = (p, ms) => Promise.race([p, new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), ms))]);
        // (youtube.com, not youtube-nocookie.com: with the no-cookie host the player's "ready" message can go missing)
        const ytPlayer = () => ytReady || (ytReady = withTimeout(loadYtApi().then(YT => new Promise((ok) => {
            ytHolder();
            if (ytP) { try { ytP.destroy(); } catch {} ytP = null; document.getElementById('song-yt-box')?.remove(); ytHolder(); }
            const made = new YT.Player('song-yt', {
                width: '100%', height: '100%',
                playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, origin: location.origin },
                events: {
                    onReady: () => { ytP = made; ok(made); },
                    onStateChange: (e) => {
                        if (player.mode !== 'yt') return;
                        ytState = e.data;
                        if (e.data === 1) { player.playing = true; player.loading = false; clearTimeout(ytStartCheck); }
                        else if (e.data === 2) player.playing = false;
                        else if (e.data === 0) { player.playing = false; songEnded(); }
                    },
                    // 100 removed · 101/150 the owner only allows it on YouTube → the preview plays instead
                    onError: () => { if (player.mode === 'yt' && player.song) { const s = player.song; forgetYt(s); startPreview(s, playTok, 'YouTube won’t play this one here. Playing the 30-second preview.'); } },
                },
            });
        })), 15000).catch(err => { ytReady = null; throw err; }));
        let ytState = -1;
        const stopEngines = () => { audio.pause(); try { ytP?.pauseVideo?.(); } catch {} clearTimeout(ytStartCheck); };
        // --- finding the song on YouTube: the artist's own upload ("Artist - Topic" = the official audio) scores highest ---
        const ytSongs = reactive(readJSON(YT_SONGS_KEY) || {});
        const saveYtSongs = debounce(() => { const k = Object.keys(ytSongs); if (k.length > 1500) k.slice(0, k.length - 1500).forEach(x => delete ytSongs[x]); try { localStorage.setItem(YT_SONGS_KEY, JSON.stringify(ytSongs)); } catch {} }, 800);
        const songYtKey = (s) => songKey(s?.title?.romaji, (s?.artists || [])[0]);
        const forgetYt = (s) => { delete ytSongs[songYtKey(s)]; saveYtSongs(); };
        const BAD_TAKE = /\b(live|cover|karaoke|instrumental|remix|sped ?up|slowed|reverb|nightcore|8d|mashup|reaction|tutorial|lesson|piano|acoustic|extended|1 ?hour|loop)\b/i;
        const pickSongVideo = (list, s) => {
            const title = normTitle(String(s.title?.romaji || '').replace(/\s*[([].*?[)\]]/g, '')); const artist = normTitle((s.artists || [])[0] || '');
            const want = s.durationMs ? s.durationMs / 1000 : null; const songText = normTitle(s.title?.romaji);
            let best = null, bestScore = -1e9;
            for (const v of list) {
                if (!v.secs || v.secs > 20 * 60) continue;
                const vt = normTitle(v.title), ch = normTitle(v.channel);
                let sc = 0;
                if (title && vt.includes(title)) sc += 30; else if (title && title.split(' ').filter(w => w.length > 2).every(w => vt.includes(w))) sc += 15; else sc -= 40;
                if (/ topic$/.test(ch) && artist && ch.startsWith(artist)) sc += 45;
                else if (artist && (ch.includes(artist) || ch.replace(/ /g, '').includes(artist.replace(/ /g, '')))) sc += 25;
                else if (artist && vt.includes(artist)) sc += 10;
                if (v.badge === 'artist') sc += 10;
                if (/\bofficial audio\b/i.test(v.title)) sc += 8;
                const bad = BAD_TAKE.exec(v.title); if (bad && !songText.includes(normTitle(bad[0]))) sc -= 45;
                if (want) { const d = Math.abs(v.secs - want); sc += d <= 3 ? 25 : d <= 10 ? 12 : d <= 30 ? 0 : -25; }
                if (sc > bestScore) { best = v; bestScore = sc; }
            }
            return bestScore >= 20 ? best : null;
        };
        const ytForSong = async (s) => {
            const k = songYtKey(s); if (ytSongs[k]) return ytSongs[k];
            const artist = (s.artists || [])[0] || '';
            let v = pickSongVideo(await ytSearch(`${artist} - ${s.title?.romaji || ''}`), s);
            if (!v) v = pickSongVideo(await ytSearch(`${s.title?.romaji || ''} ${artist} official audio`), s);
            if (!v) return null;
            ytSongs[k] = v.id; saveYtSongs(); return v.id;
        };
        const previewUrlOf = async (s) => {
            let url = s.previewUrl;
            if (!url && s.appleId) url = (await itunes('lookup', { id: s.appleId }))?.results?.[0]?.previewUrl;   // charts don't include the preview link
            if (!url && s.extId?.startsWith('am:')) url = (await itunes('lookup', { id: s.extId.slice(3) }))?.results?.[0]?.previewUrl;
            return url || null;
        };
        const startPreview = async (s, tok, note = '') => {
            clearTimeout(ytStartCheck); try { ytP?.stopVideo?.(); } catch {}
            let url = null; try { url = await previewUrlOf(s); } catch {}
            if (tok !== playTok) return;
            player.loading = false;
            if (!url) { player.mode = null; player.playing = false; showToast(note ? 'This song can’t play here' : 'No way to play this song', 'error'); if (player.queue.length > 1) setTimeout(() => tok === playTok && nextSong(true), 1200); return; }
            if (note) showToast(note);
            player.mode = 'preview'; player.dur = 30; audio.src = url; audio.volume = player.vol; audio.muted = player.muted;
            audio.play().catch(() => showToast('Tap play to start', 'error'));
        };
        const sameSong = (a, b) => !!a && !!b && (a.id === b.id || (!!b.pending && a.title?.romaji === b.title?.romaji));
        const startSong = async (s) => {
            const tok = ++playTok; loadStart = Date.now();
            stopEngines();
            Object.assign(player, { song: s, t: 0, dur: s.durationMs ? s.durationMs / 1000 : 30, loading: true, playing: false, mode: null });
            let song = s;
            if (s.pending && s.wiki) { try { const m = await songApi.matchAllTime(s.wiki); if (m) song = { ...m }; } catch {} if (tok !== playTok) return; player.song = song; }
            addHistory(song, { key: 'play', label: player.full ? 'Played' : 'Played the preview', sub: (song.artists || []).join(', ') });
            setMediaSession(song);
            if (player.full) {
                try {
                    const [id, yp] = await Promise.all([withTimeout(ytForSong(song), 15000), ytPlayer()]);
                    if (tok !== playTok) return;
                    if (id) {
                        player.mode = 'yt'; audio.pause(); ytState = -1;
                        yp.setVolume(Math.round(player.vol * 100)); if (player.muted) yp.mute(); else yp.unMute();
                        yp.loadVideoById(id); ytTick();
                        ytWatch(tok, song, 7000);
                        return;
                    }
                } catch (err) { console.warn('Full song unavailable:', err?.message || err); }
                if (tok !== playTok) return;
            }
            startPreview(song, tok, player.full ? 'Couldn’t find the full song. Playing the 30-second preview.' : '');
        };
        // YouTube didn't start: blocked autoplay (it's "cued" / "unstarted") → the play button starts it;
        // nothing at all happened → the preview plays instead
        const ytWatch = (tok, song, ms) => {
            clearTimeout(ytStartCheck);
            ytStartCheck = setTimeout(() => {
                if (tok !== playTok || player.mode !== 'yt' || player.playing) return;
                if (ytState === 3) { ytWatch(tok, song, 8000); return; }   // still buffering: give it longer
                const tapped = ytWatch.tapped; ytWatch.tapped = false;
                if (!tapped && (ytState === -1 || ytState === 5 || ytState === 2)) { player.loading = false; showToast('Tap play to start the song'); return; }
                forgetYt(song);   // look for another upload next time
                startPreview(song, tok, 'YouTube didn’t start this song. Playing the 30-second preview.');
            }, ms);
        };
        // --- the queue: the list you pressed play in (an album, a chart, a playlist…) ---
        const queueFrom = (list, s) => { const q = (list || []).filter(x => x?.type === 'SONG'); return q.some(x => sameSong(x, s)) ? q : [s]; };
        const playPreview = (s, list = null) => {
            if (!s) return;
            quickMenuFor.value = null;
            if (sameSong(player.song, s) && (player.mode || player.loading)) { togglePlay(); return; }
            if (list) { player.queue = queueFrom(list, s).slice(0, 500); backStack = []; }
            else if (!player.queue.some(x => sameSong(x, s))) { player.queue = [s]; backStack = []; }
            player.qi = player.queue.findIndex(x => sameSong(x, s));
            startSong(s);
        };
        const playQueueAt = (i) => { const s = player.queue[i]; if (!s) return; if (player.qi >= 0) backStack.push(player.qi); player.qi = i; startSong(s); };
        const togglePlay = () => {
            if (!player.song) return;
            if (player.mode === 'yt' && ytP) {
                if (player.playing) ytP.pauseVideo();
                else { ytP.playVideo(); player.loading = true; ytWatch.tapped = true; ytWatch(playTok, player.song, 6000); }   // your tap didn't start it either → preview
            }
            else if (player.mode === 'preview') { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
            else if (!player.loading || Date.now() - loadStart > 4000) startSong(player.song);   // stopped, or stuck: start over
        };
        const nextIndex = (auto) => {
            const n = player.queue.length; if (!n) return -1;
            if (player.shuffle && n > 1) {
                const left = player.queue.map((_, i) => i).filter(i => i !== player.qi && !backStack.includes(i));
                if (left.length) return left[Math.floor(Math.random() * left.length)];
                if (player.repeat === 'all' || !auto) { backStack = []; const all = player.queue.map((_, i) => i).filter(i => i !== player.qi); return all[Math.floor(Math.random() * all.length)]; }
                return -1;
            }
            if (player.qi + 1 < n) return player.qi + 1;
            return player.repeat === 'all' || !auto ? 0 : -1;
        };
        const nextSong = (auto = false) => {
            if (auto && player.repeat === 'one') { seekTo(0); if (player.mode === 'yt') ytP?.playVideo(); else audio.play().catch(() => {}); return; }
            const i = nextIndex(auto);
            if (i < 0 || (!auto && player.queue.length < 2 && player.repeat !== 'all')) { if (auto) { player.playing = false; player.t = 0; } else seekTo(player.dur - 0.5); return; }
            playQueueAt(i);
        };
        const prevSong = () => {
            if (player.t > 3 || !player.queue.length) { seekTo(0); return; }
            const i = backStack.length ? backStack.pop() : player.qi > 0 ? player.qi - 1 : player.repeat === 'all' ? player.queue.length - 1 : -1;
            if (i < 0) { seekTo(0); return; }
            player.qi = i; startSong(player.queue[i]);
        };
        const songEnded = () => nextSong(true);
        const toggleShuffle = () => { player.shuffle = !player.shuffle; backStack = []; savePlayerPrefs(); };
        const cycleRepeat = () => { player.repeat = player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off'; savePlayerPrefs(); };
        const toggleFullSongs = () => { player.full = !player.full; savePlayerPrefs(); showToast(player.full ? 'Full songs on (from YouTube)' : '30-second previews only'); if (player.song) startSong(player.song); };
        const seekTo = (t) => {
            t = clamp(t, 0, player.dur || 0); player.t = t;
            if (player.mode === 'yt') ytP?.seekTo?.(t, true); else if (player.mode === 'preview' && audio.duration) audio.currentTime = t;
        };
        const seekPreview = (e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(clamp((e.clientX - r.left) / r.width, 0, 1) * (player.dur || 0)); };
        const seekKey = (e) => { if (e.key === 'ArrowRight') seekTo(player.t + 5); else if (e.key === 'ArrowLeft') seekTo(player.t - 5); };
        const applyVolume = () => { audio.volume = player.vol; audio.muted = player.muted; try { if (ytP?.setVolume) { ytP.setVolume(Math.round(player.vol * 100)); player.muted ? ytP.mute() : ytP.unMute(); } } catch {} };
        const setVolume = (v) => { player.muted = false; player.vol = clamp(Number(v) || 0, 0, 1); applyVolume(); saveVol(); };
        const toggleMute = () => { player.muted = !player.muted; applyVolume(); };
        const isPlaying = (s) => !!s && player.playing && sameSong(player.song, s);
        const closePlayer = () => { ++playTok; stopEngines(); try { ytP?.stopVideo?.(); } catch {} audio.removeAttribute('src'); clearInterval(ytTimer); Object.assign(player, { song: null, playing: false, loading: false, mode: null, video: false, queueOpen: false, hidden: false, queue: [], qi: -1 }); backStack = []; try { navigator.mediaSession.metadata = null; } catch {} };
        const removeFromQueue = (i) => { if (i === player.qi) return; player.queue.splice(i, 1); if (i < player.qi) player.qi--; backStack = backStack.filter(x => x !== i).map(x => x > i ? x - 1 : x); };
        // lock screen / keyboard media keys
        const setMediaSession = (s) => {
            if (!('mediaSession' in navigator)) return;
            try {
                navigator.mediaSession.metadata = new MediaMetadata({ title: s.title?.romaji || '', artist: (s.artists || []).join(', '), album: s.album || '', artwork: s.coverImage?.large ? [{ src: s.coverImage.large, sizes: '600x600' }] : [] });
                navigator.mediaSession.setActionHandler('play', togglePlay); navigator.mediaSession.setActionHandler('pause', togglePlay);
                navigator.mediaSession.setActionHandler('nexttrack', () => nextSong()); navigator.mediaSession.setActionHandler('previoustrack', prevSong);
            } catch {}
        };
        // a video (episode, trailer) pauses the song
        const pauseSong = () => { if (!player.playing) return; if (player.mode === 'yt') ytP?.pauseVideo?.(); else audio.pause(); };
        // the bar takes room at the bottom: the page and every popup end above it, so it never covers a button
        watch(() => !!player.song && !player.hidden && !!currentUser.value, (on) => document.documentElement.classList.toggle('has-player', on), { immediate: true });
        // "hide" tucks the bar away (the song keeps playing); the small button in the bottom-left corner brings it back
        const hidePlayer = () => { player.hidden = true; player.queueOpen = false; player.video = false; };
        const showPlayer = () => { player.hidden = false; };
        watch(() => currentAppView.value === 'tracker', (on) => document.documentElement.classList.toggle('pbar-nav', on), { immediate: true });
        // on phones it sits right on top of the bottom tab bar, whatever that bar's real height is
        let mnavSeen = null;
        const mnavRO = typeof ResizeObserver === 'function' ? new ResizeObserver(([e]) => { const h = e?.target?.offsetHeight; if (h) document.documentElement.style.setProperty('--mnav-h', h + 'px'); }) : null;
        watch(() => !!player.song && currentAppView.value === 'tracker', async (on) => {
            if (!on || !mnavRO) return; await nextTick();
            const nav = document.querySelector('nav.mnav'); if (nav && nav !== mnavSeen) { if (mnavSeen) mnavRO.unobserve(mnavSeen); mnavRO.observe(nav); mnavSeen = nav; }
        }, { immediate: true });
        watch(() => player.video && player.mode === 'yt' && !!player.song, (on) => { const b = document.getElementById('song-yt-box'); if (b) { b.classList.toggle('show', on); b.setAttribute('aria-hidden', on ? 'false' : 'true'); } });
        const closeTrailer = () => { trailerOf.value = null; };

        // ---------- list views ----------
        const baseListItems = computed(() => {
            let items = (activeTab.value === 'coop' ? secCoop.value : secSolo.value) || [];
            if (activeTab.value === 'coop' && listFilterGroup.value !== 'ALL') items = items.filter(i => i.squadId === listFilterGroup.value);
            if (listSearchQuery.value) {
                const q = listSearchQuery.value.toLowerCase();
                items = items.filter(i => [i.anime?.title?.romaji, i.anime?.title?.english, i.anime?.title?.native].some(t => t && t.toLowerCase().includes(q)));
            }
            return items;
        });
        const statusCounts = computed(() => {
            const counts = { ALL: baseListItems.value.length };
            baseListItems.value.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
            return counts;
        });
        const filteredGroupedList = computed(() => {
            const groups = Object.fromEntries(STATUS_ORDER.map(s => [s, []]));
            baseListItems.value.forEach(item => { groups[item.status]?.push(item); });
            const keys = listFilterStatus.value === 'ALL' ? STATUS_ORDER : [listFilterStatus.value];
            return Object.fromEntries(keys.filter(k => groups[k]?.length).map(k => [k, sortEntries(groups[k], PREFS.listOrder)]));
        });
        const squadCount = (sid) => secCoop.value.filter(i => i.squadId === sid).length;
        const listFiltersOn = computed(() => listFilterStatus.value !== 'ALL' || listFilterGroup.value !== 'ALL' || !!listSearchQuery.value.trim());
        const clearListFilters = () => { listFilterStatus.value = 'ALL'; listFilterGroup.value = 'ALL'; listSearchQuery.value = ''; };

        const myAnimeIds = computed(() => new Set([...soloList.value, ...coopList.value].map(i => i.anime?.id)));
        const isOnMyList = (id) => myAnimeIds.value.has(id);
        const visibleResults = computed(() => results.value.filter(a => notHidden(a) && (!filters.value.hideMyAnime || !isOnMyList(a.id))));
        // Songs load 100 at a time behind a button: show only full rows until the next 100 arrive (the rest waits for them)
        const gridCols = ref(0);
        let gridEl = null, gridRO = null;
        const watchGridCols = (el) => {
            if (!el || el === gridEl) return;
            gridEl = el; gridRO?.disconnect();
            const measure = () => { if (gridEl?.isConnected) gridCols.value = getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length; };
            measure(); gridRO = new ResizeObserver(measure); gridRO.observe(el);
        };
        const gridResults = computed(() => {
            const list = visibleResults.value, c = gridCols.value;
            if (section.value !== 'songs' || !hasNextPage.value || c < 2) return list;
            const n = Math.floor(list.length / c) * c;
            return n ? list.slice(0, n) : list;
        });

        const uniqueItems = computed(() => {
            const map = new Map();
            [...coopList.value, ...soloList.value].forEach(i => { if (i?.anime?.id) map.set(i.anime.id, i); });  // solo wins
            return [...map.values()];
        });
        const statsFor = (items) => {
            let epsWatched = 0, chaptersRead = 0, hoursPlayed = 0, tvEps = 0, plays = 0, scored = 0, scoreSum = 0, repeatEps = 0;
            items.forEach(i => {
                const t = typeOf(i);
                const n = t === 'GAME' ? (i.progress || 0) : (i.status === 'COMPLETED' || i.status === 'REPEATING') ? (i.anime?.episodes || i.progress || 0) : (i.progress || 0);
                if (t === 'ANIME') (i.repeats || []).forEach(x => { repeatEps += x || 0; });   // rewatched episodes: only in the "with rewatches" total
                if (t === 'MANGA') chaptersRead += n; else if (t === 'GAME') hoursPlayed += n; else if (t === 'ANIME') epsWatched += n; else if (t === 'TV') tvEps += n; else if (t === 'SONG') plays += (i.progress || 0);
                if (i.score > 0) { scored++; scoreSum += i.score; }
            });
            const count = (t, done) => items.filter(i => typeOf(i) === t && (!done || i.status === 'COMPLETED' || i.status === 'REPEATING')).length;
            return {
                anime: count('ANIME'), manga: count('MANGA'), games: count('GAME'), tv: count('TV'), songs: count('SONG'),
                epsWatched, epsWithRepeats: epsWatched + repeatEps, repeatEps, chaptersRead, hoursPlayed, tvEps, plays, completed: items.filter(i => i.status === 'COMPLETED').length,
                animeDone: count('ANIME', true), mangaDone: count('MANGA', true), gamesDone: count('GAME', true), tvDone: count('TV', true), songsDone: count('SONG', true),
                mean: scored ? scoreSum / scored : 0, meanScore: formatMean(scored ? scoreSum / scored : 0),
            };
        };
        // Laid out in columns: each section on top, its "how much" below (Anime over Episodes watched, …)
        const statCards = (s, days) => [
            { key: 'days', label: 'Days active', value: days, accent: true, col: 0 },
            { key: 'mean', label: 'Mean score', value: s.meanScore, small: true, col: 0 },
            { key: 'ANIME', label: 'Anime', value: s.anime, icon: 'fa-dragon', color: SECTIONS.anime.color, col: 1, done: s.animeDone },
            { key: 'eps', label: 'Episodes watched', value: s.epsWatched, small: true, col: 1, alt: s.epsWithRepeats, altLabel: 'With rewatches' },
            { key: 'MANGA', label: 'Manga', value: s.manga, icon: 'fa-book-open', color: SECTIONS.manga.color, col: 2, done: s.mangaDone },
            { key: 'chapters', label: 'Chapters read', value: s.chaptersRead, small: true, col: 2 },
            { key: 'TV', label: 'Movies & TV', value: s.tv, icon: 'fa-film', color: SECTIONS.movies.color, col: 3 },
            { key: 'tv_done', label: 'Completed', value: s.tvDone, small: true, col: 3 },
            { key: 'GAME', label: 'Games', value: s.games, icon: 'fa-gamepad', color: SECTIONS.games.color, col: 4, done: s.gamesDone },
            { key: 'hours', label: 'Hours played', value: s.hoursPlayed, small: true, col: 4 },
            { key: 'SONG', label: 'Songs', value: s.songs, icon: 'fa-music', color: SECTIONS.songs.color, col: 5, done: s.songsDone },
            { key: 'plays', label: 'Plays', value: s.plays, small: true, col: 5 },
        ];
        const statColumns = (cards) => [0, 1, 2, 3, 4, 5].map(c => cards.filter(x => x.col === c));

        // "Series" count: seasons, movies & side stories of the same show count once (uses AniList relations)
        const FRANCHISE_RELS = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'COMPILATION', 'ALTERNATIVE'];
        const FR_KEY = 'anicoop_franchise_v1';
        const franchiseLinks = reactive(readJSON(FR_KEY) || {});
        let franchiseBusy = false;
        const ensureFranchise = async (entries) => {
            if (franchiseBusy) return;
            const ids = [...new Set(entries.filter(i => isAniListType(typeOf(i))).map(i => i.anime?.id).filter(id => id && !franchiseLinks[id]))];
            if (!ids.length) return;
            franchiseBusy = true;
            try {
                for (let i = 0; i < ids.length; i += 50) {
                    const chunk = ids.slice(i, i + 50);
                    const data = await anilistLow('query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id type relations { edges { relationType node { id type } } } } } }', { ids: chunk });
                    const got = new Map((data?.Page?.media || []).map(m => [m.id, m]));
                    chunk.forEach(id => {
                        const m = got.get(id);
                        franchiseLinks[id] = m ? (m.relations?.edges || []).filter(e => FRANCHISE_RELS.includes(e.relationType) && e.node?.type === m.type).map(e => e.node.id) : [];
                    });
                    try { localStorage.setItem(FR_KEY, JSON.stringify(franchiseLinks)); } catch {}
                    if (i + 50 < ids.length) await sleep(900);
                }
            } catch (err) { console.warn('series count', err.message || err); }
            finally { franchiseBusy = false; }
        };
        const franchiseCount = (entries, type) => {
            const ids = [...new Set(entries.filter(i => typeOf(i) === type).map(i => i.anime.id))];
            if (!ids.length) return 0;
            const parent = new Map();
            const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
            const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
            const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
            ids.forEach(id => { add(id); (franchiseLinks[id] || []).forEach(o => union(id, o)); });
            return new Set(ids.map(find)).size;
        };
        const seriesReady = (entries, type) => entries.filter(i => typeOf(i) === type).every(i => franchiseLinks[i.anime.id]);
        // completed series: the whole series is grouped first (all its seasons, movies & side stories on your list),
        // and it only counts when every one of them is Completed (or being rewatched) — one finished season isn't enough
        const franchiseDone = (entries, type) => {
            const list = entries.filter(i => typeOf(i) === type);
            if (!list.length) return 0;
            const parent = new Map();
            const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
            const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
            const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
            list.forEach(i => { add(i.anime.id); (franchiseLinks[i.anime.id] || []).forEach(o => union(i.anime.id, o)); });
            const groups = new Map();
            list.forEach(i => { const r = find(i.anime.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
            return [...groups.values()].filter(g => g.every(i => i.status === 'COMPLETED' || i.status === 'REPEATING')).length;
        };
        const withSeries = (cards, entries) => cards.map(c => (c.key === 'ANIME' || c.key === 'MANGA') && typeof c.value === 'number' && c.value > 0
            ? { ...c, series: franchiseCount(entries, c.key), seriesReady: seriesReady(entries, c.key), seriesDone: franchiseDone(entries, c.key) } : c);

        const profileStats = computed(() => statsFor(uniqueItems.value));
        const profileStatCards = computed(() => withSeries(statCards(profileStats.value, daysActive.value), uniqueItems.value));
        watch(() => currentAppView.value === 'tracker' && activeTab.value === 'profile' && !viewUserId.value && !selectedAnime.value, (on) => { if (on) { ensureFranchise(uniqueItems.value); } });
        const rankedAnime = computed(() => uniqueItems.value.filter(i => i.score > 0).sort((a, b) => b.score - a.score));
        // ---------- drag to reorder (shared by rankings + a game series' story order) ----------
        // Grab a row (on phones: its grip) and drop it on a new spot; the row follows the pointer, the others slide aside.
        const makeSortable = (onMove, canDrag) => {
            const st = reactive({ key: null, from: -1, over: -1, dy: 0, h: 0 });
            let mids = [], startY = 0;
            const down = (key, idx, e) => {
                if (!canDrag() || st.key || (e.pointerType === 'mouse' && e.button !== 0)) return;
                if (e.target.closest('input, button, a')) return;
                if (e.pointerType !== 'mouse' && !e.target.closest('.rank-grip')) return;
                const rows = [...e.currentTarget.parentElement.querySelectorAll(':scope > .rank-row')];
                mids = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + window.scrollY + b.height / 2; });
                startY = e.clientY + window.scrollY;
                Object.assign(st, { key, from: idx, over: idx, dy: 0, h: rows[idx]?.getBoundingClientRect().height || 64 });
                e.currentTarget.setPointerCapture?.(e.pointerId);
                e.preventDefault();
            };
            const move = (e) => {
                if (!st.key) return;
                st.dy = e.clientY + window.scrollY - startY;
                const at = mids[st.from] + st.dy;
                st.over = mids.reduce((n, m, k) => n + (k !== st.from && at > m ? 1 : 0), 0);
                if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
            };
            const up = () => {
                if (!st.key) return;
                const { key, from, over } = st;
                Object.assign(st, { key: null, from: -1, over: -1, dy: 0 });
                if (over !== from) onMove(key, from, over);
            };
            const style = (key, idx) => {
                if (st.key !== key) return null;
                if (idx === st.from) return { transform: `translateY(${st.dy}px)`, zIndex: 5, position: 'relative' };
                let shift = 0;
                if (st.from < st.over && idx > st.from && idx <= st.over) shift = -st.h;
                if (st.from > st.over && idx >= st.over && idx < st.from) shift = st.h;
                return { transform: `translateY(${shift}px)`, transition: 'transform .18s cubic-bezier(.16,1,.3,1)' };
            };
            return { st, down, move, up, style };
        };

        // ---------- rankings: anime / anime movies / manga / manhwa / games / movies & TV, 10 at a time, in your own order ----------
        const RANK_CATS = [
            { id: 'ANIME', label: 'Anime', icon: 'fa-dragon', noun: 'anime' }, { id: 'MOVIE', label: 'Anime movies', icon: 'fa-clapperboard', noun: 'anime movies' },
            { id: 'MANGA', label: 'Manga', icon: 'fa-book-open', noun: 'manga' }, { id: 'MANHWA', label: 'Manhwa & Manhua', icon: 'fa-scroll', noun: 'manhwa' },
            { id: 'GAME', label: 'Games', icon: 'fa-gamepad', noun: 'games' }, { id: 'FILM', label: 'Movies', icon: 'fa-film', noun: 'movies' },
            { id: 'TV', label: 'TV shows', icon: 'fa-tv', noun: 'TV shows' }, { id: 'SONG', label: 'Songs', icon: 'fa-music', noun: 'songs' },
        ];
        const rankCatOf = (i) => {
            const t = typeOf(i);
            if (t === 'GAME' || t === 'SONG') return t;
            if (t === 'TV') return i.anime?.format === 'MOVIE' ? 'FILM' : 'TV';
            if (t === 'MANGA') return ['KR', 'CN', 'TW'].includes(i.anime?.countryOfOrigin) ? 'MANHWA' : 'MANGA';
            return i.anime?.format === 'MOVIE' ? 'MOVIE' : 'ANIME';
        };
        // Titles you placed by hand keep their spot; newly scored ones slot in by score.
        const applyRankOrder = (items, order) => {
            const byScore = [...items].sort((a, b) => b.score - a.score || titleOf(a.anime).localeCompare(titleOf(b.anime)));
            if (!order?.length) return byScore;
            const pos = new Map(order.map((id, k) => [id, k]));
            const out = byScore.filter(i => pos.has(i.anime.id)).sort((a, b) => pos.get(a.anime.id) - pos.get(b.anime.id));
            byScore.filter(i => !pos.has(i.anime.id)).forEach(it => { let k = out.findIndex(x => x.score < it.score); if (k === -1) k = out.length; out.splice(k, 0, it); });
            return out;
        };
        // manhwa used to share the manga ranking, so until you reorder Manhwa it keeps the order you gave it there
        const buildRankings = (entries, orders) => RANK_CATS.map(c => ({ ...c, items: applyRankOrder(entries.filter(i => i.score > 0 && rankCatOf(i) === c.id), orders[c.id]?.length ? orders[c.id] : (c.id === 'MANHWA' ? orders.MANGA : null)) }));
        const myRankOrders = reactive({});
        const viewedRankOrders = reactive({});
        const myRankings = computed(() => buildRankings(uniqueItems.value, myRankOrders));
        const viewedRankings = computed(() => buildRankings(viewedUser.value?.entries || [], viewedRankOrders));
        const rankTab = reactive({ me: 'ANIME', them: 'ANIME' });
        const rankShown = reactive({});                 // 'me:ANIME' → how many rows are visible (10 more per click)
        const shownOf = (key) => rankShown[key] || 10;
        const showMoreRank = (key) => { rankShown[key] = shownOf(key) + 10; };
        const rankEdit = ref(false);
        const fetchRankOrders = async (userId, target) => {
            Object.keys(target).forEach(k => delete target[k]);
            const { data, error } = await sb.from('rank_orders').select('category, media_ids').eq('user_id', userId);
            if (error) return;
            (data || []).forEach(r => { target[r.category] = r.media_ids || []; });
        };
        const saveRankOrder = debounce(async (cat) => {
            const { error } = await sb.from('rank_orders').upsert({ user_id: uid(), category: cat, media_ids: myRankOrders[cat] || [], updated_at: new Date().toISOString() }, { onConflict: 'user_id,category' });
            if (error) showToast('Could not save your ranking: ' + error.message + (/rank_orders/.test(error.message) ? ' — run the latest supabase_setup.sql in Supabase' : ''), 'error');
        }, 700);
        const moveRank = (cat, from, to) => {
            const ids = myRankings.value.find(c => c.id === cat).items.map(i => i.anime.id);
            to = clamp(to, 0, ids.length - 1);
            if (from === to || from < 0 || from >= ids.length) return;
            const [id] = ids.splice(from, 1); ids.splice(to, 0, id);
            myRankOrders[cat] = ids;
            if (to >= shownOf('me:' + cat)) rankShown['me:' + cat] = Math.ceil((to + 1) / 10) * 10;
            saveRankOrder(cat);
        };
        const setRankPos = (cat, from, value) => { const n = parseInt(value, 10); if (n >= 1) moveRank(cat, from, n - 1); };
        const resetRankOrder = (cat) => { myRankOrders[cat] = []; saveRankOrder(cat); showToast('Back to sorting by score'); };
        // drag to reorder your ranking (Reorder mode)
        const rankSort = makeSortable((cat, from, to) => moveRank(cat, from, to), () => rankEdit.value);
        const rankDrag = rankSort.st;
        const onRankPointerDown = rankSort.down, onRankPointerMove = rankSort.move, onRankPointerUp = rankSort.up, rankRowStyle = rankSort.style;
        const sectionCounts = computed(() => {
            const c = {}; uniqueItems.value.forEach(i => { const k = SECTION_OF_TYPE[typeOf(i)] || 'anime'; c[k] = (c[k] || 0) + 1; }); return c;
        });
        const sectionProgress = computed(() => [...secSolo.value, ...secCoop.value].reduce((n, i) => n + (i.status === 'COMPLETED' && typeOf(i) !== 'GAME' ? (i.anime?.episodes || i.progress || 0) : (i.progress || 0)), 0));

        // Top 5 among friends: shows the most friends are into right now (current section)
        const friendsTrending = computed(() => {
            const byMedia = new Map();
            const now = Date.now();
            friendEntries.value.forEach(r => {
                if ((r.media_type || 'ANIME') !== mediaType.value || !r.media_data?.id) return;
                const age = (now - new Date(r.updated_at).getTime()) / 86400000;
                const w = (r.status === 'WATCHING' ? 3 : r.status === 'PLANNING' ? 1.5 : r.status === 'COMPLETED' ? 2 : 0.5) * (age < 14 ? 1.5 : age < 60 ? 1 : 0.6);
                const cur = byMedia.get(r.media_id) || { anime: normMedia(r.media_data), score: 0, people: [] };
                cur.score += w; cur.people.push(r.user_id);
                byMedia.set(r.media_id, cur);
            });
            return [...byMedia.values()].sort((a, b) => b.people.length - a.people.length || b.score - a.score).slice(0, 5)
                .map(x => ({ ...x, people: x.people.map(personOf) }));
        });

        // Continue watching (solo + squad entries you're currently watching)
        const continueWatching = computed(() => {
            const out = [];
            secSolo.value.forEach(i => {
                if (i.status === 'WATCHING') out.push({ ...i, key: 's-' + i.anime.id, squadName: null, source: 'solo' });
                else if (i.status === 'REPEATING') out.push({ ...i, key: 's-' + i.anime.id, squadName: null, source: 'solo', progress: repeatNow(i), repeatNo: (i.repeats || []).length || 1 });   // rewatches show their own counter
            });
            secCoop.value.forEach(i => { if (i.status === 'WATCHING') out.push({ ...i, key: 'c-' + i.key, squadName: i.group, source: 'squad' }); });
            return out.slice(0, 16);
        });
        const progressPct = (item) => item.anime?.episodes ? Math.min(100, (item.progress || 0) / item.anime.episodes * 100) : 0;
        const bumpEpisode = async (item) => {
            if (item.source === 'solo') { quickSolo(item.anime, 'EP'); return; }
            const eps = item.anime.episodes || null;
            if (eps && item.progress >= eps) { showToast(`Already at the last ${UNIT.ep.toLowerCase()}`, 'error'); return; }
            const progress = (item.progress || 0) + 1;
            const status = eps && progress >= eps ? 'COMPLETED' : 'WATCHING';
            const row = coopList.value.find(i => i.key === item.key.replace(/^c-/, ''));
            if (row) { row.progress = progress; row.status = status; }
            try { await upsertSquadEntry(item.squadId, item.anime, { status, progress, score: item.score }); logActivity(item.anime, { status: item.status, progress: item.progress }, { status, progress }, item.squadId); }
            catch (err) { showToast('Could not update: ' + (err.message || err), 'error'); fetchSquadEntries(); return; }
            showToast(status === 'COMPLETED' ? `Finished ${titleOf(item.anime)} with ${item.squadName}!` : `${UNIT.ep} ${progress}${eps ? '/' + eps : ''} · ${titleOf(item.anime)}`);
        };

        // Home poster stack: one trending pick from each of Anime, Movies & TV, Games and Manga, different every visit.
        // The pools are cached, so the posters are chosen before the intro plays and never swap mid-animation.
        const heroPool = ref([]);
        const HERO_KEY = 'anicoop_hero_pool_v2';
        const HERO_ORDER = ['ANIME', 'TV', 'GAME', 'MANGA'];
        const HERO_TINT = { ANIME: '#B490F5', TV: '#3b82f6', GAME: '#D4FF3A', MANGA: '#FF4D8D' };
        const pickHero = (pools) => HERO_ORDER.map(t => {
            const list = (pools || {})[t] || []; if (!list.length) return null;
            const m = list[Math.floor(Math.random() * list.length)];
            return { ...normMedia(m), heroColor: m.heroColor || HERO_TINT[t] };
        });
        heroPool.value = pickHero(readJSON(HERO_KEY));
        // the intro's glow / link colours follow the covers on screen
        const heroColors = computed(() => { const c = heroPool.value.map(m => m?.heroColor).filter(Boolean); return { c1: c[0] || '#B490F5', c2: c[1] || c[0] || '#D4FF3A', c3: c[2] || '#FF4D8D' }; });
        // soft, layered glow under each home poster (several wide, faint layers so it fades out with no visible edge)
        const heroGlow = (color) => {
            const base = '0 36px 70px -28px rgba(0,0,0,.6)';
            if (!/^#[0-9a-f]{6}$/i.test(color || '')) return base;
            return `${base}, 0 0 28px -6px ${color}59, 0 0 70px -10px ${color}38, 0 0 140px -20px ${color}1f`;
        };
        // back-to-top button: appears after scrolling about a screen down
        const showToTop = ref(false);
        window.addEventListener('scroll', () => { const on = window.scrollY > Math.max(600, window.innerHeight * 0.9); if (on !== showToTop.value) showToTop.value = on; }, { passive: true });
        const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        // "Plan to Watch" for anime, "Plan to Play" for games… whatever fits that poster's section
        const statusLabelFor = (type, status, short = false) => (LABEL_SETS[type] || LABEL_SETS.ANIME)[short ? 'short' : 'labels'][status] || status;
        const heroSave = (p, status) => {
            if (!p.anime) return;
            if (!currentUser.value) { showToast('Sign in to save it', 'error'); return; }
            if (p.status === status) { showToast(`${p.title} is already in ${statusLabelFor(p.anime.type, status)}`); return; }
            quickSolo(p.anime, status);
        };
        // Home: the line from P1 to P2 is a smooth curve through the 4 cards (Catmull-Rom → Bézier, in the 560×600 stage)
        const HERO_A = [40, 40], HERO_B = [496, 568];
        const HERO_POINTS = [[158, 128], [398, 238], [168, 368], [382, 470]];
        const heroPath = (() => {
            // each hop is a soft S (flat at both ends, like a cable between two nodes), so every bend shows in the gaps
            const p = [HERO_A, ...HERO_POINTS, HERO_B];
            let d = `M${HERO_A[0]} ${HERO_A[1]}`;
            for (let i = 0; i < p.length - 1; i++) {
                const [a, b] = [p[i], p[i + 1]], k = 0.62 * (b[0] - a[0]);
                d += ` C ${Math.round(a[0] + k)} ${a[1]}, ${Math.round(b[0] - k)} ${b[1]}, ${b[0]} ${b[1]}`;
            }
            return d;
        })();
        const heroPosters = computed(() => {
            // 4 cards standing along the curved line (same curve as the SVG path: M40 40 C 220 150, 330 440, 520 560 in a
            // 560×600 box), each tilted in 3D and layered over the line. x/y are the card centres in % of the stage.
            // evenly spaced and symmetric between the P1 orb (40,40) and the P2 orb (~496,568), so the group sits in the middle
            // the cards snake left–right down the stage (an S-curve from P1 to P2), each leaning with the curve
            const layout = HERO_POINTS.map(([x, y], n) => ({ x: x / 560 * 100, y: y / 600 * 100, r: [-5, 4, -4, 5][n], ry: [-20, 14, -18, 16][n], z: n + 1 }));
            const fallback = ['linear-gradient(135deg,#6D28D9,#EC4899)', 'linear-gradient(135deg,#0EA5E9,#1E3A8A)', 'linear-gradient(135deg,#84CC16,#14532D)', 'linear-gradient(135deg,#F97316,#7C2D12)'];
            return layout.map((l, n) => {
                const a = heroPool.value[n];
                const e = a ? myEntry(a.id) : null;
                return { ...l, id: a?.id || 'f' + n, anime: a || null, bg: fallback[n], color: a?.heroColor || null, title: a ? titleOf(a) : 'Loading…',
                    section: SECTIONS[SECTION_OF_TYPE[HERO_ORDER[n]]], status: e?.status || null, score: a?.averageScore ? (a.averageScore / 10).toFixed(1) : null };
            });
        });

        // ---------- friend profiles ----------
        const viewedUser = ref(null);             // { profile, entries, favs, days, loading }
        const viewedTab = ref('ALL');
        const viewedSection = ref('overview');   // overview | compare
        const openUser = (userId) => {
            if (!userId) return;
            if (userId === uid()) { switchTab('profile'); return; }
            navigate(() => { viewUserId.value = userId; selectedAnime.value = null; entity.value = null; currentAppView.value = 'tracker'; });
        };
        const loadViewedUser = async (userId) => {
            viewedTab.value = 'ALL';
            viewedUser.value = { profile: personOf(userId), entries: [], favs: [], favStaff: [], days: 0, hidden: [], stats: null, loading: true };
            viewedSection.value = 'overview';
            const [{ data: prof }, { data: entries }, { data: favs }, days, { data: hidden }, { data: stats }, { data: favStaffRows }] = await Promise.all([
                sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
                selectAll(() => sb.from('list_entries').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).order('media_id')),
                sb.from('favorite_characters').select('*').eq('user_id', userId).order('created_at'),
                countDays(userId),
                sb.rpc('list_hidden_types', { owner: userId }).then(r => r, () => ({ data: [] })),
                sb.rpc('profile_stats', { owner: userId }).then(r => r, () => ({ data: null })),
                sb.from('favorite_staff').select('*').eq('user_id', userId).order('created_at').then(r => r, () => ({ data: [] })),
            ]);
            if (viewUserId.value !== userId) return;
            viewedUser.value = {
                profile: prof || personOf(userId), entries: (entries || []).filter(r => r.media_data?.id).map(listRow), favs: (favs || []).map(r => r.data),
                favStaff: (favStaffRows || []).map(r => ({ ...r.data, kind: r.kind })), days, hidden: Array.isArray(hidden) ? hidden : [],
                stats: stats && typeof stats === 'object' ? stats : null, loading: false,
            };
        };
        watch(viewUserId, (id) => { if (id) { loadViewedUser(id); fetchRankOrders(id, viewedRankOrders); Object.keys(rankShown).filter(k => k.startsWith('them:')).forEach(k => delete rankShown[k]); } else viewedUser.value = null; });
        // friend stats come from the server so each stat can be hidden per person (Settings → Privacy)
        const viewedStats = computed(() => {
            const v = viewedUser.value; if (!v) return [];
            const st = statsFor(v.entries), cards = statCards(st, v.days);
            if (!v.stats) return cards;
            const map = { days: 'days', ANIME: 'anime', MANGA: 'manga', eps: 'eps', chapters: 'chapters', completed: 'completed', mean: 'mean' };
            return withSeries(cards.map(c => {
                const k = map[c.key]; if (!k) return c;
                const val = v.stats[k];
                if (val === null || val === undefined) return { ...c, value: '', hidden: true, done: undefined };
                const done = c.key === 'ANIME' ? v.stats.anime_done : c.key === 'MANGA' ? v.stats.manga_done : c.done;
                return { ...c, value: k === 'mean' ? formatMean(Number(val)) : val, done: done ?? undefined, ...(c.key === 'eps' ? { alt: Number(val) + st.repeatEps } : {}) };
            }), v.entries);
        });
        const viewedStatHidden = (key) => !!viewedStats.value.find(c => c.key === key)?.hidden;
        watch(() => viewedUser.value && !viewedUser.value.loading ? viewedUser.value.entries : null, (e) => { if (e?.length) ensureFranchise(e); });

        // Recent list updates (they left the feed — now they show on profiles)
        const myRecent = ref([]);
        const viewedRecent = ref([]);
        const loadRecent = async (userId) => {
            if (!userId) return;
            const { data, error } = await sb.from('activities').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40);
            if (error) return;
            if (userId === uid()) myRecent.value = data || []; else if (viewUserId.value === userId) viewedRecent.value = data || [];
        };
        // profile "Activity" button: list updates + posts. People can hide theirs (Edit profile → decor.hideActivity)
        const viewedRanked = computed(() => (viewedUser.value?.entries || []).filter(i => i.score > 0).sort((a, b) => b.score - a.score).slice(0, 10));
        const viewedList = computed(() => {
            const e = viewedUser.value?.entries || [];
            return viewedTab.value === 'ALL' ? e : e.filter(i => i.status === viewedTab.value);
        });
        const viewedIsFriend = computed(() => friendsList.value.some(f => f.id === viewUserId.value));
        // Their list, laid out like your own Solo list (read-only: open titles to comment, + adds to YOUR list)
        const theirList = reactive({ type: 'ANIME', status: 'ALL', q: '' });
        const openTheirList = (type = 'ANIME', status = 'ALL') => {
            navigate(() => { Object.assign(theirList, { type, status, q: '' }); viewedSection.value = 'list'; });
        };
        const theirBase = computed(() => (viewedUser.value?.entries || []).filter(i => typeOf(i) === theirList.type));
        const theirCounts = computed(() => { const c = { ALL: theirBase.value.length }; theirBase.value.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; }); return c; });
        const theirGrouped = computed(() => {
            const q = theirList.q.trim().toLowerCase();
            let items = theirBase.value;
            if (theirList.status !== 'ALL') items = items.filter(i => i.status === theirList.status);
            if (q) items = items.filter(i => [i.anime.title?.romaji, i.anime.title?.english, i.anime.title?.native].some(t => t && t.toLowerCase().includes(q)));
            const out = {};
            STATUS_ORDER.forEach(st => { const g = items.filter(i => i.status === st); if (g.length) out[st] = sortEntries(g, PREFS.listOrder); });
            return out;
        });
        // stat cards on a friend's profile: list-type cards open their list, the rest keep the breakdown pop-up
        const openFriendLists = async (id) => { friendsOpen.value = false; if (id !== viewUserId.value) { openUser(id); await nextTick(); } openTheirList('ANIME'); };
        const openFriendsManage = () => { friendsOpen.value = false; openTracker('profile'); setTimeout(() => document.getElementById('friends')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); };
        const setViewedSection = (sec) => navigate(() => { viewedSection.value = sec; });
        const openFriendStat = (card) => {
            if (card.soon) { showToast(`${card.label} is coming soon`); return; }
            if (card.hidden) { showToast(`${viewedUser.value?.profile?.username || 'They'} keeps this stat private`, 'error'); return; }
            if (card.key === 'ANIME' || card.key === 'eps') return openTheirList('ANIME');
            if (card.key === 'GAME' || card.key === 'hours') return openTheirList('GAME');
            if (card.key === 'TV') return openTheirList('TV');
            if (card.key === 'SONG' || card.key === 'plays') return openTheirList('SONG');
            if (card.key === 'tv_done') return openTheirList('TV', 'COMPLETED');
            if (card.key === 'MANGA' || card.key === 'chapters') return openTheirList('MANGA');
            if (card.key === 'completed') return openTheirList('ANIME', 'COMPLETED');
            openDrill(card, 'them');
        };
        // quick friends list (people icon in the header)
        const friendsOpen = ref(false);
        const friendsQuery = ref('');
        const friendsFiltered = computed(() => { const q = friendsQuery.value.trim().toLowerCase(); return q ? friendsList.value.filter(f => (f.username || '').toLowerCase().includes(q)) : friendsList.value; });
        const friendCounts = computed(() => { const c = {}; friendEntries.value.forEach(r => { c[r.user_id] = (c[r.user_id] || 0) + 1; }); return c; });
        const sharedSquads = computed(() => squads.value.filter(s => s.members.some(m => m.id === viewUserId.value)));

        // ---------- stat breakdowns (click a stat card) ----------
        const drill = reactive({ open: false, key: '', who: 'me', status: 'ALL', days: [], loadingDays: false });
        const drillEntries = computed(() => drill.who === 'me' ? uniqueItems.value : (viewedUser.value?.entries || []));
        const drillName = computed(() => drill.who === 'me' ? 'You' : (viewedUser.value?.profile?.username || 'Friend'));
        const openDrill = async (card, who = 'me') => {
            if (card.soon) { showToast(`${card.label} is coming soon`); return; }
            if (card.hidden) { showToast(`${viewedUser.value?.profile?.username || 'They'} keep${viewedUser.value ? 's' : ''} this stat private`, 'error'); return; }
            const type = ({ eps: 'ANIME', chapters: 'MANGA', hours: 'GAME', tv_done: 'TV', plays: 'SONG' })[card.key] || card.key;
            const hasDone = drillEntries.value.some(i => typeOf(i) === type && i.status === 'COMPLETED');
            Object.assign(drill, { open: true, key: card.key, who, status: ['ANIME', 'MANGA', 'GAME', 'TV', 'SONG'].includes(card.key) && hasDone ? 'COMPLETED' : card.key === 'tv_done' ? 'COMPLETED' : 'ALL', days: [] });
            if (card.key === 'days') {
                drill.loadingDays = true;
                const userId = who === 'me' ? uid() : viewUserId.value;
                const { data } = await sb.from('user_activity').select('day').eq('user_id', userId).order('day', { ascending: false }).limit(800);
                drill.days = (data || []).map(r => r.day);
                drill.loadingDays = false;
            }
        };
        const drillTitle = computed(() => ({ days: 'Days active', ANIME: 'Anime', MANGA: 'Manga', GAME: 'Games', TV: 'Movies & TV', SONG: 'Songs', plays: 'Plays', eps: 'Episodes watched', chapters: 'Chapters read', hours: 'Hours played', tv_done: 'Movies & TV completed', completed: 'Completed', mean: 'Scores' })[drill.key] || '');
        const drillType = computed(() => ({ MANGA: 'MANGA', chapters: 'MANGA', ANIME: 'ANIME', eps: 'ANIME', GAME: 'GAME', hours: 'GAME', TV: 'TV', tv_done: 'TV', SONG: 'SONG', plays: 'SONG' })[drill.key] || null);
        const countedOf = (i) => i.status === 'COMPLETED' && typeOf(i) !== 'GAME' && typeOf(i) !== 'SONG' ? (i.anime?.episodes || i.progress || 0) : (i.progress || 0);
        const drillBase = computed(() => {
            let items = drillEntries.value;
            if (drillType.value) items = items.filter(i => typeOf(i) === drillType.value);
            if (drill.key === 'completed') items = items.filter(i => i.status === 'COMPLETED');
            if (drill.key === 'mean') items = items.filter(i => i.score > 0);
            return items;
        });
        const drillStatusCounts = computed(() => { const c = { ALL: drillBase.value.length }; drillBase.value.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; }); return c; });
        const drillItems = computed(() => {
            let items = drillBase.value;
            if (drill.status !== 'ALL') items = items.filter(i => i.status === drill.status);
            if (drill.key === 'eps' || drill.key === 'chapters' || drill.key === 'hours' || drill.key === 'plays') return [...items].filter(i => countedOf(i) > 0).sort((a, b) => countedOf(b) - countedOf(a));
            if (drill.key === 'mean') return [...items].sort((a, b) => b.score - a.score);
            return sortEntries(items, PREFS.listOrder);
        });
        const drillShowsStatus = computed(() => ['ANIME', 'MANGA', 'GAME', 'TV', 'SONG', 'eps', 'chapters', 'hours', 'plays', 'mean'].includes(drill.key));
        const scoreBuckets = computed(() => {
            const b = Array.from({ length: 10 }, (_, n) => ({ label: String(n + 1), n: 0 }));
            drillBase.value.forEach(i => { const k = clamp(Math.ceil(i.score) - 1, 0, 9); b[k].n++; });
            const max = Math.max(1, ...b.map(x => x.n));
            return b.map(x => ({ ...x, pct: x.n / max * 100 }));
        });
        // heatmap: last 26 weeks, Monday-first columns
        const heatmap = computed(() => {
            const set = new Set(drill.days);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const start = new Date(today); start.setDate(start.getDate() - 7 * 25 - ((today.getDay() + 6) % 7));
            const weeks = [];
            for (let w = 0; w < 26; w++) {
                const col = [];
                for (let d = 0; d < 7; d++) {
                    const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
                    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                    col.push({ key, on: set.has(key), future: day > today });
                }
                weeks.push(col);
            }
            return weeks;
        });
        const streak = computed(() => {
            const set = new Set(drill.days); let n = 0; const d = new Date();
            if (!set.has(localDay())) d.setDate(d.getDate() - 1);
            for (;;) { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (!set.has(k)) break; n++; d.setDate(d.getDate() - 1); }
            return n;
        });

        // ---------- compare lists with a friend ----------
        const compareTab = ref('meDone');
        const compareType = ref('ANIME');
        const comparison = computed(() => {
            const theirs = (viewedUser.value?.entries || []).filter(i => typeOf(i) === compareType.value);
            const mine = uniqueItems.value.filter(i => typeOf(i) === compareType.value);
            const mineById = new Map(mine.map(i => [i.anime.id, i]));
            const theirsById = new Map(theirs.map(i => [i.anime.id, i]));
            const seen = (i) => i && (i.status === 'COMPLETED' || (i.progress || 0) > 0);
            const pair = (id) => ({ anime: (mineById.get(id) || theirsById.get(id)).anime, me: mineById.get(id) || null, them: theirsById.get(id) || null });
            const ids = [...new Set([...mineById.keys(), ...theirsById.keys()])];
            const rows = ids.map(pair);
            // Every title lands in exactly one group, so the counts always add up to the whole of both lists.
            const groups = { bothDone: [], meDone: [], themDone: [], bothPlan: [], mePlan: [], themPlan: [], extras: [] };
            const st = (x) => x?.status || null;
            rows.forEach(r => {
                const m = st(r.me), t = st(r.them);
                if (m === 'COMPLETED' && t === 'COMPLETED') groups.bothDone.push(r);
                else if (m === 'COMPLETED') groups.meDone.push(r);
                else if (t === 'COMPLETED') groups.themDone.push(r);
                else if (m === 'PLANNING' && t === 'PLANNING') groups.bothPlan.push(r);
                else if (m === 'PLANNING' && !t) groups.mePlan.push(r);
                else if (t === 'PLANNING' && !m) groups.themPlan.push(r);
                else groups.extras.push(r);                 // watching, on hold, dropped — or planning on one side and something else on the other
            });
            const top = (side) => (a, b) => (b[side]?.score || 0) - (a[side]?.score || 0) || titleOf(a.anime).localeCompare(titleOf(b.anime));
            groups.bothDone.sort((a, b) => ((b.me.score || 0) + (b.them.score || 0)) - ((a.me.score || 0) + (a.them.score || 0)));
            groups.meDone.sort(top('me')); groups.themDone.sort(top('them'));
            [groups.bothPlan, groups.mePlan, groups.themPlan, groups.extras].forEach(g => g.sort((a, b) => titleOf(a.anime).localeCompare(titleOf(b.anime))));
            const scoredBoth = rows.filter(r => seen(r.me) && seen(r.them) && r.me.score > 0 && r.them.score > 0);
            let affinity = null;
            if (scoredBoth.length >= 3) {
                const xs = scoredBoth.map(r => r.me.score), ys = scoredBoth.map(r => r.them.score);
                const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
                let num = 0, dx = 0, dy = 0;
                xs.forEach((x, n) => { num += (x - mx) * (ys[n] - my); dx += (x - mx) ** 2; dy += (ys[n] - my) ** 2; });
                const r = dx && dy ? num / Math.sqrt(dx * dy) : (xs.every((x, n) => Math.abs(x - ys[n]) < 1) ? 1 : 0);
                affinity = Math.round(((r + 1) / 2) * 100);
            }
            const genreTop = (list) => { const c = {}; list.forEach(i => (i.anime.genres || []).forEach(g => { c[g] = (c[g] || 0) + 1; })); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]); };
            const a = statsFor(mine), b = statsFor(theirs);
            const isManga = compareType.value === 'MANGA';
            const stat = (key, label, x, y, fmt = (v) => v) => viewedStatHidden(key)
                ? { label, me: fmt(x), them: 'hidden', hidden: true, pm: x ? 100 : 0, pt: 0 }
                : { label, me: fmt(x), them: fmt(y), pm: Math.max(x, y) ? x / Math.max(x, y) * 100 : 0, pt: Math.max(x, y) ? y / Math.max(x, y) * 100 : 0 };
            return {
                groups, affinity, scoredBoth: scoredBoth.length, total: rows.length,
                stats: [
                    stat(compareType.value, isManga ? 'Manga' : 'Anime', mine.length, theirs.length),
                    stat(isManga ? 'chapters' : 'eps', isManga ? 'Chapters read' : 'Episodes watched', isManga ? a.chaptersRead : a.epsWatched, isManga ? b.chaptersRead : b.epsWatched),
                    stat('completed', 'Completed', a.completed, b.completed),
                    stat('mean', 'Mean score', a.mean, b.mean, formatMean),
                    stat('days', 'Days active', daysActive.value, viewedUser.value?.days || 0),
                ],
                genres: { me: genreTop(mine), them: genreTop(theirs) },
            };
        });
        const compareGroups = [
            { id: 'meDone', label: 'Only me completed' }, { id: 'themDone', label: 'Only them completed' }, { id: 'bothDone', label: 'Both completed' },
            { id: 'mePlan', label: 'Only me planning' }, { id: 'themPlan', label: 'Only them planning' }, { id: 'bothPlan', label: 'Both planning' },
            { id: 'extras', label: 'Everything else' },
        ];
        const compareBig = ref((() => { try { return localStorage.getItem('anicoop_compare_big') === '1'; } catch { return false; } })());
        watch(compareBig, (v) => { try { localStorage.setItem('anicoop_compare_big', v ? '1' : '0'); } catch {} });
        // rows you can add to your own list (the title isn't on any of your lists yet)
        const compareAddable = computed(() => (comparison.value.groups[compareTab.value] || []).filter(r => !r.me));
        // "Only them": tick titles and add them to your own list in one go
        const compareSel = ref(new Set());
        const compareAddStatus = ref('PLANNING');
        const compareAdding = ref(false);
        watch([compareTab, compareType, viewUserId], () => { compareSel.value = new Set(); });
        const toggleCompareSel = (id) => { const n = new Set(compareSel.value); if (n.has(id)) n.delete(id); else n.add(id); compareSel.value = n; };
        const compareAllSelected = computed(() => { const rows = compareAddable.value; return rows.length > 0 && rows.every(r => compareSel.value.has(r.anime.id)); });
        const toggleCompareAll = () => { compareSel.value = compareAllSelected.value ? new Set() : new Set(compareAddable.value.map(r => r.anime.id)); };
        const addFromCompare = async (rows) => {
            rows = rows.filter(r => r?.anime?.id && !soloEntry(r.anime.id));
            if (!rows.length || compareAdding.value) return;
            const status = compareAddStatus.value;
            compareAdding.value = true;
            const entries = rows.map(r => { const eps = r.anime.episodes || null; return { anime: normMedia(r.anime), status, score: 0, progress: status === 'COMPLETED' && eps ? eps : 0 }; });
            try {
                entries.forEach(setSoloLocal);
                await upsertSolo(entries);
                entries.forEach(e => logActivity(e.anime, null, e));
                compareSel.value = new Set();
                showToast(entries.length === 1 ? `${titleOf(entries[0].anime)} → ${STATUS_LABELS[status]}` : `Added ${entries.length} to your list → ${STATUS_LABELS[status]}`);
            } catch (err) { showToast('Could not add: ' + (err.message || err), 'error'); fetchSolo(); }
            finally { compareAdding.value = false; }
        };
        const addSelectedFromCompare = () => addFromCompare(compareAddable.value.filter(r => compareSel.value.has(r.anime.id)));

        // ---------- navigation + BACK button ----------
        const navIndex = ref(0);
        const canGoBack = computed(() => navIndex.value > 0);
        const detailCache = new Map();
        const navKey = () => `${currentAppView.value}|${section.value}|${activeTab.value}|${selectedAnime.value?.id || ''}|${viewUserId.value || ''}${viewUserId.value ? ':' + viewedSection.value : ''}|${entity.value ? entity.value.type + entity.value.id : ''}|${activeTab.value === 'chat' ? (chatWith.value || '') + '/' + (groupWith.value || '') : ''}`;
        const navState = () => ({ anicoop: true, idx: navIndex.value, view: currentAppView.value, section: section.value, tab: activeTab.value, animeId: selectedAnime.value?.id || null, userId: viewUserId.value, entity: entity.value ? { ...entity.value } : null, chatWith: chatWith.value, groupWith: groupWith.value, viewedSection: viewedSection.value, theirList: { ...theirList }, scroll: window.scrollY,
            animeRef: selectedAnime.value?.extId ? { id: selectedAnime.value.id, extId: selectedAnime.value.extId, type: selectedAnime.value.type } : null, settings: settingsOpen.value ? settingsTab.value : null });
        // a refresh keeps you where you were: the browser keeps history.state across reloads, and a copy goes to this
        // tab's sessionStorage too (restoreNav puts you back there once you're signed in)
        const NAV_KEY = 'anicoop_nav_v1';
        const persistNav = () => { if (!currentUser.value) return; const s = navState(); try { history.replaceState(s, ''); } catch {} try { sessionStorage.setItem(NAV_KEY, JSON.stringify(s)); } catch {} };
        let navSaveTimer = null;
        window.addEventListener('scroll', () => { clearTimeout(navSaveTimer); navSaveTimer = setTimeout(persistNav, 400); }, { passive: true });
        window.addEventListener('pagehide', persistNav);
        window.addEventListener('beforeunload', persistNav);
        const saveScroll = () => { try { history.replaceState(navState(), ''); } catch {} };
        const pushNav = () => { navIndex.value++; try { history.pushState({ ...navState(), scroll: 0 }, ''); } catch {} try { sessionStorage.setItem(NAV_KEY, JSON.stringify({ ...navState(), scroll: 0 })); } catch {} };
        const navigate = (change) => {
            const before = navKey();
            saveScroll();
            change();
            if (navKey() !== before) pushNav();
            window.scrollTo(0, 0);
        };
        const resetSelection = () => { selectMode.value = false; selected.value = new Map(); };
        const goBack = () => {
            editForm.value = emptyForm();
            if (navIndex.value > 0) history.back();
            else if (selectedAnime.value || viewUserId.value || entity.value) navigate(() => { selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
            else if (currentAppView.value !== 'home') goHome();
        };
        const goHome = () => navigate(() => { currentAppView.value = 'home'; selectedAnime.value = null; viewUserId.value = null; entity.value = null; resetSelection(); });
        const openTracker = (tab) => navigate(() => { currentAppView.value = 'tracker'; activeTab.value = tab; selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
        const switchTab = (tab) => navigate(() => {
            if (activeTab.value !== tab) { clearListFilters(); resetSelection(); }
            activeTab.value = tab;
            selectedAnime.value = null; viewUserId.value = null; entity.value = null;
        });
        const closeAnimeDetails = () => navigate(() => { selectedAnime.value = null; });
        // Home tiles + section switcher always land on Browse
        const openSection = (id) => {
            sectionMenu.value = false;
            if (!SECTIONS[id]) return;
            navigate(() => {
                if (section.value !== id) clearListFilters();
                resetSelection();
                section.value = id; currentAppView.value = 'tracker'; selectedAnime.value = null; viewUserId.value = null; entity.value = null;
                activeTab.value = 'browse';
            });
        };
        const showDetails = (media) => {
            editForm.value = emptyForm();
            if (currentAppView.value !== 'tracker') currentAppView.value = 'tracker';
            viewUserId.value = null; entity.value = null;
            selectedAnime.value = media;
            inlineForm.value = buildForm(media);
            comments.value = []; revealed.clear();
            commentDraft.value = '';
            const f = pendingCommentFocus; pendingCommentFocus = null;
            if (f != null) setCommentFilter(f); else { commentFilter.value = 'ALL'; commentEp.value = myEntry(media.id)?.progress || ''; }
            fetchComments();
            if (f != null) setTimeout(() => document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 450);
        };
        const onPopState = (e) => {
            const s = e.state;
            if (!s?.anicoop || !currentUser.value) return;
            navIndex.value = s.idx || 0;
            editForm.value = emptyForm();
            randomOpen.value = false;
            trailerOf.value = null;
            notifOpen.value = false;
            closeSheet();
            currentAppView.value = s.view || 'home';
            if (s.section && SECTIONS[s.section]) section.value = s.section;
            activeTab.value = s.tab || 'browse';
            const sameUser = s.userId && s.userId === viewUserId.value;
            viewUserId.value = s.userId || null;
            if (sameUser) { viewedSection.value = s.viewedSection || 'overview'; if (s.theirList) Object.assign(theirList, s.theirList); }
            entity.value = s.entity || null;
            chatWith.value = s.chatWith || null;
            groupWith.value = s.groupWith || null;
            detailRequestId++;
            detailLoading.value = false;
            if (s.animeId) {
                const cached = detailCache.get(s.animeId);
                if (cached) showDetails(cached);
                else { selectedAnime.value = null; fetchAnimeDetails(s.animeRef || s.animeId, { push: false }); }
            } else {
                selectedAnime.value = null;
            }
            setTimeout(() => window.scrollTo(0, s.scroll || 0), 300);
        };
        // after a refresh: back to the page you were on (and its scroll position, once the page has loaded)
        const restoreNav = (s) => {
            if (!s?.anicoop || !currentUser.value) return;
            if (s.view && s.view !== 'home') skipIntro();
            onPopState({ state: { ...s, idx: history.state?.anicoop ? (history.state.idx || 0) : 0 } });
            if (s.settings) openSettings(s.settings);
            const y = s.scroll || 0;
            if (y > 0) [800, 1600, 3200].forEach(ms => setTimeout(() => { if (Math.abs(window.scrollY - y) > 40 && document.documentElement.scrollHeight - window.innerHeight >= y - 40) window.scrollTo(0, y); }, ms));
        };

        // ---------- quick actions (solo list) ----------
        const quickMenuFor = ref(null);
        const soloById = computed(() => new Map(soloList.value.map(i => [i.anime?.id, i])));
        const coopById = computed(() => new Map(coopList.value.map(i => [i.anime?.id, i])));
        const soloEntry = (id) => soloById.value.get(id) || null;
        const myEntry = (id) => soloById.value.get(id) || coopById.value.get(id) || null;
        const sheetAnime = ref(null);
        const onPlusClick = (anime) => {
            if (window.matchMedia('(hover: hover)').matches) { quickMenuFor.value = null; openEditor(anime); }
            else { quickMenuFor.value = anime.id; sheetAnime.value = anime; }
        };
        const closeSheet = () => { sheetAnime.value = null; quickMenuFor.value = null; };
        const sheetAction = (action) => {
            const a = sheetAnime.value; if (!a) return;
            if (action === 'EDIT') { closeSheet(); openEditor(a); return; }
            if (action === 'REMOVE') { closeSheet(); removeEverywhere(a); return; }
            quickSolo(a, action);
            if (action !== 'EP') closeSheet();
        };
        const soloNext = (anime, action) => {
            const idx = soloList.value.findIndex(i => i.anime?.id === anime.id);
            const entry = idx !== -1 ? { ...soloList.value[idx] } : { anime: normMedia(anime), status: 'PLANNING', score: 0, progress: 0 };
            const eps = anime.episodes || anime.chapters || entry.anime?.episodes || null;
            entry.repeats = [...(entry.repeats || [])];
            if (action === 'EP' && entry.status === 'REPEATING') {   // +1 on a rewatch counts on that rewatch's counter
                const n = entry.repeats.length ? entry.repeats.length - 1 : (entry.repeats.push(0), 0);
                entry.repeats[n] = Math.min((entry.repeats[n] || 0) + 1, eps || 99999);
                if (eps && entry.repeats[n] >= eps) { entry.status = 'COMPLETED'; entry.finishedRepeat = n + 1; }
            } else if (action === 'EP' && (anime.type || entry.anime?.type) === 'SONG') {   // songs: +1 play, the status stays (a new song becomes Liked)
                entry.progress = (entry.progress || 0) + 1;
                if (idx === -1 || entry.status === 'PLANNING') entry.status = 'COMPLETED';
            } else if (action === 'EP') {
                if (eps && (entry.progress || 0) >= eps) return { error: `Already at the last ${UNIT.ep.toLowerCase()} of ${titleOf(anime)}` };
                entry.progress = (entry.progress || 0) + 1;
                entry.status = eps && entry.progress >= eps ? 'COMPLETED' : 'WATCHING';
            } else if (action === 'REPEATING') {
                if (entry.status === 'REPEATING') return { error: `Already rewatching ${titleOf(anime)}` };
                const r = startRepeat(entry.repeats, eps);
                if (!r) return { error: LILBRO };
                entry.repeats = r; entry.status = 'REPEATING';
                if (eps) entry.progress = eps;
            } else {
                entry.status = action;
                if (action === 'COMPLETED' && eps) entry.progress = eps;
            }
            return { entry };
        };
        const quickSolo = async (anime, action) => {
            if (action === 'REMOVE') { removeEverywhere(anime); return; }
            const { entry, error } = soloNext(anime, action);
            if (error === LILBRO) { triggerLilBro(anime); return; }
            if (error) { showToast(error, 'error'); return; }
            const before = soloEntry(anime.id);
            const { finishedRepeat } = entry; delete entry.finishedRepeat;
            setSoloLocal(entry);                                 // instant feedback
            const title = titleOf(anime);
            const eps = anime.episodes || entry.anime?.episodes;
            showToast(finishedRepeat ? `Finished rewatch #${finishedRepeat} of ${title}!`
                : action === 'EP' && entry.status === 'REPEATING' ? `Rewatch #${entry.repeats.length} · ${UNIT.ep} ${repeatNow(entry)}${eps ? '/' + eps : ''} · ${title}`
                : action === 'REPEATING' ? `${title} → Rewatch #${entry.repeats.length} of ${MAX_REPEATS}`
                : action === 'EP' && anime.type === 'SONG' ? `Play ${entry.progress} · ${title}`
                : action === 'EP'
                ? (entry.status === 'COMPLETED' ? `Finished ${title}! Marked as Completed` : `${UNIT.ep} ${entry.progress}${anime.episodes ? '/' + anime.episodes : ''} · ${title}`)
                : `${title} → ${statusLabelFor(anime.type, action)}`);
            if (selectedAnime.value?.id === anime.id) inlineForm.value = buildForm(selectedAnime.value);
            try { await upsertSolo(entry); logActivity(entry.anime, before, entry); }
            catch (err) {
                showToast('Could not save: ' + (err.message || err), 'error');
                if (before) setSoloLocal(before); else soloList.value = soloList.value.filter(i => i.anime.id !== anime.id);
            }
        };

        // ---------- select many (batch edit) ----------
        const selectMode = ref(false);
        const selected = ref(new Map());          // anime id → anime
        const batchBusy = ref(false);
        const batchSquadMenu = ref(false);
        const selectedCount = computed(() => selected.value.size);
        const toggleSelectMode = () => { selectMode.value = !selectMode.value; if (!selectMode.value) selected.value = new Map(); quickMenuFor.value = null; };
        const isSelected = (id) => selected.value.has(id);
        const toggleSelect = (anime) => { const m = new Map(selected.value); if (m.has(anime.id)) m.delete(anime.id); else m.set(anime.id, anime); selected.value = m; };
        const visibleAnime = computed(() => {
            if (activeTab.value === 'browse') return visibleResults.value;
            const seen = new Map();
            Object.values(filteredGroupedList.value).flat().forEach(i => seen.set(i.anime.id, i.anime));
            return [...seen.values()];
        });
        const selectAllVisible = () => { const m = new Map(selected.value); visibleAnime.value.forEach(a => m.set(a.id, a)); selected.value = m; };
        const clearSelected = () => { selected.value = new Map(); };
        const batchStatus = async (status) => {
            const list = [...selected.value.values()]; if (!list.length || batchBusy.value) return;
            batchBusy.value = true;
            try {
                if (activeTab.value === 'coop' && !selectedAnime.value) {
                    const rows = coopList.value.filter(i => selected.value.has(i.anime.id) && (listFilterGroup.value === 'ALL' || i.squadId === listFilterGroup.value));
                    for (const r of rows) {
                        const progress = status === 'COMPLETED' && r.anime.episodes ? r.anime.episodes : r.progress;
                        await upsertSquadEntry(r.squadId, r.anime, { status, progress, score: r.score });
                        logActivity(r.anime, { status: r.status, progress: r.progress }, { status, progress }, r.squadId);
                    }
                    await fetchSquadEntries();
                    showToast(`${rows.length} squad entr${rows.length === 1 ? 'y' : 'ies'} → ${STATUS_LABELS[status]}`);
                } else {
                    const entries = list.map(a => {
                        if (status === 'REPEATING') return soloNext(a, 'REPEATING').entry || null;   // titles with 5 rewatches already are skipped
                        const cur = soloEntry(a.id);
                        const eps = a.episodes || cur?.anime?.episodes;
                        return { anime: normMedia(cur?.anime || a), status, score: cur?.score || 0, progress: status === 'COMPLETED' && eps ? eps : (cur?.progress || 0) };
                    }).filter(Boolean);
                    if (!entries.length) { showToast('Nothing to change', 'error'); return; }
                    const befores = entries.map(e => soloEntry(e.anime.id));
                    entries.forEach(setSoloLocal);
                    await upsertSolo(entries);
                    entries.forEach((e, n) => logActivity(e.anime, befores[n], e));
                    showToast(`${entries.length} added/updated → ${STATUS_LABELS[status]}`);
                }
            } catch (err) { showToast('Batch update failed: ' + (err.message || err), 'error'); fetchSolo(); fetchSquadEntries(); }
            finally { batchBusy.value = false; }
        };
        const batchAddToSquad = async (squad) => {
            batchSquadMenu.value = false;
            const list = [...selected.value.values()]; if (!list.length || batchBusy.value) return;
            batchBusy.value = true;
            try {
                for (const a of list) {
                    const cur = coopList.value.find(i => i.squadId === squad.id && i.anime.id === a.id) || myEntry(a.id);
                    await upsertSquadEntry(squad.id, normMedia(cur?.anime || a), { status: cur?.status || 'PLANNING', progress: cur?.progress || 0, score: cur?.score || 0 });
                }
                await fetchSquadEntries();
                showToast(`${list.length} added to ${squad.name}`);
            } catch (err) { showToast('Could not add: ' + (err.message || err), 'error'); }
            finally { batchBusy.value = false; }
        };
        const batchRemove = async () => {
            const list = [...selected.value.values()].filter(a => isOnMyList(a.id)); if (!list.length || batchBusy.value) { showToast('None of the selected are on your lists', 'error'); return; }
            if (list.length > 1) {
                const inSquads = coopList.value.some(i => list.some(a => a.id === i.anime.id));
                if (!(await askConfirm({ title: `Remove ${list.length} titles from all your lists?`, body: inSquads ? 'Some of them are on squad lists too — they’re removed there for everyone.' : '', ok: `Remove ${list.length}` }))) return;
            }
            batchBusy.value = true;
            try {
                const n = await removeMany(list);
                clearSelected();
                showToast(`Removed ${n} title${n === 1 ? '' : 's'} from all lists`);
            } catch (err) { showToast('Could not remove: ' + (err.message || err), 'error'); }
            finally { batchBusy.value = false; }
        };

        // ---------- random picker ----------
        const randomOpen = ref(false);
        const randomFilter = ref({ status: '', genre: '', squad: '' });
        const randomPick = ref(null);
        const randomRolling = ref(false);
        const randomSpinKey = ref(0);
        const randomScope = computed(() => (selectedAnime.value || viewUserId.value || currentAppView.value !== 'tracker') ? 'all' : (activeTab.value === 'coop' ? 'coop' : activeTab.value === 'solo' ? 'solo' : 'all'));
        const randomSourceLabel = computed(() => ({ coop: 'squad lists', solo: 'solo list', all: 'all your lists' })[randomScope.value]);
        const randomSource = computed(() => (randomScope.value === 'coop' ? secCoop.value : randomScope.value === 'solo' ? secSolo.value : uniqueItems.value).filter(i => i.anime?.id));
        const randomGenres = computed(() => [...new Set(randomSource.value.flatMap(i => i.anime.genres || []))].sort());
        const randomPool = computed(() => {
            const f = randomFilter.value;
            return randomSource.value.filter(i =>
                (!f.status || i.status === f.status) &&
                (!f.genre || (i.anime.genres || []).includes(f.genre)) &&
                (randomScope.value !== 'coop' || !f.squad || i.squadId === f.squad));
        });
        // No filters set → don't limit the roll to what's on your lists; pull from all of AniList instead.
        const randomWide = computed(() => !randomFilter.value.status && !randomFilter.value.genre && !randomFilter.value.squad);
        const randomWideType = computed(() => mediaType.value || 'ANIME');
        const fetchRandomWide = async () => {
            const type = randomWideType.value;
            if (type === 'GAME') return gameApi.random(gameOpts(false));
            if (type === 'TV') return tvApi.random();
            if (type === 'SONG') return songApi.random();
            const query = `query ($page: Int, $type: MediaType, $no: [String]) { Page(page: $page, perPage: 1) { media(type: $type, isAdult: false, genre_not_in: $no, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`;
            for (const page of [Math.floor(Math.random() * 4000) + 1, Math.floor(Math.random() * 250) + 1]) {
                const data = await anilist(query, { page, type, no: hiddenOf(type).length ? hiddenOf(type) : null });
                const media = data?.Page?.media?.[0];
                if (media) return media;
            }
            return null;
        };
        watch(randomFilter, () => { randomPick.value = null; }, { deep: true });
        const openRandom = () => {
            const inList = randomScope.value !== 'all';
            randomFilter.value = { status: inList && listFilterStatus.value !== 'ALL' ? listFilterStatus.value : '', genre: '', squad: randomScope.value === 'coop' && listFilterGroup.value !== 'ALL' ? listFilterGroup.value : '' };
            randomPick.value = null;
            randomOpen.value = true;
        };
        const openRandomSoon = () => setTimeout(openRandom, 320);
        const clearRandomFilters = () => { randomFilter.value = { status: '', genre: '', squad: '' }; };
        const rollRandom = async () => {
            if (randomRolling.value) return;
            if (randomWide.value) {
                randomRolling.value = true;
                randomPick.value = null;
                try {
                    const media = await fetchRandomWide();
                    if (!media) { showToast('Could not fetch a random pick — try again', 'error'); return; }
                    const m = normMedia(media);
                    const cur = myEntry(m.id);
                    randomPick.value = { anime: m, status: cur?.status, progress: cur?.progress, group: cur?.group };
                    randomSpinKey.value++;
                } catch (err) { showToast(err.message || 'Could not fetch a random pick', 'error'); }
                finally { randomRolling.value = false; }
                return;
            }
            const pool = randomPool.value;
            if (!pool.length) return;
            randomRolling.value = true;
            const total = pool.length > 1 ? 12 : 1;
            let ticks = 0;
            const tick = () => {
                let next;
                do { next = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && next === randomPick.value);
                randomPick.value = next;
                if (++ticks < total) setTimeout(tick, 50 + ticks * 12);
                else { randomRolling.value = false; randomSpinKey.value++; }
            };
            tick();
        };

        // ---------- AniList ----------
        const detailCharacters = computed(() => (selectedAnime.value?.characters?.edges || []).map(e => ({ ...e.node, role: e.role, va: e.voiceActors?.[0] || null })));
        const detailStaff = computed(() => (selectedAnime.value?.staff?.edges || []).map(e => ({ ...e.node, role: e.role })));
        const shownCharacters = computed(() => detailMore.chars ? detailCharacters.value : detailCharacters.value.slice(0, 12));
        const shownStaff = computed(() => detailMore.staff ? detailStaff.value : detailStaff.value.slice(0, 8));
        const moreChars = computed(() => !!(selectedAnime.value?.characters?.pageInfo?.hasNextPage || selectedAnime.value?.characters?.all && detailCharacters.value.length > 12));
        const moreStaff = computed(() => !!(selectedAnime.value?.staff?.pageInfo?.hasNextPage || selectedAnime.value?.staff?.all && detailStaff.value.length > 8));
        const fmtDate = (d) => d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: d.month ? 'short' : undefined, day: d.day ? 'numeric' : undefined }) : '';
        const nice = (v) => v ? String(v).toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '';
        const countdown = (secs) => { const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
        const detailInfo = computed(() => {
            const a = selectedAnime.value; if (!a) return [];
            if (a.type === 'GAME') return a.gameInfo || [];
            if (a.type === 'TV') return a.tvInfo || [];
            // songs: the artist and album rows open their pages
            if (a.type === 'SONG') return (a.songInfo || []).map(r => ({ ...r, go: r.k === 'Artist' ? 'artist' : r.k === 'Album' ? 'album' : null }));
            const manga = a.type === 'MANGA';
            const rows = [
                a.nextAiringEpisode?.timeUntilAiring && ['Next episode', `Ep ${a.nextAiringEpisode.episode} in ${countdown(a.nextAiringEpisode.timeUntilAiring)}`, true],
                ['Format', a.format === 'TV' ? 'TV' : a.format === 'ONA' || a.format === 'OVA' ? a.format : nice(a.format)],
                manga ? (a.chapters && ['Chapters', a.chapters]) : (a.episodes && ['Episodes', a.episodes]),
                manga && a.volumes && ['Volumes', a.volumes],
                manga && !a.chapters && lastChapterOf(a) && ['Latest chapter', 'Ch ' + fmtChapter(lastChapterOf(a)), true],
                !manga && a.duration && ['Episode length', a.duration >= 60 ? `${Math.floor(a.duration / 60)} h ${a.duration % 60 ? (a.duration % 60) + ' min' : ''}` : a.duration + ' min'],
                manga && mangaStatusOf(a) ? ['Status', mangaStatusOf(a).label, mangaStatusOf(a).key !== 'FINISHED'] : ['Status', a.status === 'RELEASING' ? (manga ? 'Publishing' : 'Airing') : a.status === 'NOT_YET_RELEASED' ? 'Not yet released' : nice(a.status)],
                fmtDate(a.startDate) && [manga ? 'Published' : 'Start date', fmtDate(a.startDate) + (fmtDate(a.endDate) && manga ? ' – ' + fmtDate(a.endDate) : '')],
                !manga && fmtDate(a.endDate) && ['End date', fmtDate(a.endDate)],
                !manga && a.season && ['Season', `${nice(a.season)} ${a.seasonYear || ''}`],
                a.studios?.nodes?.length && ['Studios', a.studios.nodes.map(x => x.name).join(', ')],
                a.source && ['Source', nice(a.source)],
                a.averageScore && ['Average score', a.averageScore + '%'],
                a.meanScore && ['Mean score', a.meanScore + '%'],
                a.popularity && ['Popularity', a.popularity.toLocaleString()],
                a.favourites && ['Favorites', a.favourites.toLocaleString()],
                a.title?.native && ['Native', a.title.native],
                a.synonyms?.length && ['Also known as', a.synonyms.slice(0, 3).join(' · ')],
            ];
            return rows.filter(Boolean).map(([k, v, hot]) => ({ k, v, hot: !!hot }));
        });
        const detailRankings = computed(() => (selectedAnime.value?.rankings || []).slice(0, 4).map(r => ({
            id: r.id, rank: r.rank, icon: r.type === 'RATED' ? 'fa-star' : 'fa-heart', color: r.type === 'RATED' ? '#f59e0b' : '#FF4D8D',
            text: `#${r.rank} ${r.type === 'RATED' ? 'highest rated' : 'most popular'} ${r.allTime ? 'all time' : (r.season ? nice(r.season) + ' ' : '') + (r.year || '')}`,
        })));
        const showSpoilerTags = ref(false);
        const detailTags = computed(() => (selectedAnime.value?.tags || []).filter(t => showSpoilerTags.value || !t.isMediaSpoiler).slice(0, 14));
        const STAT_STATUS = { CURRENT: ['Watching', '#3b82f6'], PLANNING: ['Planning', '#f59e0b'], COMPLETED: ['Completed', '#22c55e'], DROPPED: ['Dropped', '#ef4444'], PAUSED: ['Paused', '#a855f7'] };
        const detailStats = computed(() => {
            const st = selectedAnime.value?.stats; if (!st) return null;
            const scores = [...(st.scoreDistribution || [])].sort((a, b) => a.score - b.score);
            const maxS = Math.max(1, ...scores.map(x => x.amount));
            const statuses = (st.statusDistribution || []).filter(x => STAT_STATUS[x.status]);
            const total = statuses.reduce((n, x) => n + x.amount, 0) || 1;
            const manga = selectedAnime.value.type === 'MANGA';
            return {
                scores: scores.map(x => ({ score: x.score, amount: x.amount, pct: x.amount / maxS * 100, hue: Math.round((x.score / 100) * 120) })),
                statuses: statuses.sort((a, b) => b.amount - a.amount).map(x => ({ label: manga && x.status === 'CURRENT' ? 'Reading' : STAT_STATUS[x.status][0], color: STAT_STATUS[x.status][1], amount: x.amount, pct: x.amount / total * 100 })),
                total,
            };
        });
        const detailRelations = computed(() => (selectedAnime.value?.relations?.edges || [])
            .filter(e => e.node?.type === 'ANIME' || e.node?.type === 'MANGA' || e.node?.type === 'GAME')
            .map(e => ({ ...normMedia(e.node), relationType: e.relationType }))
            .sort((a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) || (a.seasonYear || 9999) - (b.seasonYear || 9999)));

        let detailRequestId = 0;
        const fetchAnimeDetails = async (animeNode, { push = true } = {}) => {
            const id = typeof animeNode === 'object' ? animeNode?.id : animeNode;
            if (!id) return;
            quickMenuFor.value = null;
            if (detailCache.has(id)) {
                if (push) navigate(() => showDetails(detailCache.get(id))); else showDetails(detailCache.get(id));
                return;
            }
            const kind = typeOfId(id);
            const requestId = ++detailRequestId;
            detailLoading.value = true;
            if (kind === 'GAME' || kind === 'TV' || kind === 'SONG') {   // IGDB / TMDB / Spotify pages
                try {
                    const media = kind === 'GAME' ? await gameApi.details(id) : kind === 'TV' ? await tvApi.details(id)
                        : await songApi.details(typeof animeNode === 'object' && animeNode?.extId ? animeNode : id);
                    if (requestId !== detailRequestId) return;
                    if (!media) { showToast(kind === 'SONG' ? 'Couldn’t find that song on Spotify' : kind === 'TV' ? 'That title could not be found on TMDB' : 'That game could not be found on IGDB', 'error'); return; }
                    detailCache.set(id, media);
                    if (push) navigate(() => showDetails(media)); else showDetails(media);
                } catch (err) { showToast(err.message || 'Could not load', 'error'); }
                finally { if (requestId === detailRequestId) detailLoading.value = false; }
                return;
            }
            const query = `query ($id: Int) { Media(id: $id) {
                id type isAdult description(asHtml: true) bannerImage episodes chapters volumes countryOfOrigin duration status format season seasonYear
                averageScore meanScore popularity favourites genres source synonyms
                startDate { year month day } endDate { year month day }
                nextAiringEpisode { episode airingAt timeUntilAiring }
                trailer { id site thumbnail }
                title { romaji english native } coverImage { large }
                studios(isMain: true) { nodes { id name } }
                rankings { id rank type allTime season year context }
                tags { id name rank isMediaSpoiler }
                stats { scoreDistribution { score amount } statusDistribution { status amount } }
                streamingEpisodes { title thumbnail url site }
                externalLinks { id site url type color icon language }
                characters(sort: [ROLE, FAVOURITES_DESC], perPage: 12) { pageInfo { hasNextPage } edges { role node { id name { full } image { large } }
                    voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full } image { large } } } }
                staff(sort: [RELEVANCE, ID], perPage: 8) { pageInfo { hasNextPage } edges { role node { id name { full } image { large } } } }
                relations { edges { relationType node { id type format status seasonYear episodes chapters title { romaji english native } coverImage { large } } } }
            } }`;
            try {
                const data = await anilist(query, { id });
                if (requestId !== detailRequestId || !data?.Media) return;
                if (data.Media.isAdult && !adultAllowed.value) { showToast('18+ content is turned off for your account', 'error'); return; }
                const media = normMedia(data.Media);
                detailCache.set(id, media);
                if (push) navigate(() => showDetails(media)); else showDetails(media);
            } catch (err) {
                showToast(err.message || 'Could not load', 'error');
            } finally {
                if (requestId === detailRequestId) detailLoading.value = false;
            }
        };

        // Games: 18+ only when the owner allowed it for you AND you switched it on; your hidden genres always apply
        const gameOpts = (withAdult = true) => ({ adult: withAdult && !!(filters.value.isAdult && adultAllowed.value), hidden: hiddenOf('GAME') });
        // Price sort: IGDB has no prices, so the loaded games get their Steam price and are sorted here
        // (games not on Steam go last)
        const priceCache = new Map();
        const sortByPrice = async (sort, requestId) => {
            const need = [...new Set(results.value.map(g => g.steamId).filter(id => id && !priceCache.has(id)))];
            for (let i = 0; i < need.length; i += 50) {
                try { const got = await steam('prices', need.slice(i, i + 50)); need.slice(i, i + 50).forEach(id => priceCache.set(id, got?.[id] || null)); }
                catch { break; }
            }
            if (requestId !== listRequestId) return;
            results.value.forEach(g => { const p = priceCache.get(g.steamId); g.priceText = p ? p.text : 'Not on Steam'; g.priceCents = p ? p.final : null; });
            const dir = sort === 'price_desc' ? -1 : 1;
            results.value = [...results.value].sort((a, b) => (a.priceCents == null) - (b.priceCents == null) || dir * ((a.priceCents || 0) - (b.priceCents || 0)));
        };
        // One page of Browse results for any section. `low` = background request (waits behind what you're looking at).
        // 18+ manga: AniList's API no longer lists adult manga (the isAdult: true filter comes back empty), but it still
        // answers for them by id. So MangaDex gives the list (most titles there carry their AniList id) and AniList the details.
        const MD_STATUS_OF = { RELEASING: 'ongoing', FINISHED: 'completed', HIATUS: 'hiatus', CANCELLED: 'cancelled' };
        const MD_LANG_OF = { JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh-hk' };
        const adultMangaBrowse = async (f, page, { low = false } = {}) => {
            const per = 50;   // AniList takes at most 50 ids at once
            const p = new URLSearchParams({ limit: per, offset: (page - 1) * per });
            p.append('contentRating[]', 'pornographic');
            p.append(f.search.trim() ? 'order[relevance]' : 'order[followedCount]', 'desc');
            if (f.search.trim()) p.set('title', f.search.trim());
            if (f.year) p.set('year', f.year);
            if (MD_STATUS_OF[f.status]) p.append('status[]', MD_STATUS_OF[f.status]);
            if (MD_LANG_OF[f.country]) p.append('originalLanguage[]', MD_LANG_OF[f.country]);
            const md = JSON.parse((await siteFetch('https://api.mangadex.org/manga?' + p)).body || '{}');
            const ids = [...new Set((md.data || []).map(m => Number(m.attributes?.links?.al)).filter(Boolean))];
            if (!ids.length) return { items: [], hasNextPage: false };
            const data = await anilist(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: MANGA) { ${MEDIA_FIELDS} } } }`, { ids: ids.slice(0, 50) }, { low });
            const byId = new Map((data?.Page?.media || []).map(m => [m.id, m]));
            const genres = splitMulti(f.genre), hidden = hiddenOf('MANGA');
            const items = ids.map(id => byId.get(id)).filter(m => m && m.isAdult
                && genres.every(g => (m.genres || []).includes(g)) && !(m.genres || []).some(g => hidden.includes(g))
                && (!f.format || m.format === f.format)).map(normMedia);
            return { items, hasNextPage: (md.offset || 0) + per < Math.min(md.total || 0, 9900) };
        };
        const browseFetch = async (type, f, page, { low = false } = {}) => {
            if (type === 'GAME') return gameApi.browse(f, page, gameOpts(), { low });
            if (type === 'TV') return tvApi.browse(f, page, { ...gameOpts(), hidden: hiddenOf('TV') });
            if (type === 'SONG') return songApi.browse(f, page);
            const isManga = type === 'MANGA';
            if (isManga && f.isAdult && adultAllowed.value) return adultMangaBrowse(f, page, { low });
            const varsDef = ['$page: Int'];
            const mediaArgs = [`type: ${type}`, `isAdult: ${f.isAdult && adultAllowed.value ? 'true' : 'false'}`];   // 18+ only if the owner allows you
            const variables = { page };
            let sort = '[TRENDING_DESC, POPULARITY_DESC]';
            if (f.search.trim()) { varsDef.push('$search: String'); mediaArgs.push('search: $search'); variables.search = f.search.trim(); sort = '[SEARCH_MATCH, POPULARITY_DESC]'; }
            // several genres / tags = titles that have ALL of them (that's how AniList's genre_in / tag_in behave)
            if (f.genre) { varsDef.push('$genres: [String]'); mediaArgs.push('genre_in: $genres'); variables.genres = splitMulti(f.genre); }
            if (f.tag) { varsDef.push('$tags: [String]'); mediaArgs.push('tag_in: $tags'); variables.tags = splitMulti(f.tag); }
            if (hiddenOf(type).length) { varsDef.push('$noGenres: [String]'); mediaArgs.push('genre_not_in: $noGenres'); variables.noGenres = hiddenOf(type); }
            if (f.year && !isManga) { varsDef.push('$year: Int'); mediaArgs.push('seasonYear: $year'); variables.year = parseInt(f.year); }
            if (f.year && isManga) { varsDef.push('$from: FuzzyDateInt', '$to: FuzzyDateInt'); mediaArgs.push('startDate_greater: $from', 'startDate_lesser: $to'); variables.from = parseInt(f.year) * 10000; variables.to = (parseInt(f.year) + 1) * 10000; }
            if (f.country && isManga) { varsDef.push('$country: CountryCode'); mediaArgs.push('countryOfOrigin: $country'); variables.country = f.country; }
            if (f.season && !isManga) { varsDef.push('$season: MediaSeason'); mediaArgs.push('season: $season'); variables.season = f.season; }
            if (f.status) { varsDef.push('$status: MediaStatus'); mediaArgs.push('status: $status'); variables.status = f.status; }
            if (f.format) { varsDef.push('$format: MediaFormat'); mediaArgs.push('format: $format'); variables.format = f.format; }
            const query = `query (${varsDef.join(', ')}) { Page(page: $page, perPage: 48) { pageInfo { hasNextPage }
                media(${mediaArgs.join(', ')}, sort: ${sort}) { ${MEDIA_FIELDS} } } }`;
            const data = await anilist(query, variables, { low });
            return { items: (data?.Page?.media || []).map(normMedia), hasNextPage: data?.Page?.pageInfo?.hasNextPage || false };
        };
        // the same page asked twice at once (e.g. you open a section while it's being prepared) shares one request
        const inflight = new Map();
        const browseShared = (type, f, page, opts) => {
            const k = browseKey(type, f) + '#' + page;
            if (inflight.has(k)) return inflight.get(k);
            const p = browseFetch(type, f, page, opts).finally(() => inflight.delete(k));
            inflight.set(k, p); return p;
        };
        const isDefaultView = (f) => !(f.search.trim() || f.genre || f.tag || f.platform || f.year || f.season || f.status || f.coop || f.sort || f.isAdult || f.format || f.hideExplicit || (f.country && (f.country !== 'us' || mediaType.value === 'SONG')));
        // Front page rows for every section (like Games): each section's rows are asked for together, kept 2 hours in
        // this browser so they open instantly, and "See all" jumps to the matching filter (or the Top 100)
        const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
        const seasonNow = () => { const d = new Date(); return { s: SEASONS[Math.floor(d.getMonth() / 3)], y: d.getFullYear() }; };
        const seasonNext = () => { const { s, y } = seasonNow(); const i = SEASONS.indexOf(s); return i === 3 ? { s: 'WINTER', y: y + 1 } : { s: SEASONS[i + 1], y }; };
        const capWord = (s) => s[0] + s.slice(1).toLowerCase();
        const SHELF_DEFS = {
            GAME: [
                { k: 'fresh', l: 'New releases', sub: 'out in the last few months', icon: 'fa-bolt', see: { sort: 'new' } },
                { k: 'soon', l: 'Coming soon', sub: 'the most anticipated', icon: 'fa-hourglass-half', see: { status: 'NOT_YET_RELEASED' } },
                { k: 'best', l: 'Best of all time', sub: 'highest rated by players', icon: 'fa-trophy', see: { sort: 'rating_desc' } },
                { k: 'coop', l: 'Play together', sub: 'co-op hits', icon: 'fa-user-group', see: { coop: true } },
            ],
            ANIME: [
                { k: 'season', l: 'This season', sub: () => `${capWord(seasonNow().s)} ${seasonNow().y} · airing now`, icon: 'fa-leaf', see: () => ({ season: seasonNow().s, year: String(seasonNow().y) }) },
                { k: 'next', l: 'Next season', sub: () => `${capWord(seasonNext().s)} ${seasonNext().y} · most anticipated`, icon: 'fa-hourglass-half', see: () => ({ season: seasonNext().s, year: String(seasonNext().y) }) },
                { k: 'best', l: 'Best of all time', sub: 'highest rated by fans', icon: 'fa-trophy', see: { tab: 'top' } },
                { k: 'movies', l: 'Anime movies', sub: 'trending films', icon: 'fa-film', see: { format: 'MOVIE' } },
            ],
            MANGA: [
                { k: 'releasing', l: 'Publishing now', sub: 'ongoing and popular', icon: 'fa-pen-nib', see: { status: 'RELEASING' } },
                { k: 'manhwa', l: 'Top manhwa', sub: 'from Korea', icon: 'fa-mobile-screen', see: { country: 'KR' } },
                { k: 'best', l: 'Best of all time', sub: 'highest rated by readers', icon: 'fa-trophy', see: { tab: 'top' } },
                { k: 'rising', l: 'New & rising', sub: 'started recently, trending', icon: 'fa-arrow-trend-up', see: () => ({ year: String(new Date().getFullYear()) }) },
            ],
            TV: [
                { k: 'cinema', l: 'In cinemas now', sub: 'new movies', icon: 'fa-ticket', see: { format: 'MOVIE' } },
                { k: 'series', l: 'Popular series', sub: 'what everyone is watching', icon: 'fa-tv', see: { format: 'TV' } },
                { k: 'upcoming', l: 'Coming soon', sub: 'movies on the way', icon: 'fa-hourglass-half', see: { status: 'NOT_YET_RELEASED', format: 'MOVIE' } },
                { k: 'best', l: 'Best of all time', sub: 'highest rated movies', icon: 'fa-trophy', see: { tab: 'top' } },
            ],
            SONG: [
                { k: 'alltime', l: 'Most streamed ever', sub: 'the all-time record holders', icon: 'fa-crown', see: { tab: 'top' } },
                { k: 'us', l: 'Top in the USA', sub: 'most played this week', icon: 'fa-fire', see: { country: 'us' } },
                { k: 'gb', l: 'Top in the UK', sub: 'most played this week', icon: 'fa-music', see: { country: 'gb' } },
                { k: 'kr', l: 'K-pop & Korea', sub: 'most played in Korea', icon: 'fa-star', see: { country: 'kr' } },
            ],
        };
        const SHELF_KEY = 'anicoop_shelves_v2:';
        const shelves = reactive({});            // type → { rows, at }
        const shelvesBusy = {};
        Object.keys(SHELF_DEFS).forEach(t => { const c = readJSON(SHELF_KEY + t); if (c?.rows) shelves[t] = { at: c.at, rows: Object.fromEntries(Object.entries(c.rows).map(([k, l]) => [k, l.map(normMedia)])) }; });
        // AniList: all four rows in ONE request (named parts of the same query)
        const aniShelves = async (type) => {
            const no = hiddenOf(type).length ? hiddenOf(type) : null;
            const P = (args) => `Page(perPage: 18) { media(type: ${type}, ${args}, genre_not_in: $no) { ${MEDIA_FIELDS} } }`;
            const { s, y } = seasonNow(), n = seasonNext();
            const q = type === 'ANIME'
                ? `query ($no: [String]) { season: ${P(`season: ${s}, seasonYear: ${y}, sort: POPULARITY_DESC`)} next: ${P(`season: ${n.s}, seasonYear: ${n.y}, sort: POPULARITY_DESC`)} best: ${P('sort: SCORE_DESC, popularity_greater: 60000')} movies: ${P('format: MOVIE, sort: TRENDING_DESC')} }`
                : `query ($no: [String], $since: FuzzyDateInt) { releasing: ${P('status: RELEASING, sort: POPULARITY_DESC')} manhwa: ${P('countryOfOrigin: "KR", sort: SCORE_DESC, popularity_greater: 20000')} best: ${P('sort: SCORE_DESC, popularity_greater: 25000')} rising: ${P('startDate_greater: $since, sort: TRENDING_DESC')} }`;
            const vars = { no, ...(type === 'MANGA' ? { since: (new Date().getFullYear() - 1) * 10000 + 101 } : {}) };
            const d = await anilistRaw(q, vars);
            return Object.fromEntries(Object.entries(d || {}).map(([k, v]) => [k, (v?.media || []).filter(m => !m.isAdult).map(normMedia)]));
        };
        // TMDB: the four lists at the same time
        const tvShelves = async () => {
            const keep = tvKeep({});
            const get = (path, kind, params = {}) => tmdbCall(path, params).then(d => (d.results || []).filter(keep).map(x => normTmdb(x, kind)).filter(x => x.coverImage?.large).slice(0, 18)).catch(() => []);
            const [cinema, series, upcoming, best] = await Promise.all([
                get('movie/now_playing', 'movie'),
                get('discover/tv', 'tv', { sort_by: 'popularity.desc', 'vote_count.gte': 150, without_genres: '10767,10763,10764,10766', without_keywords: [TMDB_ANIME_KEYWORD, ...TMDB_EROTIC].join(',') }),   // no talk / news / reality / soaps
                get('discover/movie', 'movie', { sort_by: 'popularity.desc', 'primary_release_date.gte': new Date(Date.now() + 86400e3).toISOString().slice(0, 10), without_keywords: [TMDB_ANIME_KEYWORD, ...TMDB_EROTIC].join(',') }),
                get('discover/movie', 'movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 8000, without_keywords: [TMDB_ANIME_KEYWORD, ...TMDB_EROTIC].join(',') }),
            ]);
            return { cinema, series, upcoming: upcoming.filter(x => !x.releaseDate || new Date(x.releaseDate).getTime() > Date.now() - 86400e3), best };
        };
        // Songs: the all-time list (the songs already matched to Apple) + three countries' charts, at the same time
        const songShelves = async () => {
            const chart = (cc) => appleChartOne(cc).then(l => dedupeSongs(l.map(normApple)).slice(0, 18)).catch(() => []);
            const [alltime, us, gb, kr] = await Promise.all([
                songApi.allTime().then(l => l.filter(x => x.song).map(x => x.song).slice(0, 18)).catch(() => []),
                chart('us'), chart('gb'), chart('kr'),
            ]);
            return { alltime: alltime.length >= 6 ? alltime : [], us, gb, kr };
        };
        const loadShelves = async (type, force = false) => {
            if (!SHELF_DEFS[type] || shelvesBusy[type] || (!force && shelves[type] && Date.now() - shelves[type].at < 2 * 3600e3)) return;
            shelvesBusy[type] = true;
            try {
                const rows = type === 'GAME' ? await gameApi.shelves(gameOpts(false)) : type === 'TV' ? await tvShelves() : type === 'SONG' ? await songShelves() : await aniShelves(type);
                Object.keys(rows).forEach(k => { rows[k] = rows[k].filter(notHidden); });
                if (Object.values(rows).some(l => l.length)) {
                    shelves[type] = { rows, at: Date.now() };
                    try { localStorage.setItem(SHELF_KEY + type, JSON.stringify({ at: Date.now(), rows: Object.fromEntries(Object.entries(rows).map(([k, l]) => [k, l.map(slimAnime)])) })); } catch {}
                }
            } catch (err) { console.warn('shelves', type, err.message || err); }
            finally { shelvesBusy[type] = false; }
        };
        const loadGameShelves = (force) => loadShelves('GAME', force);
        const shelfSub = (s) => typeof s.sub === 'function' ? s.sub() : s.sub;
        const seeShelf = (s) => {
            const see = typeof s.see === 'function' ? s.see() : s.see;
            if (see.tab) { switchTab(see.tab); return; }
            Object.assign(filters.value, see);
            nextTick(() => document.getElementById('browse-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        };
        const shelfRows = computed(() => {
            const t = mediaType.value, s = shelves[t];
            if (!s || activeTab.value !== 'browse' || !isDefaultView(filters.value)) return [];
            return (SHELF_DEFS[t] || []).filter(d => s.rows[d.k]?.length).map(d => ({ ...d, items: s.rows[d.k] }));
        });
        watch(() => currentAppView.value === 'tracker' && activeTab.value === 'browse' ? mediaType.value : null, (t) => { if (t) loadShelves(t); }, { immediate: true });

        // First pages are remembered: a section you've opened before shows instantly and quietly refreshes behind the
        // scenes. The default view of each section is also kept in this browser, so it's instant after a restart too.
        const BROWSE_KEY = 'anicoop_browse_v1';
        const BROWSE_FRESH = 3 * 60 * 1000;          // younger than this: no refresh at all
        const browseCache = new Map(Object.entries(readJSON(BROWSE_KEY) || {}).filter(([, v]) => Date.now() - v.at < 24 * 3600 * 1000 && v.items?.length));
        const browseKey = (type, f) => [type, f.search.trim().toLowerCase(), f.genre, f.tag, f.year, f.season, f.status, f.format, f.country, f.platform, f.coop, f.sort, f.hideExplicit, f.isAdult && adultAllowed.value, JSON.stringify(hiddenOf(type))].join('|');
        const saveBrowse = debounce(() => {
            const keep = {}; browseCache.forEach((v, k) => { if (v.def) keep[k] = { ...v, items: v.items.map(slimAnime) }; });
            try { localStorage.setItem(BROWSE_KEY, JSON.stringify(keep)); } catch {}
        }, 1500);
        const remember = (type, f, items, more) => {
            if (!items.length) { browseCache.delete(browseKey(type, f)); return; }   // never keep "nothing": a hiccup would stick around
            if (browseCache.size > 60) browseCache.delete(browseCache.keys().next().value);
            browseCache.set(browseKey(type, f), { at: Date.now(), items, more, def: isDefaultView(f) });
            if (isDefaultView(f)) { trendingCache[type] = items.slice(0, 5); if (mediaType.value === type) trendingTop.value = trendingCache[type]; saveBrowse(); }
        };

        let listRequestId = 0;
        const fetchMainList = async (loadMore = false) => {
            const requestId = ++listRequestId;
            const t = mediaType.value; const f = filters.value;
            moreError.value = '';
            let silent = false;
            if (!loadMore) {
                const hit = browseCache.get(browseKey(t, f));
                if (hit) {   // show what we have right away
                    results.value = hit.items; hasNextPage.value = hit.more; currentPage.value = 1; browseError.value = '';
                    if (isDefaultView(f)) { trendingCache[t] = hit.items.slice(0, 5); trendingTop.value = trendingCache[t]; }
                    if (Date.now() - hit.at < BROWSE_FRESH) { isLoading.value = false; isLoadingMore.value = false; recheckInfinite(); return; }
                    silent = true;   // older: refresh without a loading screen
                }
            }
            if (loadMore) isLoadingMore.value = true; else if (!silent) { currentPage.value = 1; isLoading.value = true; }
            if (!silent) browseError.value = '';
            const page = loadMore ? currentPage.value + 1 : 1;
            try {
                const { items, hasNextPage: more } = await browseShared(t, f, page);
                if (requestId !== listRequestId) return;
                if (loadMore) {
                    const seen = new Set(results.value.map(a => a.id));
                    results.value.push(...items.filter(a => !seen.has(a.id)));
                    currentPage.value = page;
                } else if (!silent || currentPage.value === 1) {   // a background refresh doesn't undo pages you scrolled into
                    results.value = items; hasNextPage.value = more;
                }
                if (loadMore) hasNextPage.value = more;
                if (t === 'GAME' && (f.sort === 'price_asc' || f.sort === 'price_desc')) await sortByPrice(f.sort, requestId);
                if (!loadMore) remember(t, f, items, more);
            } catch (err) {
                if (requestId !== listRequestId || silent) return;   // a failed background refresh keeps what's on screen
                if (loadMore) moreError.value = err.message || 'Could not load more'; else browseError.value = err.message || 'Could not load.';
            } finally {
                if (requestId === listRequestId) { isLoading.value = false; isLoadingMore.value = false; recheckInfinite(); }
            }
        };
        // after the app opens, quietly load the default page of the other sections so switching is instant
        // (all at once: they come from different services, and each service's lane keeps its own pace)
        const prefetchType = async (type, { low = true } = {}) => {
            const f = defaultFilters();
            const hit = browseCache.get(browseKey(type, f));
            if ((hit && Date.now() - hit.at < BROWSE_FRESH) || type === mediaType.value) return;
            try { const { items, hasNextPage: more } = await browseShared(type, f, 1, { low }); remember(type, f, items, more); } catch {}
        };
        const prefetchSections = () => Promise.all(['MANGA', 'ANIME', 'GAME', 'TV', 'SONG'].map(t => prefetchType(t)));
        // pointing at a section (menu, tiles, tabs) starts loading it right away, at full priority — by the time
        // you click, it's usually there
        const warmSection = (id) => { const t = Object.keys(SECTION_OF_TYPE).find(k => SECTION_OF_TYPE[k] === id); if (t) prefetchType(t, { low: false }); };
        const loadMoreBrowse = () => { if (hasNextPage.value && !isLoading.value && !isLoadingMore.value && !browseError.value && !moreError.value) fetchMainList(true); };
        const moreError = ref('');
        const trendingCache = {};
        // "Top 5 trending" = the first 5 of the section's default Browse page, so it normally costs no extra request
        const fetchTrending = async () => {
            const type = mediaType.value;
            const hit = trendingCache[type] || browseCache.get(browseKey(type, defaultFilters()))?.items.slice(0, 5);
            if (hit) { trendingCache[type] = hit; trendingTop.value = hit; return; }
            trendingTop.value = [];   // never show another section's trending while this one loads (or if it fails)
            if (isDefaultView(filters.value)) return;   // the Browse page being loaded right now fills it in
            try {
                const { items, hasNextPage: more } = await browseShared(type, defaultFilters(), 1, { low: true });
                remember(type, defaultFilters(), items, more);
            } catch {}
        };

        // the filter bar stays pinned, so you can search from far down the page: bring the new results into view
        const scrollToResults = () => {
            const el = document.getElementById('browse-results'); if (!el) return;
            const top = el.getBoundingClientRect().top + window.scrollY - (64 + (document.querySelector('.filter-dock')?.offsetHeight || 0) + 12);
            if (window.scrollY > top + 4) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        };
        const debouncedSearch = debounce(() => { scrollToResults(); fetchMainList(false); }, 450);
        const filterKey = () => { const f = filters.value; return [mediaType.value, f.genre, f.tag, f.year, f.season, f.status, f.format, f.country, f.platform, f.coop, f.sort, f.hideExplicit, f.isAdult, JSON.stringify(hiddenOf(mediaType.value))].join('|'); };
        watch(filterKey, () => { scrollToResults(); fetchMainList(false); });
        // (results aren't cleared here: the Browse loader either shows the saved page at once or a loading skeleton)
        watch(mediaType, () => { filters.value = defaultFilters(); fetchTrending(); resetSelection(); });
        // the Games proxy only answers signed-in users, so reload Games once the session is ready
        watch(() => currentUser.value?.id, (id) => { if (id && mediaType.value === 'GAME') { delete trendingCache.GAME; fetchMainList(false); fetchTrending(); } });
        watch(() => selectedAnime.value?.type || mediaType.value, (t) => applyLabels(t), { immediate: true });
        const formatOptions = computed(() => mediaType.value === 'MANGA'
            ? [{ v: 'MANGA', l: 'Manga' }, { v: 'NOVEL', l: 'Light novel' }, { v: 'ONE_SHOT', l: 'One shot' }]
            : [{ v: 'TV', l: 'TV' }, { v: 'TV_SHORT', l: 'TV Short' }, { v: 'MOVIE', l: 'Movie' }, { v: 'OVA', l: 'OVA' }, { v: 'ONA', l: 'ONA' }, { v: 'SPECIAL', l: 'Special' }]);
        const countryOptions = [{ v: '', l: 'All' }, { v: 'JP', l: 'Manga' }, { v: 'KR', l: 'Manhwa' }, { v: 'CN', l: 'Manhua' }];
        const quickFormats = [{ v: '', l: 'All' }, { v: 'TV', l: 'TV' }, { v: 'MOVIE', l: 'Movies' }];
        // Genre dropdown: AniList genres are names, IGDB genres are ids
        const allGenreOptions = computed(() => mediaType.value === 'GAME' ? GAME_GENRES : mediaType.value === 'TV' ? TV_GENRES : mediaType.value === 'SONG' ? SONG_GENRES : availableGenres.map(g => ({ v: g, l: g })));
        const genreOptions = computed(() => allGenreOptions.value.filter(g => !isGenreHidden(g.v)));
        // "Hide genres": saved in your settings and applied across the site (Browse, Top 100, trending, random)
        const hiddenGenreOpen = ref(false);
        const isGenreHidden = (v) => hiddenOf(mediaType.value).map(String).includes(String(v));
        const toggleHiddenGenre = (v) => {
            const t = mediaType.value; const list = [...hiddenOf(t)];
            const i = list.findIndex(x => String(x) === String(v));
            if (i !== -1) list.splice(i, 1); else list.push(t === 'GAME' ? Number(v) : v);
            PREFS.hiddenGenres = { ...PREFS.hiddenGenres, [t]: list };
            if (splitMulti(filters.value.genre).includes(String(v))) filters.value.genre = splitMulti(filters.value.genre).filter(x => x !== String(v)).join(',');
            delete trendingCache[t]; fetchTrending(); resetTop(); if (activeTab.value === 'top') loadTop(); loadShelves(t, true);   // reload the leaderboard right away (it used to stay empty)
        };

        // ---------- Top 100 leaderboard (per section) ----------
        // Ranked by a weighted score, not the raw rating: a title needs lots of votes to reach the top
        // (weighted = v/(v+m)·R + m/(v+m)·C — R rating, v votes, m votes needed to be trusted, C average rating).
        // v = how many people actually scored it (AniList's score distribution, IGDB/TMDB vote counts), R = its exact mean
        // score (decimals kept), m = votes needed before a score is trusted, C = a typical score.
        const TOP_CFG = { ANIME: { m: 12000, min: 3000, C: 70 }, MANGA: { m: 3000, min: 1000, C: 70 }, GAME: { m: 300, min: 25, C: 72 }, TV: { m: 3000, min: 1500, C: 68 }, SONG: { chart: true } };
        // sub-lists: manga / manhwa / manhua and movies / series are ranked separately
        const TOP_SUBS = { MANGA: [{ v: 'JP', l: 'Manga' }, { v: 'KR', l: 'Manhwa' }, { v: 'CN', l: 'Manhua' }], TV: [{ v: 'movie', l: 'Movies' }, { v: 'tv', l: 'Series' }] };
        const top = reactive({ type: null, sub: '', gen: 0, pool: [], shown: 100, page: 0, done: false, loading: false, error: '' });
        // every reset starts a new "generation": answers to an older request are thrown away, so the list can't come back
        // empty or mixed after you hide a genre / switch tab while it was loading
        const resetTop = () => Object.assign(top, { type: null, gen: top.gen + 1, pool: [], shown: 100, page: 0, done: false, loading: false, error: '' });
        const weighted = (R, v, cfg) => (v / (v + cfg.m)) * R + (cfg.m / (v + cfg.m)) * cfg.C;
        // AniList: the real number of people who scored it and their exact mean, from the score distribution
        const distStats = (m) => {
            const d = m.stats?.scoreDistribution || []; const v = d.reduce((a, x) => a + (x.amount || 0), 0);
            return v ? { R: d.reduce((a, x) => a + x.score * x.amount, 0) / v, v } : { R: m.meanScore || m.averageScore || 0, v: m.popularity || 0 };
        };
        const topFetchChunk = async (type, gen) => {
            const cfg = TOP_CFG[type];
            let items = [], done = false;
            if (type === 'GAME') ({ items, done } = await gameApi.top(top.page, gameOpts(false)));
            else if (type === 'TV') {   // 5 TMDB pages at once (100 titles) instead of one after another
                const pages = await Promise.all([0, 1, 2, 3, 4].map(k => tvApi.top(top.page * 5 + k, { kind: top.sub || 'movie' })));
                items = pages.flatMap(p => p.items); done = pages.some(p => p.done);
            }
            else if (type === 'SONG') { await songTopAllTime(gen); return; }
            else {
                const c = type === 'MANGA' ? (top.sub || 'JP') : null;
                const q = `query ($page: Int, $type: MediaType, $min: Int, $no: [String]${c ? ', $c: CountryCode' : ''}) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
                    media(type: $type, isAdult: false, popularity_greater: $min, genre_not_in: $no${c ? ', countryOfOrigin: $c' : ''}, sort: SCORE_DESC) { ${MEDIA_FIELDS} popularity meanScore stats { scoreDistribution { score amount } } } } }`;
                // the 4 pages (200 titles) are asked for at the same time
                const pages = await Promise.all([1, 2, 3, 4].map(k => anilist(q, { page: top.page * 4 + k, type, min: c && c !== 'JP' ? Math.round(cfg.min / 3) : cfg.min, no: hiddenOf(type).length ? hiddenOf(type) : null, ...(c ? { c } : {}) })));
                if (gen !== top.gen) return;
                pages.forEach(d => items.push(...(d?.Page?.media || []).map(m => { const s = distStats(m); return { ...normMedia(m), rating: s.R, votes: s.v, members: m.popularity || 0 }; })));
                done = pages.some(d => !d?.Page?.pageInfo?.hasNextPage);
            }
            if (gen !== top.gen) return;
            top.page++; top.done = done;
            const seen = new Set(top.pool.map(x => x.id));
            const m = type === 'MANGA' && top.sub && top.sub !== 'JP' ? { ...cfg, m: cfg.m / 3 } : cfg;
            // pages asked for together can overlap (titles with the same score swap places between pages): keep each title once
            const add = items.filter(x => !seen.has(x.id) && seen.add(x.id) && notHidden(x) && (x.rating || x.averageScore)).map(x => ({ ...x, rating: x.rating || x.averageScore, wScore: weighted(x.rating || x.averageScore, x.votes || 0, m) }));
            top.pool = [...top.pool, ...add];
        };
        // Songs: the 100 most streamed songs of all time (Spotify's all-time list, kept up to date on Wikipedia),
        // each matched to Apple Music for its cover, preview and page. The list shows at once; covers fill in.
        // "Show 100 more" goes on down kworb's longer list of the most streamed songs.
        const songTopAllTime = async (gen) => {
            const first = !top.pool.length;
            let list;
            if (first) list = await songApi.allTime();
            else {
                const have = new Set(top.pool.map(x => x.wkey));
                list = (await songApi.allTimeMore()).filter(x => !have.has(songKey(x.title, x.artist))).slice(0, 100);
            }
            if (gen !== top.gen) return;
            top.page++; top.done = !first && list.length < 100;
            const from = top.pool.length;
            const rows = list.map((x, n) => {
                const w = { ...x, rank: from + n + 1 }; const song = x.song || (allTimeMatches[allTimeKey(x)] ? normApple(allTimeMatches[allTimeKey(x)]) : null);
                const base = { streams: x.streams, chartPos: w.rank, wScore: null, wkey: songKey(x.title, x.artist) };
                return song ? { ...song, ...base } : { id: 'wk' + w.rank, pending: true, type: 'SONG', title: { romaji: x.title }, artists: [x.artist], coverImage: { large: null }, ...base, wiki: w };
            });
            top.pool = [...top.pool, ...rows];
            const todo = top.pool.map((x, n) => n).filter(n => n >= from && top.pool[n].pending);
            const worker = async () => {
                while (todo.length && gen === top.gen) {
                    const n = todo.shift(); const w = top.pool[n]?.wiki; if (!w) continue;
                    const s = await songApi.matchAllTime(w).catch(() => null);
                    if (gen !== top.gen) return;
                    if (s) top.pool[n] = { ...s, streams: w.streams, chartPos: w.rank, wScore: null, wkey: top.pool[n].wkey };
                }
            };
            await Promise.all([worker(), worker(), worker()]);
        };
        const openTopItem = async (a) => {
            if (!a.pending) { fetchAnimeDetails(a); return; }
            const s = await songApi.matchAllTime(a.wiki).catch(() => null);
            if (s) fetchAnimeDetails(s); else showToast(`Couldn’t find ${a.title.romaji} on Apple Music`, 'error');
        };
        // keep 50 extra titles fetched beyond what's shown, so the order is settled before it appears
        const topFill = async () => {
            const type = mediaType.value, gen = top.gen;
            if (!TOP_CFG[type] || top.loading) return;
            top.loading = true; top.error = '';
            // songs are in chart order, so they only need what's shown; rated lists keep 50 extra so the order is settled
            const want = () => type === 'SONG' ? top.shown : top.shown + 50;
            try { while (gen === top.gen && top.type === type && !top.done && top.pool.length < want()) await topFetchChunk(type, gen); saveTopCache(); }
            catch (err) { if (gen === top.gen) top.error = err.message || 'Could not load the leaderboard'; }
            finally { if (gen === top.gen) top.loading = false; }
        };
        // each leaderboard is kept for 6 hours (this browser), so opening it again is instant
        const TOP_CACHE = 'anicoop_top_v3:';   // v3: older saved lists could hold the same title twice
        const topCacheKey = () => TOP_CACHE + [top.type, top.sub, hiddenOf(top.type).join(',')].join('|');
        const saveTopCache = () => {
            if (!top.type || top.type === 'SONG' || !top.pool.length) return;
            const pool = top.pool.map(x => ({ ...slimAnime(x), rating: x.rating, votes: x.votes, wScore: x.wScore }));
            try { localStorage.setItem(topCacheKey(), JSON.stringify({ at: Date.now(), page: top.page, done: top.done, pool })); } catch {}
        };
        const restoreTopCache = () => {
            const c = readJSON(topCacheKey());
            if (!c?.pool?.length || Date.now() - c.at > 6 * 3600e3) return false;
            const ids = new Set(); Object.assign(top, { pool: c.pool.filter(x => !ids.has(x.id) && ids.add(x.id)).map(normMedia), page: c.page, done: c.done });
            return true;
        };
        const loadTop = () => {
            const t = mediaType.value;
            if (top.type !== t) { resetTop(); top.type = t; if (!TOP_SUBS[t]?.some(s => s.v === top.sub)) top.sub = TOP_SUBS[t]?.[0].v || ''; restoreTopCache(); }
            topFill();
        };
        const setTopSub = (v) => { if (top.sub === v) return; const t = mediaType.value; resetTop(); top.type = t; top.sub = v; restoreTopCache(); topFill(); };
        // two ways to rank: "Rating" = the score alone (a tie goes to the one more people rated), or
        // "Rating + votes" = the weighted formula (a 9 from 100k people beats a 9.5 from 10)
        // a precise score: 8.93 (or 89.3%) instead of rounding everything to 9.0
        const fmtTopScore = (w) => w == null ? '' : PREFS.scoreFormat === 'POINT_100' ? w.toFixed(1) + '%' : (w / 10).toFixed(2);
        const showMoreTop = () => { top.shown += 100; topFill(); };
        // One ranking: rating weighted by how many people rated it. Titles are compared on the score you see (8.87),
        // so when two show the same score, the one more people rated is higher — never the other way round.
        const shownScore = (w) => Math.round((w || 0) * 10);
        const topItems = computed(() => {
            if (top.type === 'SONG') return top.pool.slice(0, top.shown);
            return [...top.pool].sort((a, b) => (shownScore(b.wScore) - shownScore(a.wScore)) || (b.votes - a.votes) || (b.wScore - a.wScore)).slice(0, top.shown);
        });
        const fmtVotes = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 100) / 10 + 'k' : String(n || 0);
        watch(() => currentAppView.value === 'tracker' && activeTab.value === 'top' && !selectedAnime.value && !viewUserId.value ? mediaType.value : null, (t) => { if (t) loadTop(); });
        const resetFilters = () => {
            const before = filterKey();
            const hadSearch = !!filters.value.search.trim();
            filters.value = defaultFilters();
            if (filterKey() === before && hadSearch) fetchMainList(false);
        };
        const activeFilterCount = computed(() => { const f = filters.value; return [f.search.trim(), f.genre, f.tag, f.year, f.season, f.status, f.format, f.country, f.platform, f.coop, f.sort, f.hideExplicit, f.isAdult, f.hideMyAnime].filter(Boolean).length; });
        const anyFilter = computed(() => activeFilterCount.value > 0);
        // Genres & tags take several picks: each pick from the dropdown is added, and removed again from its chip
        const addMulti = (key, ev) => {
            const v = ev?.target ? ev.target.value : ev; if (ev?.target) ev.target.value = '';
            if (!v) return; const list = splitMulti(filters.value[key]);
            filters.value[key] = (list.includes(String(v)) ? list.filter(x => x !== String(v)) : [...list, String(v)]).join(',');   // picking a ticked one unticks it
        };
        const removeMulti = (key, v) => { filters.value[key] = splitMulti(filters.value[key]).filter(x => x !== String(v)).join(','); };
        const hasMulti = (key, v) => splitMulti(filters.value[key]).includes(String(v));
        const tagLabel = (v) => mediaType.value === 'GAME' ? (TAG_NAMES.get(v) || v) : mediaType.value === 'TV' ? (TV_TAGS.find(t => t.v === v)?.l || v) : mediaType.value === 'SONG' ? (SONG_TAGS.find(t => t.v === v)?.l || v) : v;
        const STATUS_LABEL = { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', EARLY: 'Early access' };
        // every filter that's on, as a removable chip above the results
        const activeChips = computed(() => {
            const f = filters.value, t = mediaType.value, chips = [];
            const add = (key, label, clear, icon) => chips.push({ id: key + ':' + label, label, clear, icon });
            if (f.search.trim()) add('search', `“${f.search.trim()}”`, () => { filters.value.search = ''; fetchMainList(false); }, 'fa-magnifying-glass');
            splitMulti(f.genre).forEach(g => add('genre', allGenreOptions.value.find(x => String(x.v) === g)?.l || g, () => removeMulti('genre', g), 'fa-masks-theater'));
            splitMulti(f.tag).forEach(g => add('tag', tagLabel(g), () => removeMulti('tag', g), 'fa-tag'));
            if (f.year) add('year', f.year, () => { filters.value.year = ''; }, 'fa-calendar');
            if (f.season) add('season', f.season[0] + f.season.slice(1).toLowerCase(), () => { filters.value.season = ''; }, 'fa-leaf');
            if (f.status) add('status', t === 'MANGA' && f.status === 'RELEASING' ? 'Publishing' : t === 'GAME' && f.status === 'FINISHED' ? 'Released' : STATUS_LABEL[f.status] || f.status, () => { filters.value.status = ''; }, 'fa-signal');
            if (f.format) add('format', (t === 'TV' ? quickFormats : formatOptions.value).find(x => x.v === f.format)?.l || f.format, () => { filters.value.format = ''; }, 'fa-shapes');
            if (f.country) add('country', t === 'SONG' ? 'Top songs: ' + (CHART_COUNTRIES.find(c => c.v === f.country)?.l || f.country) : countryOptions.find(c => c.v === f.country)?.l || f.country, () => { filters.value.country = ''; }, 'fa-earth-americas');
            if (f.platform) add('platform', GAME_PLATFORMS.find(p => String(p.v) === String(f.platform))?.l || f.platform, () => { filters.value.platform = ''; }, 'fa-desktop');
            if (f.coop) add('coop', 'Co-op', () => { filters.value.coop = false; }, 'fa-user-group');
            if (f.sort) add('sort', GAME_SORTS.find(s => s.v === f.sort)?.l || f.sort, () => { filters.value.sort = ''; }, 'fa-arrow-down-wide-short');
            if (f.hideExplicit) add('explicit', 'No explicit', () => { filters.value.hideExplicit = false; }, 'fa-ban');
            if (f.isAdult) add('adult', '18+ only', () => { filters.value.isAdult = false; }, 'fa-circle-exclamation');
            if (f.hideMyAnime) add('mine', 'Hiding mine', () => { filters.value.hideMyAnime = false; }, 'fa-eye-slash');
            return chips;
        });
        const listTitle = computed(() => {
            const f = filters.value;
            if (f.search.trim()) return 'Search results';
            if (f.genre || f.tag || f.year || f.season || f.status || f.format || f.country || f.platform || f.coop || f.isAdult) return 'Filtered';
            if (f.sort) return (GAME_SORTS.find(s => s.v === f.sort)?.l || 'Sorted').replace(':', ' ·');
            return currentSection.value.label;
        });

        // ---------- STAT PRIVACY (Settings → Privacy) ----------
        const STAT_KEYS = [
            { k: 'days', l: 'Days active' }, { k: 'anime', l: 'Anime count' }, { k: 'manga', l: 'Manga count' },
            { k: 'eps', l: 'Episodes watched' }, { k: 'chapters', l: 'Chapters read' }, { k: 'completed', l: 'Completed' }, { k: 'mean', l: 'Mean score' },
        ];
        const statRules = reactive({});
        const statRule = (k) => statRules[k] || { mode: 'friends', hidden_from: [] };
        const fetchStatPrivacy = async () => {
            if (!uid()) return;
            const { data, error } = await sb.from('stat_privacy').select('rules').eq('user_id', uid()).maybeSingle();
            if (error) return;
            Object.keys(statRules).forEach(k => delete statRules[k]);
            Object.entries(data?.rules || {}).forEach(([k, v]) => { statRules[k] = { mode: v?.mode || 'friends', hidden_from: [...(v?.hidden_from || [])] }; });
            ensureProfiles(Object.values(statRules).flatMap(r => r.hidden_from));
        };
        const saveStatPrivacy = debounce(async () => {
            const { error } = await sb.from('stat_privacy').upsert({ user_id: uid(), rules: JSON.parse(JSON.stringify(statRules)), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (error) showToast('Could not save stat privacy: ' + error.message + (/stat_privacy/.test(error.message) ? ' — run the v5 SQL in Supabase' : ''), 'error');
        }, 500);
        const setStatMode = (k, mode) => { statRules[k] = { ...statRule(k), mode }; saveStatPrivacy(); };
        const setAllStatModes = (mode) => { STAT_KEYS.forEach(s => { statRules[s.k] = { ...statRule(s.k), mode }; }); saveStatPrivacy(); showToast(mode === 'private' ? 'All stats are private' : mode === 'everyone' ? 'All stats are public' : 'All stats visible to friends'); };
        const toggleStatHide = (k, id) => {
            const r = { ...statRule(k), hidden_from: [...statRule(k).hidden_from] };
            const i = r.hidden_from.indexOf(id); if (i === -1) r.hidden_from.push(id); else r.hidden_from.splice(i, 1);
            statRules[k] = r; saveStatPrivacy();
        };
        const statPicker = ref(null);             // stat key whose "hide from" list is open
        const personSearch = ref('');
        const personSearchBusy = ref(false);
        const statPeople = computed(() => [...profileById.value.values()].filter(p => p.id !== uid() && p.username && p.username !== 'Someone').sort((a, b) => a.username.localeCompare(b.username)));
        const findPerson = async (statKey) => {
            const name = personSearch.value.trim().replace(/^@/, '');
            if (!name) return;
            personSearchBusy.value = true;
            const { data } = await sb.from('profiles').select('id, username, avatar_url, accent, bio').ilike('username', escapeLike(name)).maybeSingle();
            personSearchBusy.value = false;
            if (!data) { showToast('No user with that username', 'error'); return; }
            if (data.id === uid()) { showToast('That’s you!', 'error'); return; }
            if (!profileById.value.has(data.id)) extraProfiles.value = [...extraProfiles.value, data];
            if (!statRule(statKey).hidden_from.includes(data.id)) toggleStatHide(statKey, data.id);
            personSearch.value = '';
        };

        // ---------- favorite voice actors + staff ----------
        const favStaff = ref([]);
        const fetchFavStaff = async () => {
            const { data, error } = await sb.from('favorite_staff').select('*').eq('user_id', uid()).order('created_at');
            if (!error) favStaff.value = (data || []).map(r => ({ ...r.data, kind: r.kind }));
        };
        const favVAs = computed(() => favStaff.value.filter(x => x.kind === 'va'));
        const favStaffOnly = computed(() => favStaff.value.filter(x => x.kind !== 'va'));
        const isFavStaff = (id) => favStaff.value.some(x => x.id === id);
        const toggleFavStaff = async (person, kind = 'staff') => {
            if (!person?.id) return;
            const had = isFavStaff(person.id);
            try {
                if (had) {
                    favStaff.value = favStaff.value.filter(x => x.id !== person.id);
                    const { error } = await sb.from('favorite_staff').delete().eq('user_id', uid()).eq('staff_id', person.id);
                    if (error) throw error;
                    showToast('Removed from favorites');
                } else {
                    const data = { id: person.id, name: { full: person.name?.full }, image: { large: person.image?.large } };
                    favStaff.value = [...favStaff.value, { ...data, kind }];
                    const { error } = await sb.from('favorite_staff').insert({ user_id: uid(), staff_id: person.id, kind, data });
                    if (error) throw error;
                    showToast(({ VA: 'Added to favorite voice actors!', ACTOR: 'Added to favorite actors!', SINGER: 'Added to favorite singers!' })[personKind({ ...data, kind })] || 'Added to favorite staff!');
                }
            } catch (err) { showToast('Could not update favorites: ' + (err.message || err) + (/favorite_staff/.test(err.message || '') ? ' — run the v5 SQL in Supabase' : ''), 'error'); fetchFavStaff(); }
        };

        // ---------- character + staff pages ----------
        const entity = ref(null);                 // { type: 'character' | 'staff', id }
        const entityData = ref(null);
        const entityLoading = ref(false);
        const entityCache = new Map();
        const ENTITY_MEDIA = 'id type format seasonYear status episodes chapters averageScore title { romaji english native } coverImage { large } nextAiringEpisode { episode airingAt }';
        const CHARACTER_QUERY = `query ($id: Int) { Character(id: $id) { id name { full native alternative } image { large } description(asHtml: true) gender age bloodType favourites dateOfBirth { year month day }
            media(sort: POPULARITY_DESC, perPage: 30) { edges { characterRole voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full } image { large } } node { ${ENTITY_MEDIA} } } } } }`;
        const STAFF_QUERY = `query ($id: Int) { Staff(id: $id) { id name { full native alternative } image { large } description(asHtml: true) primaryOccupations gender age bloodType favourites yearsActive homeTown languageV2
            dateOfBirth { year month day } dateOfDeath { year month day }
            characterMedia(sort: POPULARITY_DESC, perPage: 30) { edges { characterRole characters { id name { full } image { large } } node { ${ENTITY_MEDIA} } } }
            staffMedia(sort: POPULARITY_DESC, perPage: 30) { edges { staffRole node { ${ENTITY_MEDIA} } } } } }`;
        const openEntity = (type, id) => {
            if (!id) return;
            quickMenuFor.value = null; drill.open = false;
            navigate(() => { selectedAnime.value = null; viewUserId.value = null; entity.value = { type, id }; currentAppView.value = 'tracker'; });
        };
        const openCharacter = (id) => openEntity('character', id);
        // favourite actors are kept with the staff favourites, under PERSON_BASE + their TMDB id
        const openStaff = (id) => id >= PERSON_BASE && id < SONG_BASE ? openEntity('actor', id - PERSON_BASE) : openEntity('staff', id);
        const openActor = (tmdbId) => openEntity('actor', tmdbId);
        // music artists (Apple ids). By name when all we have is a name (songs saved from Spotify before v8).
        const artistNameHint = {};   // Apple artist id → name, when we already know it (lets the photo & bio load sooner)
        const openArtist = (appleId, name = null) => { if (name) artistNameHint[Number(appleId)] = name; openEntity('artist', Number(appleId)); };
        const openArtistByName = async (name) => {
            if (!name) return;
            const a = await songApi.findArtist(name).catch(() => null);
            if (a) openArtist(a.id, a.name); else showToast(`Couldn’t find ${name} on Apple Music`, 'error');
        };
        const openSongArtist = (s) => { const id = s?.artistInfo?.id || s?.artistId; if (id) openArtist(id, s?.artistInfo?.name || (s?.artists || [])[0]); else openArtistByName(s?.artistInfo?.name || (s?.artists || [])[0]); };
        const artistView = reactive({ shown: 24, album: null, albumSongs: [], albumLoading: false });
        watch(() => entity.value?.type === 'artist' && entity.value.id, () => Object.assign(artistView, { shown: 24, album: null, albumSongs: [], albumLoading: false }));
        const openAlbum = async (al) => {
            if (artistView.album?.id === al.id) { artistView.album = null; return; }
            Object.assign(artistView, { album: al, albumSongs: [], albumLoading: true });
            try { const list = await songApi.album(al.id); if (artistView.album?.id === al.id) artistView.albumSongs = list; }
            catch (err) { showToast(err.message || 'Could not load the album', 'error'); }
            finally { artistView.albumLoading = false; }
            nextTick(() => document.getElementById('artist-album')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        };
        // a song's album: its artist's page, opened on that album (the album's songs are listed there)
        // a song's album: the album's own page (older Spotify songs have no Apple album, so their artist page)
        const openSongAlbum = (s) => {
            const id = s?.albumId; if (!id || !/^\d+$/.test(String(id))) { openSongArtist(s); return; }
            openEntity('album', Number(id));
        };
        const openAlbumPage = (id) => { if (id) openEntity('album', Number(id)); };
        const albumSongs = computed(() => entity.value?.type === 'album' && entityData.value?.isAlbum ? [...entityData.value.tracks].sort(sortTracks) : []);
        // a song's artist: the first one has an Apple id, featured artists only a name
        const openTrackArtist = (s, k = 0) => { if (k === 0 && s?.artistId) openArtist(s.artistId, (s.artists || [])[0]); else openArtistByName((s?.artists || [])[k]); };

        // Artist page, organised: Popular (top 10), then the discography (Albums / EPs / Singles, newest first),
        // each release with its songs in track order, then songs that only appear elsewhere (features, compilations)
        const sortTracks = (a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 0) - (b.trackNo || 0);
        const albumTracks = reactive({});       // album id → full track list (asked for when a release isn't complete yet)
        const albumLoading = reactive({});
        const loadAlbumTracks = async (al, quiet = false) => {
            if (albumTracks[al.id] || albumLoading[al.id]) return;
            albumLoading[al.id] = true;
            try { albumTracks[al.id] = (await songApi.album(al.id)).sort(sortTracks); }
            catch (err) { if (!quiet) showToast(err.message || 'Could not load that release', 'error'); }
            finally { albumLoading[al.id] = false; }
        };
        const discTab = ref('popular');
        const discShown = ref(10);
        const artistDiscog = computed(() => {
            const d = entityData.value; if (!d?.isArtist) return null;
            const all = d.tracks || d.songs || [];
            // editions of one release (Deluxe, Expanded, Clean/Explicit, Remastered…) become one entry: the biggest edition
            const base = (n) => String(n || '').toLowerCase().replace(/ - (single|ep)$/, '')
                .replace(/\s*[([][^)\]]*(deluxe|edition|expanded|version|remaster|anniversary|clean|explicit|bonus|complete|platinum|special|extended|original motion picture)[^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim();
            const editions = new Map();
            (d.albums || []).forEach(al => { const k = base(al.name) + '|' + al.kind; if (!editions.has(k)) editions.set(k, []); editions.get(k).push(al); });
            const ownerOf = new Map();   // any edition's id → the release shown
            const picked = [...editions.values()].map(list => {
                const main = [...list].sort((a, b) => (b.tracks || 0) - (a.tracks || 0) || String(a.year).localeCompare(String(b.year)))[0];
                const year = list.map(a => a.year).filter(Boolean).sort()[0] || main.year;   // the first release year
                list.forEach(a => ownerOf.set(a.id, main.id));
                return { ...main, year, editions: list.length };
            }).sort((a, b) => String(b.year).localeCompare(String(a.year)));
            const byAlbum = new Map();
            all.forEach(t => { const k = ownerOf.get(t.albumId); if (!k) return; if (!byAlbum.has(k)) byAlbum.set(k, []); byAlbum.get(k).push(t); });
            const releases = picked.map(al => {
                const got = albumTracks[al.id] || [...(byAlbum.get(al.id) || [])].sort(sortTracks);
                const seen = new Set();
                const songs = got.filter(s => { const k = s.title.romaji.toLowerCase(); return !seen.has(k) && seen.add(k); });
                return { ...al, name: al.name.replace(/ - (Single|EP)$/, ''), songs, complete: !!albumTracks[al.id] || songs.length >= (al.tracks || 0) };
            });
            // "Popular releases" (like Spotify): the newest release, then the releases holding their most played songs
            const popIdx = new Map();
            all.forEach((t, n) => { const k = ownerOf.get(t.albumId); if (k && !popIdx.has(k)) popIdx.set(k, n); });
            const newest = releases[0];
            const popular = [newest, ...releases.filter(r => r !== newest && popIdx.has(r.id)).sort((a, b) => popIdx.get(a.id) - popIdx.get(b.id))].filter(Boolean).slice(0, 12);
            const kinds = [
                { id: 'popular', l: 'Popular releases', items: popular },
                { id: 'Album', l: 'Albums', items: releases.filter(r => r.kind === 'Album') },
                { id: 'Single', l: 'Singles and EPs', items: releases.filter(r => r.kind !== 'Album') },
            ].filter(k => k.items.length);
            const elsewhere = dedupeSongs(all.filter(t => !ownerOf.has(t.albumId)));
            // Popular: their own songs first (Apple's list mixes in songs they're only featured on)
            const own = (s) => s.artistId === d.id || (s.artists[0] || '').toLowerCase() === (d.name?.full || '').toLowerCase();
            const songs = d.songs || [];
            return { popular: [...songs.filter(own), ...songs.filter(s => !own(s))].slice(0, 10), kinds, elsewhere, newestId: newest?.id };
        });
        watch(() => entity.value?.type === 'artist' && entity.value.id, () => { discShown.value = 10; discTab.value = 'popular'; discOpen.value = null; });
        watch(artistDiscog, (dg) => { if (dg && !dg.kinds.some(k => k.id === discTab.value)) discTab.value = dg.kinds[0]?.id || 'popular'; });
        const discReleases = computed(() => (artistDiscog.value?.kinds.find(k => k.id === discTab.value)?.items || []));
        // click a cover → its songs open right under the covers (click again to close); the full tracklist loads then
        const discOpen = ref(null);
        const openRelease = (al) => {
            if (discOpen.value === al.id) { discOpen.value = null; return; }
            discOpen.value = al.id;
            if (!al.complete) loadAlbumTracks(al);
            nextTick(() => document.getElementById('disc-open')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
        };
        const discOpenRelease = computed(() => artistDiscog.value?.kinds.flatMap(k => k.items).find(r => r.id === discOpen.value) || null);
        const artistPopularShown = ref(5);
        watch(() => entity.value?.id, () => { artistPopularShown.value = 5; });

        // Songs browse, organised: a numbered track list (or the old poster grid), grouped the way you pick.
        // "Auto" = an artist search shows Popular + their releases one by one + other matches; anything else is a ranked list.
        const readPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
        const songView = ref(readPref('anicoop_song_view_v2', 'grid'));   // covers first, like every other section
        const songGroupBy = ref(readPref('anicoop_song_group', 'auto'));
        watch(songView, (v) => { try { localStorage.setItem('anicoop_song_view_v2', v); } catch {} });
        watch(songGroupBy, (v) => { try { localStorage.setItem('anicoop_song_group', v); } catch {} });
        const SONG_GROUPS = [{ v: 'auto', l: 'Auto' }, { v: 'none', l: 'Ranked list' }, { v: 'artist', l: 'Artist' }, { v: 'album', l: 'Album' }, { v: 'genre', l: 'Genre' }, { v: 'decade', l: 'Decade' }];
        const songBrowseGroups = computed(() => {
            if (section.value !== 'songs') return [];
            const items = visibleResults.value;
            const artist = songSearchArtist.value;
            const q = filters.value.search.trim();
            const bucket = (keyOf, labelOf = (k) => k) => {
                const m = new Map();
                items.forEach(s => { const k = keyOf(s) ?? '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
                return [...m.entries()].map(([k, list]) => ({ key: String(k), title: labelOf(k), items: list }));
            };
            const mode = songGroupBy.value;
            if (mode === 'auto' && artist && q) {
                const mine = (s) => s.artistId === artist.id || (s.artists[0] || '').toLowerCase() === artist.name.toLowerCase();
                const theirs = items.filter(mine), others = items.filter(s => !mine(s));
                const byAlbum = new Map();
                theirs.forEach(s => { const k = s.albumId || s.album || '—'; if (!byAlbum.has(k)) byAlbum.set(k, []); byAlbum.get(k).push(s); });
                const releases = [...byAlbum.values()]
                    .map(list => ({ key: 'al-' + (list[0].albumId || list[0].album), title: (list[0].album || 'Other songs').replace(/ - (Single|EP)$/, ''), sub: [list[0].seasonYear, /- Single$/.test(list[0].album || '') ? 'Single' : / - EP$/.test(list[0].album || '') ? 'EP' : list.length > 7 ? 'Album' : null].filter(Boolean).join(' · '), cover: list[0].coverImage?.large, year: list[0].seasonYear || 0, items: list.sort(sortTracks), trackNo: true }))
                    .sort((a, b) => (b.items.length > 1) - (a.items.length > 1) || b.year - a.year);
                return [
                    theirs.length && { key: 'popular', title: 'Popular', sub: artist.name, items: theirs.slice(0, 10), ranked: true },
                    ...releases,
                    others.length && { key: 'others', title: `Other songs matching “${q}”`, items: others, ranked: true },
                ].filter(Boolean);
            }
            if (mode === 'artist') return bucket(s => s.artists[0] || '—').sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title));
            if (mode === 'album') return bucket(s => s.album || '—', k => String(k).replace(/ - (Single|EP)$/, '')).map(g => ({ ...g, cover: g.items[0].coverImage?.large, sub: [g.items[0].artists[0], g.items[0].seasonYear].filter(Boolean).join(' · '), items: [...g.items].sort(sortTracks), trackNo: true })).sort((a, b) => b.items.length - a.items.length);
            if (mode === 'genre') return bucket(s => s.genres[0] || 'Other').sort((a, b) => b.items.length - a.items.length);
            if (mode === 'decade') return bucket(s => s.seasonYear ? Math.floor(s.seasonYear / 10) * 10 : 'Unknown', k => typeof k === 'number' ? `${k}s` : k).sort((a, b) => (parseInt(b.key) || 0) - (parseInt(a.key) || 0));
            return [{ key: 'all', title: '', items, ranked: true }];
        });
        // an actor (TMDB person) in the same shape as an AniList staff page
        const loadActor = async (id) => {
            const x = await tmdbCall(`person/${id}`, { append_to_response: 'combined_credits,external_ids' });
            if (!x?.id) return null;
            const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? { year: +m[1], month: +m[2], day: +m[3] } : null; };
            const born = x.birthday ? new Date(x.birthday) : null, end = x.deathday ? new Date(x.deathday) : new Date();
            const age = born ? Math.floor((end - born) / 31557600000) : null;
            const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
            const seen = new Set();
            const acting = (x.combined_credits?.cast || []).filter(c => (c.media_type === 'movie' || c.media_type === 'tv') && c.poster_path && tvKeep({})(c) && !seen.has(c.media_type + c.id) && seen.add(c.media_type + c.id))
                .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 40)
                .map(c => ({ media: normTmdb(c, c.media_type), character: c.character || '', episodes: c.episode_count || null }));
            const crewSeen = new Map();
            (x.combined_credits?.crew || []).filter(c => (c.media_type === 'movie' || c.media_type === 'tv') && c.poster_path && tvKeep({})(c)).forEach(c => {
                const k = c.media_type + c.id; const cur = crewSeen.get(k) || { media: normTmdb(c, c.media_type), roles: [], votes: c.vote_count || 0 }; cur.roles.push(c.job); crewSeen.set(k, cur);
            });
            return {
                id, tmdbId: id, name: { full: x.name, native: null, alternative: x.also_known_as || [] }, image: { large: TMDB_IMG(x.profile_path, 'h632') },
                description: x.biography ? x.biography.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('') : '',
                primaryOccupations: x.known_for_department ? [x.known_for_department === 'Acting' ? 'Actor' : x.known_for_department] : [],
                gender: ({ 1: 'Female', 2: 'Male', 3: 'Non-binary' })[x.gender] || null, age, dateOfBirth: ymd(x.birthday), dateOfDeath: ymd(x.deathday), homeTown: x.place_of_birth || null,
                imdb: x.external_ids?.imdb_id ? `https://www.imdb.com/name/${x.external_ids.imdb_id}/` : null, tmdbUrl: `https://www.themoviedb.org/person/${id}`,
                instagram: x.external_ids?.instagram_id ? `https://www.instagram.com/${x.external_ids.instagram_id}/` : null,
                acting, crew: [...crewSeen.values()].sort((a, b) => b.votes - a.votes).slice(0, 16),
            };
        };
        const loadEntity = async (e) => {
            const key = e.type + ':' + e.id;
            if (entityCache.has(key)) { entityData.value = entityCache.get(key); return; }
            entityData.value = null; entityLoading.value = true;
            try {
                if (e.type === 'actor' || e.type === 'artist') {
                    const raw = e.type === 'actor' ? await loadActor(e.id) : await songApi.artist(e.id, artistNameHint[e.id] || null);
                    if (!raw) throw new Error(e.type === 'artist' ? 'That artist could not be found on Apple Music' : 'That person could not be found on TMDB');
                    const { extras, more, ...d } = raw;
                    entityCache.set(key, d);
                    const here = () => entity.value?.id === e.id && entity.value?.type === e.type;
                    if (here()) entityData.value = d;
                    // artists: the photo + bio and the full song list fill in as they arrive (the page is already showing)
                    const merge = (x) => { const cur = entityCache.get(key) || d; const next = { ...cur, ...x, image: x.image || cur.image }; entityCache.set(key, next); if (here()) entityData.value = next; };
                    extras?.then(x => merge({ ...x, extrasPending: false })).catch(() => merge({ extrasPending: false }));
                    more?.then(x => { if (x) merge(x); }).catch(() => {});
                    return;
                }
                if (e.type === 'album') {
                    const d = await songApi.albumPage(e.id);
                    if (!d) throw new Error('That album could not be found on Apple Music');
                    entityCache.set(key, d);
                    if (entity.value?.id === e.id && entity.value?.type === e.type) entityData.value = d;
                    return;
                }
                const data = await anilist(e.type === 'character' ? CHARACTER_QUERY : STAFF_QUERY, { id: e.id });
                const d = e.type === 'character' ? data?.Character : data?.Staff;
                if (!d) throw new Error('Not found on AniList');
                entityCache.set(key, d);
                if (entity.value?.id === e.id && entity.value?.type === e.type) entityData.value = d;
            } catch (err) { showToast(err.message || 'Could not load', 'error'); }
            finally { entityLoading.value = false; }
        };
        watch(entity, (e) => { if (e) loadEntity(e); else entityData.value = null; });
        const entityIsActor = computed(() => entity.value?.type === 'actor');
        const entityIsVA = computed(() => entity.value?.type === 'staff' && ((entityData.value?.characterMedia?.edges || []).length > 0 || (entityData.value?.primaryOccupations || []).includes('Voice Actor')));
        const entityInfo = computed(() => {
            const d = entityData.value; if (!d) return [];
            const rows = [
                d.primaryOccupations?.length && ['Occupation', d.primaryOccupations.join(', ')],
                d.age && ['Age', d.age],
                d.gender && ['Gender', d.gender],
                fmtDate(d.dateOfBirth) && ['Birthday', fmtDate(d.dateOfBirth)],
                fmtDate(d.dateOfDeath) && ['Died', fmtDate(d.dateOfDeath)],
                d.bloodType && ['Blood type', d.bloodType],
                d.yearsActive?.length && ['Years active', d.yearsActive[0] + (d.yearsActive[1] ? ' – ' + d.yearsActive[1] : ' – now')],
                d.homeTown && ['Hometown', d.homeTown],
                d.languageV2 && entity.value?.type === 'staff' && ['Language', d.languageV2],
                d.favourites && ['Favorites on AniList', d.favourites.toLocaleString()],
                d.acting?.length && ['Credits', `${d.acting.length}${d.acting.length >= 40 ? '+' : ''} movies & shows`],
                d.isArtist && d.about && ['About', d.about],
                d.isArtist && d.genre && ['Genre', d.genre],
                d.isArtist && d.fans && ['Fans on Deezer', d.fans.toLocaleString()],
                d.isArtist && d.albumCount && ['Albums', artistDiscog.value?.kinds.find(k => k.id === 'Album')?.items.length || d.albumCount],
                d.isArtist && d.songCount && ['Songs', d.songCount + (d.songCount >= 200 ? '+' : '')],
                d.isArtist && d.active && ['Active', d.active],
                d.name?.alternative?.filter(Boolean).length && ['Also known as', d.name.alternative.filter(Boolean).slice(0, 4).join(', ')],
            ];
            return rows.filter(Boolean).map(([k, v]) => ({ k, v }));
        });
        const entityRoles = computed(() => {
            const d = entityData.value; if (!d) return { appearances: [], voice: [], production: [] };
            const appearances = (d.media?.edges || []).map(e => ({ media: normMedia(e.node), role: e.characterRole, va: e.voiceActors?.[0] || null }));
            const voice = (d.characterMedia?.edges || []).flatMap(e => (e.characters || []).filter(Boolean).map(c => ({ key: c.id + '-' + e.node.id, character: c, media: normMedia(e.node), role: e.characterRole })));
            const byMedia = new Map();
            (d.staffMedia?.edges || []).forEach(e => { const cur = byMedia.get(e.node.id) || { media: normMedia(e.node), roles: [] }; cur.roles.push(e.staffRole); byMedia.set(e.node.id, cur); });
            return { appearances, voice, production: [...byMedia.values()] };
        });
        const toggleEntityFav = () => {
            const d = entityData.value; if (!d) return;
            if (entity.value.type === 'character') toggleFavChar(d);
            else if (entity.value.type === 'artist') toggleFavStaff({ id: -Number(d.id), name: { full: d.name?.full }, image: { large: d.image?.large } }, 'staff');   // singers: saved with a minus id (Apple artist ids can't clash with anything)
            else if (entity.value.type === 'actor') toggleFavStaff({ ...d, id: PERSON_BASE + d.tmdbId }, 'staff');
            else toggleFavStaff(d, entityIsVA.value ? 'va' : 'staff');
        };
        const entityIsFav = computed(() => entityData.value && (entity.value?.type === 'character' ? isFavChar(entityData.value.id)
            : isFavStaff(entity.value?.type === 'actor' ? PERSON_BASE + entityData.value.tmdbId : entity.value?.type === 'artist' ? -Number(entityData.value.id) : entityData.value.id)));

        // "Show all" characters / staff on an anime page
        const detailMore = reactive({ chars: false, staff: false, loading: '' });
        watch(() => selectedAnime.value?.id, () => { detailMore.chars = false; detailMore.staff = false; detailMore.loading = ''; showAllEpisodes.value = false; });
        const loadAllCredits = async (what) => {
            const a = selectedAnime.value; if (!a || detailMore.loading) return;
            const key = what === 'chars' ? 'characters' : 'staff';
            if (a[key]?.all) { detailMore[what] = !detailMore[what]; return; }
            detailMore.loading = what;
            try {
                const edges = [];
                for (let page = 1; page < 15; page++) {
                    const q = what === 'chars'
                        ? `query ($id: Int, $p: Int) { Media(id: $id) { characters(page: $p, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) { pageInfo { hasNextPage } edges { role node { id name { full } image { large } } voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full } image { large } } } } } }`
                        : `query ($id: Int, $p: Int) { Media(id: $id) { staff(page: $p, perPage: 25, sort: [RELEVANCE, ID]) { pageInfo { hasNextPage } edges { role node { id name { full } image { large } } } } } }`;
                    const data = await anilist(q, { id: a.id, p: page });
                    const conn = data?.Media?.[key];
                    edges.push(...(conn?.edges || []));
                    if (!conn?.pageInfo?.hasNextPage) break;
                    await sleep(350);
                }
                if (selectedAnime.value?.id !== a.id) return;
                selectedAnime.value = { ...selectedAnime.value, [key]: { edges, all: true, pageInfo: { hasNextPage: false } } };
                detailCache.set(a.id, selectedAnime.value);
                detailMore[what] = true;
            } catch (err) { showToast(err.message || 'Could not load', 'error'); }
            finally { detailMore.loading = ''; }
        };

        // ---------- WATCH: episode list → straight to Crunchyroll (or wherever AniList links) ----------
        const showAllEpisodes = ref(false);
        const detailEpisodes = computed(() => {
            const seen = new Set();
            return (selectedAnime.value?.streamingEpisodes || []).filter(e => e?.url && !seen.has(e.url) && seen.add(e.url)).map((e, i) => {
                const m = /(?:episode|ep\.?|#)\s*(\d+)/i.exec(e.title || '');
                const name = (e.title || '').replace(/^\s*(?:episode|ep\.?)\s*\d+\s*[-–:.]?\s*/i, '').trim();
                return { ...e, n: m ? Number(m[1]) : null, name, i };
            }).sort((a, b) => (a.n ?? 1e6) - (b.n ?? 1e6) || a.i - b.i);
        });
        const watchLinks = computed(() => (selectedAnime.value?.externalLinks || []).filter(l => l.type === 'STREAMING' && l.url));
        // More legal places to watch an anime: official free YouTube channels (region-locked) + JustWatch for your country
        const moreWatch = computed(() => {
            const a = selectedAnime.value; if (!a || a.type !== 'ANIME') return [];
            const q = encodeURIComponent(a.title?.english || a.title?.romaji || titleOf(a));
            const cc = (/-([A-Z]{2})$/.exec(navigator.language || '') || [])[1]?.toLowerCase() || 'us';
            return [
                { id: 'muse', site: 'Muse Asia (free, YouTube)', url: `https://www.youtube.com/@MuseAsia/search?query=${q}`, color: '#e11d48', icon: 'fa-brands fa-youtube' },
                { id: 'anione', site: 'Ani-One Asia (free, YouTube)', url: `https://www.youtube.com/@AniOneAsia/search?query=${q}`, color: '#e11d48', icon: 'fa-brands fa-youtube' },
                { id: 'jw', site: 'Everywhere it streams in your country (JustWatch)', url: `https://www.justwatch.com/${cc}/search?q=${q}`, color: '#1c2b3a', icon: 'fa-solid fa-magnifying-glass' },
            ];
        });

        // ---------- manga & manhwa: where to read + chapter list (MangaDex), like picking a source in Mihon ----------
        const reader = reactive({ id: null, lang: 'en', chapters: [], total: 0, loading: false, error: '', shown: 40 });
        const MD_LINKS = {
            engtl: ['Official English', null], raw: ['Original (raw)', null], bw: ['BookWalker', 'https://bookwalker.jp/{}'], amz: ['Amazon', null],
            ebj: ['eBookJapan', null], cdj: ['CDJapan', null], mu: ['MangaUpdates', 'https://www.mangaupdates.com/series/{}'],
        };
        const LANG_NAMES = { en: 'English', 'es-la': 'Spanish (LatAm)', es: 'Spanish', 'pt-br': 'Portuguese (BR)', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ru: 'Russian', id: 'Indonesian', vi: 'Vietnamese', tr: 'Turkish', ar: 'Arabic', pl: 'Polish', th: 'Thai', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-hk': 'Chinese (HK)' };
        const readInfo = computed(() => selectedAnime.value?.type === 'MANGA' ? mangaInfo[selectedAnime.value.id] || null : null);
        const readLangs = computed(() => { const l = readInfo.value?.langs || []; return [...new Set(['en', ...l])].filter(x => l.includes(x) || x === 'en').map(v => ({ v, l: LANG_NAMES[v] || v })); });
        // official reading sites from AniList + MangaDex's links + MangaDex itself (one per website)
        const readSources = computed(() => {
            const a = selectedAnime.value; if (!a || a.type !== 'MANGA') return [];
            const out = [];
            (a.externalLinks || []).filter(l => l.url && l.type !== 'SOCIAL').forEach(l => out.push({ id: 'al' + l.id, site: l.site, url: l.url, color: l.color || '#3b82f6', icon: l.icon || null, note: l.language || (l.type === 'STREAMING' ? 'official' : '') }));
            const info = readInfo.value;
            Object.entries(info?.links || {}).forEach(([k, v]) => {
                const def = MD_LINKS[k]; if (!def || !v) return;
                const url = /^https?:\/\//.test(v) ? v : def[1] ? def[1].replace('{}', v) : null;
                if (url) out.push({ id: 'md-' + k, site: def[0], url, color: k === 'engtl' ? '#22c55e' : '#52525b', note: k === 'raw' ? 'original language' : '' });
            });
            if (info?.md) out.push({ id: 'mdx', site: 'MangaDex', url: `https://mangadex.org/title/${info.md}`, color: '#ff6740', note: 'all chapters' });
            const seen = new Set();
            return out.filter(s => { let h = s.url; try { h = new URL(s.url).hostname.replace(/^www\./, ''); } catch {} if (seen.has(h)) return false; seen.add(h); return true; });
        });
        const loadChapters = async (more = false) => {
            const a = selectedAnime.value; const info = readInfo.value;
            if (!a || !info?.md) return;
            reader.loading = true; reader.error = '';
            try {
                const d = await mangaDex({ kind: 'chapters', md: info.md, lang: reader.lang, offset: more ? reader.chapters.length : 0 });
                if (reader.id !== a.id) return;
                reader.chapters = more ? [...reader.chapters, ...(d.chapters || [])] : (d.chapters || []);
                reader.total = d.total || 0;
                if (!more) reader.shown = 40;
            } catch (err) { reader.error = err.status === 400 ? 'Update the “igdb” Edge Function in Supabase to load chapters (see README).' : (err.message || 'Could not load chapters'); }
            finally { reader.loading = false; }
        };
        const shownChapters = computed(() => chapterList.value.slice(0, reader.shown));
        const showMoreChapters = () => { reader.shown += 40; if (readSrc.value === 'mangadex' && reader.shown > reader.chapters.length && reader.chapters.length < reader.total) loadChapters(true); };
        const chapterUrl = (c) => c.url || `https://mangadex.org/chapter/${c.id}`;
        const chapterRead = (c) => { const e = myEntry(selectedAnime.value?.id); const n = parseFloat(c.ch); return !!e && !Number.isNaN(n) && (e.status === 'COMPLETED' || (e.progress || 0) >= n); };
        watch(() => selectedAnime.value?.type === 'MANGA' ? selectedAnime.value.id : null, (id) => {
            Object.assign(reader, { id, chapters: [], total: 0, error: '', lang: 'en', shown: 40 });
            if (id) needMangaInfo(selectedAnime.value);
        });
        watch(() => reader.id && readInfo.value?.md, (md) => { if (md) loadChapters(); });
        watch(() => reader.lang, () => { if (reader.id) loadChapters(); });

        // ---------- Extensions + in-app reader (Mihon-style) ----------
        // anicoop itself has no manga. Install an extension to read in the app:
        //  • MangaDex: MangaDex's official API (it allows third-party readers); pages stream from MangaDex's own image servers
        //  • Local files: CBZ / ZIP archives or images from your device, opened in the browser — nothing is uploaded
        // the Read / Watch window on a title page (sources + chapters / episodes)
        const wp = reactive({ open: false, season: 1 });
        const EXTENSIONS = [
            { id: 'mangadex', kinds: ['manga'], name: 'MangaDex', icon: 'fa-book-open-reader', color: '#ff6740', lang: 'Multi-language', version: '1.0',
              desc: 'Read MangaDex chapters right here, no ads or trackers. Official releases that MangaDex only links to still open on the publisher’s site.' },
            { id: 'local', kinds: ['manga'], name: 'Local files', icon: 'fa-file-zipper', color: '#3b82f6', lang: 'Any', version: '1.0',
              desc: 'Open CBZ / ZIP comic archives or a set of images from your device. Stays on your device, nothing is uploaded.' },
            { id: 'archive', kinds: ['tv'], name: 'Internet Archive', icon: 'fa-building-columns', color: '#71717a', lang: 'Multi-language', version: '1.0',
              desc: 'Public-domain and freely licensed films and shows (classics, old cartoons, documentaries), played straight from archive.org with no ads.' },
            { id: 'youtube', kinds: ['anime', 'tv'], name: 'YouTube', icon: 'fa-play', color: '#ff0033', lang: 'Multi-language', version: '1.0',
              desc: 'Full episodes and films that studios and distributors post for free on YouTube (Muse Asia, Ani-One, TMS, GundamInfo and others), played in YouTube’s own player. Not every title is there.' },
            { id: 'localvideo', kinds: ['anime', 'tv'], name: 'Local video files', icon: 'fa-file-video', color: '#3b82f6', lang: 'Any', version: '1.0',
              desc: 'Play an MP4 / WebM file from your device. Stays on your device, nothing is uploaded.' },
        ];
        // which section the Extensions window is managing, and the title it was opened from ("Find readable sources" checks that title)
        const extOpen = ref(false);
        const extKind = ref('manga');
        const extFor = ref(null);
        const extList = computed(() => EXTENSIONS.filter(x => x.kinds.includes(extKind.value)));
        const extOn = (id) => (PREFS.extensions || []).includes(id);
        const toggleExt = (id) => {
            const on = extOn(id);
            PREFS.extensions = on ? PREFS.extensions.filter(x => x !== id) : [...(PREFS.extensions || []), id];
            showToast(on ? `${EXTENSIONS.find(e => e.id === id)?.name} removed` : `${EXTENSIONS.find(e => e.id === id)?.name} installed`);
            if (!on && wp.open && readTabs.value.some(t => t.id === id)) readSrc.value = id;
        };
        // 18+ sources only show (and install) while the 18+ filter is switched on
        const adultOn = computed(() => adultAllowed.value && !!filters.value.isAdult);
        const playKind = computed(() => MEDIA_KIND[selectedAnime.value?.type] || null);
        // ---- website sources: add / remove / install from a repository ----
        const siteSources = computed(() => PREFS.sources || []);
        const kindOf = (s) => s?.kind || 'manga';
        const kindSources = (k) => siteSources.value.filter(s => kindOf(s) === k && (!s.nsfw || adultOn.value));
        const extSources = computed(() => kindSources(extKind.value));
        const srcForm = reactive({ name: '', baseUrl: '', template: 'auto', selectors: '', busy: false, msg: '', repo: '', repoItems: [], repoName: '', repoBusy: false, repoMsg: '', repoQ: '', repoLang: 'all', repoKind: null });
        const makeSource = (x) => {
            let u; try { u = new URL(String(x.baseUrl || '').trim()); } catch { throw new Error('Enter the site’s full address, e.g. https://example.com'); }
            if (!/^https?:$/.test(u.protocol)) throw new Error('The address must start with http:// or https://');
            let selectors = x.selectors || null;
            if (typeof selectors === 'string' && selectors.trim()) { try { selectors = JSON.parse(selectors); } catch { throw new Error('Custom selectors must be valid JSON.'); } }
            const template = SOURCE_TEMPLATES[x.template] ? x.template : 'custom';
            if (template === 'custom' && !selectors?.search?.item) throw new Error('A custom source needs at least search.url, search.item, chapters.item and pages.image.');
            return { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(x.name || u.hostname.replace(/^www\./, '')).slice(0, 40),
                baseUrl: (u.origin + u.pathname).replace(/\/+$/, ''), template, lang: x.lang || 'en', selectors: typeof selectors === 'object' ? selectors : null, repo: x.repo || null,
                kind: x.kind || extKind.value, nsfw: !!x.nsfw };
        };
        // "Auto-detect": look at the site's homepage to see which template it runs
        const withTemplate = async (x) => {
            if (x.template !== 'auto') return x;
            let base; try { base = new URL(String(x.baseUrl || '').trim()).href; } catch { throw new Error('Enter the site’s full address, e.g. https://example.com'); }
            const t = await detectTemplate(base, x.kind || extKind.value);
            if (!t) throw new Error('Couldn’t tell which template this site uses. It may use its own custom code, so it can’t be read here. You can still pick Custom and enter selectors.');
            if (x === srcForm) srcForm.template = t;
            return { ...x, template: t };
        };
        const addSource = async (x = srcForm, { quiet = false } = {}) => {
            try { x = await withTemplate(x); } catch (err) { srcForm.msg = err.message; return null; }
            let s; try { s = makeSource(x); } catch (err) { srcForm.msg = err.message; return null; }
            if (siteSources.value.some(o => o.baseUrl === s.baseUrl && kindOf(o) === s.kind)) { srcForm.msg = `${s.name} is already installed.`; return null; }
            PREFS.sources = [...siteSources.value, s];
            if (!quiet) { showToast(`${s.name} installed`); Object.assign(srcForm, { name: '', baseUrl: '', selectors: '', msg: '', template: 'auto' }); }
            if (playKind.value === s.kind && !readSrc.value) readSrc.value = s.id;
            return s;
        };
        // quick test before installing: search the site for a common word and count the results
        const testSource = async () => {
            srcForm.busy = true; srcForm.msg = 'Testing…';
            try {
                const x = await withTemplate(srcForm);
                const s = makeSource(x);
                const r = await sourceApi.search(s, 'the');
                srcForm.msg = r.length ? `✓ Works (${SOURCE_TEMPLATES[s.template].label.split(' (')[0]}): found ${r.length} titles, e.g. “${r[0].title}”.` : 'The site answered, but no titles were found. Check the address or try the other template.';
            }
            catch (err) { srcForm.msg = friendlyErr(err); }
            finally { srcForm.busy = false; }
        };
        const removeSource = (id) => {
            const s = siteSources.value.find(x => x.id === id);
            PREFS.sources = siteSources.value.filter(x => x.id !== id);
            if (readSrc.value === id) readSrc.value = readTabs.value[0]?.id || null;
            if (s) showToast(`${s.name} removed`);
        };
        // Repositories. Understands Mihon / Tachiyomi / Aniyomi repos (new index.json, old index.min.json) and anicoop's own format:
        //   { "name": "...", "sources": [{ "name", "baseUrl", "template", "lang", "selectors"? }] }
        // Their extensions are Android code we can't run, but each one names its website. Many of those sites are built
        // on a few common WordPress themes, which anicoop reads natively — so installing checks the site first.
        const repoCandidates = (raw) => {
            const u = raw.trim().replace(/[?#].*$/, '');
            const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i.exec(u);
            if (gh) { const b = `https://raw.githubusercontent.com/${gh[1]}/${gh[2].replace(/\.git$/, '')}/repo`; return [b + '/index.json', b + '/index.min.json']; }
            if (/\/repo\.json$/i.test(u)) return [u.replace(/repo\.json$/i, 'index.json'), u.replace(/repo\.json$/i, 'index.min.json')];
            if (/\/index\.min\.json$/i.test(u)) return [u, u.replace(/index\.min\.json$/i, 'index.json')];   // old file first, newer one if it's a stub
            if (/\.json$/i.test(u)) return [u];
            const b = u.replace(/\/+$/, ''); return [b + '/index.json', b + '/index.min.json', b + '/repo/index.json'];
        };
        const STUB = /^(outdated app|update to mihon)/i;   // placeholder entries old repo files keep for outdated apps
        const readRepo = (j, url) => {
            let items = [];
            if (j?.extensionList?.extensions) {          // Mihon 0.20+ index.json
                items = j.extensionList.extensions.flatMap(x => (x.sources || []).map(s => ({ name: s.name, baseUrl: s.homeUrl, lang: s.language, ext: x.name, icon: x.resources?.iconUrl || null, nsfw: /NSFW/i.test(x.contentWarning || '') })));
            } else if (Array.isArray(j) && j.some(x => x?.pkg)) {   // Tachiyomi / Aniyomi index.min.json
                items = j.flatMap(x => (x.sources || []).map(s => ({ name: s.name, baseUrl: s.baseUrl, lang: s.lang, ext: x.name, icon: null, nsfw: x.nsfw === 1 })));
            } else {                                                  // anicoop format
                items = (Array.isArray(j) ? j : (j?.sources || j?.extensions || [])).map(x => ({ ...x, nsfw: !!x.nsfw }));
            }
            const seen = new Set();
            items = items.filter(x => x?.baseUrl && /^https?:\/\//.test(x.baseUrl) && !STUB.test(x.name || '') && !seen.has(x.baseUrl + '|' + x.lang) && seen.add(x.baseUrl + '|' + x.lang)).map(x => ({ ...x, repo: url }));
            return { name: j?.name || j?.meta?.name || (() => { try { return new URL(url).pathname.split('/')[2] || new URL(url).hostname; } catch { return 'Repository'; } })(), items };
        };
        const getText = async (url) => {
            try { const r = await fetch(url); if (r.ok) return await r.text(); if (r.status === 404) return null; } catch {}   // GitHub raw files allow direct reads
            try { const d = await siteFetch(url); return d.body; } catch { return null; }
        };
        const loadRepo = async () => {
            const raw = srcForm.repo.trim(); if (!raw) return;
            Object.assign(srcForm, { repoBusy: true, repoItems: [], repoName: '', repoMsg: '', repoQ: '', repoKind: extKind.value });
            try {
                let found = null;
                for (const url of repoCandidates(raw)) {
                    const text = await getText(url); if (!text) continue;
                    let j; try { j = JSON.parse(text); } catch { continue; }
                    const r = readRepo(j, url);
                    if (r.items.length) { found = r; break; }
                }
                if (!found) { srcForm.repoMsg = 'No sources found there. Use the repository’s link (a GitHub repo page, or its index.json / index.min.json file). Some old repos have been taken down.'; return; }
                srcForm.repoName = found.name; srcForm.repoItems = found.items;
                // remembered per section, so the list is back next time you open Extensions
                PREFS.repos = { ...(PREFS.repos || {}), [extKind.value]: raw };
                const langs = new Set(found.items.map(x => x.lang));
                srcForm.repoLang = langs.has('en') ? 'en' : 'all';
            } finally { srcForm.repoBusy = false; }
        };
        const repoLangs = computed(() => [...new Set(srcForm.repoItems.map(x => x.lang || 'all'))].sort());
        // Which template a site runs, from its homepage: known themes by their markers, otherwise the
        // Generic smart fallback if a test search finds real titles.
        // Sites behind Cloudflare's bot check can't be read from a server (Mihon solves that check inside the phone's browser).
        const CF_MSG = 'Protected by Cloudflare’s bot check. Only the Mihon app can pass it, so it can’t be read here.';
        const SELF_MSG = 'Self-hosted: this source runs on your own computer (e.g. Komga / Jellyfin), not on the internet.';
        const UNSUP_MSG = (k) => k === 'manga' ? 'Not readable here: this site needs its own Android extension code' : 'Can’t play here: this site needs its own Android extension code';
        const isPrivateHost = (u) => { try { return /^(localhost|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(new URL(u).hostname); } catch { return true; } };
        const friendlyErr = (err) => /cloudflare|blocked the request/i.test(err?.message || '') ? CF_MSG
            : /answered 5\d\d|could not reach|network/i.test(err?.message || '') ? 'The site is down or unreachable right now.' : (err?.message || 'Could not reach the site');
        const detectTemplate = async (baseUrl, kind = 'manga') => {
            if (isPrivateHost(baseUrl)) throw new Error(SELF_MSG);
            let h = '';
            try { h = (await siteFetch(baseUrl)).body || ''; }
            catch (err) { throw new Error(friendlyErr(err)); }
            if (/<title>\s*just a moment|cf-chl-|challenge-platform|cf_chl_opt/i.test(h)) throw new Error(CF_MSG);
            const probe = async (template) => { try { return (await sourceApi.search({ id: 'probe', name: 'probe', baseUrl: baseUrl.replace(/\/+$/, ''), template }, 'the')).length >= 3; } catch { return false; } };
            if (kind !== 'manga') {
                if (/themes\/animestream|class="eplister|class="mirror"|animestream|class="bixbox/i.test(h)) return 'animestream';
                if (/themes\/dooplay|dooplay|doo_player|dtAjax/i.test(h)) return 'dooplay';
                return (await probe('genericvideo')) ? 'genericvideo' : null;
            }
            if (/wp-manga|themes\/madara|manga_get_chapters|c-tabs-item|madara/i.test(h)) return 'madara';
            if (/ts_reader|mangathemesia|themes\/mangareader|class="listupd|themesia/i.test(h)) return 'mangathemesia';
            return (await probe('generic')) ? 'generic' : null;
        };
        // does a chapter give page images / an episode give a player?
        const opensHere = async (s, list) => {
            for (const c of [list[list.length - 1], list[0], list[Math.floor(list.length / 2)]].filter((c, n, all) => c && all.indexOf(c) === n).slice(0, 2)) {
                try { if (isVideoSrc(s) ? (await sourceApi.videos(s, c.link)).length : (await sourceApi.pages(s, c.link)).length >= 2) return true; } catch {}
            }
            return false;
        };
        // general check (no title picked): the template must find titles, a chapter list AND pages
        const verifySource = async (x, template) => {
            const s = { id: 'probe', name: x.name, baseUrl: x.baseUrl.replace(/\/+$/, ''), template };
            let results = [];
            for (const q of ['the', 'a', 'love']) { results = await sourceApi.search(s, q); if (results.length) break; }
            for (const r of results.slice(0, 2)) {
                const ch = await sourceApi.chapters(s, r.url);
                if (ch.length && await opensHere(s, ch)) return 'ok';
            }
            return 'unsupported';
        };
        // title check ("Find readable sources" from a manga / anime / movie): the site has to have THIS title — under its
        // own name, one of its "Also known as" names, or the site's alternative names — and it has to open here
        const pendingMatch = {};   // "titleId|baseUrl" → the match found, saved to the source when you install it
        const verifyTitle = async (x, template, a) => {
            const s = { id: 'probe', name: x.name, baseUrl: x.baseUrl.replace(/\/+$/, ''), template };
            const { match } = await findTitleOn(s, a);
            if (!match) return 'notfound';
            const list = await sourceApi.chapters(s, match.url);
            if (!list.length || !(await opensHere(s, list))) return 'noopen';
            pendingMatch[`${a.id}|${x.baseUrl}`] = { url: match.url, title: match.title, cover: match.cover || null };
            return 'ok';
        };
        // site checks are remembered for a week (a site that can't be read stays that way); title checks for this visit
        const CHECK_KEY = 'anicoop_srccheck_v1';
        const repoState = reactive(Object.fromEntries(Object.entries(readJSON(CHECK_KEY) || {}).filter(([, v]) => Date.now() - v.at < 7 * 864e5).map(([k, v]) => [k, v.v])));   // baseUrl → 'checking' | 'unsupported' | 'ok:<template>' | message
        watch(repoState, debounce(() => {
            try { localStorage.setItem(CHECK_KEY, JSON.stringify(Object.fromEntries(Object.entries(repoState).filter(([, v]) => v && v !== 'checking').map(([k, v]) => [k, { v, at: Date.now() }])))); } catch {}
        }, 1500), { deep: true });
        const titleState = reactive({});   // "titleId|baseUrl" → 'checking' | 'ok' | 'notfound' | 'noopen'
        const titleKey = (x) => `${extFor.value?.id}|${x.baseUrl}`;
        const tplName = (x) => (SOURCE_TEMPLATES[String(repoState[x.baseUrl] || '').slice(3)] || {}).label?.split(' (')[0] || '';
        // one status per repository row: { st: 'ok' | 'checking' | 'bad' | 'site' | 'none', text }
        const srcStatus = (x) => {
            const site = repoState[x.baseUrl]; const t = extFor.value ? titleState[titleKey(x)] : null;
            if (t === 'checking' || (!t && site === 'checking')) return { st: 'checking', text: 'Checking…' };
            if (site && site !== 'checking' && !site.startsWith('ok:')) return { st: 'bad', text: site === 'unsupported' ? UNSUP_MSG(extKind.value) : site };
            if (extFor.value) {
                const name = titleOf(extFor.value);
                if (t === 'ok') return { st: 'ok', text: `✓ Has “${name}” · ${extKind.value === 'manga' ? 'readable' : 'plays'} here` };
                if (t === 'notfound') return { st: 'bad', text: `Doesn’t have “${name}” (its other names were checked too)` };
                if (t === 'noopen') return { st: 'bad', text: `Has “${name}”, but its ${extKind.value === 'manga' ? 'chapters don’t open' : 'episodes don’t play'} here` };
                if (site?.startsWith('ok:')) return { st: 'site', text: `Works here (${tplName(x)}) · not checked for this title yet` };
                return { st: 'none', text: x.baseUrl };
            }
            if (site?.startsWith('ok:')) return { st: 'ok', text: `✓ ${extKind.value === 'manga' ? 'Readable' : 'Plays'} here · ${tplName(x)}` };
            return { st: 'none', text: x.baseUrl };
        };
        const repoOk = (x) => srcStatus(x).st === 'ok';
        const repoInstalled = (x) => siteSources.value.some(o => o.baseUrl === String(x.baseUrl || '').replace(/\/+$/, '') && kindOf(o) === extKind.value);
        const repoScan = reactive({ running: false, done: 0, total: 0, found: 0, onlyOk: false });
        const repoShown = computed(() => {
            if (srcForm.repoKind !== extKind.value) return [];
            const q = normTitle(srcForm.repoQ);
            const seen = new Set();   // one row per site (a site is often listed for "all" and for one language)
            const rank = (x) => { const st = srcStatus(x).st; return repoInstalled(x) ? 0 : st === 'ok' ? 1 : st === 'bad' ? 3 : 2; };   // readable first, failed checks last
            return srcForm.repoItems.filter(x => (srcForm.repoLang === 'all' || x.lang === srcForm.repoLang || x.lang === 'all') && (!x.nsfw || adultOn.value) && (!q || normTitle(x.name).includes(q) || normTitle(x.baseUrl).includes(q)) && !seen.has(x.baseUrl) && seen.add(x.baseUrl))
                .filter(x => !repoScan.onlyOk || repoInstalled(x) || repoOk(x)).sort((a, b) => rank(a) - rank(b));
        });
        const installRepoItem = async (x) => {
            if (x.nsfw && !adultOn.value) return;
            const a = extFor.value;
            const remember = (s) => { const m = a && pendingMatch[`${a.id}|${x.baseUrl}`]; if (s && m) { srcMatches[`${a.id}:${s.id}`] = m; saveMatches(); } };
            if (x.template || x.selectors) { const s = await addSource({ ...x, kind: extKind.value }, { quiet: true }); if (s) { remember(s); showToast(`${x.name || 'Source'} installed`); } else if (srcForm.msg) showToast(srcForm.msg, 'error'); return; }
            const known = String(repoState[x.baseUrl] || '').startsWith('ok:') ? String(repoState[x.baseUrl]).slice(3) : null;
            repoState[x.baseUrl] = 'checking';
            try {
                const template = known || await detectTemplate(x.baseUrl, extKind.value);
                if (!template) { repoState[x.baseUrl] = 'unsupported'; return; }
                // anime / movie sites: only install one whose episodes really play here (many hide their players behind code of their own)
                if (extKind.value !== 'manga') {
                    if (a) {
                        const key = `${a.id}|${x.baseUrl}`;
                        if (titleState[key] !== 'ok') { titleState[key] = 'checking'; titleState[key] = await verifyTitle(x, template, a).catch(() => 'notfound'); }
                        if (titleState[key] !== 'ok') { repoState[x.baseUrl] = 'ok:' + template; showToast(`${x.name} doesn’t play “${titleOf(a)}” here`, 'error'); return; }
                    } else if (!known && (await verifySource(x, template)) !== 'ok') { repoState[x.baseUrl] = 'unsupported'; showToast(`${x.name}'s episodes don’t play here`, 'error'); return; }
                }
                repoState[x.baseUrl] = 'ok:' + template;
                const s = await addSource({ ...x, template, kind: extKind.value }, { quiet: true });
                if (s) { remember(s); showToast(`${x.name} installed (${SOURCE_TEMPLATES[template].label.split(' (')[0]})`); if (wp.open && playKind.value === s.kind) readSrc.value = s.id; }
                else showToast(srcForm.msg || 'Could not install', 'error');
            } catch (err) { repoState[x.baseUrl] = err.message || 'Could not reach the site'; }
        };
        // check every source in the current list (6 at a time) and pin the working ones to the top.
        // Opened from a title → each site is checked for THAT title, so it works again on the next title.
        const scanRepo = async () => {
            if (repoScan.running) { repoScan.running = false; return; }   // second press stops it
            const a = extFor.value; const kind = extKind.value;
            const list = repoShown.value.filter(x => !repoInstalled(x) && ['none', 'site'].includes(srcStatus(x).st));
            Object.assign(repoScan, { running: true, done: 0, total: list.length, found: 0, onlyOk: false });
            let k = 0;
            const worker = async () => {
                while (repoScan.running && k < list.length) {
                    const x = list[k++]; const key = a ? `${a.id}|${x.baseUrl}` : null;
                    try {
                        let site = String(repoState[x.baseUrl] || '');
                        if (!site.startsWith('ok:')) {
                            repoState[x.baseUrl] = 'checking';
                            const template = await detectTemplate(x.baseUrl, kind);
                            if (!template) { repoState[x.baseUrl] = 'unsupported'; continue; }
                            // without a title, "working" means a real chapter / episode opens; with one, the title check proves it
                            if (!a && (await verifySource(x, template)) !== 'ok') { repoState[x.baseUrl] = 'unsupported'; continue; }
                            repoState[x.baseUrl] = site = 'ok:' + template;
                            if (!a) { repoScan.found++; continue; }
                        } else if (!a) continue;
                        titleState[key] = 'checking';
                        titleState[key] = await verifyTitle(x, site.slice(3), a);
                        if (titleState[key] === 'ok') repoScan.found++;
                    } catch (err) {
                        if (key && titleState[key] === 'checking') titleState[key] = 'notfound';
                        if (repoState[x.baseUrl] === 'checking') repoState[x.baseUrl] = err.message || 'unsupported';
                    } finally { repoScan.done++; }
                }
            };
            await Promise.all(Array.from({ length: 6 }, worker));
            if (!repoScan.running && repoScan.done < repoScan.total) return;   // stopped by hand
            repoScan.running = false;
            const noun = a ? (kind === 'manga' ? 'source with this title' : 'source that plays this title') : 'working source';
            if (repoScan.found) { repoScan.onlyOk = true; showToast(`Found ${repoScan.found} ${noun}${repoScan.found === 1 ? '' : 's'}`); }
            else showToast(a ? `No source in this list has “${titleOf(a)}”. Try another language or repository.` : 'No working sources in this list. Try another language or repository.', 'error');
        };
        // open the Extensions window for a section (and the title you're on)
        const openExtensions = (kind = playKind.value || 'manga', title = playKind.value === kind ? selectedAnime.value : null) => {
            if (repoScan.running && (kind !== extKind.value || title?.id !== extFor.value?.id)) repoScan.running = false;
            if (kind !== extKind.value || title?.id !== extFor.value?.id) Object.assign(repoScan, { done: 0, total: 0, found: 0, onlyOk: false });
            extKind.value = kind; extFor.value = title || null;
            if (srcForm.repoKind !== kind) {
                Object.assign(srcForm, { repo: PREFS.repos?.[kind] || '', repoItems: [], repoName: '', repoMsg: '', repoQ: '', repoKind: null, template: 'auto', msg: '' });
                if (srcForm.repo) loadRepo();
            }
            extOpen.value = true;
        };

        // ---- per title: which source you read / watch from, its match for this title, its chapters / episodes ----
        const MATCH_KEY = 'anicoop_srcmatch_v1';
        const srcMatches = reactive(readJSON(MATCH_KEY) || {});   // "aniListId:sourceId" → { url, title, cover }
        const saveMatches = debounce(() => { try { localStorage.setItem(MATCH_KEY, JSON.stringify(srcMatches)); } catch {} }, 500);
        const readSrc = ref(null);
        const srcView = reactive({ loading: false, error: '', results: [], chapters: [], picking: false, q: '', match: null, key: '' });
        // ---- player links (anime, movies & TV): an address with blanks the app fills in for the episode you pick ----
        // e.g. https://player.example/embed/{tmdb}/{season}/{episode}. Nothing is searched or scraped: the address plays as it is.
        const playerLinks = computed(() => PREFS.players || []);
        const kindPlayers = (k) => playerLinks.value.filter(p => p.kind === k);
        const extPlayers = computed(() => kindPlayers(extKind.value));
        const plForm = reactive({ name: '', url: '', movieUrl: '', msg: '' });
        const PLAYER_BLANK = /\{(tmdb|imdb|anilist|mal|title)\}/;
        const checkPlayerUrl = (raw, need = true) => {
            let u; try { u = new URL(raw.replace(/\{[a-z]+\}/g, '1')); } catch { throw new Error('Enter the full address, starting with https://'); }
            if (u.protocol !== 'https:') throw new Error('The address must start with https://');
            if (need && !PLAYER_BLANK.test(raw)) throw new Error('The address needs {tmdb}, {imdb}, {anilist}, {mal} or {title} in it, so the player knows which title to play.');
            return u;
        };
        const addPlayerLink = () => {
            const raw = plForm.url.trim(), movie = plForm.movieUrl.trim();
            try {
                const u = checkPlayerUrl(raw); if (movie) checkPlayerUrl(movie);
                PREFS.players = [...(PREFS.players || []), { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: extKind.value, name: (plForm.name.trim() || u.hostname.replace(/^www\./, '')).slice(0, 40), url: raw, movieUrl: movie || null }];
                showToast(`${PREFS.players.at(-1).name} added`);
                Object.assign(plForm, { name: '', url: '', movieUrl: '', msg: '' });
                if (wp.open && playKind.value === extKind.value) readSrc.value = PREFS.players.at(-1).id;
            } catch (err) { plForm.msg = err.message; }
        };
        const removePlayerLink = (id) => {
            PREFS.players = (PREFS.players || []).filter(p => p.id !== id);
            if (readSrc.value === id) readSrc.value = readTabs.value[0]?.id || null;
        };
        // the source playing right now is a player link or YouTube (not a website with an episode list)
        const directSrc = computed(() => {
            if (readSrc.value === 'youtube') return { id: 'youtube', type: 'youtube', name: 'YouTube' };
            const p = playerLinks.value.find(x => x.id === readSrc.value);
            return p && p.kind === playKind.value ? { id: p.id, type: 'link', name: p.name, p } : null;
        });
        const ARCHIVE_SRC = { id: 'archive', name: 'Internet Archive', baseUrl: IA, template: 'archive', kind: 'tv' };
        const readTabs = computed(() => {
            const k = playKind.value; if (!k) return [];
            return [
                ...(k !== 'manga' ? kindPlayers(k).map(p => ({ id: p.id, name: p.name, icon: 'fa-link' })) : []),
                ...(k !== 'manga' && extOn('youtube') ? [{ id: 'youtube', name: 'YouTube', icon: 'fa-play' }] : []),
                ...(k === 'manga' && extOn('mangadex') ? [{ id: 'mangadex', name: 'MangaDex', icon: 'fa-book-open-reader' }] : []),
                ...(k === 'tv' && extOn('archive') ? [{ id: 'archive', name: 'Internet Archive', icon: 'fa-building-columns' }] : []),
                ...kindSources(k).map(s => ({ id: s.id, name: s.name, icon: 'fa-globe' })),
            ];
        });
        const currentSite = computed(() => readSrc.value === 'archive' ? ARCHIVE_SRC : siteSources.value.find(s => s.id === readSrc.value) || null);
        const chapterList = computed(() => readSrc.value === 'mangadex' ? reader.chapters : srcView.chapters);
        const loadSourceFor = async (q = null) => {
            const a = selectedAnime.value; const s = currentSite.value;
            if (!a || !playKind.value || !s) return;
            const key = `${a.id}:${s.id}`;
            Object.assign(srcView, { loading: true, error: '', results: [], chapters: [], picking: false, match: q ? null : srcMatches[key] || null, key });
            const stale = () => readSrc.value !== s.id || selectedAnime.value?.id !== a.id;
            try {
                if (!srcView.match) {
                    if (q) {   // your own search: show what the site found
                        const results = await sourceApi.search(s, q); if (stale()) return;
                        Object.assign(srcView, { results, q, picking: true }); return;
                    }
                    // the same title (or one of its "Also known as" names) → picked automatically, otherwise you choose
                    const { match, results } = await findTitleOn(s, a); if (stale()) return;
                    srcView.results = results; srcView.q = a.title?.english || a.title?.romaji || titleOf(a);
                    if (!match) { srcView.picking = true; return; }
                    srcView.match = match; srcMatches[key] = { url: match.url, title: match.title, cover: match.cover || null }; saveMatches();
                }
                const list = await sourceApi.chapters(s, srcView.match.url);
                if (stale()) return;
                srcView.chapters = list; reader.shown = 40;
                if (!list.length) srcView.error = `No ${playKind.value === 'manga' ? 'chapters' : 'episodes'} found on ${s.name} for this title.`;
            } catch (err) { if (!stale()) srcView.error = friendlyErr(err); }
            finally { if (readSrc.value === s.id) srcView.loading = false; }
        };
        const chooseMatch = (r) => { const a = selectedAnime.value; const s = currentSite.value; if (!a || !s) return; srcMatches[`${a.id}:${s.id}`] = { url: r.url, title: r.title, cover: r.cover || null }; saveMatches(); srcView.match = r; srcView.picking = false; loadSourceFor(); };
        const changeMatch = () => { srcView.picking = true; srcView.results.length || loadSourceFor(srcView.q || titleOf(selectedAnime.value)); };
        // new title → start on MangaDex if it has the title, otherwise your first source for that section
        watch(() => playKind.value ? selectedAnime.value.id : null, (id) => {
            if (!id) return;
            readSrc.value = readTabs.value.find(t => t.id === 'mangadex') ? 'mangadex' : readTabs.value[0]?.id || null;
            Object.assign(srcView, { chapters: [], results: [], match: null, picking: false, error: '', key: '' });
        });
        // sources load when the Read / Watch window opens (not with every page you open)
        watch(() => [readSrc.value, selectedAnime.value?.id, wp.open], () => {
            const a = selectedAnime.value; const s = currentSite.value;
            if (!wp.open || !a || !s) return;
            if (srcView.key === `${a.id}:${s.id}` && (srcView.chapters.length || srcView.loading || srcView.picking)) return;
            loadSourceFor();
        });
        // MangaDex doesn't have it (or it only links out) → switch to a website source by itself
        watch(() => readSrc.value === 'mangadex' && readInfo.value && (!readInfo.value.md || (!reader.loading && reader.chapters.length && reader.chapters.every(c => c.url))), (bad) => {
            const sites = kindSources('manga');
            if (bad && sites.length) readSrc.value = sites[0].id;
        });
        // a chapter that can't open here: offer your other sources instead of leaving the app
        const cantReadHere = (c) => {
            const sites = kindSources('manga');
            if (sites.length && readSrc.value === 'mangadex') { readSrc.value = sites[0].id; showToast(`That chapter is only linked on MangaDex — switched to ${sites[0].name}`); }
            else { openExtensions('manga'); showToast(c?.url ? 'That chapter is only linked on MangaDex. Add a website source to read it here.' : 'Install a source to read in the app'); }
        };

        const canReadInApp = (c) => !!c && (!!c.src || (extOn('mangadex') && !c.url));   // website-source chapter, or a MangaDex-hosted one

        const rd = reactive({ open: false, manga: null, chapter: null, pages: [], i: 0, mode: 'rtl', loading: false, error: '', local: false, marked: false, ui: true });
        let blobUrls = [];
        const freeBlobs = () => { blobUrls.forEach(u => URL.revokeObjectURL(u)); blobUrls = []; };
        const chNum = (c) => parseFloat(c?.ch);
        // chapters of the current language, oldest → newest, one per chapter number (for next / previous)
        const rdChapters = computed(() => {
            const seen = new Set();
            return chapterList.value.filter(c => canReadInApp(c) && !Number.isNaN(chNum(c)) && !seen.has(chNum(c)) && seen.add(chNum(c))).sort((a, b) => chNum(a) - chNum(b));
        });
        const rdNeighbour = (d) => { const list = rdChapters.value; const k = list.findIndex(c => chNum(c) === chNum(rd.chapter)); return k === -1 ? null : list[k + d] || null; };
        const defaultMode = (m) => PREFS.reader.modes?.[m?.id] || (['KR', 'CN', 'TW'].includes(m?.countryOfOrigin) ? 'vertical' : 'rtl');
        const setReadMode = (mode) => { rd.mode = mode; if (rd.manga?.id) PREFS.reader = { ...PREFS.reader, modes: { ...(PREFS.reader.modes || {}), [rd.manga.id]: mode } }; };
        const preload = (from) => rd.pages.slice(from, from + 3).forEach(u => { const im = new Image(); im.decoding = 'async'; im.referrerPolicy = 'no-referrer'; im.src = u; });
        // Many sites refuse images shown on other websites. Pages load with no referrer first; if one still fails,
        // it's fetched once through the proxy (with the site as referrer) and shown from memory.
        const pageRetried = new Set();
        const viaProxy = async (n) => {
            const url = rd.pages[n]; if (!url || url.startsWith('blob:') || pageRetried.has(url)) return false;
            pageRetried.add(url);
            try {
                const blob = await siteFetch(url, { as: 'image', referer: rd.referer });
                if (rd.pages[n] !== url) return false;   // you moved to another chapter meanwhile
                const obj = URL.createObjectURL(blob); blobUrls.push(obj);
                rd.pages.splice(n, 1, obj);
                return true;
            } catch { return false; }
        };
        const onPageError = async (n) => {
            if (!rd.source || !(await viaProxy(n))) return;
            // this site blocks its images on other websites: fetch the rest of the chapter the same way, 3 at a time
            if (rd.proxyAll) return; rd.proxyAll = true;
            const order = [...rd.pages.keys()].sort((a, b) => Math.abs(a - rd.i) - Math.abs(b - rd.i));   // pages near you first
            const chapter = rd.chapter;
            const worker = async () => { while (order.length && rd.chapter === chapter) await viaProxy(order.shift()); };
            await Promise.all([worker(), worker(), worker()]);
        };
        const openChapter = async (c, manga = selectedAnime.value) => {
            if (!canReadInApp(c)) { cantReadHere(c); return; }
            addHistory(manga, { key: 'ch' + (c.ch || c.id), label: c.ch ? `Chapter ${c.ch}` : (c.title || 'Chapter'), sub: c.group || (c.src ? '' : 'MangaDex') });
            freeBlobs();
            Object.assign(rd, { open: true, manga, chapter: c, pages: [], i: 0, mode: defaultMode(manga), loading: true, error: '', local: false, marked: false, ui: true, source: c.src || null, referer: null, proxyAll: false });
            pageRetried.clear();   // new chapter: every page may be retried once again
            if (c.src) {   // website source: read the chapter page, pull out the image list
                const s = siteSources.value.find(x => x.id === c.src);
                try {
                    if (!s) throw new Error('That source was removed.');
                    const urls = await sourceApi.pages(s, c.link);
                    if (rd.chapter?.id !== c.id) return;
                    if (!urls.length) throw new Error(`No pages found on ${s.name}. The site may have changed its layout — try another source, or edit this source’s selectors.`);
                    rd.referer = s.baseUrl; rd.pages = urls; preload(0);
                } catch (err) { rd.error = friendlyErr(err); }
                finally { rd.loading = false; }
                return;
            }
            try {
                const d = await mangaDex({ kind: 'pages', chapter: c.id });
                if (rd.chapter?.id !== c.id) return;
                if (d?.error) { rd.error = d.error; return; }
                const files = PREFS.reader.saver && d.saver?.length ? d.saver : d.data;
                rd.pages = files.map(f => `${d.base}/${PREFS.reader.saver && d.saver?.length ? 'data-saver' : 'data'}/${d.hash}/${f}`);
                preload(0);
            } catch (err) { rd.error = err.status === 400 ? 'Update the “igdb” Edge Function in Supabase to read in the app (see README).' : (err.message || 'Could not load this chapter'); }
            finally { rd.loading = false; }
        };
        const closeReader = () => { rd.open = false; freeBlobs(); rd.pages = []; };
        // mark the chapter read (only moves your progress forward; never back)
        const markChapterRead = async (c = rd.chapter, manga = rd.manga) => {
            const n = Math.floor(chNum(c)); if (!manga || Number.isNaN(n) || n <= 0) return;
            const cur = soloEntry(manga.id)?.progress || 0;
            if (n <= cur) { rd.marked = true; return; }
            rd.marked = true;
            await setProgressTo(manga, n);
        };
        // reader's button: read ⇄ unread
        const toggleReaderMark = async () => {
            const n = Math.floor(chNum(rd.chapter)); if (!rd.manga || Number.isNaN(n) || n <= 0) return;
            const cur = soloEntry(rd.manga.id)?.progress || 0;
            if (rd.marked || n <= cur) { rd.marked = false; await setProgressTo(rd.manga, Math.min(cur, n - 1), { ask: false }); }
            else await markChapterRead();
        };
        const rdGo = (d) => {
            if (!rd.pages.length) return;
            const next = clamp(rd.i + d, 0, rd.pages.length);   // index == length → the "chapter finished" page
            rd.i = next; preload(next + 1);
            if (next === rd.pages.length && PREFS.reader.autoMark && !rd.local && !rd.marked) markChapterRead();
        };
        const rdTap = (e) => {   // tap the left / right third to turn pages, the middle to show/hide the bars
            const x = e.clientX / window.innerWidth;
            if (x > 0.33 && x < 0.67) { rd.ui = !rd.ui; return; }
            const forward = rd.mode === 'rtl' ? x < 0.5 : x >= 0.5;
            rdGo(forward ? 1 : -1);
        };
        const rdChapterGo = (d) => { const c = rdNeighbour(d); if (c) openChapter(c, rd.manga); };
        // vertical (webtoon) mode: reaching the bottom counts as finishing the chapter
        const onVerticalScroll = (e) => {
            const el = e.target; const imgs = el.querySelectorAll('img');
            let k = 0; imgs.forEach((im, n) => { if (im.offsetTop - el.scrollTop < el.clientHeight / 2) k = n; });
            rd.i = k;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && rd.pages.length && PREFS.reader.autoMark && !rd.local && !rd.marked) markChapterRead();
        };
        window.addEventListener('keydown', (e) => {
            if (!rd.open) return;
            if (e.key === 'Escape') closeReader();
            else if (rd.mode !== 'vertical' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) rdGo((e.key === 'ArrowLeft') === (rd.mode === 'rtl') ? 1 : -1);
            else if (rd.mode !== 'vertical' && e.key === ' ') { e.preventDefault(); rdGo(1); }
        });
        // next chapter you haven't read (for the "Continue" button)
        const continueChapter = computed(() => {
            const cur = soloEntry(selectedAnime.value?.id)?.progress || myEntry(selectedAnime.value?.id)?.progress || 0;
            return rdChapters.value.find(c => chNum(c) > cur) || null;
        });

        // Local files: CBZ / ZIP (unzipped in the browser with JSZip) or plain images
        let jszip = null;
        const loadJSZip = () => jszip || (jszip = new Promise((ok, bad) => {
            const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.onload = () => ok(window.JSZip); s.onerror = () => { jszip = null; bad(new Error('Could not load the ZIP reader')); }; document.head.appendChild(s);
        }));
        const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        const openLocalFiles = async (e) => {
            const files = [...(e.target.files || [])]; e.target.value = '';
            if (!files.length) return;
            freeBlobs();
            Object.assign(rd, { open: true, manga: selectedAnime.value || null, chapter: { ch: null, title: files.length === 1 ? files[0].name : files.length + ' images' }, pages: [], i: 0, mode: defaultMode(selectedAnime.value), loading: true, error: '', local: true, marked: false, ui: true });
            try {
                const out = [];
                for (const f of files) {
                    if (/\.(cbz|zip)$/i.test(f.name)) {
                        const Zip = await loadJSZip(); const zip = await Zip.loadAsync(f);
                        const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.(jpe?g|png|gif|webp|avif)$/i.test(n) && !/__MACOSX/.test(n)).sort(natural);
                        for (const n of names) out.push({ name: f.name + '/' + n, blob: await zip.files[n].async('blob') });
                    } else if (f.type.startsWith('image/')) out.push({ name: f.name, blob: f });
                }
                if (!out.length) { rd.error = 'No images found. Pick a .cbz / .zip file or some images.'; return; }
                out.sort((a, b) => natural(a.name, b.name));
                rd.pages = out.map(x => { const u = URL.createObjectURL(x.blob); blobUrls.push(u); return u; });
            } catch (err) { rd.error = err.message || 'Could not open that file'; }
            finally { rd.loading = false; }
        };
        const setProgressTo = async (anime, n, { ask = true } = {}) => {
            const before = soloEntry(anime.id);
            if (ask && before && (before.progress || 0) >= n && !(await askConfirm({ title: `Set your progress back to ${n}?`, body: `You're at ${UNIT.ep.toLowerCase()} ${before.progress}.`, ok: 'Set progress', danger: false }))) return;
            const eps = anime.episodes || before?.anime?.episodes || null;
            const entry = { anime: normMedia(before?.anime || anime), score: before?.score || 0, progress: n, status: eps && n >= eps ? 'COMPLETED' : n > 0 ? 'WATCHING' : (before?.status === 'COMPLETED' ? 'WATCHING' : before?.status || 'PLANNING') };
            setSoloLocal(entry);
            if (selectedAnime.value?.id === anime.id) inlineForm.value = buildForm(selectedAnime.value);
            try {
                await upsertSolo(entry);
                logActivity(entry.anime, before, entry);
                showToast(entry.status === 'COMPLETED' ? `Finished ${titleOf(anime)}!` : n > 0 ? `${anime.type === 'MANGA' ? 'Read' : 'Watched'} up to ${UNIT.ep.toLowerCase()} ${n}` : `${titleOf(anime)} · back to ${UNIT.ep.toLowerCase()} 0`);
            } catch (err) { showToast('Could not save: ' + (err.message || err), 'error'); fetchSolo(); }
        };
        // the ✓ next to a chapter works both ways: read → marks it (and everything after it) unread again
        const toggleChapterRead = (anime, c) => {
            const n = Math.floor(parseFloat(c.ch)); if (Number.isNaN(n)) return;
            if (chapterRead(c)) setProgressTo(anime, Math.max(0, n - 1), { ask: false });
            else setProgressTo(anime, n);
        };

        // ---------- History: what you read / watched / played, per section (kept on this device) ----------
        const HIST_KEY = 'anicoop_history_v1';
        const histList = ref((() => { const h = readJSON(HIST_KEY); return Array.isArray(h) ? h : []; })());
        // saved in this browser only (never sent anywhere), written when the page is idle so it never slows a click down
        const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));
        const saveHistory = debounce(() => idle(() => { try { localStorage.setItem(HIST_KEY, JSON.stringify(histList.value.slice(0, 300))); } catch {} }), 800);
        // what = { key, label, sub }: the same chapter / episode again moves to the top instead of repeating
        const addHistory = (a, what) => {
            if (!a?.id || !what) return;
            const e = { key: `${a.id}:${what.key}`, id: a.id, type: a.type, title: titleOf(a), cover: a.coverImage?.large || null, label: what.label, sub: what.sub || '', at: Date.now(), media: slimAnime(a) };
            histList.value = [e, ...histList.value.filter(x => x.key !== e.key)].slice(0, 300); saveHistory();
        };
        watch(trailerOf, (a) => { if (a?.trailer?.id) addHistory(a, { key: 'yt' + a.trailer.id, label: 'Watched a trailer' }); });
        const histOpen = ref(false);
        const histType = ref('ANIME');
        const openHistory = (type = mediaType.value) => { histType.value = type; histOpen.value = true; };
        const histItems = computed(() => histList.value.filter(x => x.type === histType.value));
        const histDay = (t) => {
            const d = new Date(t); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
            if (d.toDateString() === today.toDateString()) return 'Today';
            if (d.toDateString() === y.toDateString()) return 'Yesterday';
            return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
        };
        const histGroups = computed(() => {
            const out = [];
            histItems.value.forEach(x => { const l = histDay(x.at); const g = out[out.length - 1]; if (g && g.label === l) g.items.push(x); else out.push({ label: l, items: [x] }); });
            return out;
        });
        const removeHistory = (key) => { histList.value = histList.value.filter(x => x.key !== key); saveHistory(); };
        const clearHistory = async () => {
            const name = (SECTION_LIST.find(s => s.type === histType.value)?.label || 'this section');
            if (!(await askConfirm({ title: `Clear your ${name} history?`, body: 'Only the history list is removed. Your lists and progress stay as they are.', ok: 'Clear history' }))) return;
            histList.value = histList.value.filter(x => x.type !== histType.value); saveHistory();
        };
        const openHistoryItem = (x) => { histOpen.value = false; fetchAnimeDetails(x.media || { id: x.id, type: x.type }); };
        const histTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

        // ---------- Read / Watch window ----------
        const isVideoKind = computed(() => playKind.value === 'anime' || playKind.value === 'tv');
        const isMovie = computed(() => selectedAnime.value?.type === 'TV' && selectedAnime.value.format === 'MOVIE');
        const seasonsOf = (a) => (a?.seasons || []).filter(x => x.episodes > 0);
        // TV progress counts every episode of the show, so "S2 E3" is episode (all of season 1) + 3
        const absOf = (a, season, ep) => { if (!season) return ep; let n = 0; for (const x of seasonsOf(a)) { if (x.n >= season) break; n += x.episodes; } return n + ep; };
        const seasonForAbs = (a, abs) => { let n = 0; for (const x of seasonsOf(a)) { if (abs <= n + x.episodes) return x.n; n += x.episodes; } return seasonsOf(a).slice(-1)[0]?.n || 1; };
        const myProgress = (a) => soloEntry(a?.id)?.progress || myEntry(a?.id)?.progress || 0;
        // TV episode guide from TMDB, one season at a time
        const tvSeasons = reactive({});   // "titleId:season" → [{ n, name, overview, still, runtime, air }] | 'loading' | 'error'
        const loadTvSeason = async (n) => {
            const a = selectedAnime.value; if (!a || a.type !== 'TV' || a.format === 'MOVIE' || !a.extId) return;
            const key = `${a.id}:${n}`; if (Array.isArray(tvSeasons[key]) || tvSeasons[key] === 'loading') return;
            tvSeasons[key] = 'loading';
            try {
                const d = await tmdbCall(`tv/${a.extId}/season/${n}`);
                tvSeasons[key] = (d.episodes || []).map(e => ({ n: e.episode_number, name: e.name, overview: e.overview || '', still: TMDB_IMG(e.still_path, 'w300'), runtime: e.runtime || null, air: e.air_date || null }));
            } catch { tvSeasons[key] = 'error'; }
        };
        const openWatch = () => {
            const a = selectedAnime.value; if (!a || !playKind.value) return;
            if (!readSrc.value || !readTabs.value.some(t => t.id === readSrc.value)) readSrc.value = readTabs.value[0]?.id || null;
            if (a.type === 'TV' && !isMovie.value) {
                const seasons = seasonsOf(a);
                if (!seasons.some(x => x.n === wp.season) || wp.id !== a.id) wp.season = seasons.length ? seasonForAbs(a, myProgress(a) + 1) : 1;
                loadTvSeason(wp.season);
            }
            wp.id = a.id; wp.open = true;
        };
        watch(() => wp.season, (n) => { if (wp.open) loadTvSeason(n); });
        watch(() => selectedAnime.value?.id, () => { wp.open = false; });
        const srcEps = computed(() => isVideoKind.value && readSrc.value !== 'mangadex' && !directSrc.value && !srcView.picking ? srcView.chapters : []);
        const noSeasons = computed(() => srcEps.value.every(c => !c.season));
        // the source's episode for a row of the guide
        const srcEpFor = (season, ep, abs) => {
            const list = srcEps.value; if (!list.length) return null;
            return list.find(c => c.season === season && c.ep === ep) || (noSeasons.value ? list.find(c => c.ep === abs) || (season === 1 ? list.find(c => c.ep === ep) : null) : null) || null;
        };
        const plainText = (html) => String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        // Netflix-style rows (number, picture, name, length, summary); "item" is the source's episode that plays
        const wpRows = computed(() => {
            const a = selectedAnime.value; const k = playKind.value;
            if (!a || !k || k === 'manga') return [];
            const prog = myProgress(a); const done = myEntry(a.id)?.status === 'COMPLETED';
            const direct = !!directSrc.value;   // a player link / YouTube can play any episode of the guide
            const row = (r) => ({ ...r, play: !!r.item || direct, watched: done || (r.abs != null && r.abs > 0 && prog >= r.abs) });
            if (isMovie.value) return [row({ key: 'movie', n: 1, abs: 1, title: titleOf(a), desc: plainText(a.description).slice(0, 320), thumb: a.bannerImage || a.coverImage?.large, runtime: a.runtime, item: srcEps.value[0] || null })];
            if (a.type === 'TV') {
                const eps = tvSeasons[`${a.id}:${wp.season}`];
                if (Array.isArray(eps) && eps.length) return eps.map(e => { const abs = absOf(a, wp.season, e.n); return row({ key: `s${wp.season}e${e.n}`, n: e.n, abs, title: e.name || `Episode ${e.n}`, desc: e.overview, thumb: e.still, runtime: e.runtime, air: e.air, item: srcEpFor(wp.season, e.n, abs) }); });
                // no episode guide: the source's own list for this season
                return srcEps.value.filter(c => noSeasons.value || c.season === wp.season).map(c => row({ key: c.id, n: c.ep, abs: c.season ? absOf(a, c.season, c.ep) : c.ep, title: c.title, desc: '', thumb: null, item: c }));
            }
            // anime: the source's episodes, with AniList's episode pictures and names where it has them
            const thumbs = new Map(detailEpisodes.value.filter(e => e.n).map(e => [e.n, e]));
            if (srcEps.value.length) return srcEps.value.map(c => {
                const n = c.ep != null ? Math.floor(c.ep) : null; const t = thumbs.get(n);
                return row({ key: c.id, n: c.ep ?? '–', abs: n, title: (c.title && !/^Episode [\d.]+$/.test(c.title) ? c.title : '') || t?.name || c.title || 'Episode', desc: '', thumb: t?.thumbnail || null, item: c });
            });
            const total = a.episodes || (a.nextAiringEpisode?.episode ? a.nextAiringEpisode.episode - 1 : 0) || detailEpisodes.value.length;
            return Array.from({ length: Math.min(total, 2000) }, (_, i) => { const t = thumbs.get(i + 1); return row({ key: 'e' + (i + 1), n: i + 1, abs: i + 1, title: t?.name || `Episode ${i + 1}`, desc: '', thumb: t?.thumbnail || null, item: null }); });
        });
        const wpShown = ref(40);
        watch(() => [selectedAnime.value?.id, wp.season, readSrc.value], () => { wpShown.value = 40; });
        // the big button: the next thing you haven't read / watched yet
        const wpContinue = computed(() => {
            if (playKind.value === 'manga') return continueChapter.value ? { label: `ch ${continueChapter.value.ch}`, chapter: continueChapter.value } : null;
            const prog = myProgress(selectedAnime.value);
            const r = wpRows.value.find(x => x.play && x.abs > prog) || (prog ? null : wpRows.value.find(x => x.play));
            return r ? { label: isMovie.value ? '' : selectedAnime.value?.type === 'TV' ? `S${wp.season} E${r.n}` : `ep ${r.n}`, row: r } : null;
        });
        const playContinue = () => { const c = wpContinue.value; if (!c) return; if (c.chapter) openChapter(c.chapter); else playRow(c.row); };
        const wpStarted = computed(() => myProgress(selectedAnime.value) > 0);
        const playRow = (r) => {
            if (r.item) return openEpisode(r.item, selectedAnime.value, r);
            if (directSrc.value) return openDirect(r);
            if (!readTabs.value.length) { openExtensions(); return; }
            if (srcView.loading) { showToast(`Still looking on ${currentSite.value?.name || 'the source'}…`); return; }
            showToast(srcView.picking ? 'Pick the right title first' : `${currentSite.value?.name || 'This source'} doesn’t have this one. Try another source.`, 'error');
        };
        const toggleRowWatched = (r) => { const a = selectedAnime.value; if (!a || r.abs == null) return; setProgressTo(a, r.watched ? Math.max(0, r.abs - 1) : r.abs, { ask: false }); };

        // ---------- video player (anime, movies & TV) ----------
        // A site's player is shown in a sandboxed frame: it plays, but can't open pop-ups or send you to other websites.
        const vp = reactive({ open: false, anime: null, ep: null, abs: null, label: '', servers: [], i: 0, loading: false, error: '', safe: true, marked: false, local: false });
        let hls = null, localUrl = null;
        const vpLabel = (a, c, r) => c?.movie || a?.format === 'MOVIE' ? 'Movie' : c?.season ? `S${c.season} E${c.ep}` : a?.type === 'TV' && r ? `S${wp.season} E${r.n}` : `Episode ${c?.ep ?? r?.n ?? '?'}`;
        const stopVideo = () => { if (hls) { try { hls.destroy(); } catch {} hls = null; } };
        const openEpisode = async (c, anime = selectedAnime.value, r = null) => {
            const s = c.src === 'archive' ? ARCHIVE_SRC : siteSources.value.find(x => x.id === c.src);
            stopVideo();
            const abs = r?.abs ?? (c.movie ? 1 : anime?.type === 'TV' && c.season ? absOf(anime, c.season, c.ep) : Math.floor(c.ep || 0) || null);
            pauseSong();
            Object.assign(vp, { open: true, anime, ep: c, abs, label: vpLabel(anime, c, r), servers: [], i: 0, loading: true, error: '', marked: false, local: false });
            addHistory(anime, { key: 'ep:' + vp.label, label: vp.label, sub: s?.name || '' });
            try {
                if (!s) throw new Error('That source was removed.');
                const list = await sourceApi.videos(s, c.link);
                if (vp.ep?.id !== c.id) return;
                if (!list.length) throw new Error(`${s.name} didn’t show a player for this episode. The site probably loads its player with protected code of its own, which only its Aniyomi extension can run. Try another source: "Find sources with this title" in Extensions only marks ones that play here.`);
                vp.servers = list.sort((x, y) => (x.kind === 'embed') - (y.kind === 'embed'));   // plain video files first: they play with nothing around them
            } catch (err) { if (vp.ep?.id === c.id) vp.error = friendlyErr(err); }
            finally { if (vp.ep?.id === c.id) vp.loading = false; }
        };
        // ---- player links + YouTube: build the player for one row of the episode guide ----
        const extIds = reactive({});   // "anilistId" → { tmdb, imdb, mal } found for player links
        const idsFor = async (a, need) => {
            const k = String(a.id); const have = extIds[k] || (extIds[k] = {});
            const movie = a.format === 'MOVIE';
            if (need.tmdb || need.imdb) {
                if (have.tmdb == null) {
                    if (a.type === 'TV') have.tmdb = a.extId;
                    else {   // an anime: find it on TMDB by name (AniList has no TMDB link)
                        const q = a.title?.english || a.title?.romaji || titleOf(a);
                        const d = await tmdbCall(movie ? 'search/movie' : 'search/tv', { query: q, ...(a.seasonYear ? { [movie ? 'year' : 'first_air_date_year']: a.seasonYear } : {}) }).catch(() => null);
                        const d2 = d?.results?.length ? d : await tmdbCall(movie ? 'search/movie' : 'search/tv', { query: q }).catch(() => null);
                        have.tmdb = d2?.results?.[0]?.id || 0;
                    }
                }
                if (!have.tmdb) throw new Error('Couldn’t find this title on TMDB, which this player link needs ({tmdb} / {imdb}).');
            }
            if (need.imdb && have.imdb == null) {
                const d = await tmdbCall(`${movie ? 'movie' : 'tv'}/${have.tmdb}/external_ids`).catch(() => null);
                have.imdb = d?.imdb_id || '';
                if (!have.imdb) throw new Error('Couldn’t get the IMDb number for this title. Use {tmdb} in the player link, or redeploy the Edge Function (the IMDb lookup needs the latest one).');
            }
            if (need.mal && have.mal == null) {
                if (a.type !== 'ANIME' && a.type !== 'MANGA') throw new Error('{mal} only works for anime.');
                const d = await anilist('query ($id: Int) { Media(id: $id) { idMal } }', { id: a.id }).catch(() => null);
                have.mal = d?.Media?.idMal || 0;
                if (!have.mal) throw new Error('This anime has no MyAnimeList number.');
            }
            return have;
        };
        const linkServer = async (p, a, c) => {
            const tpl = (c.movie && p.movieUrl) || p.url;
            const need = { tmdb: /\{tmdb\}/.test(tpl), imdb: /\{imdb\}/.test(tpl), mal: /\{mal\}/.test(tpl) };
            if (/\{anilist\}/.test(tpl) && a.type !== 'ANIME') throw new Error('{anilist} only works for anime.');
            const ids = await idsFor(a, need);
            const url = tpl.replace(/\{(tmdb|imdb|anilist|mal|season|episode|title)\}/g, (_, k) => encodeURIComponent(
                k === 'tmdb' ? ids.tmdb : k === 'imdb' ? ids.imdb : k === 'mal' ? ids.mal : k === 'anilist' ? a.id : k === 'season' ? (c.season || 1) : k === 'episode' ? (c.ep || 1) : (a.title?.english || a.title?.romaji || titleOf(a))));
            return { name: p.name, url, kind: /\.m3u8(\?|$)/i.test(url) ? 'hls' : /\.(mp4|webm|m4v)(\?|$)/i.test(url) ? 'file' : 'embed' };
        };
        // YouTube: the free, official uploads of this episode (studios' and distributors' own channels first)
        const OFFICIAL_YT = /muse asia|muse indonesia|muse india|ani-one|tms anime|gundam ?info|tezuka|toei anim|crunchyroll|aniplex|viz media|discotek|retrocrush|pok[eé]mon|sentai|kadokawa|bandai namco|sunrise|nippon animation|dreamworks|pbs kids|cartoon network|nickelodeon|disney|warner bros|lionsgate|mgm|paramount|sony pictures|popcornflix|filmrise|moviesphere|youtube movies/i;
        const ytEpisodeServers = async (a, c) => {
            const names = [...new Set([a.title?.english, a.title?.romaji, titleOf(a)].filter(Boolean))];
            const movie = !!c.movie;
            const q = movie ? `${names[0]} full movie` : a.type === 'TV' && c.season ? `${names[0]} season ${c.season} episode ${c.ep}` : `${names[0]} episode ${c.ep}`;
            const list = [...await ytSearch(q), ...(names[1] && !movie ? await ytSearch(`${names[1]} episode ${c.ep}`).catch(() => []) : [])];
            const words = names.map(n => normTitle(n).split(' ').filter(w => w.length > 2));
            const epRx = new RegExp(`(?:ep(?:isode)?\\.?\\s*|#|\\be)0*${c.ep}(?!\\d)|\\b0*${c.ep}\\s*(?:[:\\-|–]|$)`, 'i');
            const seen = new Set();
            const hits = list.filter(v => {
                if (seen.has(v.id)) return false; seen.add(v.id);
                if (!v.secs || v.secs < (movie ? 45 * 60 : 6 * 60)) return false;   // trailers, clips, Shorts
                const t = normTitle(v.title);
                if (!words.some(ws => ws.length && ws.every(w => t.includes(w)))) return false;
                if (/\b(trailer|teaser|preview|clip|opening|ending|amv|reaction|review|recap|explained|compilation)\b/i.test(v.title)) return false;
                return movie || epRx.test(v.title);
            }).map(v => ({ v, sc: (OFFICIAL_YT.test(v.channel) ? 30 : 0) + (v.badge ? 10 : 0) }))
              .sort((x, y) => y.sc - x.sc).slice(0, 6);
            return hits.map(({ v }) => ({ name: `${v.channel || 'YouTube'} · ${fmtClock(v.secs)}`, url: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1&iv_load_policy=3`, kind: 'embed', yt: true }));
        };
        const openDirect = async (r, anime = selectedAnime.value) => {
            const d = directSrc.value; if (!d || !anime) return;
            const movie = isMovie.value || anime.format === 'MOVIE';
            const tv = anime.type === 'TV' && !movie;
            const c = { id: `direct:${d.id}:${anime.id}:${r.key}`, key: r.key, title: r.title, season: tv ? wp.season : null, ep: movie ? null : r.n, movie, src: d.id, direct: true };
            pauseSong(); stopVideo();
            Object.assign(vp, { open: true, anime, ep: c, abs: r.abs, label: vpLabel(anime, c, r), servers: [], i: 0, loading: true, error: '', marked: false, local: false });
            addHistory(anime, { key: 'ep:' + vp.label, label: vp.label, sub: d.name });
            try {
                const list = d.type === 'youtube' ? await ytEpisodeServers(anime, c) : [await linkServer(d.p, anime, c)];
                if (vp.ep?.id !== c.id) return;
                if (!list.length) throw new Error(`YouTube has no free upload of ${movie ? 'this film' : 'this episode'}. Try another source.`);
                vp.servers = list;
            } catch (err) { if (vp.ep?.id === c.id) vp.error = friendlyErr(err); }
            finally { if (vp.ep?.id === c.id) vp.loading = false; }
        };
        const loadHls = () => window.Hls ? Promise.resolve(window.Hls) : new Promise((ok, bad) => {
            const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
            sc.onload = () => ok(window.Hls); sc.onerror = () => bad(new Error('Couldn’t load the stream player. Try another server.')); document.head.appendChild(sc);
        });
        const vpServer = computed(() => vp.servers[vp.i] || null);
        watch(() => vp.open && vpServer.value?.url, async () => {
            stopVideo();
            const sv = vpServer.value; if (!vp.open || !sv || sv.kind === 'embed') return;
            await nextTick();
            const el = document.getElementById('vp-video'); if (!el) return;
            if (sv.kind === 'hls' && !el.canPlayType('application/vnd.apple.mpegurl')) {
                try {
                    const Hls = await loadHls(); if (vpServer.value?.url !== sv.url) return;
                    if (!Hls.isSupported()) throw new Error('This browser can’t play this stream. Try another server.');
                    hls = new Hls(); hls.loadSource(sv.url); hls.attachMedia(el);
                    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) vp.error = 'This stream didn’t load (the site may only allow its own player). Try another server.'; });
                } catch (err) { vp.error = err.message; }
            } else el.src = sv.url;
        });
        const pickServer = (n) => { vp.i = n; vp.error = ''; };
        const markEpisodeWatched = async () => {
            const a = vp.anime; const n = vp.abs; if (!a || !n || vp.local) return;
            vp.marked = true;
            if (myProgress(a) < n) await setProgressTo(a, n, { ask: false });
        };
        const onVideoTime = (e) => { const v = e.target; if (!vp.marked && v.duration && v.currentTime / v.duration > 0.9) markEpisodeWatched(); };
        const onVideoError = () => { if (vpServer.value && vpServer.value.kind !== 'embed' && !hls) vp.error = 'This video didn’t load. Try another server.'; };
        const vpList = () => srcView.chapters.filter(c => c.src === vp.ep?.src);
        const vpNeighbour = (d) => {
            if (vp.ep?.direct) { const rows = wpRows.value; const k = rows.findIndex(r => r.key === vp.ep.key); return k === -1 ? null : rows[k + d] || null; }
            const list = vpList(); const k = list.findIndex(c => c.id === vp.ep?.id); return k === -1 ? null : list[k + d] || null;
        };
        const vpGo = async (d) => {
            const c = vpNeighbour(d); if (!c) return;
            if (vp.ep?.direct) { if (d > 0 && !vp.marked) markEpisodeWatched(); openDirect(c, vp.anime); return; }
            if (d > 0 && !vp.marked) markEpisodeWatched();   // moving on = you watched this one
            if (c.season && selectedAnime.value?.type === 'TV') wp.season = c.season;
            openEpisode(c, vp.anime, wpRows.value.find(r => r.item?.id === c.id) || null);
        };
        const closeVideo = () => { stopVideo(); vp.open = false; vp.servers = []; if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; } };
        const openLocalVideo = (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            closeVideo(); localUrl = URL.createObjectURL(f);
            Object.assign(vp, { open: true, anime: selectedAnime.value, ep: { id: 'local', title: f.name }, abs: null, label: f.name, servers: [{ name: 'This device', url: localUrl, kind: 'file' }], i: 0, loading: false, error: '', marked: false, local: true });
        };
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (vp.open) closeVideo();
            else if (wp.open && !extOpen.value && !rd.open) wp.open = false;
        });

        // ---------- OWNER: who may see 18+ content ----------
        const adultAllowed = ref(false);
        const isOwner = ref(false);
        const hasOwner = ref(true);
        const adultConfig = reactive({ everyone: false, users: [] });
        const loadOwnerState = async () => {
            const call = (fn) => sb.rpc(fn).then(r => r.error ? null : r.data, () => null);
            const [allowed, owner, any] = await Promise.all([call('adult_allowed'), call('is_app_owner'), call('has_owner')]);
            adultAllowed.value = allowed === true; isOwner.value = owner === true; hasOwner.value = any !== false;
            if (!adultAllowed.value && filters.value.isAdult) filters.value.isAdult = false;
            if (isOwner.value || can('manage_18')) {
                const { data } = await sb.from('app_config').select('value').eq('key', 'adult').maybeSingle();
                Object.assign(adultConfig, { everyone: !!data?.value?.everyone, users: [...(data?.value?.users || [])] });
                ensureProfiles(adultConfig.users);
            }
        };
        const claimOwner = async () => {
            const { data, error } = await sb.rpc('claim_owner');
            if (error) { showToast('Could not claim: ' + error.message + ' — run the v6 SQL in Supabase', 'error'); return; }
            if (!data) { showToast('Someone already owns this app', 'error'); await loadOwnerState(); return; }
            showToast('You are now the owner of anicoop');
            await loadOwnerState();
        };
        const saveAdultConfig = async () => {
            const { error } = await sb.from('app_config').update({ value: { everyone: adultConfig.everyone, users: adultConfig.users }, updated_at: new Date().toISOString() }).eq('key', 'adult');
            if (error) showToast('Could not save: ' + error.message, 'error'); else showToast('18+ access updated');
        };
        const setAdultEveryone = (on) => { adultConfig.everyone = on; saveAdultConfig(); };
        const toggleAdultUser = (id) => { const i = adultConfig.users.indexOf(id); if (i === -1) adultConfig.users.push(id); else adultConfig.users.splice(i, 1); saveAdultConfig(); };
        const ownerSearch = ref('');
        const addAdultUserByName = async () => {
            const name = ownerSearch.value.trim().replace(/^@/, ''); if (!name) return;
            const { data } = await sb.from('profiles').select('id, username, avatar_url, accent').ilike('username', escapeLike(name)).maybeSingle();
            if (!data) { showToast('No user with that username', 'error'); return; }
            if (!profileById.value.has(data.id)) extraProfiles.value = [...extraProfiles.value, data];
            if (!adultConfig.users.includes(data.id)) toggleAdultUser(data.id);
            ownerSearch.value = '';
        };

        // ---------- ROLES, POWERS & ACHIEVEMENTS (v8.2) ----------
        // The owner has every power. Anyone else gets powers from their roles. Roles show on profiles for everyone.
        const ROLE_PERMS = [
            { v: 'admin', l: 'Full admin', d: 'Every power below', high: true },
            { v: 'manage_roles', l: 'Manage roles', d: 'Create roles and give them to people', high: true },
            { v: 'give_awards', l: 'Give achievements', d: 'Award and remove special achievements' },
            { v: 'moderate', l: 'Moderate', d: "Delete anyone's posts, replies & comments; clear profile pictures, banners and bios" },
            { v: 'manage_feedback', l: 'Manage feedback', d: 'Change feedback status and delete feedback' },
            { v: 'manage_18', l: 'Manage 18+', d: 'Decide who sees 18+ content (and see it)' },
        ];
        const ROLE_ICONS = ['fa-shield-halved', 'fa-crown', 'fa-star', 'fa-gavel', 'fa-hammer', 'fa-wand-magic-sparkles', 'fa-heart', 'fa-fire', 'fa-bolt', 'fa-gem', 'fa-dragon', 'fa-ghost', 'fa-gamepad', 'fa-music', 'fa-film', 'fa-book-open', 'fa-paintbrush', 'fa-code', 'fa-handshake-angle', 'fa-seedling'];
        const AWARD_ICONS = ['fa-trophy', 'fa-medal', 'fa-award', 'fa-crown', 'fa-star', 'fa-gem', 'fa-fire', 'fa-bolt', 'fa-heart', 'fa-rocket', 'fa-dragon', 'fa-ghost', 'fa-gamepad', 'fa-music', 'fa-film', 'fa-book-open', 'fa-hand-holding-heart', 'fa-bug', 'fa-lightbulb', 'fa-cake-candles'];
        const ROLE_COLORS = ['#B490F5', '#D4FF3A', '#FF4D8D', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#f97316', '#e5e7eb'];
        const roles = ref([]);                    // every role, in order
        const roleLinks = ref([]);                // { user_id, role_id }
        const rolesReady = ref(false);
        const loadRoles = async () => {
            const [r, u] = await Promise.all([
                sb.from('app_roles').select('*').order('position').order('created_at'),
                sb.from('user_roles').select('user_id, role_id'),
            ]);
            if (r.error || u.error) { rolesReady.value = false; return; }   // v8.2 SQL not run yet
            roles.value = r.data || []; roleLinks.value = u.data || []; rolesReady.value = true;
            ensureProfiles(roleLinks.value.map(x => x.user_id));
        };
        const rolesOf = (userId) => { const ids = new Set(roleLinks.value.filter(x => x.user_id === userId).map(x => x.role_id)); return roles.value.filter(r => ids.has(r.id)); };
        const myPerms = computed(() => new Set(rolesOf(uid()).flatMap(r => r.perms || [])));
        const can = (p) => isOwner.value || myPerms.value.has('admin') || myPerms.value.has(p);
        const anyPower = computed(() => isOwner.value || myPerms.value.size > 0);
        // roles you're allowed to hand out / edit (only the owner handles the ones with power over roles)
        const canTouchRole = (r) => isOwner.value || (can('manage_roles') && !(r.perms || []).some(p => p === 'admin' || p === 'manage_roles'));
        const isOwnerId = (id) => !!id && id === ownerId.value;

        const roleDraft = reactive({ id: null, name: '', color: '#B490F5', icon: 'fa-shield-halved', perms: [], busy: false });
        const editRole = (r) => Object.assign(roleDraft, r ? { id: r.id, name: r.name, color: r.color, icon: r.icon, perms: [...(r.perms || [])] } : { id: null, name: '', color: '#B490F5', icon: 'fa-shield-halved', perms: [] });
        const toggleRolePerm = (p) => { const i = roleDraft.perms.indexOf(p); if (i === -1) roleDraft.perms.push(p); else roleDraft.perms.splice(i, 1); };
        const saveRole = async () => {
            const name = roleDraft.name.trim().slice(0, 30); if (!name) return;
            if (!isOwner.value && roleDraft.perms.some(p => p === 'admin' || p === 'manage_roles')) { showToast('Only the owner can make roles with those powers', 'error'); return; }
            roleDraft.busy = true;
            const row = { name, color: roleDraft.color, icon: roleDraft.icon, perms: [...roleDraft.perms] };
            const { error } = roleDraft.id ? await sb.from('app_roles').update(row).eq('id', roleDraft.id)
                : await sb.from('app_roles').insert({ ...row, position: roles.value.length, created_by: uid() });
            roleDraft.busy = false;
            if (error) { showToast('Could not save the role: ' + error.message + (/app_roles/.test(error.message) ? ' — run the v8.2 SQL' : ''), 'error'); return; }
            showToast(roleDraft.id ? `Role “${name}” updated` : `Role “${name}” created`);
            editRole(null); await loadRoles();
        };
        const deleteRole = async (r) => {
            if (!(await askConfirm({ title: `Delete the role “${r.name}”?`, body: 'It is taken away from everyone who has it.', ok: 'Delete role' }))) return;
            const { error } = await sb.from('app_roles').delete().eq('id', r.id);
            if (error) { showToast(error.message, 'error'); return; }
            if (roleDraft.id === r.id) editRole(null);
            await loadRoles();
        };
        const moveRole = async (r, d) => {
            const list = [...roles.value]; const i = list.findIndex(x => x.id === r.id), j = i + d;
            if (j < 0 || j >= list.length) return;
            [list[i], list[j]] = [list[j], list[i]]; roles.value = list;
            await Promise.all(list.map((x, n) => x.position === n ? null : sb.from('app_roles').update({ position: n }).eq('id', x.id)));
            await loadRoles();
        };
        const hasRole = (userId, roleId) => roleLinks.value.some(x => x.user_id === userId && x.role_id === roleId);
        const toggleUserRole = async (userId, r) => {
            if (!canTouchRole(r)) { showToast('Only the owner can give or take that role', 'error'); return; }
            const had = hasRole(userId, r.id);
            const { error } = had ? await sb.from('user_roles').delete().eq('user_id', userId).eq('role_id', r.id)
                : await sb.from('user_roles').insert({ user_id: userId, role_id: r.id, granted_by: uid() });
            if (error) { showToast(error.message, 'error'); return; }
            showToast(had ? `${personOf(userId).username} is no longer ${r.name}` : `${personOf(userId).username} is now ${r.name}`);
            await loadRoles();
        };
        // find someone by username (admin tools)
        const adminLookup = reactive({ q: '', user: null, busy: false });
        const findUserByName = async (raw) => {
            const name = String(raw || '').trim().replace(/^@/, ''); if (!name) return null;
            const { data } = await sb.from('profiles').select('*').ilike('username', escapeLike(name)).maybeSingle();
            if (data && !profileById.value.has(data.id)) extraProfiles.value = [...extraProfiles.value, data];
            return data || null;
        };
        const adminFind = async () => {
            adminLookup.busy = true; adminLookup.user = await findUserByName(adminLookup.q); adminLookup.busy = false;
            if (!adminLookup.user) showToast('No user with that username', 'error');
        };

        // achievements the owner (or anyone with "give achievements") hands out
        const awardsOf = reactive({});           // user id → list
        const loadAwards = async (userId) => {
            if (!userId) return;
            const { data, error } = await sb.from('awards').select('*').eq('user_id', userId).order('created_at', { ascending: false });
            if (!error) awardsOf[userId] = data || [];
        };
        const awardBox = reactive({ open: false, userId: null, title: '', description: '', icon: 'fa-trophy', color: '#f59e0b', busy: false });
        const openAwardBox = (userId) => Object.assign(awardBox, { open: true, userId, title: '', description: '', icon: 'fa-trophy', color: '#f59e0b', busy: false });
        const giveAward = async () => {
            const title = awardBox.title.trim().slice(0, 40); if (!title || !awardBox.userId) return;
            awardBox.busy = true;
            const { error } = await sb.from('awards').insert({ user_id: awardBox.userId, title, description: awardBox.description.trim().slice(0, 160) || null, icon: awardBox.icon, color: awardBox.color, awarded_by: uid() });
            awardBox.busy = false;
            if (error) { showToast('Could not give it: ' + error.message + (/awards/.test(error.message) ? ' — run the v8.2 SQL' : ''), 'error'); return; }
            showToast(`🏆 ${personOf(awardBox.userId).username} got “${title}”`);
            awardBox.open = false; loadAwards(awardBox.userId);
        };
        const removeAward = async (a) => {
            if (!(await askConfirm({ title: `Take away “${a.title}”?`, ok: 'Remove achievement' }))) return;
            const { error } = await sb.from('awards').delete().eq('id', a.id);
            if (error) { showToast(error.message, 'error'); return; }
            loadAwards(a.user_id);
        };
        watch(() => viewUserId.value, (id) => { if (id) loadAwards(id); }, { immediate: true });
        watch(() => activeTab.value === 'profile' && uid(), (id) => { if (id) loadAwards(id); }, { immediate: true });

        // moderation: clear parts of someone's profile
        const moderateProfile = async (userId, what) => {
            const label = { bio: 'bio', avatar_url: 'profile picture', banner_url: 'banner' }[what];
            if (!(await askConfirm({ title: `Remove ${personOf(userId).username}'s ${label}?`, ok: 'Remove' }))) return;
            const { error } = await sb.from('profiles').update({ [what]: null }).eq('id', userId);
            if (error) { showToast(error.message, 'error'); return; }
            showToast(`Removed their ${label}`);
            if (viewedUser.value?.profile?.id === userId) viewedUser.value.profile = { ...viewedUser.value.profile, [what]: null };
            extraProfiles.value = extraProfiles.value.map(p => p.id === userId ? { ...p, [what]: null } : p);
        };
        const adminMenu = ref(false);

        // ---------- CHAT ----------
        // GIF search needs a free Tenor API key (Google Cloud → Tenor API). Leave empty to use uploads + links only.
        const TENOR_KEY = '';
        const makeSticker = (emoji, text, c1, c2) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
            + `<g transform="rotate(-6 100 100)"><rect x="18" y="26" width="164" height="148" rx="38" fill="#fff"/><rect x="26" y="34" width="148" height="132" rx="31" fill="url(#g)"/>`
            + `<text x="100" y="104" font-size="64" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text>`
            + `<text x="100" y="146" font-size="${text.length > 9 ? 17 : 22}" font-weight="900" text-anchor="middle" fill="#0A0A0C" font-family="Arial Black,Arial,sans-serif" letter-spacing="1">${text}</text></g></svg>`);
        const STICKERS = [
            ['peak', '🔥', 'PEAK', '#D4FF3A', '#22c55e'], ['crying', '😭', 'CRYING', '#7dd3fc', '#3b82f6'], ['w', '🏆', 'BIG W', '#fde047', '#f59e0b'], ['l', '🥀', 'HUGE L', '#fda4af', '#ef4444'],
            ['sus', '👀', 'SUS', '#c4b5fd', '#8b5cf6'], ['nospoil', '🤫', 'NO SPOILERS', '#FF4D8D', '#be185d'], ['epwhen', '⏳', 'EP WHEN?', '#fdba74', '#f97316'], ['dead', '💀', 'I’M DEAD', '#e5e7eb', '#9ca3af'],
            ['bestgirl', '💘', 'BEST GIRL', '#fbcfe8', '#ec4899'], ['bestboy', '😎', 'BEST BOY', '#a5f3fc', '#06b6d4'], ['twist', '🤯', 'PLOT TWIST', '#d9f99d', '#84cc16'], ['binge', '🍿', 'BINGE?', '#fef08a', '#eab308'],
            ['hype', '😤', 'HYPE', '#fca5a5', '#dc2626'], ['watch', '🙏', 'WATCH IT', '#B490F5', '#6d28d9'], ['goat', '🐐', 'GOAT', '#fde68a', '#d97706'], ['filler', '😴', 'FILLER', '#cbd5e1', '#64748b'],
        ].map(([id, e, t, a, b]) => ({ id, label: t, url: makeSticker(e, t, a, b) }));
        const stickerById = Object.fromEntries(STICKERS.map(x => [x.id, x]));

        const chats = ref([]);
        const chatWith = ref(null);
        const groupWith = ref(null);
        const chatMessages = ref([]);
        const chatLoading = ref(false);
        const chatDraft = ref('');
        const chatReplyTo = ref(null);
        const chatSending = ref(false);
        const chatPanel = ref('');               // '' | 'stickers' | 'gif'
        const chatSearch = ref('');
        const chatSearchBusy = ref(false);
        const gifState = reactive({ q: '', results: [], loading: false, link: '' });
        const chatScroll = ref(null);
        const chatFile = ref(null);
        const incomingRequests = computed(() => chats.value.filter(c => c.status === 'request' && c.requested_by !== uid()));
        const chatList = computed(() => chats.value.filter(c => !(c.status === 'request' && c.requested_by !== uid()) && !(c.status === 'declined' && c.requested_by !== uid())));
        const chatUnread = computed(() => chatList.value.reduce((n, c) => n + (Number(c.unread) || 0), 0) + incomingRequests.value.length + groupUnread.value);
        const currentChat = computed(() => chats.value.find(c => c.other === chatWith.value) || null);
        const chatBanner = computed(() => {
            const c = currentChat.value; if (!c) return friendsList.value.some(f => f.id === chatWith.value) ? '' : 'new-request';
            if (c.status === 'request') return c.requested_by === uid() ? 'waiting' : 'incoming';
            if (c.status === 'declined') return c.requested_by === uid() ? 'declined' : 'you-declined';
            return '';
        });
        const fetchChats = async () => {
            if (!uid()) return;
            const { data, error } = await sb.rpc('my_chats');
            if (error) { chats.value = []; return; }
            chats.value = data || [];
            ensureProfiles(chats.value.map(c => c.other));
        };
        const refreshChats = debounce(fetchChats, 400);
        const scrollChatDown = () => nextTick(() => { const el = chatScroll.value; if (el) el.scrollTop = el.scrollHeight; });
        const openChat = async (userId) => {
            if (!userId || userId === uid()) return;
            quickMenuFor.value = null; sendSheet.open = false;
            await ensureProfiles([userId]);
            navigate(() => { currentAppView.value = 'tracker'; activeTab.value = 'chat'; chatWith.value = userId; groupWith.value = null; selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
        };
        const loadChat = async (userId) => {
            chatMessages.value = []; chatReplyTo.value = null; chatPanel.value = '';
            if (!userId) return;
            chatLoading.value = true;
            const { data } = await sb.from('messages').select('*').in('sender_id', [uid(), userId]).in('receiver_id', [uid(), userId]).order('created_at', { ascending: true }).limit(300);
            if (chatWith.value !== userId) return;
            chatMessages.value = data || [];
            chatLoading.value = false;
            scrollChatDown();
            markChatRead(userId);
        };
        const markChatRead = async (userId) => {
            const c = chats.value.find(x => x.other === userId);
            if (c) c.unread = 0;
            await sb.rpc('mark_chat_read', { other: userId }).then(() => {}, () => {});
            notifications.value.filter(n => (n.kind === 'message' || n.kind === 'message_request') && n.actor_id === userId && !n.read).forEach(n => { n.read = true; sb.from('notifications').update({ read: true }).eq('id', n.id).then(() => {}, () => {}); });
        };
        watch(() => activeTab.value === 'chat' && currentAppView.value === 'tracker' ? chatWith.value : null, (id) => { if (id) loadChat(id); });
        watch(() => activeTab.value === 'chat', (on) => { if (on) fetchChats(); });

        // ---------- group chats ----------
        const groups = ref([]);
        const groupMessages = ref([]);
        const groupMembersOf = reactive({});          // group id → [user id, …]
        const groupUnread = computed(() => groups.value.reduce((n, g) => n + (Number(g.unread) || 0), 0));
        const groupById = computed(() => new Map(groups.value.map(g => [g.id, g])));
        const groupInfo = computed(() => groupById.value.get(groupWith.value) || null);
        const groupDraft = reactive({ open: false, name: '', members: new Set(), busy: false });
        const addMemberDraft = reactive({ open: false, q: '', busy: false });
        const fetchGroups = async () => {
            if (!uid()) return;
            const { data, error } = await sb.rpc('my_groups');
            if (error) { groups.value = []; return; }
            groups.value = data || [];
            ensureProfiles(groups.value.map(g => g.last_sender).filter(Boolean));
        };
        const refreshGroups = debounce(fetchGroups, 400);
        const fetchGroupMembers = async (gid) => {
            const { data, error } = await sb.rpc('group_member_ids', { gid });
            if (error) return;
            groupMembersOf[gid] = (data || []).map(r => (typeof r === 'string' ? r : r.user_id ?? r));
            ensureProfiles(groupMembersOf[gid]);
        };
        const groupMemberProfiles = computed(() => (groupMembersOf[groupWith.value] || []).map(personOf));
        const openGroup = async (gid) => {
            if (!gid) return;
            quickMenuFor.value = null; sendSheet.open = false;
            navigate(() => { currentAppView.value = 'tracker'; activeTab.value = 'chat'; groupWith.value = gid; chatWith.value = null; selectedAnime.value = null; viewUserId.value = null; entity.value = null; });
        };
        const loadGroup = async (gid) => {
            groupMessages.value = []; chatReplyTo.value = null; chatPanel.value = '';
            if (!gid) return;
            chatLoading.value = true;
            fetchGroupMembers(gid);
            const { data } = await sb.from('messages').select('*').eq('group_id', gid).order('created_at', { ascending: true }).limit(300);
            if (groupWith.value !== gid) return;
            groupMessages.value = data || [];
            chatLoading.value = false;
            scrollChatDown();
            markGroupRead(gid);
        };
        const markGroupRead = async (gid) => {
            const g = groups.value.find(x => x.id === gid);
            if (g) g.unread = 0;
            await sb.rpc('mark_group_read', { gid }).then(() => {}, () => {});
            notifications.value.filter(n => n.kind === 'group_message' && n.group_id === gid && !n.read).forEach(n => { n.read = true; sb.from('notifications').update({ read: true }).eq('id', n.id).then(() => {}, () => {}); });
        };
        watch(() => activeTab.value === 'chat' && currentAppView.value === 'tracker' ? groupWith.value : null, (id) => { if (id) loadGroup(id); });
        watch(() => activeTab.value === 'chat', (on) => { if (on) fetchGroups(); });
        const openGroupDraft = () => { Object.assign(groupDraft, { open: true, name: '', members: new Set(), busy: false }); };
        const toggleGroupMember = (id) => { groupDraft.members.has(id) ? groupDraft.members.delete(id) : groupDraft.members.add(id); };
        const createGroupChat = async () => {
            if (!groupDraft.name.trim() || groupDraft.busy) return;
            groupDraft.busy = true;
            try {
                const { data, error } = await sb.rpc('create_group', { gname: groupDraft.name.trim(), member_ids: [...groupDraft.members] });
                if (error) throw error;
                groupDraft.open = false;
                await fetchGroups();
                showToast('Group created!');
                openGroup(data);
            } catch (err) {
                showToast('Could not create group: ' + (err.message || err) + (/create_group|group/i.test(err.message || '') ? ' — run the v7 SQL in Supabase' : ''), 'error');
            } finally { groupDraft.busy = false; }
        };
        const openAddMember = () => { Object.assign(addMemberDraft, { open: true, q: '', busy: false }); };
        const addableFriends = computed(() => {
            const have = new Set(groupMembersOf[groupWith.value] || []);
            const q = addMemberDraft.q.trim().toLowerCase();
            return friendsList.value.filter(f => !have.has(f.id) && (!q || (f.username || '').toLowerCase().includes(q)));
        });
        const addMemberTo = async (userId) => {
            if (addMemberDraft.busy) return;
            addMemberDraft.busy = true;
            try {
                const { error } = await sb.rpc('add_group_member', { gid: groupWith.value, member_id: userId });
                if (error) throw error;
                await fetchGroupMembers(groupWith.value);
                await fetchGroups();
                showToast('Added to the group');
            } catch (err) { showToast('Could not add them: ' + (err.message || err), 'error'); }
            finally { addMemberDraft.busy = false; }
        };
        const leaveGroupChat = async (gid) => {
            if (!(await askConfirm({ title: 'Leave this group?', body: 'You’ll stop seeing its messages.', ok: 'Leave group' }))) return;
            const { error } = await sb.rpc('leave_group', { gid });
            if (error) { showToast(error.message, 'error'); return; }
            groups.value = groups.value.filter(g => g.id !== gid);
            if (groupWith.value === gid) navigate(() => { groupWith.value = null; });
            showToast('Left the group');
        };
        const startChatByName = async () => {
            const name = chatSearch.value.trim().replace(/^@/, ''); if (!name) return;
            chatSearchBusy.value = true;
            const { data } = await sb.from('profiles').select('id, username, avatar_url, accent, bio').ilike('username', escapeLike(name)).maybeSingle();
            chatSearchBusy.value = false;
            if (!data) { showToast('No user with that username', 'error'); return; }
            if (data.id === uid()) { showToast('That’s you!', 'error'); return; }
            if (!profileById.value.has(data.id)) extraProfiles.value = [...extraProfiles.value, data];
            chatSearch.value = '';
            openChat(data.id);
        };
        const sendMessage = async (msg, to = chatWith.value) => {
            if (!to || chatSending.value) return false;
            chatSending.value = true;
            const row = { sender_id: uid(), receiver_id: to, kind: msg.kind || 'text', body: msg.body ?? null, payload: msg.payload ?? null };
            if (to === chatWith.value && chatReplyTo.value) row.reply_to = chatReplyTo.value.id;
            try {
                const { data, error } = await sb.from('messages').insert(row).select().single();
                if (error) throw error;
                if (to === chatWith.value) { chatMessages.value = [...chatMessages.value.filter(m => m.id !== data.id), data]; chatReplyTo.value = null; scrollChatDown(); }
                refreshChats();
                return true;
            } catch (err) {
                showToast(/declined/i.test(err.message || '') ? 'They declined your message request' : 'Could not send: ' + (err.message || err) + (/messages/.test(err.message || '') ? ' — run the v6 SQL in Supabase' : ''), 'error');
                return false;
            } finally { chatSending.value = false; }
        };
        const sendGroupMessage = async (msg, gid = groupWith.value) => {
            if (!gid || chatSending.value) return false;
            chatSending.value = true;
            const row = { sender_id: uid(), group_id: gid, kind: msg.kind || 'text', body: msg.body ?? null, payload: msg.payload ?? null };
            if (gid === groupWith.value && chatReplyTo.value) row.reply_to = chatReplyTo.value.id;
            try {
                const { data, error } = await sb.from('messages').insert(row).select().single();
                if (error) throw error;
                if (gid === groupWith.value) { groupMessages.value = [...groupMessages.value.filter(m => m.id !== data.id), data]; chatReplyTo.value = null; scrollChatDown(); }
                refreshGroups();
                return true;
            } catch (err) {
                showToast('Could not send: ' + (err.message || err) + (/group|messages/i.test(err.message || '') ? ' — run the v7 SQL in Supabase' : ''), 'error');
                return false;
            } finally { chatSending.value = false; }
        };
        // whichever pane is open (a DM or a group) gets the message
        const sendAny = (msg) => groupWith.value ? sendGroupMessage(msg) : sendMessage(msg);
        const sendText = async () => { const body = chatDraft.value.trim(); if (!body) return; if (await sendAny({ kind: 'text', body: body.slice(0, 4000) })) chatDraft.value = ''; };
        const sendSticker = (st) => { chatPanel.value = ''; sendAny({ kind: 'sticker', payload: { id: st.id } }); };
        const sendGif = (url, kind = 'gif') => { chatPanel.value = ''; gifState.link = ''; sendAny({ kind, payload: { url } }); };
        const sendGifLink = () => { const u = gifState.link.trim(); if (!/^https?:\/\/\S+$/i.test(u)) { showToast('Paste a full link (https://…)', 'error'); return; } sendGif(u, /\.gif(\?|$)/i.test(u) || /tenor|giphy/i.test(u) ? 'gif' : 'image'); };
        const searchGifs = debounce(async () => {
            const q = gifState.q.trim();
            if (!TENOR_KEY || !q) { gifState.results = []; return; }
            gifState.loading = true;
            try {
                const res = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&client_key=anicoop&limit=24&contentfilter=medium&media_filter=tinygif,gif`);
                const json = await res.json();
                gifState.results = (json.results || []).map(r => ({ id: r.id, preview: r.media_formats?.tinygif?.url, url: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url })).filter(g => g.url);
            } catch { gifState.results = []; }
            finally { gifState.loading = false; }
        }, 400);
        watch(() => gifState.q, searchGifs);
        const onChatFile = async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (!f.type.startsWith('image/')) { showToast('Pick an image or GIF', 'error'); return; }
            if (f.size > 15 * 1024 * 1024) { showToast('Max 15 MB', 'error'); return; }
            chatSending.value = true;
            try {
                const up = f.type === 'image/gif' ? f : await compressImage(f);
                const path = `${uid()}/chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${f.type === 'image/gif' ? 'gif' : 'jpg'}`;
                const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, up, { contentType: up.type, upsert: false });
                if (error) throw error;
                const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
                chatSending.value = false;
                await sendAny({ kind: f.type === 'image/gif' ? 'gif' : 'image', payload: { url: data.publicUrl } });
            } catch (err) { showToast('Upload failed: ' + (err.message || err), 'error'); }
            finally { chatSending.value = false; chatPanel.value = ''; }
        };
        const unsendMessage = async (m) => {
            const { error } = await sb.from('messages').delete().eq('id', m.id);
            if (error) { showToast(error.message, 'error'); return; }
            if (m.group_id) { groupMessages.value = groupMessages.value.filter(x => x.id !== m.id); refreshGroups(); }
            else { chatMessages.value = chatMessages.value.filter(x => x.id !== m.id); refreshChats(); }
        };
        const respondChat = async (accept) => {
            const other = chatWith.value;
            const { error } = await sb.rpc('respond_chat', { other, accept });
            if (error) { showToast(error.message, 'error'); return; }
            showToast(accept ? 'Request accepted — you can chat now' : 'Request declined. They can’t message you anymore.');
            await fetchChats();
            if (!accept) navigate(() => { chatWith.value = null; });
        };
        const msgById = computed(() => new Map([...chatMessages.value, ...groupMessages.value].map(m => [m.id, m])));
        const msgPreview = (m) => {
            if (!m) return 'Message deleted';
            return ({ text: m.body, sticker: 'Sticker', gif: 'GIF', image: 'Picture', anime: '📺 ' + (m.payload?.title || 'Recommendation'), episode: '▶ ' + (m.payload?.title || '') + ' · Ep ' + (m.payload?.episode ?? '?') })[m.kind] || '';
        };
        const chatPreview = (c) => {
            const mine = c.last_sender === uid() ? 'You: ' : '';
            const t = ({ text: c.last_body, sticker: 'sent a sticker', gif: 'sent a GIF', image: 'sent a picture', anime: 'recommended an anime', episode: 'shared an episode' })[c.last_kind] || '';
            return mine + (t || '');
        };
        const dayLabel = (iso) => { const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
            return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
        const clockOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const onMessageRealtime = (p) => {
            const m = p.new;
            if (p.eventType === 'DELETE' || (!m && p.old)) {
                const old = p.old; const id = old?.id;
                if (old?.group_id) { groupMessages.value = groupMessages.value.filter(x => x.id !== id); refreshGroups(); }
                else { chatMessages.value = chatMessages.value.filter(x => x.id !== id); refreshChats(); }
                return;
            }
            if (!m) return;
            if (m.group_id) {
                if (m.group_id === groupWith.value && activeTab.value === 'chat') {
                    if (!groupMessages.value.some(x => x.id === m.id)) { groupMessages.value = [...groupMessages.value, m]; scrollChatDown(); }
                    if (m.sender_id !== uid()) markGroupRead(m.group_id);
                }
                refreshGroups();
                return;
            }
            const other = m.sender_id === uid() ? m.receiver_id : m.sender_id;
            if (other === chatWith.value && activeTab.value === 'chat') {
                if (!chatMessages.value.some(x => x.id === m.id)) { chatMessages.value = [...chatMessages.value, m]; scrollChatDown(); }
                if (m.receiver_id === uid()) markChatRead(other);
            }
            refreshChats();
        };
        const chatPickerOpen = () => openPicker('chat');
        const recommendToChat = (a) => sendAny({ kind: 'anime', payload: { media_id: a.id, type: a.type || 'ANIME', title: titleOf(a), cover: a.coverImage?.large || null } });

        // "Send to…" from an anime page or an episode
        const sendSheet = reactive({ open: false, payload: null, kind: 'anime', note: '', q: '', busy: false });
        const openSendSheet = (kind, payload) => { Object.assign(sendSheet, { open: true, kind, payload, note: '', q: '', busy: false }); if (!chats.value.length) fetchChats(); };
        const sendAnimeTo = (a) => openSendSheet('anime', { media_id: a.id, type: a.type || 'ANIME', title: titleOf(a), cover: a.coverImage?.large || null });
        const sendEpisodeTo = (a, ep) => openSendSheet('episode', { media_id: a.id, type: a.type || 'ANIME', title: titleOf(a), cover: a.coverImage?.large || null, episode: ep.n, name: ep.name || ep.title, url: ep.url, site: ep.site, thumbnail: ep.thumbnail || null });
        const sendTargets = computed(() => {
            const seen = new Set(); const out = [];
            chats.value.filter(c => c.status !== 'declined').forEach(c => { if (!seen.has(c.other)) { seen.add(c.other); out.push(personOf(c.other)); } });
            friendsList.value.forEach(f => { if (!seen.has(f.id)) { seen.add(f.id); out.push(f); } });
            const q = sendSheet.q.trim().toLowerCase();
            return q ? out.filter(p => (p.username || '').toLowerCase().includes(q)) : out;
        });
        const sendSheetTo = async (person) => {
            if (sendSheet.busy) return;
            sendSheet.busy = true;
            const ok = await sendMessage({ kind: sendSheet.kind, payload: sendSheet.payload }, person.id);
            if (ok && sendSheet.note.trim()) await sendMessage({ kind: 'text', body: sendSheet.note.trim() }, person.id);
            sendSheet.busy = false;
            if (ok) { sendSheet.open = false; showToast(`Sent to ${person.username}`); }
        };

        // ---------- friends on this anime (anime page) ----------
        const friendsOnAnime = computed(() => {
            const id = selectedAnime.value?.id; if (!id) return [];
            const friendIds = new Set(friendsList.value.map(f => f.id));
            return friendEntries.value.filter(r => r.media_id === id && friendIds.has(r.user_id))
                .map(r => ({ person: personOf(r.user_id), status: r.status, score: Number(r.score) || 0, progress: r.progress || 0 }))
                .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.score - a.score);
        });

        // ---------- who's online (Supabase Realtime presence) + everyone on the app ----------
        const onlineIds = ref(new Set());
        let presenceChannel = null;
        const startPresence = () => {
            stopPresence();
            if (!uid() || !PREFS.showOnline || typeof sb.channel !== 'function') return;
            try {
                presenceChannel = sb.channel('anicoop-online', { config: { presence: { key: uid() } } });
                if (typeof presenceChannel.track !== 'function') return;
                const sync = () => { try { onlineIds.value = new Set(Object.keys(presenceChannel.presenceState() || {})); } catch {} };
                presenceChannel.on('presence', { event: 'sync' }, sync).on('presence', { event: 'join' }, sync).on('presence', { event: 'leave' }, sync)
                    .subscribe((st) => { if (st === 'SUBSCRIBED') presenceChannel.track({ at: Date.now() }); });
            } catch {}
        };
        const stopPresence = () => { if (presenceChannel) { try { sb.removeChannel(presenceChannel); } catch {} presenceChannel = null; } onlineIds.value = new Set(); };
        watch(() => PREFS.showOnline, () => { if (uid()) { startPresence(); touchLastSeen(); } });
        const isOnline = (id) => id === uid() ? !!PREFS.showOnline : onlineIds.value.has(id);
        const touchLastSeen = async () => { if (uid() && PREFS.showOnline) await sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', uid()).then(() => {}, () => {}); };
        setInterval(touchLastSeen, 5 * 60 * 1000);
        const people = ref([]);
        const peopleTab = ref('friends');           // friends | online | everyone (friends panel tabs)
        const peopleLoading = ref(false);
        const fetchPeople = async () => {
            peopleLoading.value = true;
            const { data } = await sb.from('profiles').select('*').order('last_seen', { ascending: false, nullsFirst: false }).limit(300);
            peopleLoading.value = false;
            people.value = (data || []).filter(p => p.id !== uid());
            const known = new Set(profileById.value.keys());
            const add = people.value.filter(p => !known.has(p.id));
            if (add.length) extraProfiles.value = [...extraProfiles.value, ...add];
        };
        watch(peopleTab, (t) => { if (t !== 'friends') fetchPeople(); });
        const peopleOnline = computed(() => people.value.filter(p => onlineIds.value.has(p.id)));
        const peopleOffline = computed(() => people.value.filter(p => !onlineIds.value.has(p.id)));
        const lastSeenText = (p) => onlineIds.value.has(p.id) ? 'online now' : p.last_seen ? 'seen ' + timeAgo(p.last_seen) : 'offline';
        const friendStateOf = (id) => friendsList.value.some(f => f.id === id) ? 'friend' : sentRequests.value.some(r => r.id === id) ? 'sent' : pendingRequests.value.some(r => r.id === id) ? 'incoming' : 'none';
        const addFriendById = async (id) => { const p = personOf(id); if (!p?.username) return; friendUsername.value = p.username; await addFriend(); };

        // ---------- their friends (on a friend's profile, if their privacy allows) ----------
        const viewedFriends = ref(null);            // null = hidden / not loaded, [] = none
        const loadViewedFriends = async (userId) => {
            viewedFriends.value = null;
            const { data, error } = await sb.rpc('friends_of', { owner: userId });
            if (error || viewUserId.value !== userId) return;
            if (data?.hidden) { viewedFriends.value = 'hidden'; return; }
            const ids = (data?.ids || []).filter(Boolean);
            await ensureProfiles(ids);
            if (viewUserId.value === userId) viewedFriends.value = ids.map(personOf);
        };
        watch(viewUserId, (id) => { if (id) loadViewedFriends(id); });


        // ---------- profile decorations (frames, themes, badges) ----------
        const FRAMES = [
            { v: 'none', l: 'None' }, { v: 'neon', l: 'Neon' }, { v: 'sakura', l: 'Sakura' }, { v: 'flame', l: 'Flame' },
            { v: 'gold', l: 'Gold' }, { v: 'ice', l: 'Ice' }, { v: 'rainbow', l: 'Rainbow' }, { v: 'void', l: 'Void' },
            { v: 'thunder', l: 'Thunder' }, { v: 'toxic', l: 'Toxic' }, { v: 'hearts', l: 'Hearts' }, { v: 'stars', l: 'Starry' },
            { v: 'crown', l: 'Crown' }, { v: 'catears', l: 'Cat ears' }, { v: 'halo', l: 'Halo' }, { v: 'demon', l: 'Demon' },
            { v: 'pixel', l: 'Pixel' }, { v: 'glitch', l: 'Glitch' }, { v: 'bubble', l: 'Bubbles' }, { v: 'moon', l: 'Moon' },
        ];
        const THEMES = [
            { v: 'default', l: 'Default' }, { v: 'sunset', l: 'Sunset' }, { v: 'ocean', l: 'Ocean' }, { v: 'forest', l: 'Forest' },
            { v: 'sakura', l: 'Sakura' }, { v: 'cyber', l: 'Cyber' }, { v: 'blood', l: 'Crimson' }, { v: 'mono', l: 'Mono' },
            { v: 'aurora', l: 'Aurora' }, { v: 'galaxy', l: 'Galaxy' }, { v: 'gold', l: 'Royal gold' }, { v: 'vapor', l: 'Vaporwave' },
            { v: 'manga', l: 'Manga panel' }, { v: 'shrine', l: 'Shrine' }, { v: 'matrix', l: 'Matrix' }, { v: 'candy', l: 'Candy' },
        ];
        // animated effects over the profile card (like Discord profile effects)
        const EFFECTS = [
            { v: 'none', l: 'None' }, { v: 'petals', l: 'Sakura petals' }, { v: 'snow', l: 'Snow' }, { v: 'sparkles', l: 'Sparkles' },
            { v: 'embers', l: 'Embers' }, { v: 'rain', l: 'Rain' }, { v: 'hearts', l: 'Hearts' }, { v: 'stars', l: 'Shooting stars' },
        ];
        // how your name looks on your profile
        const NAME_STYLES = [
            { v: 'none', l: 'Normal' }, { v: 'rainbow', l: 'Rainbow' }, { v: 'gold', l: 'Gold' }, { v: 'neon', l: 'Neon glow' },
            { v: 'fire', l: 'Fire' }, { v: 'ice', l: 'Ice' }, { v: 'sakura', l: 'Sakura' }, { v: 'glitch', l: 'Glitch' },
        ];
        const effectParticles = (kind) => Array.from({ length: kind === 'rain' ? 26 : kind === 'stars' ? 6 : 16 }, (_, n) => ({ n, x: (n * 37 + 11) % 100, d: (n * 0.73) % 6, s: 0.7 + ((n * 13) % 7) / 10, t: 5 + (n * 7) % 6 }));
        // badges are earned automatically from what's on your list
        const BADGES = [
            { id: 'founder', l: 'Founding member', d: 'Joined anicoop in its first year', icon: 'fa-seedling', c: '#22c55e', test: (x) => x.created && new Date(x.created) < new Date('2027-09-01') },
            { id: 'owner', l: 'Owner', d: 'Runs this anicoop', icon: 'fa-crown', c: '#fbbf24', test: (x) => x.owner },
            { id: 'c10', l: 'Getting started', d: 'Completed 10 anime', icon: 'fa-flag-checkered', c: '#7dd3fc', test: (x) => x.done >= 10 },
            { id: 'c100', l: 'Centurion', d: 'Completed 100 anime', icon: 'fa-medal', c: '#c4b5fd', test: (x) => x.done >= 100 },
            { id: 'c500', l: 'Legend', d: 'Completed 500 anime', icon: 'fa-dragon', c: '#f472b6', test: (x) => x.done >= 500 },
            { id: 'e1k', l: '1K episodes', d: 'Watched 1,000 episodes', icon: 'fa-tv', c: '#60a5fa', test: (x) => x.eps >= 1000 },
            { id: 'e10k', l: 'No life', d: 'Watched 10,000 episodes', icon: 'fa-skull', c: '#f87171', test: (x) => x.eps >= 10000 },
            { id: 'reader', l: 'Bookworm', d: '1,000 chapters read', icon: 'fa-book-open', c: '#fb7185', test: (x) => x.ch >= 1000 },
            { id: 'movies', l: 'Movie night', d: 'Completed 20 anime movies', icon: 'fa-film', c: '#38bdf8', test: (x) => x.movies >= 20 },
            { id: 'critic', l: 'Critic', d: 'Scored 50 titles', icon: 'fa-star', c: '#facc15', test: (x) => x.scored >= 50 },
            { id: 'variety', l: 'Genre hopper', d: 'Completed anime in 12+ genres', icon: 'fa-shuffle', c: '#a3e635', test: (x) => x.genres >= 12 },
            { id: 'planner', l: 'Backlog boss', d: '200+ titles on Plan to watch', icon: 'fa-list-check', c: '#fdba74', test: (x) => x.plan >= 200 },
            { id: 'g10', l: 'Player one', d: 'Beat 10 games', icon: 'fa-gamepad', c: '#D4FF3A', test: (x) => x.gamesDone >= 10 },
            { id: 'g50', l: 'Completionist', d: 'Beat 50 games', icon: 'fa-trophy', c: '#fbbf24', test: (x) => x.gamesDone >= 50 },
            { id: 'h1k', l: 'Touch grass', d: 'Played 1,000 hours', icon: 'fa-hourglass-half', c: '#34d399', test: (x) => x.hours >= 1000 },
            { id: 'coop', l: 'Co-op crew', d: 'Beat 5 co-op games', icon: 'fa-people-group', c: '#22d3ee', test: (x) => x.coopDone >= 5 },
            // secret: only shows up once you've earned it
            { id: 'lilbro', secret: true, l: 'Lil bro', d: 'Tried to rewatch the same anime a 6th time. There are more anime out there.', icon: 'fa-face-grin-squint-tears', c: '#fb923c', test: (x) => x.lilbro },
        ];
        const ownerId = ref(null);
        const badgeFacts = (entries, created, userId) => {
            const anime = entries.filter(i => typeOf(i) === 'ANIME');
            const done = anime.filter(i => i.status === 'COMPLETED' || i.status === 'REPEATING');
            const st = statsFor(entries);
            return {
                created, owner: !!userId && userId === ownerId.value, done: done.length, eps: st.epsWatched, ch: st.chaptersRead,
                movies: done.filter(i => i.anime?.format === 'MOVIE').length, scored: entries.filter(i => i.score > 0).length,
                genres: new Set(done.flatMap(i => i.anime?.genres || [])).size, plan: entries.filter(i => i.status === 'PLANNING').length,
                gamesDone: entries.filter(i => typeOf(i) === 'GAME' && i.status === 'COMPLETED').length, hours: st.hoursPlayed,
                coopDone: entries.filter(i => typeOf(i) === 'GAME' && i.status === 'COMPLETED' && i.anime?.coop).length,
                lilbro: entries.some(i => i.lilbro),
            };
        };
        // badges you hid (Settings → Profile, or the × on your profile) don't show to anyone
        const earnedBadges = (entries, profile, withHidden = false) => {
            const f = badgeFacts(entries, profile?.created_at, profile?.id); const hidden = profile?.decor?.hidden || [];
            return BADGES.filter(b => b.test(f) && (withHidden || !hidden.includes(b.id)));
        };
        const sortBadges = (list, decor) => { const pin = decor?.pinned || []; return [...list].sort((a, b) => (pin.includes(b.id) - pin.includes(a.id))); };
        const myBadges = computed(() => sortBadges(earnedBadges(uniqueItems.value, currentProfile.value), currentProfile.value?.decor));
        const myEarnedBadges = computed(() => earnedBadges(uniqueItems.value, currentProfile.value, true));
        const viewedBadges = computed(() => viewedUser.value ? sortBadges(earnedBadges(viewedUser.value.entries || [], viewedUser.value.profile), viewedUser.value.profile?.decor) : []);
        const decorOf = (p) => p?.decor || {};
        // Profile page background (like Steam): bg = { type: 'none' | 'theme' | 'image', v: theme id or image url, dim: 0–85 (% darker) }
        const BG_NONE = { type: 'none', v: '', dim: 55 };
        const normBg = (b) => (b && ['theme', 'image'].includes(b.type) && b.v ? { type: b.type, v: String(b.v), dim: clamp(Number(b.dim ?? 55), 0, 85) } : { ...BG_NONE });
        const decorDraft = reactive({ frame: 'none', theme: 'default', tagline: '', pinned: [], hidden: [], effect: 'none', name: 'none', bg: { ...BG_NONE } });
        const loadDecorDraft = () => { const d = decorOf(currentProfile.value); Object.assign(decorDraft, { frame: d.frame || 'none', theme: d.theme || 'default', tagline: d.tagline || '', pinned: [...(d.pinned || [])], hidden: [...(d.hidden || [])], effect: d.effect || 'none', name: d.name || 'none', bg: normBg(d.bg) }); bgUrlDraft.value = d.bg?.type === 'image' ? d.bg.v : ''; };
        const bgUrlDraft = ref('');
        const bgUploading = ref(false);
        const bgInput = ref(null);
        // the fixed layer behind a profile page (yours or a friend's); in Settings it previews the draft
        const profileBg = (decor) => {
            const b = normBg(decor?.bg); if (b.type === 'none') return null;
            return { cls: b.type === 'theme' ? 'pt-' + b.v : '', style: { ...(b.type === 'image' ? { backgroundImage: `url("${b.v.replace(/"/g, '%22')}")` } : {}), '--dim': b.dim / 100 } };
        };
        // the background of the profile on screen (yours or a friend's). It sits behind the page (body turns see-through).
        const pageBg = computed(() => {
            if (currentAppView.value !== 'tracker' || selectedAnime.value || entity.value) return null;
            if (viewUserId.value) return profileBg(decorOf(viewedUser.value?.profile));
            return activeTab.value === 'profile' ? profileBg(decorOf(currentProfile.value)) : null;
        });
        watch(pageBg, (b) => document.body.classList.toggle('has-pbg', !!b), { immediate: true });
        // banners of titles on your list make good backgrounds: best-scored first
        const bgBannerChoices = computed(() => {
            const seen = new Set();
            return [...uniqueItems.value].filter(i => i.anime?.bannerImage && !seen.has(i.anime.bannerImage) && seen.add(i.anime.bannerImage))
                .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 12).map(i => ({ url: i.anime.bannerImage, title: titleOf(i.anime) }));
        });
        const setBgUrl = () => {
            const u = bgUrlDraft.value.trim();
            if (!/^https:\/\/\S+$/i.test(u)) { showToast('Paste an https:// image link', 'error'); return; }
            decorDraft.bg = { ...decorDraft.bg, type: 'image', v: u };
        };
        // your own picture: big photos are shrunk to 1920px wide first (GIFs are kept as they are)
        const onBgFile = async (e) => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (!file) return;
            if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
            if (file.size > (file.type === 'image/gif' ? 8 : 25) * 1024 * 1024) { showToast('That image is too large', 'error'); return; }
            bgUploading.value = true;
            try {
                let up = file, ext = 'gif';
                if (file.type !== 'image/gif') {
                    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
                    const scale = Math.min(1, 1920 / img.naturalWidth); const c = document.createElement('canvas');
                    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
                    up = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.84)); ext = 'jpg';
                }
                const path = `${uid()}/background-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
                const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, up, { contentType: ext === 'gif' ? 'image/gif' : 'image/jpeg', upsert: false });
                if (error) throw error;
                const url = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
                decorDraft.bg = { ...decorDraft.bg, type: 'image', v: url }; bgUrlDraft.value = url;
                showToast('Background uploaded — hit “Save look” to keep it');
            } catch (err) { showToast('Could not upload: ' + (err.message || err), 'error'); }
            finally { bgUploading.value = false; }
        };
        const togglePinBadge = (id) => {
            if (decorDraft.hidden.includes(id)) { showToast('Show this badge first to feature it', 'error'); return; }
            const i = decorDraft.pinned.indexOf(id); if (i !== -1) decorDraft.pinned.splice(i, 1); else if (decorDraft.pinned.length < 3) decorDraft.pinned.push(id); else showToast('You can feature up to 3 badges', 'error');
        };
        const toggleHideBadge = (id) => {
            const i = decorDraft.hidden.indexOf(id);
            if (i !== -1) decorDraft.hidden.splice(i, 1);
            else { decorDraft.hidden.push(id); decorDraft.pinned = decorDraft.pinned.filter(x => x !== id); }
        };
        // the × on a badge on your own profile hides it right away
        const hideBadgeNow = async (b) => {
            const d = decorOf(currentProfile.value);
            try {
                await saveProfileFields({ decor: { ...d, hidden: [...new Set([...(d.hidden || []), b.id])], pinned: (d.pinned || []).filter(x => x !== b.id) } });
                showToast(`“${b.l}” is hidden — bring it back in Edit profile`);
            } catch (err) { showToast('Could not hide it: ' + (err.message || err), 'error'); }
        };
        const decorKey = (d) => JSON.stringify({ frame: d.frame || 'none', theme: d.theme || 'default', tagline: (d.tagline || '').trim(), pinned: d.pinned || [], hidden: [...(d.hidden || [])].sort(), effect: d.effect || 'none', name: d.name || 'none', bg: normBg(d.bg) });
        const decorDirty = computed(() => decorKey(decorDraft) !== decorKey(decorOf(currentProfile.value)));
        const saveDecor = async () => {
            try {
                await saveProfileFields({ decor: { frame: decorDraft.frame, theme: decorDraft.theme, tagline: decorDraft.tagline.trim().slice(0, 60), pinned: decorDraft.pinned.slice(0, 3), hidden: [...decorDraft.hidden], effect: decorDraft.effect, name: decorDraft.name, bg: normBg(decorDraft.bg) } });
                showToast('Profile look saved!');
            } catch (err) { showToast(/decor/.test(err.message || '') ? 'Decorations need the latest database update — run the whole supabase_setup.sql in Supabase again (it ends by refreshing the API), then try again.' : 'Could not save: ' + (err.message || err), 'error'); }
        };
        watch(() => settingsOpen.value && settingsTab.value, (t) => { if (t === 'profile') loadDecorDraft(); });
        const fetchOwnerId = async () => { const { data } = await sb.from('app_admins').select('user_id').limit(1); ownerId.value = data?.[0]?.user_id || null; };

        // ---------- feedback board: anyone posts, everyone sees, up/down votes like Reddit ----------
        const fb = reactive({ list: [], votes: {}, sort: 'top', cat: 'ALL', loading: false, draft: { title: '', body: '', category: 'idea' }, posting: false, error: '' });
        const FB_CATS = [{ v: 'idea', l: 'Idea', icon: 'fa-lightbulb', c: '#D4FF3A' }, { v: 'bug', l: 'Bug', icon: 'fa-bug', c: '#f87171' }, { v: 'other', l: 'Other', icon: 'fa-comment', c: '#B490F5' }];
        const FB_STATUS = { open: ['Open', '#8b8b99'], planned: ['Planned', '#3b82f6'], done: ['Done', '#22c55e'], declined: ['Declined', '#ef4444'] };
        const fetchFeedback = async () => {
            if (!uid()) return;
            fb.loading = true; fb.error = '';
            const [{ data, error }, { data: votes }] = await Promise.all([
                sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(300),
                selectAll(() => sb.from('feedback_votes').select('feedback_id, user_id, value')),
            ]);
            fb.loading = false;
            if (error) { fb.error = /feedback/.test(error.message) ? 'The feedback board needs the latest database update — run supabase_setup.sql in Supabase.' : error.message; return; }
            const v = {};
            (votes || []).forEach(r => { const x = v[r.feedback_id] || (v[r.feedback_id] = { score: 0, mine: 0 }); x.score += r.value; if (r.user_id === uid()) x.mine = r.value; });
            fb.votes = v; fb.list = data || [];
            ensureProfiles(fb.list.map(f => f.user_id));
        };
        const fbScore = (f) => fb.votes[f.id]?.score || 0;
        const fbMine = (f) => fb.votes[f.id]?.mine || 0;
        const fbShown = computed(() => {
            const list = fb.list.filter(f => fb.cat === 'ALL' || f.category === fb.cat);
            if (fb.sort === 'new') return list;
            // "top" = score, with a small boost for recent posts so new ideas get seen
            const hot = (f) => fbScore(f) + 2 / (1 + (Date.now() - new Date(f.created_at).getTime()) / 864e5);
            return [...list].sort((a, b) => fb.sort === 'hot' ? hot(b) - hot(a) : fbScore(b) - fbScore(a) || String(b.created_at).localeCompare(String(a.created_at)));
        });
        const voteFeedback = async (f, value) => {
            const cur = fbMine(f); const next = cur === value ? 0 : value;
            const v = fb.votes[f.id] || (fb.votes[f.id] = { score: 0, mine: 0 });
            v.score += next - cur; v.mine = next;
            const { error } = next === 0
                ? await sb.from('feedback_votes').delete().eq('feedback_id', f.id).eq('user_id', uid())
                : await sb.from('feedback_votes').upsert({ feedback_id: f.id, user_id: uid(), value: next }, { onConflict: 'feedback_id,user_id' });
            if (error) { showToast('Could not vote: ' + error.message, 'error'); fetchFeedback(); }
        };
        const postFeedback = async () => {
            const title = fb.draft.title.trim();
            if (title.length < 3 || fb.posting) { if (title.length < 3) showToast('Give it a short title (3+ characters)', 'error'); return; }
            fb.posting = true;
            const { data, error } = await sb.from('feedback').insert({ user_id: uid(), title: title.slice(0, 120), body: fb.draft.body.trim().slice(0, 2000) || null, category: fb.draft.category }).select().single();
            fb.posting = false;
            if (error) { showToast('Could not post: ' + error.message, 'error'); return; }
            fb.list = [data, ...fb.list];
            fb.votes[data.id] = { score: 1, mine: 1 };
            sb.from('feedback_votes').upsert({ feedback_id: data.id, user_id: uid(), value: 1 }, { onConflict: 'feedback_id,user_id' }).then(() => {}, () => {});   // you upvote your own post, like Reddit
            Object.assign(fb.draft, { title: '', body: '' });
            showToast('Thanks! Your feedback is up for everyone to see');
        };
        const deleteFeedback = async (f) => {
            if (!(await askConfirm({ title: 'Delete this feedback?', body: f.title, ok: 'Delete' }))) return;
            const { error } = await sb.from('feedback').delete().eq('id', f.id);
            if (error) { showToast(error.message, 'error'); return; }
            fb.list = fb.list.filter(x => x.id !== f.id);
        };
        const setFeedbackStatus = async (f, status) => {
            const { error } = await sb.from('feedback').update({ status }).eq('id', f.id);
            if (error) { showToast(error.message, 'error'); return; }
            f.status = status;
        };
        watch(() => currentAppView.value === 'tracker' && activeTab.value === 'feedback' && !selectedAnime.value && !viewUserId.value, (on) => { if (on) fetchFeedback(); });

        // ---------- game page extras: Steam info, time to beat, whole franchise, characters ----------
        const gameExtra = reactive({ id: null, steam: null, ttb: null, series: [], seriesOpts: [], seriesIdx: 0, seriesLoading: false, storyIds: [], seriesView: 'release', chars: [], linkFallback: null });
        const loadSeries = async (g) => {
            const s = gameExtra.seriesOpts[gameExtra.seriesIdx]; if (!s) return;
            gameExtra.seriesLoading = true; gameExtra.series = []; gameExtra.storyIds = []; seriesLimit.value = 10;
            try {
                const [list, ord] = await Promise.all([gameApi.series(s, adultAllowed.value), sb.from('story_orders').select('media_ids').eq('series_key', s.key).maybeSingle()]);
                if (gameExtra.id !== g.id) return;
                gameExtra.series = list; gameExtra.storyIds = ord?.data?.media_ids || [];
            } catch (err) { console.warn('series', err.message || err); }
            finally { if (gameExtra.id === g.id) gameExtra.seriesLoading = false; }
        };
        // Steam prices around the world: the store's own price in each country, and roughly what it costs in US dollars
        // (exchange rates from open.er-api.com, refreshed every 6 hours) so they can be compared. Cheapest first.
        const STEAM_REGIONS = [['us', 'United States', '🇺🇸'], ['ca', 'Canada', '🇨🇦'], ['mx', 'Mexico', '🇲🇽'], ['br', 'Brazil', '🇧🇷'], ['ar', 'Argentina', '🇦🇷'],
            ['gb', 'United Kingdom', '🇬🇧'], ['de', 'Europe (Euro)', '🇪🇺'], ['pl', 'Poland', '🇵🇱'], ['tr', 'Turkey', '🇹🇷'], ['ua', 'Ukraine', '🇺🇦'], ['kz', 'Kazakhstan', '🇰🇿'],
            ['sa', 'Saudi Arabia', '🇸🇦'], ['ae', 'UAE', '🇦🇪'], ['za', 'South Africa', '🇿🇦'], ['in', 'India', '🇮🇳'], ['cn', 'China', '🇨🇳'], ['jp', 'Japan', '🇯🇵'],
            ['kr', 'South Korea', '🇰🇷'], ['id', 'Indonesia', '🇮🇩'], ['ph', 'Philippines', '🇵🇭'], ['au', 'Australia', '🇦🇺'], ['nz', 'New Zealand', '🇳🇿']];
        const regionPrices = reactive({ open: false, id: null, name: '', loading: false, rows: [], error: '', fx: false });
        let fxCache = null;
        const fxRates = async () => {
            if (fxCache && Date.now() - fxCache.at < 6 * 3600e3) return fxCache.rates;
            const j = JSON.parse(await textAny('https://open.er-api.com/v6/latest/USD'));
            if (!j?.rates) throw new Error('no rates');
            fxCache = { at: Date.now(), rates: j.rates }; return j.rates;
        };
        const openRegionPrices = async () => {
            const id = gameExtra.steam?.appid; if (!id) return;
            regionPrices.open = true;
            if (regionPrices.id === id && (regionPrices.rows.length || regionPrices.loading)) return;
            Object.assign(regionPrices, { id, name: titleOf(selectedAnime.value), loading: true, rows: [], error: '', fx: false });
            const fx = fxRates().catch(() => null);
            const rows = [], todo = [...STEAM_REGIONS];
            const worker = async () => {
                while (todo.length && regionPrices.id === id) {
                    const [cc, name, flag] = todo.shift();
                    let p = null, failed = false; try { p = (await steam('prices', [id], cc))?.[id] || null; } catch { failed = true; }
                    rows.push(p ? { cc, name, flag, ...p } : { cc, name, flag, na: true, failed });
                }
            };
            await Promise.all([worker(), worker(), worker(), worker()]);
            if (regionPrices.id !== id) return;
            const rates = await fx;
            rows.forEach(r => { r.usd = r.na ? null : !r.final ? 0 : rates && r.currency && rates[r.currency] ? r.final / 100 / rates[r.currency] : null; r.mine = r.cc === steamCountry(); });
            rows.sort((a, b) => (a.na - b.na) || ((a.usd ?? 1e9) - (b.usd ?? 1e9)));
            const cheapest = rows.find(r => !r.na && r.usd != null);
            if (cheapest && rows.some(r => r.usd > 0)) cheapest.best = true;
            Object.assign(regionPrices, { rows, loading: false, fx: !!rates, error: rows.every(r => r.na) ? 'Steam didn’t return prices for this game.' : '' });
        };
        const fmtUsd = (n) => n == null ? '' : n === 0 ? 'Free' : '$' + (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(2) : Math.round(n));
        const loadGameExtras = (g) => {
            // franchise first (everything related), then the tighter series/collection
            const opts = [...(g.series || [])].sort((a, b) => (a.field === 'franchises' ? 0 : 1) - (b.field === 'franchises' ? 0 : 1))
                .filter((s, n, all) => all.findIndex(x => x.name.toLowerCase() === s.name.toLowerCase()) === n);   // franchise + series often share a name
            Object.assign(gameExtra, { id: g.id, steam: null, ttb: null, series: [], seriesOpts: opts, seriesIdx: 0, storyIds: [], seriesView: 'release', chars: [], linkFallback: null });
            gameApi.timeToBeat([g.extId, ...(g.dlcIds || [])]).then(m => {
                if (gameExtra.id !== g.id) return;
                const t = m.get(g.extId); if (!t) return;
                const dlc = (g.dlcIds || []).reduce((n, id) => n + (m.get(id)?.completely || 0), 0);
                gameExtra.ttb = { story: hoursOf(t.hastily), sides: hoursOf(t.normally), full: hoursOf(t.completely), fullDlc: t.completely && dlc ? hoursOf(t.completely + dlc) : null, count: t.count || 0 };
            }).catch(() => {});
            if (g.steamId) steam('game', [g.steamId]).then(s => { if (gameExtra.id === g.id) gameExtra.steam = s; }).catch(() => { if (gameExtra.id === g.id) gameExtra.steam = false; });
            gameApi.characters(g.id).then(c => { if (gameExtra.id === g.id) gameExtra.chars = c; }).catch(() => {});
            loadSeries(g);
        };
        watch(() => selectedAnime.value?.type === 'GAME' ? selectedAnime.value.id : null, (id) => { if (id) loadGameExtras(selectedAnime.value); });
        watch(() => selectedAnime.value?.id, () => { gameExtra.linkFallback = null; });
        const pickSeries = (n) => { gameExtra.seriesIdx = n; gameExtra.seriesView = 'release'; loadSeries(selectedAnime.value); };
        // release order = by date; story order = the order your community arranged (new games fall in by date at the end)
        const seriesShown = computed(() => {
            const list = gameExtra.series;
            if (gameExtra.seriesView !== 'story' || !gameExtra.storyIds.length) return list;
            const pos = new Map(gameExtra.storyIds.map((id, k) => [id, k]));
            return [...list].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6) - (pos.has(b.id) ? pos.get(b.id) : 1e6));
        });
        const seriesTotals = computed(() => {
            const sum = (k) => Math.round(gameExtra.series.reduce((n, g) => n + (g.hours?.[k] || 0), 0));
            return { story: sum('story'), sides: sum('sides'), full: sum('full'), fullDlc: Math.round(gameExtra.series.reduce((n, g) => n + (g.hours?.fullDlc || g.hours?.full || 0), 0)),
                missing: gameExtra.series.filter(g => !g.hours?.sides).length, count: gameExtra.series.length };
        });
        const storyEdit = ref(false);
        // the franchise list starts with 10 games (all of them while you arrange the story order)
        const seriesLimit = ref(10);
        const seriesVisible = computed(() => storyEdit.value ? seriesShown.value : seriesShown.value.slice(0, seriesLimit.value));
        const storySort = makeSortable(async (_key, from, to) => {
            const ids = seriesShown.value.map(g => g.id);
            const [id] = ids.splice(from, 1); ids.splice(to, 0, id);
            gameExtra.storyIds = ids;
            const s = gameExtra.seriesOpts[gameExtra.seriesIdx];
            const { error } = await sb.from('story_orders').upsert({ series_key: s.key, media_ids: ids, updated_by: uid(), updated_at: new Date().toISOString() }, { onConflict: 'series_key' });
            if (error) showToast('Could not save the story order: ' + error.message + (/story_orders/.test(error.message) ? ' — run the latest supabase_setup.sql' : ''), 'error');
        }, () => storyEdit.value && gameExtra.seriesView === 'story');
        // store links try the installed app first (Steam, Epic, Microsoft Store); if nothing opens, you get the web page
        const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const appUrlOf = (l) => {
            if (isPhone) return null;
            if (l.type === 13) { const m = /\/app\/(\d+)/.exec(l.url); return m ? `steam://store/${m[1]}` : null; }
            if (l.type === 'spotify') { const m = /track\/([0-9A-Za-z]+)/.exec(l.url); return m ? `spotify:track:${m[1]}` : null; }
            if (l.type === 16) { const m = /store\.epicgames\.com\/(?:[a-z-]+\/)?p\/([^/?#]+)/i.exec(l.url); return m ? `com.epicgames.launcher://store/p/${m[1]}` : null; }
            if (l.type === 22 && /Windows/i.test(navigator.userAgent)) { const m = /\/([0-9A-Z]{12})(?:[/?#]|$)/.exec(l.url); return m ? `ms-windows-store://pdp/?productid=${m[1]}` : null; }
            return null;
        };
        const openGameLink = (l, e) => {
            const app = appUrlOf(l); if (!app) return;           // plain link: the browser opens it
            e.preventDefault();
            let left = false; const gone = () => { left = true; };
            window.addEventListener('blur', gone, { once: true });
            document.addEventListener('visibilitychange', gone, { once: true });
            gameExtra.linkFallback = null;
            window.location.href = app;
            setTimeout(() => {
                window.removeEventListener('blur', gone); document.removeEventListener('visibilitychange', gone);
                if (!left) gameExtra.linkFallback = l;             // app isn't installed → offer the website
            }, 1400);
        };
        const playVideo = (v) => { if (selectedAnime.value && v?.id) trailerOf.value = { ...selectedAnime.value, trailer: { id: v.id, site: 'youtube' } }; };
        // scroll a horizontal row with the ‹ › buttons
        const scrollRow = (e, dir) => { const row = e.currentTarget.closest('.row-wrap')?.querySelector('.row-scroll'); if (row) row.scrollBy({ left: dir * Math.max(240, row.clientWidth * 0.8), behavior: 'smooth' }); };
        // full-screen screenshot viewer with ‹ › and arrow keys
        const shotViewer = reactive({ list: [], i: -1 });
        const openShot = (list, i) => Object.assign(shotViewer, { list, i });
        const closeShot = () => { shotViewer.i = -1; };
        const stepShot = (d) => { if (shotViewer.i >= 0) shotViewer.i = (shotViewer.i + d + shotViewer.list.length) % shotViewer.list.length; };
        window.addEventListener('keydown', (e) => { if (shotViewer.i < 0) return; if (e.key === 'ArrowRight') stepShot(1); else if (e.key === 'ArrowLeft') stepShot(-1); else if (e.key === 'Escape') closeShot(); });
        const fmtHours = (h) => h == null ? '–' : h >= 100 ? Math.round(h) + ' h' : h + ' h';

        // ---------- favourite characters, one shelf per section ----------
        const FAV_SECTIONS = [{ t: 'ANIME', l: 'Anime' }, { t: 'MANGA', l: 'Manga' }, { t: 'GAME', l: 'Games' }, { t: 'TV', l: 'Movies & TV' }];
        const favSectionOf = (c) => c.section || 'ANIME';     // favourites saved before sections existed were anime
        const favTab = reactive({ me: 'ANIME', them: 'ANIME' });
        const favsIn = (list, t) => (list || []).filter(c => favSectionOf(c) === t);
        const openFavChar = (p) => { if (p.section === 'GAME' || p.section === 'TV') { if (p.gameId) fetchAnimeDetails(p.gameId); } else openCharacter(p.id); };
        // favourite people, by kind: anime voice actors, actors (movies & TV), singers (songs) and staff
        const personKind = (p) => p.id < 0 ? 'SINGER' : (p.id >= PERSON_BASE && p.id < SONG_BASE) ? 'ACTOR' : p.kind === 'va' ? 'VA' : 'STAFF';
        // Actors aren't a tab in People (still counted as people, so an old "Actors" pick doesn't turn into characters)
        const FAV_PEOPLE = [{ t: 'VA', l: 'Voice actors' }, { t: 'SINGER', l: 'Singers' }, { t: 'STAFF', l: 'Staff' }];
        const isPeopleTab = (t) => t === 'ACTOR' || FAV_PEOPLE.some(x => x.t === t);
        const favItems = (chars, staff, t) => isPeopleTab(t) ? (staff || []).filter(p => personKind(p) === t) : favsIn(chars, t);
        const favCount = (chars, staff, t) => favItems(chars, staff, t).length;
        const openFavItem = (p, t) => { if (!isPeopleTab(t)) openFavChar(p); else if (p.id < 0) openArtist(-p.id); else openStaff(p.id); };
        const removeFavItem = (p, t) => isPeopleTab(t) ? toggleFavStaff(p, p.kind) : toggleFavChar(p);
        const FAV_EMPTY = { VA: 'Tap the heart next to a voice actor on any anime or character page.', ACTOR: 'Open an actor from a movie or show and tap “Favorite actor”.', SINGER: 'Open an artist from Songs and tap “Favorite singer”.', STAFF: 'Directors, writers, composers… tap the heart on their page.' };
        // a friend's favourites: the tab you picked, or the first one they have something in
        const favTheirTab = computed(() => {
            const v = viewedUser.value; if (!v) return favTab.them;
            const all = [...FAV_SECTIONS, ...FAV_PEOPLE];
            return favItems(v.favs, v.favStaff, favTab.them).length ? favTab.them : (all.find(s => favItems(v.favs, v.favStaff, s.t).length) || all[0]).t;
        });

        // ---------- profile Activity button (hideable) ----------
        const activityOpen = ref(false);
        const openViewedActivity = () => setViewedSection('activity');
        watch(() => viewedSection.value === 'activity' && viewUserId.value, (id) => { if (id) loadRecent(id); });
        watch(viewUserId, () => { viewedRecent.value = []; });
        const toggleMyActivity = () => { activityOpen.value = !activityOpen.value; if (activityOpen.value) loadRecent(uid()); };
        const setActivityHidden = async (hide) => {
            try { await saveProfileFields({ decor: { ...decorOf(currentProfile.value), hideActivity: !!hide } }); showToast(hide ? 'Your activity is hidden from your profile' : 'Your activity shows on your profile again'); }
            catch (err) { showToast('Could not save: ' + (err.message || err), 'error'); }
        };
        const activityLine = (a) => a.kind === 'list' ? `${activityVerb(a)} ${a.media_title || ''}`
            : `${({ post: 'Posted', poll: 'Started a poll', question: 'Asked', tierlist: 'Made a tier list', debate: 'Started a debate' })[a.kind] || 'Posted'}${a.body ? ': “' + String(a.body).slice(0, 90) + (String(a.body).length > 90 ? '…”' : '”') : ''}`;
        const openActivity = (a) => { if (a.media_id) fetchAnimeDetails(a.media_id); else { section.value = SECTION_OF_TYPE[a.media_type] || section.value; openTracker('feed'); } };

        // ---------- games on your lists: checked once a day (release date, early access → released, delisted …) ----------
        const checkGames = async ({ force = false } = {}) => {
            const me = uid(); if (!me) return;
            const KEY = `anicoop_gamecheck:${me}`;
            try { if (!force && localStorage.getItem(KEY) === localDay()) return; } catch { return; }
            const all = new Map();
            [...soloList.value, ...coopList.value].forEach(i => { if (i.anime?.type === 'GAME') all.set(i.anime.id, i.anime); });
            if (!all.size) return;
            let fresh;
            try { fresh = await gameApi.refresh([...all.keys()]); } catch (err) { console.warn('game check skipped:', err.message || err); return; }
            try { localStorage.setItem(KEY, localDay()); } catch {}
            const notes = [];
            fresh.forEach(g => {
                const old = all.get(g.id); if (!old) return;
                const ch = [];
                if (old.status === 'NOT_YET_RELEASED' && g.status === 'FINISHED') ch.push('It’s out now!');
                else if ((old.gameStatus || null) !== (g.gameStatus || null)) ch.push(`Status: ${old.gameStatus || (old.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Released')} → ${g.gameStatus || (g.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Released')}`);
                if (old.releaseDate && g.releaseDate && old.releaseDate.slice(0, 10) !== g.releaseDate.slice(0, 10) && g.status === 'NOT_YET_RELEASED')
                    ch.push(`Release date moved to ${new Date(g.releaseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
                if (ch.length && notifOn('media_changed')) notes.push({ user_id: me, kind: 'media_changed', media_id: g.id, media_type: 'GAME', media_title: titleOf(g), media_cover: g.coverImage?.large || null, text: ch.join(' · ') });
            });
            if (notes.length) { const { error } = await sb.from('notifications').insert(notes); if (!error) fetchNotifications(); }
            const byId = new Map(fresh.map(g => [g.id, g]));
            const soloRows = soloList.value.filter(e => byId.has(e.anime.id) && JSON.stringify(slimAnime(byId.get(e.anime.id))) !== JSON.stringify(slimAnime(e.anime)))
                .map(e => ({ user_id: me, media_id: e.anime.id, media_type: 'GAME', media_data: entryData(e, byId.get(e.anime.id)), status: e.status, score: e.score, progress: e.progress, updated_at: e.updatedAt }));
            if (soloRows.length) { const { error } = await sb.from('list_entries').upsert(soloRows, { onConflict: 'user_id,media_id' }); if (!error) fetchSolo(); }
        };

        // ---------- anime alerts: follow a title → get told about new episodes, seasons and changes ----------
        const follows = ref([]);
        const followIds = computed(() => new Set(follows.value.map(f => f.media_id)));
        const isFollowing = (id) => followIds.value.has(id);
        const followSnap = (m) => ({
            s: m.status || null, e: m.episodes || m.chapters || null, f: m.format || null,
            n: m.nextAiringEpisode?.episode || null,
            r: (m.relations?.edges || []).filter(e => e.node?.type === 'ANIME' || e.node?.type === 'MANGA').map(e => e.node.id),
            media: slimAnime(m),
        });
        const fetchFollows = async () => {
            if (!uid()) return;
            const { data, error } = await sb.from('media_follows').select('*').eq('user_id', uid());
            if (!error) follows.value = data || [];
        };
        const toggleFollow = async (m) => {
            if (!m?.id) return;
            if (isFollowing(m.id)) {
                follows.value = follows.value.filter(f => f.media_id !== m.id);
                const { error } = await sb.from('media_follows').delete().eq('user_id', uid()).eq('media_id', m.id);
                if (error) { showToast(error.message, 'error'); fetchFollows(); return; }
                showToast(`Alerts off for ${titleOf(m)}`);
                return;
            }
            const row = { user_id: uid(), media_id: m.id, media_type: m.type || 'ANIME', data: followSnap(m) };
            follows.value = [...follows.value, row];
            const { error } = await sb.from('media_follows').upsert(row, { onConflict: 'user_id,media_id' });
            if (error) { showToast('Could not turn alerts on: ' + error.message + (/media_follows/.test(error.message) ? ' — run the v7.2 SQL in Supabase' : ''), 'error'); fetchFollows(); return; }
            showToast(`🔔 You’ll be told about new episodes, seasons & updates for ${titleOf(m)}`);
        };
        // runs when the app opens (and every ~90 minutes while it's open); the snapshot lives in the database
        const checkFollowed = async ({ force = false } = {}) => {
            const me = uid(); if (!me || !follows.value.length) return;
            const KEY = `anicoop_followcheck:${me}`;
            try { if (!force && Date.now() - Number(localStorage.getItem(KEY) || 0) < 90 * 60 * 1000) return; localStorage.setItem(KEY, String(Date.now())); } catch {}
            const list = follows.value.filter(f => isAniListType(f.media_type)); const notes = []; const updates = [];
            try {
                for (let i = 0; i < list.length; i += 50) {
                    const chunk = list.slice(i, i + 50);
                    const data = await anilistLow(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { ${MEDIA_FIELDS} relations { edges { relationType node { id type title { romaji english native } } } } } } }`, { ids: chunk.map(f => f.media_id) });
                    const got = new Map((data?.Page?.media || []).map(m => [m.id, m]));
                    chunk.forEach(f => {
                        const m = got.get(f.media_id); if (!m) return;
                        const old = f.data || {}; const cur = followSnap(m); const media = normMedia(m);
                        const unit = m.type === 'MANGA' ? 'Chapter' : 'Episode';
                        if (old.n && (cur.n > old.n || (!cur.n && cur.s === 'FINISHED'))) {
                            const last = cur.n ? cur.n - 1 : (cur.e || old.n);
                            notes.push({ kind: 'media_episode', media, text: last > old.n ? `${unit}s ${old.n}–${last} are out` : `${unit} ${last} is out${!cur.n ? ' (the final one)' : ''}` });
                        } else if (!old.n && cur.n && cur.s === 'RELEASING' && old.s !== 'RELEASING') notes.push({ kind: 'media_episode', media, text: `It started airing — ${unit.toLowerCase()} ${Math.max(1, cur.n - 1)} is out` });
                        const added = (m.relations?.edges || []).filter(e => (e.node?.type === 'ANIME' || e.node?.type === 'MANGA') && !(old.r || []).includes(e.node.id));
                        if (old.r && added.length) notes.push({ kind: 'media_related', media, text: 'New: ' + added.slice(0, 3).map(e => `${titleOf(e.node)} (${nice(e.relationType)})`).join(', ') });
                        const ch = [];
                        if (old.s && old.s !== cur.s && !(cur.s === 'FINISHED' && old.n)) ch.push(`Status: ${nice(old.s)} → ${nice(cur.s)}`);
                        if (old.e !== undefined && old.e !== cur.e && cur.e) ch.push(`${unit}s: ${old.e ?? '?'} → ${cur.e}`);
                        if (ch.length) notes.push({ kind: 'media_changed', media, text: ch.join(' · ') });
                        if (JSON.stringify(old) !== JSON.stringify(cur)) updates.push({ user_id: me, media_id: f.media_id, media_type: f.media_type, data: cur });
                    });
                }
            } catch (err) { console.warn('follow check skipped:', err.message || err); return; }
            if (updates.length) { await sb.from('media_follows').upsert(updates, { onConflict: 'user_id,media_id' }); fetchFollows(); }
            const rows = notes.map(n => ({ user_id: me, kind: n.kind, media_id: n.media.id, media_type: n.media.type || 'ANIME', media_title: titleOf(n.media), media_cover: n.media.coverImage?.large || null, text: n.text }));
            if (rows.length) { const { error } = await sb.from('notifications').insert(rows); if (!error) fetchNotifications(); }
        };
        setInterval(() => checkFollowed(), 30 * 60 * 1000);

        // ---------- links you save on an anime page ----------
        const mediaLinks = ref([]);
        const linkDraft = reactive({ url: '', label: '', episode: '', busy: false });
        const fetchMediaLinks = async (mediaId) => {
            mediaLinks.value = [];
            if (!uid() || !mediaId) return;
            const { data, error } = await sb.from('media_links').select('*').eq('user_id', uid()).eq('media_id', mediaId).order('created_at', { ascending: false });
            if (!error && selectedAnime.value?.id === mediaId) mediaLinks.value = data || [];
        };
        const saveMediaLink = async () => {
            let url = linkDraft.url.trim(); if (!url || linkDraft.busy || !selectedAnime.value) return;
            if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
            linkDraft.busy = true;
            const row = { user_id: uid(), media_id: selectedAnime.value.id, url: url.slice(0, 2000), label: linkDraft.label.trim().slice(0, 120) || null, episode: linkDraft.episode ? Math.max(0, Math.floor(Number(linkDraft.episode))) : null };
            const { data, error } = await sb.from('media_links').insert(row).select().single();
            linkDraft.busy = false;
            if (error) { showToast('Could not save link: ' + error.message + (/media_links/.test(error.message) ? ' — run the v7.2 SQL in Supabase' : ''), 'error'); return; }
            mediaLinks.value = [data, ...mediaLinks.value];
            Object.assign(linkDraft, { url: '', label: '', episode: '' });
        };
        const deleteMediaLink = async (l) => {
            mediaLinks.value = mediaLinks.value.filter(x => x.id !== l.id);
            await sb.from('media_links').delete().eq('id', l.id);
        };
        watch(() => selectedAnime.value?.id, (id) => { if (id) fetchMediaLinks(id); });

        // ---------- watch buddies: your Plan to watch lists stay in sync ----------
        const buddies = ref([]);        // rows from watch_buddies that involve you
        const fetchBuddies = async () => {
            if (!uid()) return;
            const { data, error } = await sb.from('watch_buddies').select('*').or(`requester.eq.${uid()},addressee.eq.${uid()}`);
            if (error) return;
            buddies.value = data || [];
            ensureProfiles(buddies.value.map(b => b.requester === uid() ? b.addressee : b.requester));
        };
        const buddyWith = (userId) => buddies.value.find(b => b.requester === userId || b.addressee === userId) || null;
        const buddyState = (userId) => { const b = buddyWith(userId); if (!b) return 'none'; if (b.status === 'accepted') return 'buddies'; return b.requester === uid() ? 'sent' : 'incoming'; };
        const buddyRequests = computed(() => buddies.value.filter(b => b.status === 'pending' && b.addressee === uid()));
        const buddyList = computed(() => buddies.value.filter(b => b.status === 'accepted').map(b => personOf(b.requester === uid() ? b.addressee : b.requester)));
        const askBuddy = async (userId) => {
            const { error } = await sb.from('watch_buddies').insert({ requester: uid(), addressee: userId });
            if (error) { showToast('Could not send: ' + error.message + (/watch_buddies/.test(error.message) ? ' — run the v7.2 SQL in Supabase' : ''), 'error'); return; }
            showToast(`Watch buddy request sent to ${personOf(userId).username}`);
            fetchBuddies();
        };
        const acceptBuddy = async (userId) => {
            const b = buddyWith(userId); if (!b) return;
            const { error } = await sb.from('watch_buddies').update({ status: 'accepted' }).eq('id', b.id);
            if (error) { showToast(error.message, 'error'); return; }
            showToast(`You and ${personOf(userId).username} are watch buddies — your Plan to watch lists are merged`);
            await fetchBuddies(); fetchSolo();
        };
        const endBuddy = async (userId) => {
            const b = buddyWith(userId); if (!b) return;
            const who = personOf(userId).username;
            if (b.status === 'accepted' && !(await askConfirm({ title: `Stop being watch buddies with ${who}?`, body: 'Your lists stay as they are; they just stop syncing.', ok: 'Stop syncing' }))) return;
            const { error } = await sb.from('watch_buddies').delete().eq('id', b.id);
            if (error) { showToast(error.message, 'error'); return; }
            showToast(b.status === 'accepted' ? `Stopped syncing with ${who}` : 'Request removed');
            fetchBuddies();
        };

        // ---------- AniList account link: changes you make here are copied to your AniList list ----------
        // The owner registers a (free) AniList API client once and pastes its id in Settings → Owner.
        const TO_ANILIST = { WATCHING: 'CURRENT', REPEATING: 'REPEATING', PLANNING: 'PLANNING', COMPLETED: 'COMPLETED', PAUSED: 'PAUSED', DROPPED: 'DROPPED' };
        const alLink = ref(null);
        const alClientId = ref('');
        const alClientDraft = ref('');
        const alSync = reactive({ pending: 0, error: '', pushing: false, pushed: 0, total: 0 });
        let alSuppress = false;          // imports don't echo back to AniList
        const alTokenKey = 'anicoop_al_pending_token';
        // AniList sends you back to the site with #access_token=… in the address
        (() => { try { const h = new URLSearchParams(location.hash.slice(1)); if (h.get('access_token')) { sessionStorage.setItem(alTokenKey, JSON.stringify({ t: h.get('access_token'), e: Number(h.get('expires_in')) || 31536000 })); history.replaceState(history.state, '', location.pathname + location.search); } } catch {} })();
        const anilistAuth = async (query, variables, token = alLink.value?.access_token) => {
            for (let attempt = 0; ; attempt++) {
                const res = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ query, variables }) });
                if (res.status === 429 && attempt < 3) { await sleep((Number(res.headers.get('Retry-After')) || 30) * 1000); continue; }
                const json = await res.json().catch(() => ({}));
                if (res.status === 401 || /invalid token|unauthorized/i.test(json.errors?.[0]?.message || '')) throw Object.assign(new Error('AniList sign-in expired — connect again in Settings'), { auth: true });
                if (json.errors?.length) throw Object.assign(new Error(json.errors[0].message), { status: json.errors[0].status });
                return json.data;
            }
        };
        const loadAniListLink = async () => {
            if (!uid()) return;
            const [{ data: cfg }, { data: link }] = await Promise.all([
                sb.from('app_config').select('value').eq('key', 'anilist').maybeSingle(),
                sb.from('account_links').select('*').eq('user_id', uid()).eq('provider', 'anilist').maybeSingle().then(r => r, () => ({ data: null })),
            ]);
            alClientId.value = cfg?.value?.client_id || ''; alClientDraft.value = alClientId.value;
            alLink.value = link && (!link.expires_at || new Date(link.expires_at) > new Date()) ? link : null;
            let pending = null; try { pending = JSON.parse(sessionStorage.getItem(alTokenKey) || 'null'); sessionStorage.removeItem(alTokenKey); } catch {}
            if (pending?.t) {
                try {
                    const d = await anilistAuth('query { Viewer { id name } }', {}, pending.t);
                    const row = { user_id: uid(), provider: 'anilist', access_token: pending.t, remote_id: d.Viewer.id, remote_name: d.Viewer.name, expires_at: new Date(Date.now() + pending.e * 1000).toISOString() };
                    const { error } = await sb.from('account_links').upsert(row, { onConflict: 'user_id,provider' });
                    if (error) throw error;
                    alLink.value = row;
                    showToast(`AniList connected as ${d.Viewer.name} — your changes will sync there`);
                    openSettings('import');
                } catch (err) { showToast('Could not connect AniList: ' + (err.message || err) + (/account_links/.test(err.message || '') ? ' — run the v7.2 SQL in Supabase' : ''), 'error'); }
            }
        };
        const connectAniList = () => {
            if (!alClientId.value) { showToast('The app owner needs to add an AniList client id first (Settings → Owner)', 'error'); return; }
            location.href = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(alClientId.value)}&response_type=token`;
        };
        const disconnectAniList = async () => {
            await sb.from('account_links').delete().eq('user_id', uid()).eq('provider', 'anilist');
            alLink.value = null; alQueue.clear(); alSync.pending = 0;
            showToast('AniList disconnected');
        };
        const saveAniListClient = async () => {
            const v = alClientDraft.value.trim();
            const { error } = await sb.from('app_config').update({ value: { client_id: v }, updated_at: new Date().toISOString() }).eq('key', 'anilist');
            if (error) { showToast(error.message, 'error'); return; }
            alClientId.value = v; showToast('AniList client id saved');
        };
        // queue: one AniList request at a time, newest change per title wins
        const alQueue = new Map();
        let alRunning = false;
        const alEnqueue = (id, op) => { if (!alLink.value || alSuppress || !id) return; alQueue.delete(id); alQueue.set(id, op); alSync.pending = alQueue.size; runAlQueue(); };
        const runAlQueue = async () => {
            if (alRunning) return; alRunning = true;
            try {
                while (alQueue.size && alLink.value) {
                    const [id, op] = alQueue.entries().next().value; alQueue.delete(id); alSync.pending = alQueue.size;
                    try {
                        if (op.kind === 'save') {
                            await anilistAuth('mutation ($id: Int, $st: MediaListStatus, $p: Int, $s: Int, $r: Int) { SaveMediaListEntry(mediaId: $id, status: $st, progress: $p, scoreRaw: $s, repeat: $r) { id } }',
                                { id, st: TO_ANILIST[op.status] || 'PLANNING', p: op.progress || 0, s: Math.round((op.score || 0) * 10), r: op.repeat || 0 });
                        } else {
                            const d = await anilistAuth('query ($u: Int, $id: Int) { MediaList(userId: $u, mediaId: $id) { id } }', { u: alLink.value.remote_id, id }).catch(e => { if (e.status === 404 || /not found/i.test(e.message)) return null; throw e; });
                            if (d?.MediaList?.id) await anilistAuth('mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }', { id: d.MediaList.id });
                        }
                        alSync.error = '';
                    } catch (err) {
                        alSync.error = err.message || String(err);
                        if (err.auth) { alLink.value = null; showToast(alSync.error, 'error'); break; }
                    }
                    await sleep(700);
                }
            } finally { alRunning = false; alSync.pending = alQueue.size; }
        };
        const pushAllToAniList = async () => {
            if (!alLink.value || alSync.pushing) return;
            if (!(await askConfirm({ title: `Copy all ${soloList.value.length} titles to AniList?`, body: 'Titles already there get this site’s status, progress and score. This takes about a second per title — you can keep using the app.', ok: 'Copy to AniList', danger: false }))) return;
            soloList.value.forEach(e => alEnqueue(e.anime.id, alSaveOp(e)));
            showToast('Syncing to AniList in the background…');
        };

        // Home: 3 random trending posters, different every time the app opens
        // The pool is cached, so the 3 posters are picked before the intro plays and never swap mid-animation;
        // a fresh pool is fetched in the background for next time.
        const fetchHeroPool = async () => {
            const pools = readJSON(HERO_KEY) || {};
            const aniList = async (type) => ((await anilistLow(`query { Page(perPage: 40) { media(type: ${type}, isAdult: false, sort: TRENDING_DESC) { ${MEDIA_FIELDS} coverImage { color } } } }`, {}))?.Page?.media || [])
                .filter(m => m.coverImage?.large).map(m => ({ ...slimAnime(m), heroColor: m.coverImage?.color || null }));
            const jobs = {
                ANIME: () => aniList('ANIME'), MANGA: () => aniList('MANGA'),
                TV: async () => (await tvApi.browse(defaultFilters(), 1)).items.filter(m => m.coverImage?.large).map(slimAnime),
                GAME: async () => (await gameApi.browse(defaultFilters(), 1, { adult: false })).items.filter(m => m.coverImage?.large).map(slimAnime),
            };
            await Promise.all(Object.entries(jobs).map(async ([t, job]) => { try { const list = await job(); if (list.length) pools[t] = list.slice(0, 40); } catch {} }));
            try { localStorage.setItem(HERO_KEY, JSON.stringify(pools)); } catch {}
            // fill any empty spot now; the rest refresh on the next visit
            if (heroPool.value.some(x => !x)) { const fresh = pickHero(pools); heroPool.value = heroPool.value.map((x, n) => x || fresh[n]); }
        };

        // ---------- site data changes: once a day, compare the shows on your lists with AniList ----------
        const checkListMedia = async ({ force = false } = {}) => {
            const me = uid(); if (!me) return;
            const DAY_KEY = `anicoop_mediacheck:${me}`, SNAP_KEY = `anicoop_mediasnap:${me}`;
            try { if (!force && localStorage.getItem(DAY_KEY) === localDay()) return; } catch { return; }
            const all = new Map();
            [...soloList.value, ...coopList.value].forEach(i => { if (i.anime?.id && isAniListType(i.anime.type)) all.set(i.anime.id, i.anime); });
            if (!all.size) return;
            const snap = readJSON(SNAP_KEY) || {};
            const next = {}; const notes = []; const fresh = new Map();
            const ids = [...all.keys()];
            try {
                for (let i = 0; i < ids.length; i += 50) {
                    const chunk = ids.slice(i, i + 50);
                    const data = await anilistLow(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { ${MEDIA_FIELDS} relations { edges { relationType node { id type title { romaji english native } } } } } } }`, { ids: chunk });
                    const got = new Map((data?.Page?.media || []).map(m => [m.id, m]));
                    chunk.forEach(id => {
                        const old = snap[id]; const m = got.get(id); const listed = all.get(id);
                        if (!m) {
                            if (old && !old.gone) notes.push({ kind: 'media_removed', pref: notifOn('media_deleted') || notifOn('media_merged'), media: listed, text: 'It no longer exists on AniList (deleted, or merged into another entry).' });
                            next[id] = { ...(old || {}), gone: true };
                            return;
                        }
                        const rel = (m.relations?.edges || []).filter(e => e.node?.type === 'ANIME' || e.node?.type === 'MANGA');
                        const cur = { s: m.status, e: m.episodes || m.chapters || null, f: m.format, r: rel.map(e => e.node.id) };
                        next[id] = cur;
                        fresh.set(id, normMedia(m));
                        if (!old || old.gone) return;               // first time we see it: just remember
                        const added = rel.filter(e => !(old.r || []).includes(e.node.id));
                        if (added.length) notes.push({ kind: 'media_related', pref: notifOn('media_related'), media: m, text: added.slice(0, 3).map(e => `${titleOf(e.node)} (${nice(e.relationType)})`).join(', ') });
                        const changes = [];
                        if (old.s !== cur.s) changes.push(`Status: ${nice(old.s) || '?'} → ${nice(cur.s)}`);
                        if (old.e !== cur.e) changes.push(`${m.type === 'MANGA' ? 'Chapters' : 'Episodes'}: ${old.e ?? '?'} → ${cur.e ?? '?'}`);
                        if (old.f !== cur.f) changes.push(`Format: ${nice(old.f) || '?'} → ${nice(cur.f)}`);
                        if (changes.length) notes.push({ kind: 'media_changed', pref: notifOn('media_changed'), media: m, text: changes.join(' · ') });
                    });
                    if (i + 50 < ids.length) await sleep(1200);
                }
            } catch (err) { console.warn('list check skipped:', err.message || err); return; }
            try { localStorage.setItem(SNAP_KEY, JSON.stringify(next)); localStorage.setItem(DAY_KEY, localDay()); } catch {}
            const rows = notes.filter(n => n.pref).map(n => ({ user_id: me, kind: n.kind, media_id: n.media?.id || null, media_type: n.media?.type || 'ANIME', media_title: n.media ? titleOf(n.media) : null, media_cover: n.media?.coverImage?.large || null, text: n.text }));
            if (rows.length) {
                const { error } = await sb.from('notifications').insert(rows);
                if (error) console.warn('site data notices', error.message);
                else fetchNotifications();
            }
            // keep list posters fresh (airing episode counts, status) without bumping "last updated"
            const soloRows = soloList.value.filter(e => fresh.has(e.anime.id) && JSON.stringify(slimAnime(fresh.get(e.anime.id))) !== JSON.stringify(slimAnime(e.anime)))
                .map(e => ({ user_id: me, media_id: e.anime.id, media_type: e.anime.type || 'ANIME', media_data: entryData(e, fresh.get(e.anime.id)), status: e.status, score: e.score, progress: e.progress, updated_at: e.updatedAt }));
            if (soloRows.length) { const { error } = await sb.from('list_entries').upsert(soloRows, { onConflict: 'user_id,media_id' }); if (!error) fetchSolo(); }
            const squadRows = coopList.value.filter(e => fresh.has(e.anime.id) && JSON.stringify(slimAnime(fresh.get(e.anime.id))) !== JSON.stringify(slimAnime(e.anime)));
            for (const e of squadRows) await sb.from('squad_entries').update({ media_data: slimAnime(fresh.get(e.anime.id)) }).eq('squad_id', e.squadId).eq('media_id', e.anime.id);
            if (squadRows.length) fetchSquadEntries();
        };

        // ---------- install as app (PWA) ----------
        const installPrompt = shallowRef(null);
        const INSTALL_DISMISS = 'anicoop_install_dismissed';
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            let dismissed = false; try { dismissed = !!localStorage.getItem(INSTALL_DISMISS); } catch {}
            if (!dismissed) installPrompt.value = e;
        });
        window.addEventListener('appinstalled', () => { installPrompt.value = null; showToast('anicoop installed!'); });
        const installApp = async () => {
            const p = installPrompt.value; installPrompt.value = null;
            if (!p) return;
            p.prompt();
            try { await p.userChoice; } catch {}
        };
        const dismissInstall = () => { installPrompt.value = null; try { localStorage.setItem(INSTALL_DISMISS, '1'); } catch {} };

        // ---------- boot ----------
        onMounted(() => {
            // where you were before a refresh (history.state survives a reload; this tab's sessionStorage is the backup)
            let bootNav = history.state?.anicoop ? history.state : (() => { try { return JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null'); } catch { return null; } })();
            if (!bootNav?.anicoop || (bootNav.view === 'home' && !bootNav.settings)) bootNav = null;
            const startSection = new URLSearchParams(location.search).get('section');
            if (SECTIONS[startSection]?.live) section.value = startSection;
            let startTab = new URLSearchParams(location.search).get('tab');
            if (!tabs.some(t => t.id === startTab)) startTab = null;
            sb.auth.onAuthStateChange((_event, session) => {
                if (session?.user && startTab && !currentUser.value) { currentAppView.value = 'tracker'; activeTab.value = startTab; startTab = null; bootNav = null; }
                const firstSignIn = !!session?.user && !currentUser.value;
                if (firstSignIn && bootNav?.view) currentAppView.value = bootNav.view;   // before the Home intro would start
                currentUser.value = session?.user || null;
                if (firstSignIn && bootNav) { const s = bootNav; bootNav = null; setTimeout(() => restoreNav(s), 0); }
                if (!session?.user) bootNav = null;
                authReady.value = true;
                setTimeout(() => { session?.user ? loadUserData() : clearUserData(); }, 0);
            });
            // wake the server function now: its first ("cold") start is the slowest part of the first Games / Movies /
            // Songs load, so it boots while you're still on Home.
            tmdbCall('genre/movie/list').catch(() => {});   // tiny request the server keeps cached
            fetchMainList();
            fetchTrending();
            // the big AniList tag list is only needed for the Tag filter, so fetch it when the browser is idle
            (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => fetchTags(), { timeout: 6000 });
            fetchHeroPool();
            // a few seconds later, quietly get the other sections ready so switching to them is instant
            setTimeout(() => (window.requestIdleCallback || ((fn) => fn()))(() => prefetchSections(), { timeout: 1500 }), 1200);

            if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
            if (!bootNav) try { history.replaceState(navState(), ''); } catch {}
            window.addEventListener('popstate', onPopState);
            document.addEventListener('click', () => { quickMenuFor.value = null; sectionMenu.value = false; adminMenu.value = false; notifOpen.value = false; friendsOpen.value = false; batchSquadMenu.value = false; });
            document.addEventListener('keydown', (e) => {
                if (introMode.value !== 'done') { skipIntro(); return; }
                if (e.key !== 'Escape') return;
                if (confirmBox.open) { closeConfirm(false); return; }
                if (lilBro.open) { lilBro.open = false; return; }
                if (cropper.open) closeCropper();
                else if (trailerOf.value) closeTrailer();
                else if (tier.open) { if (tier.sel) tier.sel = null; else tier.open = false; }
                else if (sendSheet.open) sendSheet.open = false;
                else if (addMemberDraft.open) addMemberDraft.open = false;
                else if (groupDraft.open) groupDraft.open = false;
                else if (lightbox.value) lightbox.value = null;
                else if (drill.open) drill.open = false;
                else if (settingsOpen.value) settingsOpen.value = false;
                else if (sheetAnime.value) closeSheet();
                else if (randomOpen.value) randomOpen.value = false;
                else if (editForm.value.anime) closeEditor();
                else if (notifOpen.value) notifOpen.value = false;
                else if (friendsOpen.value) friendsOpen.value = false;
                else if (selectMode.value) toggleSelectMode();
                else if (quickMenuFor.value) quickMenuFor.value = null;
            });
            // a new day while the app stays open still counts
            setInterval(() => { if (uid()) markActive(); }, 60 * 60 * 1000);
        });

        return {
            repoScan, scanRepo, repoOk, srcStatus, extKind, extFor, extList, extSources, openExtensions, adultOn, playKind, KIND_LABEL, templatesFor,
            regionPrices, openRegionPrices, fmtUsd,
            plForm, extPlayers, addPlayerLink, removePlayerLink, directSrc,
            wp, openWatch, wpRows, wpShown, wpContinue, wpStarted, playContinue, playRow, toggleRowWatched, tvSeasons, seasonsOf, isMovie, isVideoKind,
            vp, vpServer, pickServer, closeVideo, openLocalVideo, onVideoTime, onVideoError, vpGo, vpNeighbour, markEpisodeWatched,
            gridResults, watchGridCols, histList, histOpen, histType, openHistory, histItems, histGroups, removeHistory, clearHistory, openHistoryItem, histTime,
            siteSources, srcForm, SOURCE_TEMPLATES, installRepoItem, repoLangs, repoShown, repoState, addSource, testSource, removeSource, loadRepo, repoInstalled, readSrc, srcView, readTabs, currentSite, chapterList, loadSourceFor, chooseMatch, changeMatch, onPageError,
            EXTENSIONS, extOpen, extOn, toggleExt, canReadInApp, rd, rdChapters, rdNeighbour, setReadMode, openChapter, closeReader, markChapterRead, toggleChapterRead, toggleReaderMark, rdGo, rdTap, rdChapterGo, onVerticalScroll, continueChapter, openLocalFiles,
            moreWatch, reader, readInfo, readLangs, readSources, loadChapters, shownChapters, showMoreChapters, chapterUrl, chapterRead, mangaStatusOf, lastChapterOf, fmtChapter,            isYouTube, yt, ytFrame, ytBox, onYtLoad, ytToggle, ytSeek, ytMute, ytFull, fmtClock, seriesLimit, seriesVisible,
            GAME_TAGS, GAME_SORTS, allGenreOptions, hiddenGenreOpen, isGenreHidden, toggleHiddenGenre, hiddenOf, notHidden,
            top, topItems, loadTop, showMoreTop, fmtVotes,
            fb, FB_CATS, FB_STATUS, fbScore, fbMine, fbShown, voteFeedback, postFeedback, deleteFeedback, setFeedbackStatus, fetchFeedback,
            gameExtra, pickSeries, seriesShown, seriesTotals, storyEdit, storySort, openGameLink, playVideo, scrollRow, shotViewer, openShot, closeShot, stepShot, fmtHours,
            FAV_SECTIONS, favTab, favsIn, favSectionOf, openFavChar, activityOpen, toggleMyActivity, openViewedActivity, setActivityHidden, activityLine, openActivity, checkGames,
            STATUS_ORDER, statusPick, MAX_REPEATS, lilBro, setFormStatus, repeatNow, repeatsDone, STATUS_LABELS, STATUS_SHORT, STATUS_COLORS, UNIT, ACCENTS, tabs,
            authReady, currentUser, currentProfile, isSignUp, authLoading, authForm, handleAuth, signOut,
            introMode, skipIntro, warmSection, ROLE_PERMS, ROLE_ICONS, AWARD_ICONS, ROLE_COLORS, roles, roleLinks, rolesReady, rolesOf, can, anyPower, canTouchRole, isOwnerId, roleDraft, editRole, toggleRolePerm, saveRole, deleteRole, moveRole, hasRole, toggleUserRole, adminLookup, adminFind, awardsOf, awardBox, openAwardBox, giveAward, removeAward, moderateProfile, adminMenu, heroPosters, heroPath, HERO_POINTS, heroSave, statusLabelFor, showToTop, scrollToTop,
            currentAppView, activeTab, openTracker, switchTab, canGoBack, goBack, goHome,
            section, sectionMenu, sectionList, currentSection, openSection, sectionCounts, sectionProgress, secSolo, secCoop,
            filters, availableYears, availableGenres, results, visibleResults, trendingTop, isLoading, isLoadingMore, browseError, hasNextPage,
            resetFilters, anyFilter, activeFilterCount, listTitle, formatOptions, countryOptions, friendsTrending,
            soloList, coopList, toast, selectedAnime, detailLoading, detailCharacters, detailRelations,
            editForm, inlineForm, isSaving, stepProgress, toggleFormSquad,
            listFilterStatus, listFilterGroup, listSearchQuery, filteredGroupedList, statusCounts, squadCount, listFiltersOn, clearListFilters,
            friendsList, pendingRequests, sentRequests, friendUsername, friendBusy, addFriend, acceptRequest, deleteFriendship, removeFriend,
            debouncedSearch, fetchMainList, openEditor, closeEditor, saveEditor, saveInline, fetchAnimeDetails, closeAnimeDetails,
            profileStats, profileStatCards, rankedAnime, favCharacters, toggleFavChar, isFavChar, isOnMyList, daysActive,
            continueWatching, progressPct, bumpEpisode, removeEverywhere,
            titleOf, initialOf, timeAgo, personOf,
            quickMenuFor, soloEntry, myEntry, onPlusClick, quickSolo, sheetAnime, closeSheet, sheetAction,
            randomOpen, randomFilter, randomPick, randomRolling, randomSpinKey, randomGenres, randomPool, randomSourceLabel, randomWide, randomWideType, openRandom, openRandomSoon, rollRandom, clearRandomFilters,
            avatarInput, avatarUploading, changeProfilePic, onAvatarFile, removeProfilePic,
            cropper, cropImgStyle, cropDown, cropMove, cropUp, cropWheel, closeCropper, applyCrop, CROP_VIEW,
            profileEdit, openProfileEdit, saveProfileEdit,
            installPrompt, installApp, dismissInstall,
            trailerOf, trailerUrl, trailerExternal, playTrailer, closeTrailer,
            squads, squadDraft, openSquadDraft, toggleDraftMember, draftAutoName, createSquad, squadAddMember, renameSquad, leaveSquad, friendsNotIn, squadAddOpen, squadById,
            notifications, notifOpen, unreadCount, notifText, openNotification, markAllRead, systemNotifOn, enableSystemNotifs,
            comments, commentsLoading, commentFilter, commentDraft, commentEp, commentPosting, commentEpisodes, countFor, shownComments, isSpoiler, revealed, setCommentFilter, postComment, deleteComment, epLabel,
            viewUserId, viewedUser, viewedTab, viewedStats, viewedRanked, viewedList, viewedIsFriend, sharedSquads, openUser,
            selectMode, selectedCount, toggleSelectMode, isSelected, toggleSelect, selectAllVisible, clearSelected, batchStatus, batchAddToSquad, batchRemove, batchBusy, batchSquadMenu,
            // v6
            adultAllowed, isOwner, hasOwner, adultConfig, claimOwner, setAdultEveryone, toggleAdultUser, ownerSearch, addAdultUserByName,
            STICKERS, stickerById, chats, chatWith, chatMessages, chatLoading, chatDraft, chatReplyTo, chatSending, chatPanel, chatSearch, chatSearchBusy, gifState, chatScroll, chatFile,
            incomingRequests, chatList, chatUnread, currentChat, chatBanner, openChat, startChatByName, sendText, sendSticker, sendGif, sendGifLink, onChatFile, unsendMessage, respondChat,
            msgById, msgPreview, chatPreview, dayLabel, clockOf, chatPickerOpen, TENOR_KEY, sendSheet, sendAnimeTo, sendEpisodeTo, sendTargets, sendSheetTo,
            statColumns, myRecent, viewedRecent,
            // v7
            confirmBox, closeConfirm,
            friendsOnAnime, isOnline, people, peopleTab, peopleLoading, peopleOnline, peopleOffline, lastSeenText, friendStateOf, addFriendById, viewedFriends,
            EFFECTS, NAME_STYLES, effectParticles, heroColors,
            personKind, FAV_PEOPLE, isPeopleTab, favTheirTab, favItems, favCount, openFavItem, removeFavItem, FAV_EMPTY, heroGlow, FRAMES, THEMES, BADGES, myBadges, viewedBadges, decorOf, decorDraft, togglePinBadge, toggleHideBadge, hideBadgeNow, myEarnedBadges, decorDirty, saveDecor, profileBg, pageBg, bgBannerChoices, setBgUrl, onBgFile, bgUrlDraft, bgUploading, bgInput,
            debateInfo, sideLabel, tier, TIER_SOURCES, openTierMaker, tierItemKey, pickTierResult, loadTierGroup, loadTierMine, moveTierItem, tapTierItem, tapTierRow, onTierDrop, removeTierItem, addTierRow, removeTierRow, tierPlacedCount, postTierList,
            follows, isFollowing, toggleFollow, checkFollowed, mediaLinks, linkDraft, saveMediaLink, deleteMediaLink,
            buddyState, buddyRequests, buddyList, askBuddy, acceptBuddy, endBuddy,
            siteUrl: location.origin + location.pathname, alLink, alClientId, alClientDraft, alSync, connectAniList, disconnectAniList, saveAniListClient, pushAllToAniList,
            rankTab, RANK_CATS, myRankings, viewedRankings, shownOf, showMoreRank, rankEdit, moveRank, setRankPos, resetRankOrder, myRankOrders, rankDrag, onRankPointerDown, onRankPointerMove, onRankPointerUp, rankRowStyle,
            compareBig, compareAddable, theirList, openTheirList, theirCounts, theirGrouped, openFriendStat, setViewedSection, openFriendLists, openFriendsManage, friendsOpen, friendsQuery, friendsFiltered, friendCounts,
            groupWith, groups, groupMessages, groupUnread, groupInfo, groupMemberProfiles, openGroup, leaveGroupChat,
            groupDraft, openGroupDraft, toggleGroupMember, createGroupChat, addMemberDraft, openAddMember, addableFriends, addMemberTo,
            // v5
            compareSel, compareAddStatus, compareAdding, toggleCompareSel, compareAllSelected, toggleCompareAll, addFromCompare, addSelectedFromCompare,
            tagGroups, STAT_KEYS, statRule, setStatMode, setAllStatModes, toggleStatHide, statPicker, personSearch, personSearchBusy, statPeople, findPerson,
            favStaff, favVAs, favStaffOnly, isFavStaff, toggleFavStaff, entity, entityData, entityLoading, openCharacter, openStaff, entityIsVA, entityIsActor, openActor, PERSON_BASE, TOP_SUBS, setTopSub, fmtTopScore, openTopItem, shelfRows, shelfSub, seeShelf, playlists, plOpen, plMissing, plAddPick, createPlaylist, togglePlaylistSong, inPlaylist, addPickToPlaylist, renamePlaylist, deletePlaylist, movePlaylistSong, openPlaylist, plOpenList, plCovers, plLength, plAddSongs, player, playPreview, isPlaying, setVolume, toggleMute, seekPreview, seekKey, closePlayer, hidePlayer, showPlayer, togglePlay, nextSong, prevSong, toggleShuffle, cycleRepeat, toggleFullSongs, playQueueAt, removeFromQueue, openArtist, openArtistByName, openSongArtist, openSongAlbum, openAlbumPage, albumSongs, artistView, openAlbum, songSearchArtist, openTrackArtist, albumTracks, albumLoading, loadAlbumTracks, discTab, discShown, artistDiscog, discReleases, discOpen, openRelease, discOpenRelease, artistPopularShown, songView, songGroupBy, SONG_GROUPS, songBrowseGroups, SONG_TAG_GROUPS, entityInfo, entityRoles, toggleEntityFav, entityIsFav,
            detailMore, loadAllCredits, shownCharacters, shownStaff, moreChars, moreStaff, showAllEpisodes, detailEpisodes, watchLinks, setProgressTo,
            COMPOSER_KINDS, POLL_DURATIONS, FEED_KINDS, composer, resetComposer, openComposer, mediaInput, onMediaFiles, addLink, removeAttachment, linkHost,
            picker, openPicker, choosePick, clearOption, addOption, removeOption, canPost, submitComposer, pollInfo, votePoll, isActSpoiler, revealedActs, repliesSorted, markBest, lightbox, playVideoLink,
            // v4
            PREFS, SCORE_FORMATS, THEME_ACCENTS, LIST_ORDERS, formatScore, formatAvg, epBadge, posterGrid, altTitleOf,
            settingsOpen, settingsTab, SETTINGS_TABS, openSettings, notifOn, toggleNotif, NOTIF_GROUPS,
            account, saveUsername, saveEmail, savePassword, customAccent, setAccent,
            PRIVACY_TYPES, privacy, setPrivacyMode, togglePrivacyFriend, resetScores, profileDirty, changeBanner, cropVW, cropVH,
            importState, importProgress, importMal, importAniList,
            notifQuote, notifIcon, likeOf, toggleLike, likeNames, mentionSuggestions, applyMention, bodyParts,
            repliesOf, replyTo, replyDraft, startReply,
            feed, feedLoading, feedEnd, feedFilter, feedReplies, replyDrafts, openReplies, fetchFeed, loadMoreFeed, activityVerb, toggleReplies, postReply, deleteReply, deleteActivity, highlightActivity,
            drill, openDrill, drillTitle, drillItems, drillStatusCounts, drillShowsStatus, drillName, drillType, scoreBuckets, heatmap, streak, countedOf,
            compareTab, compareType, comparison, compareGroups, viewedSection,
            detailStaff, detailInfo, detailRankings, detailTags, showSpoilerTags, detailStats,
            loadMoreBrowse, moreError, quickFormats, checkListMedia, genreOptions, GAME_PLATFORMS, platformFamilies, CHART_COUNTRIES, typeWord, isAniListType, fmtDuration, mediaType, songPlayerId, songSpotifyUrl, addMulti, removeMulti, hasMulti, activeChips, TV_TAGS, TV_TAG_GROUPS,
        };
    }
}).component('quick-add', QuickAdd).component('track-row', TrackRow).component('poster-card', PosterCard).component('user-avatar', UserAvatar).component('score-input', ScoreInput).directive('infinite', InfiniteScroll).directive('dock-height', DockHeight).directive('focus-select', { mounted: (el) => setTimeout(() => { el.focus(); el.select?.(); }, 60) }).mount('#app');

// Offline support + "install as app"
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
        // updateViaCache:'none' → the browser always re-downloads sw.js, so a new upload is noticed right away
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
            setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
        }).catch(() => {});
    });
    // a new version took over → reload once so the page and its files match
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true; location.reload();
    });
}
