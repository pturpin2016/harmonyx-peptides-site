// HarmonyX Peptides - minimal service worker
// Purpose: satisfy PWA installability criteria (desktop "Install app" + Android
// home-screen install) and provide a basic offline fallback. Deliberately does
// NOT cache index.html or the hero video - those should always come fresh
// from the network/CDN so future site updates show up immediately without
// needing a service worker version bump.
//
// The two shared vial/bottle template images (reused by nearly every product
// card) and the catalog API response ARE cached, using stale-while-revalidate:
// a repeat app launch gets them instantly from cache while a fresh copy is
// fetched quietly in the background for the *next* launch. Worst case is one
// launch showing a briefly-stale catalog/image instead of a blank wait on a
// third-party origin every single time the app opens.

const CACHE_NAME = "hx-shell-v1";
const PRECACHE_URLS = ["/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

const VIAL_IMAGE_URLS = [
  "https://pub-d475d060317e4fc189c2744f92462331.r2.dev/Vial%20template.png",
  "https://pub-d475d060317e4fc189c2744f92462331.r2.dev/HarmonyX-Nasal-Spray-Bottle.jpg"
  ];

const CATALOG_API_URL = "https://harmonyx-proxy.pturpin2016.workers.dev/api/catalog";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
    );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
                       )
    );
  self.clients.claim();
});

// Cache whatever comes back from the network. Cross-origin requests issued
// as no-cors (e.g. a plain <img src>) resolve to an opaque response whose
// status/ok can't be read, so those are cached unconditionally; regular
// (readable) responses are only cached when they actually succeeded, so a
// transient API error never gets stuck in the cache.
function cachePut(cache, request, response) {
  if (response && (response.type === "opaque" || response.ok)) {
    cache.put(request, response.clone());
  }
}

function staleWhileRevalidate(event) {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
        .then((response) => {
          cachePut(cache, event.request, response);
          return response;
        })
        .catch(() => cached);
        return cached || network;
      })
                                 )
    );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

                      // Only handle simple GET navigations/assets; let everything else (POST,
                      // etc.) pass straight through untouched.
                      if (req.method !== "GET") return;

                      // Page navigations: always try the network first so content updates are
                      // never masked by the service worker. Only fall back to a cached shell
                      // asset if the user is genuinely offline.
                      if (req.mode === "navigate") {
                        event.respondWith(
                          fetch(req).catch(() => caches.match("/icon-512.png").then(() => new Response(
                            "<h1>You're offline</h1><p>HarmonyX Peptides needs an internet connection.</p>",
                            { headers: { "Content-Type": "text/html" } }
                            )))
                          );
                        return;
                      }

                      // Shared vial/bottle template images + the catalog API: serve instantly
                      // from cache on repeat launches while quietly refreshing in the background.
                      if (VIAL_IMAGE_URLS.includes(req.url) || req.url === CATALOG_API_URL) {
                        staleWhileRevalidate(event);
                        return;
                      }

                      // Precached shell assets (icons, manifest): cache-first for instant load.
                      if (PRECACHE_URLS.includes(new URL(req.url).pathname)) {
                        event.respondWith(
                          caches.match(req).then((cached) => cached || fetch(req))
                          );
                      }
});
