// Кэш оболочки приложения: открывается мгновенно и без сети. Данные HA сюда не попадают.
const CACHE = 'climate-shell-750de8acc0';
const FILES = ['./index.html', './app.js', './ha.js', './devices.js', './rooms.js', './views.js',
  './push.js', './styles.css', './manifest.json', './icon-180.png', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// stale-while-revalidate для файлов приложения
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location.href).pathname)) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Климат', {
    body: data.body || '',
    tag: data.tag || 'climate',
    renotify: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './index.html#/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './index.html#/', self.location.origin).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); return win.navigate ? win.navigate(target).catch(() => {}) : undefined; }
    return self.clients.openWindow(target);
  })());
});
