const CACHE = 'scoreboard-v36';
const SHELL = ['./', './index.php', './assets/style.css', './assets/choices.min.css', './assets/choices.min.js', './assets/app.js', './assets/qrcode.min.js', './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png', './manifest.webmanifest'];
function fresh(request){return fetch(request,{cache:'no-cache'})}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(url => fresh(url).then(res => { if (res.ok) return cache.put(url, res); })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api/')) return;
  event.respondWith(fresh(event.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return res;
  }).catch(() => caches.match(event.request)));
});
