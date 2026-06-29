importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

/* ===================================================================
   Forge — service worker
   Strategy: network-first, always. No pre-caching. On activate, all
   caches are wiped so stale assets never linger.
   =================================================================== */

var CACHE_NAME = 'forge-runtime';

// Install: take over immediately, do NOT pre-cache anything.
self.addEventListener('install', function () {
  self.skipWaiting();
});

// Activate: delete ALL caches, then claim open clients.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Fetch: network-first. Fall back to cache only when offline.
self.addEventListener('fetch', function (event) {
  // Let OneSignal handle its own SDK/API requests — never intercept them.
  if (event.request.url.includes('onesignal.com') ||
      event.request.url.includes('OneSignalSDK')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        // Keep a fresh copy for offline fallback.
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copy);
        });
        return response;
      })
      .catch(function () {
        // Offline — serve the cached copy if we have one.
        return caches.match(event.request);
      })
  );
});
