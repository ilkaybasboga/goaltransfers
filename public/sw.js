// GoalTransfer Service Worker — PWA Offline Desteği
const CACHE_NAME   = 'goaltransfer-v5';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Kurulum — statik dosyaları önbelleğe al
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE))
  );
  self.skipWaiting();
});

// Aktivasyon — eski önbellekleri temizle
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Network first, önbellek fallback
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // API istekleri: Network only (güncel veri önemli)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/admin/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ success: false, error: 'Çevrimdışısın', offline: true }),
          { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // HTML sayfaları: Network first, önbellek fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Diğerleri: Cache first
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

// Push bildirimleri (gelecek için hazır)
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'GoalTransfer', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.link || '/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
