// anicoop — IGDB (Twitch) proxy for the Games section.
//
// Why this exists: IGDB doesn't allow calls straight from a browser (no CORS), and the Twitch
// Client Secret must never be put in app.js (anyone could read it). This Supabase Edge Function
// keeps the secret on the server, gets/refreshes the Twitch token, and forwards read-only queries.
//
// Setup (once) — see README.md "Games section (IGDB)":
//   supabase secrets set TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=...
//   supabase functions deploy igdb

// tolerate secrets pasted with spaces, line breaks or quotes around them
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
const CLIENT_ID = clean(Deno.env.get('TWITCH_CLIENT_ID'));
const CLIENT_SECRET = clean(Deno.env.get('TWITCH_CLIENT_SECRET'));
// only these IGDB endpoints can be reached through the proxy (all read-only).
// endpoint "steam" is also allowed: public Steam store data (price, reviews, players) — see steamData below.
const ALLOWED = new Set(['games', 'genres', 'platforms', 'popularity_primitives', 'game_time_to_beats', 'characters', 'keywords', 'themes']);

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

let token = '';
let tokenExpires = 0;
const getToken = async (force = false) => {
    if (!force && token && Date.now() < tokenExpires) return token;
    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}&grant_type=client_credentials`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
        // Twitch says exactly what's wrong ("invalid client" = bad Client ID, "invalid client secret" = bad secret)
        let why = '';
        try { why = (await res.json())?.message || ''; } catch { /* not JSON */ }
        const hint = /secret/i.test(why) ? 'TWITCH_CLIENT_SECRET is wrong' : /client/i.test(why) ? 'TWITCH_CLIENT_ID is wrong' : 'check both Twitch secrets';
        throw new Error(`Twitch login failed (${res.status}${why ? ': ' + why : ''}) — ${hint} in Supabase → Edge Functions → Secrets.`);
    }
    const data = await res.json();
    token = data.access_token;
    tokenExpires = Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000;   // refresh 5 min early
    return token;
};

// small in-memory cache: the same browse page asked by several friends only hits IGDB once
const cache = new Map<string, { at: number; body: string }>();
const CACHE_MS = 10 * 60 * 1000;

const igdb = (endpoint: string, query: string, tok: string) => fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
    body: query,
});

// ---------- Steam (public store data, no key needed; the store blocks browsers, so it goes through here too) ----------
const getJson = async (url: string) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); return r.ok ? r.json() : null; };
const steamData = async (kind: string, appids: number[], cc: string) => {
    if (kind === 'prices') {   // many games at once: just the price
        const d = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appids.join(',')}&filters=price_overview&cc=${cc}`);
        const out: Record<string, unknown> = {};
        for (const id of appids) {
            const e = d?.[id];
            if (!e?.success) continue;
            const p = e.data?.price_overview;
            out[id] = p ? { final: p.final, initial: p.initial, discount: p.discount_percent, text: p.final_formatted, currency: p.currency } : { final: 0, text: 'Free' };
        }
        return out;
    }
    // one game: price, Metacritic, Steam reviews and how many are playing right now
    const id = appids[0];
    const [det, rev, pl] = await Promise.all([
        getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=english`),
        getJson(`https://store.steampowered.com/appreviews/${id}?json=1&num_per_page=0&language=all&purchase_type=all`),
        getJson(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`),
    ]);
    const d = det?.[id]?.success ? det[id].data : null;
    const s = rev?.query_summary;
    return {
        appid: id,
        free: !!d?.is_free,
        price: d?.price_overview ? { text: d.price_overview.final_formatted, initial: d.price_overview.initial_formatted || null, discount: d.price_overview.discount_percent || 0 } : null,
        metacritic: d?.metacritic?.score ? { score: d.metacritic.score, url: d.metacritic.url } : null,
        reviews: s?.total_reviews ? { desc: s.review_score_desc, positive: s.total_positive, total: s.total_reviews } : null,
        players: pl?.response?.result === 1 ? pl.response.player_count : null,
        release: d?.release_date?.date || null, comingSoon: !!d?.release_date?.coming_soon,
        categories: (d?.categories || []).map((c: { description: string }) => c.description).slice(0, 12),
        achievements: d?.achievements?.total || null,
    };
};

// ---------- MangaDex (manga/manhwa: latest chapter, status, where to read). Their API blocks browsers too. ----------
const MD = 'https://api.mangadex.org';
const mdGet = async (path: string) => {
    const r = await fetch(MD + path, { headers: { 'User-Agent': 'anicoop/1.0 (+https://anicoop.studio)', Accept: 'application/json' } });
    return r.ok ? r.json() : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RATINGS = '&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica';
const mangaDex = async (body: Record<string, unknown>) => {
    if (body.kind === 'find') {
        // find the MangaDex entry linked to this AniList id (MangaDex stores the AniList id in links.al)
        const alId = String(Number(body.alId) || '');
        const titles = (Array.isArray(body.titles) ? body.titles : []).map(String).filter(t => t && t.length <= 200).slice(0, 2);
        if (!alId || !titles.length) return null;
        let hit: any = null;
        for (const t of titles) {
            const d = await mdGet(`/manga?limit=10&title=${encodeURIComponent(t)}${RATINGS}`);
            hit = (d?.data || []).find((m: any) => m.attributes?.links?.al === alId) || null;
            if (hit) break;
        }
        if (!hit) return { md: null };
        // highest chapter number in any language = the latest chapter out
        const agg = await mdGet(`/manga/${hit.id}/aggregate`);
        let last = 0;
        for (const v of Object.values(agg?.volumes || {}) as any[]) for (const c of Object.keys(v?.chapters || {})) { const n = parseFloat(c); if (n > last) last = n; }
        const a = hit.attributes || {};
        return { md: hit.id, status: a.status || null, last: last || (a.lastChapter ? parseFloat(a.lastChapter) : null), final: a.lastChapter || null,
            links: a.links || {}, langs: a.availableTranslatedLanguages || [] };
    }
    if (body.kind === 'pages') {
        // where a chapter's page images live (MangaDex@Home). The images themselves load straight from MangaDex.
        const id = String(body.chapter || '');
        if (!UUID.test(id)) return null;
        const d = await mdGet(`/at-home/server/${id}`);
        if (!d?.baseUrl || !d?.chapter) return { error: 'This chapter isn’t readable on MangaDex (it may be an official external release).' };
        return { base: d.baseUrl, hash: d.chapter.hash, data: d.chapter.data || [], saver: d.chapter.dataSaver || [] };
    }
    if (body.kind === 'chapters') {
        const id = String(body.md || ''); const lang = String(body.lang || 'en'); const offset = Math.max(0, Math.min(10000, Number(body.offset) || 0));
        if (!UUID.test(id) || !/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) return null;
        const d = await mdGet(`/manga/${id}/feed?limit=100&offset=${offset}&translatedLanguage[]=${lang}&order[chapter]=desc&order[volume]=desc&includes[]=scanlation_group${RATINGS}`);
        return {
            total: d?.total || 0,
            chapters: (d?.data || []).map((c: any) => ({
                id: c.id, ch: c.attributes?.chapter || null, vol: c.attributes?.volume || null, title: c.attributes?.title || null,
                url: c.attributes?.externalUrl || null, pages: c.attributes?.pages || 0, at: c.attributes?.readableAt || c.attributes?.publishAt || null,
                group: (c.relationships || []).find((r: any) => r.type === 'scanlation_group')?.attributes?.name || null,
            })),
        };
    }
    return null;
};

// ---------- TMDB (Movies & TV). Read Access Token in the TMDB_TOKEN secret. ----------
const TMDB_TOKEN = clean(Deno.env.get('TMDB_TOKEN'));
const TMDB_PATH = /^(trending\/(all|movie|tv)\/(day|week)|search\/(multi|movie|tv)|discover\/(movie|tv)|(movie|tv)\/(\d+|popular|top_rated|upcoming|now_playing|on_the_air|airing_today)(\/(season\/\d+|recommendations|similar|external_ids))?|collection\/\d+|genre\/(movie|tv)\/list|person\/\d+)$/;
const tmdb = async (body: Record<string, any>) => {
    if (!TMDB_TOKEN) return json({ error: 'The TMDB key isn’t set on the server (TMDB_TOKEN secret).' }, 500);
    const path = String(body.path || '').replace(/^\/+/, '');
    if (!TMDB_PATH.test(path)) return json({ error: 'Not allowed' }, 400);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body.params || {})) if (/^[a-z_.]{1,40}$/i.test(k) && v !== null && v !== undefined && v !== '') params.set(k, String(v).slice(0, 200));
    const url = `https://api.themoviedb.org/3/${path}?${params}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS * 3) return json(hit.body);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) return json({ error: `TMDB error (${r.status})`, detail: text.slice(0, 300) }, r.status === 404 ? 404 : r.status === 429 ? 429 : 502);
    if (cache.size > 800) cache.clear();
    cache.set(url, { at: Date.now(), body: text });
    return json(text);
};

// ---------- Spotify (Songs). Client id + secret in SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. ----------
// Spotify only gives new apps search + track/album/artist lookups, so the charts come from Apple Music's public
// "most played" list, matched to Spotify tracks here.
const SP_ID = clean(Deno.env.get('SPOTIFY_CLIENT_ID'));
const SP_SECRET = clean(Deno.env.get('SPOTIFY_CLIENT_SECRET'));
let spToken = '', spExpires = 0;
const spGetToken = async () => {
    if (spToken && Date.now() < spExpires) return spToken;
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${SP_ID}:${SP_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!r.ok) throw new Error(`Spotify login failed (${r.status}) — check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in Supabase → Edge Functions → Secrets.`);
    const d = await r.json(); spToken = d.access_token; spExpires = Date.now() + Math.max(60, (d.expires_in || 3600) - 300) * 1000;
    return spToken;
};
// Spotify's dev-tier rate limit is strict (a burst of just a few concurrent calls can trip it), so every call
// really does get retried after a 429 — not just delayed and given up on, which was silently dropping songs.
// When Spotify hands out a long block (Retry-After of minutes or hours), stop calling it until then: every extra call
// during a block can make it longer.
let spBlockedUntil = 0;
const spGet = async (path: string, tries = 3): Promise<any> => {
    if (Date.now() < spBlockedUntil) return null;
    for (let attempt = 0; attempt < tries; attempt++) {
        let r = await fetch('https://api.spotify.com/v1/' + path, { headers: { Authorization: `Bearer ${await spGetToken()}` } });
        if (r.status === 401) { spToken = ''; r = await fetch('https://api.spotify.com/v1/' + path, { headers: { Authorization: `Bearer ${await spGetToken()}` } }); }
        if (r.ok) return r.json();
        if (r.status !== 429 && r.status !== 502 && r.status !== 503) return null;   // a real "not found" etc — don't retry
        const retryAfter = Number(r.headers.get('Retry-After')) || 0;
        if (retryAfter > 30) { spBlockedUntil = Date.now() + retryAfter * 1000; return null; }
        await new Promise(res => setTimeout(res, Math.min(8000, retryAfter * 1000 || 600 * 2 ** attempt)));
    }
    return null;
};
// a handful of spGet calls at a time, never more — matches Spotify's real burst limit instead of guessing.
// `deadline` stops starting new batches past that time so a badly rate-limited run still returns (with whatever
// it got) instead of running the retries all the way out and risking the function itself timing out.
const spBatch = async <T>(jobs: (() => Promise<T>)[], size = 4, deadline = Date.now() + 20000): Promise<(T | undefined)[]> => {
    const out: (T | undefined)[] = new Array(jobs.length);
    for (let i = 0; i < jobs.length && Date.now() < deadline; i += size) await Promise.all(jobs.slice(i, i + size).map(async (job, k) => { out[i + k] = await job(); }));
    return out;
};
const SPID = /^[0-9A-Za-z]{22}$/;
const spotify = async (body: Record<string, any>) => {
    if (!SP_ID || !SP_SECRET) return json({ error: 'The Spotify keys aren’t set on the server (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET secrets).' }, 500);
    const kind = String(body.kind || ''); const market = /^[A-Z]{2}$/i.test(body.market || '') ? String(body.market).toUpperCase() : 'US';
    const cc = /^[a-z]{2}$/i.test(body.country || '') ? String(body.country).toLowerCase() : 'us';
    // charts: cached and matched by the CHART's country, never by the visitor's own browser region — otherwise every
    // visitor builds (and rate-limits) their own copy instead of sharing one, which is what was breaking this for
    // some people: their build got rate-limited harder than someone else's and the broken result then sat cached
    // for hours. It also matches the songs against the market they actually charted in, which finds more of them.
    const key = kind === 'charts' ? `sp\ncharts\n${cc}\n${Math.min(100, Math.max(10, Number(body.limit) || 50))}` : 'sp\n' + JSON.stringify(body);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (kind === 'charts' ? CACHE_MS * 36 : CACHE_MS * 3)) return json(hit.body);
    let out: unknown = null; let ttl = kind === 'charts' ? CACHE_MS * 36 : CACHE_MS * 3;
    try {
        if (kind === 'search') {
            const q = String(body.q || '').slice(0, 200); if (!q) return json({ error: 'Empty search' }, 400);
            const limit = Math.min(50, Math.max(1, Number(body.limit) || 20)); const offset = Math.min(950, Math.max(0, Number(body.offset) || 0));
            // new Spotify apps get at most 10 results per search call, so bigger pages are several calls at once
            const pages = await spBatch(Array.from({ length: Math.ceil(limit / 10) }, (_, k) => offset + k * 10).filter(o => o <= 990)
                .map(o => () => spGet(`search?type=track&q=${encodeURIComponent(q)}&limit=10&offset=${o}&market=${market}`)));
            const seen = new Set<string>();
            out = { items: pages.flatMap(d => d?.tracks?.items || []).filter((t: any) => t?.id && !seen.has(t.id) && seen.add(t.id)), total: pages[0]?.tracks?.total || 0 };
        } else if (kind === 'track') {
            if (!SPID.test(body.id || '')) return json({ error: 'Not allowed' }, 400);
            const t = await spGet(`tracks/${body.id}?market=${market}`);
            const [album, artist] = await Promise.all([
                t?.album?.id ? spGet(`albums/${t.album.id}?market=${market}`) : null,
                t?.artists?.[0]?.id ? spGet(`artists/${t.artists[0].id}`) : null,
            ]);
            out = { track: t, album, artist };
        } else if (kind === 'tracks') {   // several tracks at once (refreshing your list)
            const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x: string) => SPID.test(x)).slice(0, 50);
            const d = ids.length ? await spBatch(ids.map((id: string) => () => spGet(`tracks/${id}?market=${market}`))) : [];
            out = { items: d.filter(Boolean) };
        } else if (kind === 'charts') {    // Apple Music "most played", matched to Spotify (by the chart's own country)
            const limit = Math.min(100, Math.max(10, Number(body.limit) || 50));
            const r = await fetch(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/${limit}/songs.json`);
            const feed = r.ok ? (await r.json())?.feed?.results || [] : [];
            const clean1 = (s: string) => s.replace(/\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]/gi, '').replace(/["']/g, '').trim();
            const chartMarket = cc.toUpperCase();
            const items = await spBatch(feed.map((f: any) => async () => {
                const q = `track:${clean1(f.name || '')} artist:${clean1((f.artistName || '').split(/,|&| x /i)[0])}`;
                const d = await spGet(`search?type=track&q=${encodeURIComponent(q)}&limit=1&market=${chartMarket}`);
                return d?.tracks?.items?.[0] || null;
            }));
            const matched = items.filter(Boolean);
            out = { items: matched, country: cc };
            // an incomplete build (rate-limited mid-way) is only kept briefly, so the next visitor gets a fresh,
            // hopefully complete try instead of being stuck with a half-empty chart for hours
            if (feed.length && matched.length < feed.length * 0.7) ttl = 90 * 1000;
        } else return json({ error: 'Not allowed' }, 400);
    } catch (err) { return json({ error: (err as Error).message || 'Spotify request failed' }, 502); }
    const text = JSON.stringify(out);
    if (cache.size > 800) cache.clear();
    // the read check above always uses the full TTL for this kind; backdating "at" makes a short-lived (incomplete
    // chart) entry look that much older, so it expires under that same check after only `ttl` ms instead of the full one
    const fullTtl = kind === 'charts' ? CACHE_MS * 36 : CACHE_MS * 3;
    cache.set(key, { at: Date.now() - (fullTtl - ttl), body: text });
    return json(text);
};

// ---------- website sources (Mihon-style extensions) ----------
// Browsers can't read other websites, so extensions fetch pages (HTML) and images through here.
// Only signed-in users can call this function; local / private network addresses are refused.
const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const siteFetch = async (body: Record<string, any>) => {
    let u: URL;
    try { u = new URL(String(body.url || '')); } catch { return json({ error: 'Bad URL' }, 400); }
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname) || u.username || u.password) return json({ error: 'Not allowed' }, 400);
    const method = body.method === 'POST' ? 'POST' : 'GET';
    let referer = u.origin + '/';
    try { if (body.referer) referer = new URL(String(body.referer)).href; } catch { /* keep the site's own origin */ }
    const asImage = body.as === 'image';
    const key = `site\n${method}\n${u.href}`;
    if (!asImage && method === 'GET') { const hit = cache.get(key); if (hit && Date.now() - hit.at < CACHE_MS / 2) return json(hit.body); }
    const headers: Record<string, string> = {
        'User-Agent': BROWSER_UA, Referer: referer,
        Accept: asImage ? 'image/avif,image/webp,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    };
    if (method === 'POST') { headers['X-Requested-With'] = 'XMLHttpRequest'; headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    let r: Response;
    try { r = await fetch(u.href, { method, headers, body: method === 'POST' ? String(body.form || '') : undefined, redirect: 'follow' }); }
    catch (err) { return json({ error: 'Could not reach ' + u.hostname + ': ' + ((err as Error).message || 'network error') }, 502); }
    if (asImage) {
        // raw bytes (application/octet-stream so the app receives a Blob)
        const buf = await r.arrayBuffer();
        if (!r.ok || buf.byteLength > 15 * 1024 * 1024) return json({ error: `Image failed (${r.status})` }, 502);
        return new Response(buf, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' } });
    }
    const text = (await r.text()).slice(0, 4 * 1024 * 1024);
    const out = JSON.stringify({ status: r.status, url: r.url, body: text });
    if (r.ok && method === 'GET') { if (cache.size > 800) cache.clear(); cache.set(key, { at: Date.now(), body: out }); }
    return json(out);
};

// ---------- YouTube search (the song player and the YouTube video source) ----------
// YouTube's own web search (the same one youtube.com uses), trimmed to what the app needs:
// [{ id, title, channel, secs, thumb, badge }]. Nothing is downloaded or converted: the app plays results in YouTube's player.
const ytTime = (t: string) => String(t || '').split(':').reduce((a, x) => a * 60 + (parseInt(x, 10) || 0), 0);
const ytWalk = (o: any, out: any[]) => {
    if (!o || typeof o !== 'object' || out.length >= 30) return;
    if (Array.isArray(o)) { for (const x of o) ytWalk(x, out); return; }
    const v = o.videoRenderer;
    if (v?.videoId) {
        const badges = JSON.stringify(v.ownerBadges || []);
        out.push({
            id: v.videoId, title: v.title?.runs?.map((r: any) => r.text).join('') || '',
            channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
            secs: ytTime(v.lengthText?.simpleText || ''), thumb: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
            badge: /OFFICIAL_ARTIST/.test(badges) ? 'artist' : /VERIFIED/.test(badges) ? 'verified' : '',
        });
        return;
    }
    for (const k in o) ytWalk(o[k], out);
};
const ytSearch = async (body: Record<string, any>) => {
    const q = String(body.q || '').trim().slice(0, 200);
    if (!q) return json({ error: 'Nothing to search' }, 400);
    const key = 'yt\n' + q;
    const hit = cache.get(key); if (hit && Date.now() - hit.at < CACHE_MS * 36) return json(hit.body);
    let r: Response;
    try {
        r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA, Origin: 'https://www.youtube.com' },
            // params EgIQAQ== = "videos only"
            body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } }, query: q, params: 'EgIQAQ==' }),
        });
    } catch (err) { return json({ error: 'Could not reach YouTube: ' + ((err as Error).message || 'network error') }, 502); }
    if (!r.ok) return json({ error: `YouTube search failed (${r.status})` }, 502);
    const out: any[] = []; ytWalk(await r.json(), out);
    const text = JSON.stringify({ items: out });
    if (cache.size > 800) cache.clear();
    cache.set(key, { at: Date.now(), body: text });
    return json(text);
};

// ---------- YouTube Music search (the song player) ----------
// YouTube Music's own search, "Songs" only: the official audio tracks (the same ones music.youtube.com plays),
// trimmed to [{ id, title, channel (artists), album, secs, atv }]. The app plays them in YouTube's player; nothing is downloaded.
const ytmText = (c: any) => (c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []) as any[];
const ytmWalk = (o: any, out: any[]) => {
    if (!o || typeof o !== 'object' || out.length >= 25) return;
    if (Array.isArray(o)) { for (const x of o) ytmWalk(x, out); return; }
    const r = o.musicResponsiveListItemRenderer;
    if (r) {
        const watch = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
        const id = r.playlistItemData?.videoId || watch?.videoId;
        if (id) {
            const cols = r.flexColumns || [];
            const runs = cols.slice(1).flatMap(ytmText);
            const page = (x: any) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
            const artists = runs.filter((x: any) => page(x) === 'MUSIC_PAGE_TYPE_ARTIST').map((x: any) => x.text);
            const album = runs.find((x: any) => page(x) === 'MUSIC_PAGE_TYPE_ALBUM')?.text || '';
            const dur = runs.map((x: any) => x.text).find((t: string) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t || '')) || '';
            const type = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '';
            out.push({ id, title: ytmText(cols[0]).map((x: any) => x.text).join(''), channel: artists.join(', '), album, secs: ytTime(dur), atv: type === 'MUSIC_VIDEO_TYPE_ATV' || !type });
        }
        return;
    }
    for (const k in o) ytmWalk(o[k], out);
};
const ytmSearch = async (body: Record<string, any>) => {
    const q = String(body.q || '').trim().slice(0, 200);
    if (!q) return json({ error: 'Nothing to search' }, 400);
    const key = 'ytm\n' + q;
    const hit = cache.get(key); if (hit && Date.now() - hit.at < CACHE_MS * 36) return json(hit.body);
    let r: Response;
    try {
        r = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' },
            // params = the "Songs" filter
            body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } }, query: q, params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF' }),
        });
    } catch (err) { return json({ error: 'Could not reach YouTube Music: ' + ((err as Error).message || 'network error') }, 502); }
    if (!r.ok) return json({ error: `YouTube Music search failed (${r.status})` }, 502);
    const out: any[] = []; ytmWalk(await r.json(), out);
    const text = JSON.stringify({ items: out });
    if (cache.size > 800) cache.clear();
    cache.set(key, { at: Date.now(), body: text });
    return json(text);
};

// ---------- chat: emoji (emoji-api.com) and GIFs (GIPHY, or Tenor) ----------
// The keys stay here as Edge Function secrets (EMOJI_API_KEY, GIPHY_API_KEY or TENOR_API_KEY), never in the website's code.
const emojiList = async () => {
    const key = Deno.env.get('EMOJI_API_KEY') || '';
    if (!key) return json({ error: 'EMOJI_API_KEY is not set in the Edge Function secrets' }, 500);
    const ck = 'emoji\nall';
    const hit = cache.get(ck); if (hit && Date.now() - hit.at < 24 * 3600e3) return json(hit.body);
    let r: Response;
    try { r = await fetch(`https://emoji-api.com/emojis?access_key=${encodeURIComponent(key)}`); }
    catch (err) { return json({ error: 'Could not reach emoji-api.com: ' + ((err as Error).message || 'network error') }, 502); }
    if (!r.ok) return json({ error: `emoji-api.com answered ${r.status}` }, 502);
    const all = await r.json();
    // compact: character, name, group — about a third of the original size
    const items = (Array.isArray(all) ? all : []).filter((e: any) => e?.character && !/skin-tone|:.*tone/i.test(e.slug || ''))
        .map((e: any) => ({ c: e.character, n: String(e.unicodeName || e.slug || '').replace(/^E\d+(\.\d+)?\s+/, ''), g: e.group || 'other' }));
    const text = JSON.stringify({ items });
    cache.set(ck, { at: Date.now(), body: text });
    return json(text);
};
const gifSearch = async (body: Record<string, any>) => {
    const q = String(body.q || '').trim().slice(0, 100);
    const giphy = Deno.env.get('GIPHY_API_KEY') || '', tenor = Deno.env.get('TENOR_API_KEY') || '';
    if (!giphy && !tenor) return json({ error: 'No GIF key: add GIPHY_API_KEY to the Edge Function secrets' }, 500);
    const ck = 'gif\n' + q;
    const hit = cache.get(ck); if (hit && Date.now() - hit.at < CACHE_MS * 3) return json(hit.body);
    let items: any[] = [];
    try {
        if (giphy) {
            const u = q ? `https://api.giphy.com/v1/gifs/search?api_key=${giphy}&q=${encodeURIComponent(q)}&limit=30&rating=pg-13&lang=en`
                : `https://api.giphy.com/v1/gifs/trending?api_key=${giphy}&limit=30&rating=pg-13`;
            const d = await (await fetch(u)).json();
            items = (d?.data || []).map((g: any) => ({ id: g.id, preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url, url: g.images?.downsized?.url || g.images?.original?.url, title: g.title || '' }));
        } else {
            const u = q ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${tenor}&client_key=anicoop&limit=30&contentfilter=medium&media_filter=tinygif,gif`
                : `https://tenor.googleapis.com/v2/featured?key=${tenor}&client_key=anicoop&limit=30&contentfilter=medium&media_filter=tinygif,gif`;
            const d = await (await fetch(u)).json();
            items = (d?.results || []).map((g: any) => ({ id: g.id, preview: g.media_formats?.tinygif?.url, url: g.media_formats?.gif?.url || g.media_formats?.tinygif?.url, title: g.content_description || '' }));
        }
    } catch (err) { return json({ error: 'GIF search failed: ' + ((err as Error).message || 'network error') }, 502); }
    const text = JSON.stringify({ items: items.filter(x => x.url && x.preview), by: giphy ? 'GIPHY' : 'Tenor' });
    if (cache.size > 800) cache.clear();
    cache.set(ck, { at: Date.now(), body: text });
    return json(text);
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body: Record<string, any> = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    const { endpoint = '', query = '', kind = '', appids = [], cc = 'us' } = body;

    if (endpoint === 'fetch') return siteFetch(body);
    if (endpoint === 'yt') return ytSearch(body);
    if (endpoint === 'ytm') return ytmSearch(body);
    if (endpoint === 'emoji') return emojiList();
    if (endpoint === 'gif') return gifSearch(body);
    if (endpoint === 'tmdb') return tmdb(body);
    if (endpoint === 'spotify') return spotify(body);

    if (endpoint === 'mangadex') {
        const key = 'md\n' + JSON.stringify(body);
        const hit = cache.get(key);
        const ttl = kind === 'find' ? CACHE_MS * 36 : kind === 'pages' ? CACHE_MS / 2 : CACHE_MS * 3;   // find 6 h · page servers 5 min (their links expire) · chapters 30 min
        if (hit && Date.now() - hit.at < ttl) return json(hit.body);
        try {
            const out = await mangaDex(body);
            if (out === null) return json({ error: 'Not allowed' }, 400);
            const text = JSON.stringify(out);
            if (cache.size > 800) cache.clear();
            cache.set(key, { at: Date.now(), body: text });
            return json(text);
        } catch (err) { return json({ error: (err as Error).message || 'MangaDex request failed' }, 502); }
    }

    if (endpoint === 'steam') {
        const ids = Array.isArray(appids) ? appids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 60) : [];
        const country = /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : 'us';
        if (!ids.length || !['prices', 'game'].includes(kind)) return json({ error: 'Not allowed' }, 400);
        const key = `steam\n${kind}\n${country}\n${ids.join(',')}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS * 3) return json(hit.body);
        try {
            const body = JSON.stringify(await steamData(kind, ids, country));
            cache.set(key, { at: Date.now(), body });
            return json(body);
        } catch (err) { return json({ error: (err as Error).message || 'Steam request failed' }, 502); }
    }

    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'The IGDB keys are not set on the server (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET).' }, 500);
    // "what people are playing" in one round trip: the popularity list, then those games' details
    if (endpoint === 'popular_games') {
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 48)); const offset = Math.min(5000, Math.max(0, Number(body.offset) || 0));
        const fields = String(body.fields || 'name'), where = String(body.where || 'cover != null');
        if (fields.length > 1500 || where.length > 1500) return json({ error: 'Not allowed' }, 400);
        const key = `popular\n${limit}\n${offset}\n${fields}\n${where}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);
        const run = async (ep: string, q: string) => {
            let r = await igdb(ep, q, await getToken());
            if (r.status === 401) r = await igdb(ep, q, await getToken(true));
            if (!r.ok) throw new Error(`IGDB error (${r.status})`);
            return r.json();
        };
        try {
            const pops = await run('popularity_primitives', `fields game_id; where popularity_type = 3; sort value desc; limit ${limit}; offset ${offset};`);
            const ids = (pops || []).map((p: { game_id: number }) => p.game_id).filter(Boolean);
            const games = ids.length ? await run('games', `fields ${fields}; where id = (${ids.join(',')}) & ${where}; limit ${limit};`) : [];
            const text = JSON.stringify({ ids, games, full: (pops || []).length === limit });
            if (cache.size > 800) cache.clear();
            cache.set(key, { at: Date.now(), body: text });
            return json(text);
        } catch (err) { return json({ error: (err as Error).message || 'IGDB request failed' }, 502); }
    }

    if (!ALLOWED.has(endpoint) || typeof query !== 'string' || !query.trim() || query.length > 4000) return json({ error: 'Not allowed' }, 400);

    const key = endpoint + '\n' + query;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

    try {
        let res = await igdb(endpoint, query, await getToken());
        if (res.status === 401) res = await igdb(endpoint, query, await getToken(true));   // token was revoked/expired early
        const body = await res.text();
        if (!res.ok) return json({ error: `IGDB error (${res.status})`, detail: body.slice(0, 500) }, res.status === 429 ? 429 : 502);
        if (cache.size > 500) cache.clear();
        cache.set(key, { at: Date.now(), body });
        return json(body);
    } catch (err) {
        return json({ error: (err as Error).message || 'IGDB request failed' }, 502);
    }
});
