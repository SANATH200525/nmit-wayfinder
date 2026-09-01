const CACHE_NAME = 'nmit-wayfinder-v16';
import { openOfflineDB } from './js/db-helper.js';

const FLOOR_PLANS = [
  '/static/floor1-updated.png',
  '/static/floor2-updated.png',
  '/static/floor3-updated.png',
  '/static/floor4-updated.png',
];

// Pre-cached on install — must all be available offline
const SHELL_ASSETS = [
  '/',
  '/static/icon-192-v2.png',
  '/static/icon-512-v2.png',
  '/static/manifest.json',
  '/static/css/style.css',
  '/static/js/graph-data.js',
  '/static/js/routing.js',
  '/static/js/pdr.js',
  '/static/js/metrics.js',
  '/static/js/checkpoint-flow.js',
  '/static/js/app.js',
];

// Network-first assets (change with code deploys)
const NETWORK_FIRST = [
  '/static/js/routing.js',
  '/static/js/app.js',
  '/static/js/pdr.js',
  '/static/js/metrics.js',
  '/static/js/checkpoint-flow.js',
  '/static/css/style.css',
];

// Stale-while-revalidate (changes when Person A regenerates)
const STALE_WHILE_REVALIDATE = [
  '/static/js/graph-data.js',
  ...FLOOR_PLANS,
];

// ---------------------------------------------------------------------------
// Install — pre-cache shell + floor plans
// ---------------------------------------------------------------------------
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        [...SHELL_ASSETS, ...FLOOR_PLANS].map(url =>
          cache.add(url).catch(() => { })
        )
      );
    })
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — purge old caches
// ---------------------------------------------------------------------------
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch — route by strategy
// ---------------------------------------------------------------------------
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept non-GET or API writes
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/stats') ||
    url.pathname.startsWith('/coord-picker')
  ) {
    return;
  }

  // FAQ + feedback: pass through (offline feedback queued by metrics.js/IndexedDB)
  if (url.pathname.startsWith('/faq') || url.pathname.startsWith('/feedback') ||
    url.pathname.startsWith('/session')) {
    return;
  }

  // Strip query string for matching
  const path = url.pathname;

  // ── Stale-while-revalidate (graph-data.js + floor plans) ─────────────────
  if (STALE_WHILE_REVALIDATE.some(p => path === p || path.startsWith(p + '?'))) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => null);
        return cached || await fetchPromise || await caches.match(request);
      })
    );
    return;
  }

  // ── Network-first (routing.js, app.js, style.css) ─────────────────────────
  if (NETWORK_FIRST.some(p => path === p || path.startsWith(p + '?'))) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Root / — network-first with cache fallback ────────────────────────────
  if (path === '/') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Everything else — cache-first ─────────────────────────────────────────
  e.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); }
        return res;
      })
    )
  );
});

// ---------------------------------------------------------------------------
// Background Sync — flush queued feedback and sessions when back online
// ---------------------------------------------------------------------------
self.addEventListener('sync', event => {
  if (event.tag === 'sync-feedback') {
    event.waitUntil(flushOfflineFeedback());
  }
  if (event.tag === 'sync-sessions') {
    event.waitUntil(flushOfflineSessions());
  }
});



// ---------------------------------------------------------------------------
// flushOfflineFeedback — drain pending-feedback → POST /feedback
// ---------------------------------------------------------------------------
async function flushOfflineFeedback() {
  const db = await openOfflineDB();
  const pending = await db.getAll('pending-feedback');
  for (const item of pending) {
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) await db.delete('pending-feedback', item.id);
    } catch { /* will retry on next sync */ }
  }
}

// ---------------------------------------------------------------------------
// flushOfflineSessions — drain pending-sessions → POST /session/start
// ---------------------------------------------------------------------------
async function flushOfflineSessions() {
  const db = await openOfflineDB();
  const pending = await db.getAll('pending-sessions');
  for (const item of pending) {
    try {
      const res = await fetch('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) await db.delete('pending-sessions', item.id);
    } catch { /* will retry on next sync */ }
  }
}
