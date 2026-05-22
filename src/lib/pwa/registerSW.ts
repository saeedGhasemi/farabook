// Service worker registration — guarded against Lovable preview & iframes.
// SW only registers on real production deploys (e.g. farabook.lovable.app or
// a custom domain). In dev / preview we proactively unregister any leftover
// worker so the preview is never served stale code.
//
// AUTO-UPDATE BEHAVIOR
// --------------------
// When a new build is deployed:
//   1. The browser fetches the new sw.js (we also poll every 60s + on focus).
//   2. As soon as a new SW reaches the "waiting" state, we call
//      `updateSW(true)` which activates it and reloads the page — so the
//      user sees the new version on the very next render, without needing
//      Ctrl+F5 or a manual cache clear.

const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

const host = typeof window !== "undefined" ? window.location.hostname : "";
const isPreviewHost =
  host.includes("id-preview--") ||
  host.includes("lovableproject.com") ||
  host.includes("lovableproject-dev.com") ||
  host === "localhost" ||
  host === "127.0.0.1";

export const PWA_ENABLED = !isInIframe && !isPreviewHost;

async function clearRuntimeCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => /workbox|precache|runtime|html|assets|media|farabook/i.test(name))
      .map((name) => caches.delete(name)),
  );
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (!PWA_ENABLED) {
    // Cleanup any previously installed SW so preview is never trapped.
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      await clearRuntimeCaches();
    } catch { /* ignore */ }
    return;
  }

  try {
    const { registerSW } = await import("virtual:pwa-register");

    // Auto-reload as soon as a new build is ready. We don't prompt the user —
    // updates are tiny (a fresh HTML shell + hashed JS bundles) and prompting
    // for every deploy was confusing.
    let reloading = false;
    const updateSW = registerSW({
      swUrl: "/service-worker.js",
      immediate: true,
      onNeedRefresh() {
        if (reloading) return;
        reloading = true;
        // `true` → skipWaiting + reload, picks up the new build instantly.
        void updateSW(true);
      },
      onRegistered(registration) {
        if (!registration) return;
        // Poll for a new SW periodically and on tab focus so deploys
        // propagate within ~1 minute even for long-lived tabs.
        const check = () => { registration.update().catch(() => {}); };
        setInterval(check, 60_000);
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      },
    });

    // Initial check.
    void updateSW(false);

    // If the active controller changes (new SW took over), make sure the
    // page reloads exactly once so the user is on the latest assets.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    // Request persistent storage so iOS/Safari doesn't evict offline books.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    console.warn("[PWA] register failed", e);
  }
}
