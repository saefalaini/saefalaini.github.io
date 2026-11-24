/* RESET Site Assessment – offline support.
   Stores the app on the device so it opens with no signal.
   Survey data is NOT handled here: it lives in the browser's own storage (IndexedDB). */
const VERSION = 'rsa-v1';
const APP_CACHE = VERSION + '-app';
const TILE_CACHE = 'rsa-tiles';          // map tiles viewed while online, kept across versions
const MAX_TILES = 1500;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Cache each file on its own so one failure (e.g. CDN unreachable) does not block the install.
    await Promise.all(APP_FILES.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== APP_CACHE && k !== TILE_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app page: try the network first so updates arrive, fall back to the stored copy offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(APP_CACHE)).put('./index.html', res.clone());
        return res;
      } catch (e) {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Map tiles: stored copy first, otherwise fetch and keep it for offline use.
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (e) { return Response.error(); }
    })());
    return;
  }

  // Everything else the app uses (icons, manifest, map library): stored copy first, then network.
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com')) {
        (await caches.open(APP_CACHE)).put(req, res.clone());
      }
      return res;
    } catch (e) { return Response.error(); }
  })());
});
