// Service Worker: Offline-Fähigkeit und Hintergrund-Check (js/bg.js).
// Bei jeder Veröffentlichung VERSION erhöhen.
const VERSION = 'v5';
const CACHE = 'fragerunde-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/store.js',
  'js/logic.js',
  'js/questions.js',
  'js/questions-generated.js',
  'js/bg.js',
  'vendor/nostr.bundle.js',
  'vendor/qrcode.js',
  'vendor/jsQR.js',
  'fonts/young-serif.woff2',
  'fonts/schibsted-grotesk.woff2',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

importScripts('vendor/nostr.bundle.js', 'js/bg.js');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Erst das Netz (damit Updates sofort ankommen), nach 3 s oder offline der Cache.
// 'no-cache' umgeht den HTTP-Cache (GitHub Pages: max-age=600), sonst könnten
// nach einem Update alte und neue Dateien gemischt geladen werden.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const net = fetch(req, { cache: 'no-cache' }).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
      const timeout = new Promise((res) => setTimeout(res, 3000));
      const first = await Promise.race([net.catch(() => null), timeout]);
      if (first) return first;
      const hit = await cache.match(key, { ignoreSearch: true });
      return hit || net;
    }),
  );
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'fragerunde-check') e.waitUntil(self.FR.check());
});

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'check') {
    e.waitUntil(
      self.FR.check({ dry: msg.dry, force: true, after: msg.after })
        .catch((err) => ({ error: String(err) }))
        .then((notes) => e.source?.postMessage({ type: 'check-result', notes })),
    );
  } else if (msg.type === 'test') {
    e.waitUntil(
      self.registration.showNotification('Fragerunde', {
        body: 'So sehen Benachrichtigungen aus 🎉',
        tag: 'fr-test',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
      }),
    );
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) return win.navigate(url).then((c) => (c || win).focus());
      return self.clients.openWindow(url);
    }),
  );
});
