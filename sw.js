// Offline support. App files: try the network first so updates show up, and
// fall back to the saved copy with no signal. Map tiles: use the saved copy if
// we have one, so places you've already looked at work offline.

const APP_CACHE = 'salemtrip-app-v1';
const TILE_CACHE = 'salemtrip-tiles-v1';
const MAX_TILES = 2500;

const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/app.js', 'js/planner.js', 'js/places.js', 'js/time.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-180.png',
];

const TILE_HOSTS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(tile(req));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(appFile(req));
  }
  // Everything else (route and place search) goes straight to the network.
});

async function appFile(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    return Response.error();
  }
}

let tileWrites = 0;
async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (++tileWrites % 100 === 0) trim(cache);
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
