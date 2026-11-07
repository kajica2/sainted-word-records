// Scoped service worker for Color Tales only — does not replace site-wide sw.js
const CACHE = 'swr-color-tales-v1';
const SHELL = [
  '/color-tales/',
  '/color-tales.html',
  '/color-tales/color-tales-worker.js',
  '/color-tales/default-characters-placeholder.svg',
  '/color-tales/color-tales-manifest.webmanifest',
  '/client/color-tales-constants.client.js',
  '/client/color-tales-speed.client.js',
  '/client/color-tales-two-color.client.js',
  '/client/color-tales-segment.client.js',
  '/client/color-tales-scheduler.client.js',
  '/client/color-tales-sanitize.client.js',
  '/client/color-tales-storage.client.js',
  '/client/color-tales-export.client.js',
  '/client/color-tales-coverage.client.js',
  '/client/color-tales-runtime.client.js',
  '/lib/design-tokens.css',
  '/lib/components.css',
  '/lib/nav.client.js',
  '/lib/footer.client.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k === CACHE).length ? [] : [])
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/color-tales') &&
      !url.pathname.startsWith('/client/color-tales')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || caches.match('/color-tales.html');
      }
    })
  );
});
