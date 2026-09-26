/* anicoop service worker — makes the app installable, fast to open and usable offline.
   When you change app files, bump REL here AND the ?v= of app.css / app.js in index.html (the same value), so everyone
   gets the update automatically. */
const REL = '1.5';
const VERSION = 'anicoop-v' + REL;
const SHELL = ['./', 'index.html', `app.css?v=${REL}`, `app.js?v=${REL}`, 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg'];
const CDN = /^(https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com))/;
const IMAGES = /^https:\/\/(s4\.anilist\.co|images\.igdb\.com)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const staleWhileRevalidate = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => cached);
  return cached || network;
};

const cacheFirst = async (req, cacheName, max = 400) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    cache.keys().then((keys) => { if (keys.length > max) cache.delete(keys[0]); });
  }
  return res;
};

// The app's own unversioned files (icons, manifest): always try the network first so a new upload is picked up on
// the very next load. The cache is only used when offline.
const networkFirst = async (req) => {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
};

// v1.5 app.css / app.js carry the release in their address (?v=…): a new release is a new address, so the copy saved
// for this address is always the right one → straight from the cache, with no trip to the server on every open.
// (The page itself is always asked fresh, and it names the release it needs.)
const versioned = async (req) => {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // Supabase writes, AniList queries → always live
  const url = req.url;

  if (req.mode === 'navigate') {                           // the page itself: fresh when online, cached when offline
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return res; })   // clone right away: the page reads the body
      .catch(() => caches.match('index.html')));
    return;
  }
  if (CDN.test(url)) { e.respondWith(staleWhileRevalidate(req, VERSION + '-cdn')); return; }
  if (IMAGES.test(url)) { e.respondWith(cacheFirst(req, VERSION + '-img')); return; }
  const u = new URL(url);
  if (u.origin === self.location.origin) { e.respondWith(/[?&]v=/.test(u.search) ? versioned(req) : networkFirst(req)); return; }
  // everything else (Supabase, AniList API) goes straight to the network
});
