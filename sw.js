// HarmonyX Peptides - minimal service worker
// Purpose: satisfy PWA installability criteria (desktop "Install app" + Android
// home-screen install) and provide a basic offline fallback. Deliberately does
// NOT cache index.html, images, or the hero video - those should always come
// fresh from the network/CDN so future site updates show up immediately
// without needing a service worker version bump.

const CACHE_NAME = "hx-shell-v1";
const PRECACHE_URLS = ["/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

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

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle simple GET navigations/assets; let everything else (POST,
  // cross-origin, etc.) pass straight through untouched.
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

  // Precached shell assets (icons, manifest): cache-first for instant load.
  if (PRECACHE_URLS.includes(new URL(req.url).pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
