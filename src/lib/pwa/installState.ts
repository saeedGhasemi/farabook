// Tracks "is this PWA already installed?" across browser tabs/sessions.
// We persist a flag once we observe the install (or are running standalone),
// so the install button / auto-prompt stops nagging users on the regular
// browser tab after they've installed the app.

const KEY = "farabook.pwa.installed";

export const isStandaloneDisplay = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true);

export const markInstalled = () => {
  try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
};

/** True when we've ever observed an install on this device, or we're running
 *  in standalone mode right now. */
export const isLikelyInstalled = (): boolean => {
  if (isStandaloneDisplay()) {
    markInstalled();
    return true;
  }
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

/** Best-effort: ask the browser if any related app (same scope PWA) is
 *  installed. Available in Chromium-based browsers. */
export const checkInstalledViaRelatedApps = async (): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (typeof nav.getInstalledRelatedApps !== "function") return false;
    const apps = await nav.getInstalledRelatedApps();
    if (Array.isArray(apps) && apps.length > 0) {
      markInstalled();
      return true;
    }
  } catch { /* ignore */ }
  return false;
};

/** Wire global listeners that mark the app as installed when we detect it. */
export const wireInstallDetection = () => {
  if (typeof window === "undefined") return;
  window.addEventListener("appinstalled", () => markInstalled());
  // If we're already running standalone right now, persist that.
  if (isStandaloneDisplay()) markInstalled();
  // Async probe via getInstalledRelatedApps (Chromium only).
  void checkInstalledViaRelatedApps();
};
