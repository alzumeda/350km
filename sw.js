const CACHE_APP   = 'de350-app-v6';
const CACHE_TILES = 'de350-tiles-v1';

const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './data/de-border.json',
  './js/config.js',
  './js/state.js',
  './js/cache.js',
  './js/ui.js',
  './js/map.js',
  './js/border.js',
  './js/elevation.js',
  './js/passes.js',
  './js/radius.js',
  './js/gps.js',
  './js/routing.js',
  './js/poi.js',
  './js/search.js',
  './js/gpx.js',
  './js/settings.js',
  './js/app.js',
  // CDN libs
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
];

// ── Install: pre-cache all app assets ────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(APP_ASSETS))
      .catch(err => console.warn('[SW] Pre-cache partial failure:', err))
  );
  self.skipWaiting();
});

// ── Activate: delete stale caches ────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_TILES)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Map tiles: network-first, cache fallback (stale tiles are fine)
  if (url.includes('tile.openstreetmap') || url.includes('/tiles/')) {
    e.respondWith(
      caches.open(CACHE_TILES).then(async cache => {
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch {
          const cached = await cache.match(e.request);
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // External APIs (ORS, OSRM, Open-Elevation, open-meteo): network-only
  // (do NOT cache — responses depend on parameters)
  const isApi =
    url.includes('openrouteservice.org') ||
    url.includes('router.project-osrm.org') ||
    url.includes('open-elevation.com') ||
    url.includes('open-meteo.com') ||
    url.includes('overpass-api.de') ||
    url.includes('nominatim.openstreetmap.org');  if (isApi) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // App shell + CDN libs: cache-first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE_APP).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
