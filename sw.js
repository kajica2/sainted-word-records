// Sainted Word Records — PWA service worker
const CACHE_VERSION = 'swr-v2';
// Only paths that exist as separate files in the dist root after Vite build.
// The engine now lives at /engine/ (rewritten to /engine.html). The 9 client
// modules (project, mic-input, camera, timeline, trim, media-sets, share,
// layer-scheduler, wizard) are bundled by Vite into dist/assets/engine-*.js
// and are cached on first fetch via the runtime cache.
const APP_SHELL = [
  '/',
  '/landing.html',
  '/engine',
  '/engine.html',
  '/offline.html',
  '/fx-postprocess.js',
  '/personas.js',
  '/audio-analysis-v2.js',
  '/persona-preview.client.js',
  '/pwa-bootstrap.js',
  '/pt.client.js',
  '/pt-panel.client.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png'
];

// Install: precache app shell, then activate immediately.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// Activate: delete any cache that isn't the current version.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Message: page sends {type:'SKIP_WAITING'} from the update toast.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Last-resort offline shell. The SW must never throw an uncaught error.
const offline = () => new Response(
  '<!doctype html><meta charset=utf-8><title>SWR offline</title><body style="background:#0a0d12;color:#f5a524;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><h1>SWR is offline</h1><p>Reconnect to load the engine.</p>',
  { status: 503, statusText: 'Service Unavailable', headers: { 'content-type': 'text/html; charset=utf-8' } }
);
const isGoogleFonts = (u) => u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com';
const isNavigation = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));

// Fetch router — navigations use network-first, assets use cache-first,
// Google Fonts use stale-while-revalidate. All paths return a Response,
// never throw, so the SW never surfaces an uncaught error.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  const sameOrigin = url.origin === self.location.origin;

  // Navigation: network-first, fall back to cached /, fall back to offline.html, fall back to inline shell.
  if (isNavigation(req) && sameOrigin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(req))
          || (await cache.match('/'))
          || (await cache.match('/offline.html'))
          || offline();
      }
    })());
    return;
  }

  // Same-origin assets: cache-first.
  if (sameOrigin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Google Fonts: stale-while-revalidate.
  if (isGoogleFonts(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req).then((f) => { if (f && f.ok) cache.put(req, f.clone()); return f; }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })());
  }
  // else: cross-origin, let the browser handle it
});
