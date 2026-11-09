// Scoped service worker for Color Tales only — does not replace site-wide sw.js
const CACHE = 'swr-color-tales-v4';
const SHELL = [
  '/color-tales',
  '/color-tales/',
  '/color-tales.html',
  '/color-tales/color-tales.css',
  '/color-tales/color-tales-worker.js',
  '/color-tales/default-characters-placeholder.svg',
  '/color-tales/characters.webp',
  '/color-tales/default-pages.bundle.js',
  '/color-tales/color-tales-manifest.webmanifest',
  '/color-tales/sw-color-tales.js',
  '/client/color-tales-constants.client.js',
  '/client/color-tales-speed.client.js',
  '/client/color-tales-two-color.client.js',
  '/client/color-tales-segment.client.js',
  '/client/color-tales-scheduler.client.js',
  '/client/color-tales-sanitize.client.js',
  '/client/color-tales-storage.client.js',
  '/client/color-tales-export.client.js',
  '/client/color-tales-coverage.client.js',
  '/client/color-tales-paint.client.js',
  '/client/color-tales-audio.client.js',
  '/client/color-tales-record.client.js',
  '/client/color-tales-runtime.client.js',
  '/lib/design-tokens.css',
  '/lib/components.css',
  '/lib/nav.client.js',
  '/lib/footer.client.js',
  '/color-tales/pages/chef-a.webp',
  '/color-tales/pages/chef-a.svg',
  '/color-tales/pages/cat-face-a.webp',
  '/color-tales/pages/cat-face-a.svg',
  '/color-tales/pages/girl-a.webp',
  '/color-tales/pages/girl-a.svg',
  '/color-tales/pages/sitting-cat-a.webp',
  '/color-tales/pages/sitting-cat-a.svg',
  '/color-tales/pages/chef-b.webp',
  '/color-tales/pages/chef-b.svg',
  '/color-tales/pages/cat-face-b.webp',
  '/color-tales/pages/cat-face-b.svg',
  '/color-tales/pages/girl-b.webp',
  '/color-tales/pages/girl-b.svg',
];

function shellMatch(pathname) {
  if (pathname === '/color-tales' || pathname === '/color-tales.html') return true;
  if (pathname.startsWith('/color-tales/')) return true;
  if (pathname.startsWith('/client/color-tales')) return true;
  return SHELL.includes(pathname);
}

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
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (!shellMatch(url.pathname)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (url.pathname === '/color-tales') {
        const page = await cache.match('/color-tales.html');
        if (page) return page;
      }
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || cache.match('/color-tales.html');
      }
    })
  );
});
