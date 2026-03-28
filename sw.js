// ============================================================
//  EtherX Browser — Service Worker
//  Provides: Offline support, caching, background sync
// ============================================================

const CACHE_VERSION = 'etherx-v2.4.123';
const CACHE_ASSETS = [
    '/etherx-standalone/src/index.html',
    '/etherx-standalone/assets/filters/filters.txt',
    '/etherx-standalone/src/logo_novi.png'
];

// ── Install Event ──────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker v' + CACHE_VERSION);

    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => {
            console.log('[SW] Caching assets');
            return cache.addAll(CACHE_ASSETS).catch(err => {
                console.warn('[SW] Failed to cache some assets:', err);
                // Don't fail installation if caching fails
            });
        })
    );

    // Force immediate activation
    self.skipWaiting();
});

// ── Activate Event ─────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker v' + CACHE_VERSION);

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_VERSION) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );

    // Take control of all clients immediately
    return self.clients.claim();
});

// ── Fetch Event ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip chrome-extension:// and other non-http(s) schemes
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // Skip POST/PUT/DELETE requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Strategy: Network First, fallback to Cache
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone response before caching
                const responseToCache = response.clone();

                // Only cache successful responses
                if (response.status === 200) {
                    caches.open(CACHE_VERSION).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }

                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('[SW] Serving from cache:', event.request.url);
                        return cachedResponse;
                    }

                    // Return offline page for navigation requests
                    if (event.request.mode === 'navigate') {
                        return new Response(
                            `<!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Offline - EtherX Browser</title>
                <style>
                  body {
                    margin: 0;
                    padding: 0;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                  }
                  .container {
                    text-align: center;
                    padding: 2rem;
                    max-width: 500px;
                  }
                  h1 { font-size: 3rem; margin: 0 0 1rem 0; }
                  p { font-size: 1.2rem; opacity: 0.9; line-height: 1.6; }
                  button {
                    margin-top: 2rem;
                    padding: 1rem 2rem;
                    font-size: 1rem;
                    background: rgba(255,255,255,0.2);
                    border: 2px solid white;
                    color: white;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.3s;
                  }
                  button:hover {
                    background: white;
                    color: #667eea;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>🌐 Offline</h1>
                  <p>You're currently offline. EtherX Browser requires an internet connection to browse the web.</p>
                  <p>Please check your connection and try again.</p>
                  <button onclick="location.reload()">Retry</button>
                </div>
              </body>
              </html>`,
                            {
                                headers: { 'Content-Type': 'text/html; charset=utf-8' }
                            }
                        );
                    }

                    // For other requests, return 503
                    return new Response('Service Unavailable', { status: 503 });
                });
            })
    );
});

// ── Background Sync ────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-history') {
        console.log('[SW] Background sync: history');
        event.waitUntil(syncHistory());
    }
});

async function syncHistory() {
    // Placeholder for syncing browser history when online
    try {
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETE',
                data: { synced: true }
            });
        });
    } catch (err) {
        console.error('[SW] Sync failed:', err);
    }
}

// ── Push Notifications ─────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};

    const options = {
        body: data.body || 'New notification',
        icon: '/standalone-browser/src/logo_novi.png',
        badge: '/standalone-browser/src/logo_novi.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'EtherX Browser', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow(event.notification.data.url || '/')
    );
});

// ── Message Handler ────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.delete(CACHE_VERSION).then(() => {
                console.log('[SW] Cache cleared');
            })
        );
    }
});

console.log('[SW] Service Worker loaded');
