// Offline support. App files: try the network first so updates show up, and
// fall back to the saved copy with no signal. Map tiles: use the saved copy if
// we have one, so places you've already looked at work offline.

const APP_CACHE = 'salemtrip-app-v9';
const TILE_CACHE = 'salemtrip-tiles-v2';
const MAX_TILES = 1200;

const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/app.js', 'js/planner.js', 'js/places.js', 'js/time.js', 'js/hours.js', 'js/trip.js',
  'data/osm-places.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-180.png', 'js/icons.js',
  'vendor/fonts/cormorant-500-normal.woff2', 'vendor/fonts/cormorant-600-normal.woff2', 'vendor/fonts/cormorant-500-italic.woff2',
];

const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.openstreetmap.fr'];
const TILE_MAX_AGE = 7 * 24 * 3600 * 1000;

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never
  // saves stale copies of the files.
  const fresh = APP_FILES.map(u => new Request(u, { cache: 'reload' }));
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
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
    // no-cache: always check with the server (cheap when nothing changed).
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 4000);
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
  // Saved tiles are used for up to a week, then refreshed when there's a signal.
  const saved = hit && Date.parse(hit.headers.get('date') || '');
  if (hit && !(saved && Date.now() - saved > TILE_MAX_AGE)) return hit;
  let res;
  try {
    res = await fetch(req);
  } catch {
    return hit || Response.error();
  }
  if (res.ok || res.type === 'opaque') {
    // Saving is a bonus. If storage is full, still show the tile.
    cache.put(req, res.clone())
      .then(() => { if (++tileWrites % 100 === 0) trim(cache); })
      .catch(() => {});
  }
  return res;
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
