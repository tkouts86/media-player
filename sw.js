// Makes the app always load its latest files. Without this, iPhone Home Screen apps can keep
// using cached copies after an update, or mix new files with old ones.
//
// Every request for the app's own files goes to the network as a quick "has it changed?" check
// (usually a tiny 304 reply); the last copy is only used when the network is unavailable.
// Requests to other sites (Spotify, lyrics, the login-code relay) aren't touched.

const CACHE = 'media-player';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // Store copies without the query string, so login codes (?code=…) are never kept.
  const key = new URL(request.url);
  key.search = '';

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request.url, { cache: 'no-cache' });
      if (response.ok) cache.put(key, response.clone());
      return response;
    } catch (err) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw err;
    }
  })());
});
