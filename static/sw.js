const VERSION = 'xbp-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Never cache API / auth / streaming routes
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.includes('/stream')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful navigations and static assets opportunistically
        if (res.ok && (req.mode === 'navigate' || /\.(png|svg|webmanifest|css|js|woff2?)$/i.test(url.pathname))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('/')))
  );
});
