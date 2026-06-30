var CACHE_NAME = 'forge-runtime-v2';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copy);
        });
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  var title = (data.notification && data.notification.title) || 'Forge 🔥';
  var body = (data.notification && data.notification.body) || 'Time to train!';
  var icon = '/forge-app/icons/icon-192.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: icon,
      badge: icon,
      tag: 'forge-reminder',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('https://learning-development667.github.io/forge-app/')
  );
});
