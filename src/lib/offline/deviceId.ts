// Stable per-install device id. Persisted in localStorage on web, and in
// Capacitor Preferences (Keychain/Keystore-backed) on native. Never sent
// outside the user's session.
const KEY = "farabook.device_id";

let cached: string | null = null;
let prefsModule: typeof import("@capacitor/preferences") | null = null;

async function loadPrefs() {
  if (prefsModule !== null) return prefsModule;
  try {
    prefsModule = await import("@capacitor/preferences");
  } catch {
    prefsModule = null;
  }
  return prefsModule;
}

function isNative(): boolean {
  // Capacitor injects this global on native runtimes only.
  return typeof (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor !== "undefined"
    && !!(globalThis as unknown as { Capacitor: { isNativePlatform?: () => boolean } }).Capacitor.isNativePlatform?.();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Edg|OPR/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome|Edg|OPR/i.test(ua)) return "Safari";
  return "Browser";
}

function detectOS(ua: string): string {
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function detectLabel(): string {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent;
  const os = detectOS(ua);
  if (isNative()) return os;
  const br = detectBrowser(ua);
  return `${br} • ${os}`;
}

export function getDeviceLabel(): string {
  return detectLabel();
}


export function getDevicePlatform(): string {
  return isNative() ? "native" : "web";
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  if (isNative()) {
    const prefs = await loadPrefs();
    if (prefs) {
      const got = await prefs.Preferences.get({ key: KEY });
      if (got.value) {
        cached = got.value;
        return cached;
      }
      const id = newId();
      await prefs.Preferences.set({ key: KEY, value: id });
      cached = id;
      return id;
    }
  }

  // Web fallback
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const id = newId();
    localStorage.setItem(KEY, id);
    cached = id;
    return id;
  } catch {
    // Private mode etc.
    const id = newId();
    cached = id;
    return id;
  }
}
