/**
 * MentorOS Reader service worker — hand-rolled, ~50 lines, no Workbox.
 *
 * Two rules, no versioning ceremony:
 *   • the page and content.json are network-first, so a republish shows up as
 *     soon as you're online, and falls back to cache when you're not;
 *   • everything else (Vite's content-hashed assets, fonts, icons) is
 *     cache-first, because a hashed filename never changes contents.
 */
/* global self, caches, fetch, Response, URL */
const CACHE = 'mentoros-reader';
const SHELL = ['./', './index.html', './manifest.webmanifest', './content.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    // A navigation with nothing cached for this exact URL still has the shell.
    return (await cache.match('./index.html')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) await cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isContent = url.pathname.endsWith('/content.json');
  event.respondWith(
    request.mode === 'navigate' || isContent ? networkFirst(request) : cacheFirst(request),
  );
});
