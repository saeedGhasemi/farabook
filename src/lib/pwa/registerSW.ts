// Service worker registration — guarded against Lovable preview & iframes.
// SW only registers on real production deploys (e.g. farabook.lovable.app or
// a custom domain). In dev / preview we proactively unregister any leftover
// worker so the preview is never served stale code.

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

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (!PWA_ENABLED) {
    // Cleanup any previously installed SW so preview is never trapped.
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch { /* ignore */ }
    return;
  }

  try {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
    // Request persistent storage so iOS/Safari doesn't evict offline books.
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    console.warn("[PWA] register failed", e);
  }
}
