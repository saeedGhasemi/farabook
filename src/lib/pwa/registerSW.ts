// Registers a minimal app-shell service worker (public/app-sw.js) so the
// Library and other routes keep working after a refresh while offline.
// Old PWA workers (sw.js, service-worker.js) are unregistered on sight to
// prevent stale builds from being served.

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

const APP_SW_URL = "/app-sw.js";

async function unregisterLegacyWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs.map(async (r) => {
      const scriptURL = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (!scriptURL.endsWith(APP_SW_URL)) {
        try { await r.unregister(); } catch (_) {}
      }
    }),
  );
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    await unregisterLegacyWorkers();

    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if (!PWA_ENABLED) return;

    // Register the app-shell SW so refresh-while-offline still boots the app.
    await navigator.serviceWorker.register(APP_SW_URL, { scope: "/" });
  } catch (e) {
    console.warn("[PWA] register failed", e);
  }
}
