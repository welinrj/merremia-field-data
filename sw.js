const CACHE_NAME = 'merremia-field-v1.3';

// Dynamically determine what to cache based on SW scope
const SCOPE = self.registration?.scope || self.location.href.replace(/sw\.js.*$/, '');

const ASSETS_TO_CACHE = [
  SCOPE,
  new URL('index.html', SCOPE).href,
  new URL('manifest.json', SCOPE).href
];

// Google Fonts to cache (these are cross-origin, handled separately)
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap'
];

// Install — cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Caching core assets for scope:', SCOPE);
      // Cache same-origin assets first (these should always work)
      await cache.addAll(ASSETS_TO_CACHE);
      // Try to cache fonts (cross-origin, may fail silently)
      for (const url of FONT_URLS) {
        try { await cache.add(url); }
        catch (e) { console.warn('[SW] Font cache skipped:', e.message); }
      }
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch — network-first for API calls, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache GitHub API calls — always go to network
  if (url.hostname === 'api.github.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for Google Fonts (they update occasionally)
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (app shell)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Only cache successful same-origin responses
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Fallback for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});

// Background sync — retry failed syncs when connectivity returns
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-records') {
    event.waitUntil(syncPendingRecords());
  }
});

async function syncPendingRecords() {
  // Notify the main app to trigger sync
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}

// Listen for messages from main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
