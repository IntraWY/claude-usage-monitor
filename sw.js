'use strict';

const CACHE = 'claude-opt-v1';
const PRECACHE = ['/index.html', '/manifest.webmanifest', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Never cache API routes — stale VAPID key would break push subscription
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// CRITICAL: iOS requires every push event to result in a shown notification.
// Early return without showNotification causes iOS to throttle and unsubscribe.
self.addEventListener('push', (e) => {
  let title = 'Claude Session Optimizer';
  let body = '';
  let tag = `claude-ping-${Date.now()}`;

  if (e.data) {
    try {
      const p = e.data.json();
      title = p.title || title;
      body  = p.body  || body;
      tag   = p.tag   || tag;
    } catch { /* keep defaults — must still show notification */ }
  }

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});
