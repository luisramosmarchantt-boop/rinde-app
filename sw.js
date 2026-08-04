// Service Worker — RindeApp Cloud
// Cache de la "app shell" (los datos en si viven en Supabase, no aca).
// Ademas maneja notificaciones Web Push.

const CACHE = 'rindeapp-cloud-v1';
const RUNTIME = 'rindeapp-cloud-runtime-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/app.js',
  './js/store.js',
  './js/utils.js',
  './js/charts.js',
  './js/router.js',
  './js/views.js',
  './js/forms.js',
  './js/ui.js',
  './js/ocr.js',
  './js/crop.js',
  './js/pdf.js',
  './js/assets.js',
  './js/imageUtils.js',
  './js/supabaseClient.js',
  './js/auth.js',
  './js/storage.js',
  './js/push.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![CACHE, RUNTIME].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Network-first para navegación (para tomar versiones nuevas),
  // cache-first para el resto de assets.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const fresh = fetch(request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return resp;
        }).catch(() => null);
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        const copy = resp.clone();
        const targetCache = new URL(request.url).origin === self.location.origin ? CACHE : RUNTIME;
        caches.open(targetCache).then((cache) => cache.put(request, copy)).catch(() => {});
        return resp;
      }).catch(() => cached);
    })
  );
});

// ===== Web Push =====
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { title: 'RindeApp Cloud', body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'RindeApp Cloud';
  const options = {
    body: payload.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
