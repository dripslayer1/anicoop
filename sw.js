/* anicoop service worker — makes the app installable, fast to open and usable offline.
   When you change app files, bump VERSION so everyone gets the update automatically. */
const VERSION = 'anicoop-v1.2b';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg'];
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

// The app's own files (app.js, app.css, icons): always try the network first so a new upload is
// picked up on the very next load. The cache is only used when offline. (v3 served the cached copy
// first, which could mix an old app.js with a new index.html right after an update.)
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
  if (new URL(url).origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  // everything else (Supabase, AniList API) goes straight to the network
});
