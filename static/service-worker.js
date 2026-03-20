const CACHE_NAME = 'nmit-wayfinder-v7';

const FLOOR_PLANS = [
  '/static/floor1.png',
  '/static/floor2.png',
  '/static/floor3.png',
  '/static/floor4.png',
];

const SHELL_ASSETS = [
  '/static/style.css',
  '/static/script.js',
  '/static/manifest.json',
  '/static/icon-192-v2.png',
  '/static/icon-512-v2.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        [...FLOOR_PLANS, ...SHELL_ASSETS].map(url =>
          cache.add(url).catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (
    e.request.method !== 'GET' ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/stats') ||
    url.pathname.startsWith('/faq') ||
    url.pathname.startsWith('/feedback') ||
    url.pathname.startsWith('/coord-picker')
  ) {
    return;
  }

  // Floor plans: stale-while-revalidate — return cache instantly, update in background
  if (FLOOR_PLANS.some(p => url.pathname === p)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        if (cached) {
          fetchPromise;
          return cached;
        }
        return await fetchPromise || await caches.match(e.request);
      })
    );
    return;
  }

  // Root: network-first with cache fallback
  if (url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Other static: cache-first
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});