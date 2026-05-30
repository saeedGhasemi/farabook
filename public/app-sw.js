// Minimal app-shell service worker — provides offline support for the SPA
// without using vite-plugin-pwa. Strategy:
//   • HTML navigations → network-first, fall back to cached "/" so a refresh
//     while offline still boots the React app (which then renders the
//     offline-aware Library from IndexedDB).
//   • Hashed assets (/assets/*) → cache-first (Vite content-hashes them, so
//     they're immutable and safe to keep forever).
//   • Other GETs → stale-while-revalidate.
// On activate, old caches are purged and clients are reloaded only when
// upgrading from a different SW version.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `farabook-shell-${VERSION}`;
const ASSET_CACHE = `farabook-assets-${VERSION}`;
const RUNTIME_CACHE = `farabook-runtime-${VERSION}`;
const CACHE_ALLOWLIST = [SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE];
const SHELL_URLS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try { await cache.addAll(SHELL_URLS); } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("farabook-") && !CACHE_ALLOWLIST.includes(n))
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/") && /\.[0-9a-f]{6,}\./i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle same-origin requests. Supabase/CDN traffic is left to the
  // app's own caching (IndexedDB blob cache).
  if (url.origin !== self.location.origin) return;

  // Never cache the service worker scripts themselves.
  if (url.pathname === "/app-sw.js" || url.pathname === "/sw.js" || url.pathname === "/service-worker.js") return;

  // HTML navigations → network-first, fallback to cached shell. The root
  // shell is cached only after a real navigation succeeds so installs never
  // pin the app to the HTML from the install-time version.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put("/", fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        const cached = (await cache.match(req)) || (await cache.match("/"));
        if (cached) return cached;
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Hashed assets → cache-first
  if (isHashedAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Other GETs (fonts, manifest, icons) → stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; })
      .catch(() => null);
    return cached || (await network) || new Response("Offline", { status: 503 });
  })());
});
