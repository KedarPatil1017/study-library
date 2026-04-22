// ── Study Manager — Service Worker ─────────────────────────────────────────────
// Cache-first strategy for all static assets; network-first for navigations.

const CACHE_NAME   = 'study-manager-v1';
const CACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    // CDN assets pre-cached so the app works fully offline
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// ── Install: pre-cache all essential assets ────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cache same-origin assets reliably; CDN assets best-effort.
            const sameOrigin = CACHE_ASSETS.filter(url => !url.startsWith('http'));
            const crossOrigin = CACHE_ASSETS.filter(url => url.startsWith('http'));

            return cache.addAll(sameOrigin).then(() =>
                Promise.allSettled(
                    crossOrigin.map(url =>
                        fetch(url, { mode: 'cors' })
                            .then(res => res.ok ? cache.put(url, res) : null)
                            .catch(() => null)   // Never block install on CDN failure
                    )
                )
            );
        }).then(() => self.skipWaiting())   // Activate immediately
    );
});

// ── Activate: prune old caches ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())   // Take control of all open pages
    );
});

// ── Fetch: cache-first for static assets, network-first for navigations ────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Only handle GET requests
    if (request.method !== 'GET') return;

    // Skip non-http(s) schemes (chrome-extension, blob, data, …)
    if (!request.url.startsWith('http')) return;

    // Skip Google Fonts HTML (varies per user-agent; let browser handle it)
    // but DO serve cached CSS/font files
    const isNavigation = request.mode === 'navigate';

    if (isNavigation) {
        // Network-first for page navigations (ensures fresh HTML when online)
        event.respondWith(
            fetch(request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, clone));
                    return res;
                })
                .catch(() => caches.match('./index.html'))   // Fallback to cached shell
        );
        return;
    }

    // Cache-first for everything else (CSS, JS, fonts, images)
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            // Not cached — fetch, store, return
            return fetch(request).then(res => {
                if (!res || res.status !== 200) return res;

                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(request, clone));
                return res;
            }).catch(() => {
                // For image requests, return a transparent placeholder
                if (request.destination === 'image') {
                    return new Response(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
                        { headers: { 'Content-Type': 'image/svg+xml' } }
                    );
                }
                return new Response('Offline', { status: 503 });
            });
        })
    );
});
