// Service worker cleanup. The app previously shipped a PWA worker that could
// keep serving stale HTML/JS and roll users back after refresh. We now keep
// the app network-first by not registering a runtime PWA worker at all, and
// aggressively unregister/delete any old workers/caches left on the device.

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

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    await clearRuntimeCaches();

    // Request persistent storage so iOS/Safari doesn't evict offline books.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    console.warn("[PWA] register failed", e);
  }
}
