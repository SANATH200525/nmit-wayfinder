const CACHE_NAME = 'nmit-wayfinder-v6';
const STATIC_ASSETS = [
  '/', '/static/style.css', '/static/script.js',
  '/static/floor1.png', '/static/floor2.png',
  '/static/floor3.png', '/static/floor4.png',
  '/static/manifest.json', '/static/icon-192-v2.png',
  '/static/icon-512-v2.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' ||
      url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/stats') ||
      url.pathname.startsWith('/faq') ||
      url.pathname.startsWith('/feedback')) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (url.pathname === '/') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
});

self.skipWaiting();
self.clients.claim();