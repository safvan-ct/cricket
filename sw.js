const CACHE = 'scoreboard-v3';
const SHELL = [
  './',
  './index.php',
  './assets/style.css',
  './assets/app.js',
  './assets/qrcode.min.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.webmanifest'
];

function fresh(request) {
  return fetch(request, { cache: 'no-cache' });
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        SHELL.map(url =>
          fresh(url)
            .then(res => {
              if (res.ok) return cache.put(url, res);
            })
            .catch(() => {})
        )
      )
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never intercept API requests
  if (url.pathname.includes('/api/')) return;
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fresh(event.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
