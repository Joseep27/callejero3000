const CACHE_NAME = 'callejero3000-v2';
const SHELL = ['./','./index.html','./storage.js','./sync.js','./sync-core.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-180.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await cache.addAll(SHELL);
    await cache.addAll(['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css']).catch(() => {});
  }));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('callejero3000-') && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const inApp = url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);
  const asset = ['cdnjs.cloudflare.com','cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  // Never cache Supabase/auth responses, map tiles or another repo's documents.
  if (!inApp && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (inApp && event.request.mode === 'navigate') return cache.match('./index.html');
      throw error;
    }
  })());
});
