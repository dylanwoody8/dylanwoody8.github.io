const CACHE_VERSION = 'cruisenav-pwa-v1';
const APP_SHELL_CACHE = CACHE_VERSION + '-app-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';
const TILE_CACHE = CACHE_VERSION + '-tiles';
const OFFLINE_FALLBACK_URL = './CruiseNav.html';

const APP_SHELL_URLS = [
  './',
  './CruiseNav.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    await cache.addAll(APP_SHELL_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('cruisenav-pwa-') && !key.startsWith(CACHE_VERSION))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE, OFFLINE_FALLBACK_URL));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  if (request.destination === 'image' && isTileRequest(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

function isCacheableResponse(response) {
  return !!response && (response.ok || response.type === 'opaque');
}

function isTileRequest(url) {
  return (
    /tile/i.test(url.hostname) ||
    /google/i.test(url.hostname) ||
    /arcgisonline/i.test(url.hostname) ||
    /openstreetmap/i.test(url.hostname) ||
    url.pathname.toLowerCase().includes('/tile/')
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  if (request.destination === 'document') {
    const fallback = await cache.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
  }

  return new Response('', { status: 504, statusText: 'Offline' });
}
