import { useEffect, useRef, useState } from "react";

// Same-origin reachability probe. It checks more than one static endpoint because
// previews, proxies, or a stale service worker can occasionally fail one URL even
// while the user is online. We only treat repeated failures as offline.
const probeOnline = async (): Promise<boolean> => {
  if (typeof window === "undefined") return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const ts = Date.now();
    const probes = [`/version.json?online_check=${ts}`, `/manifest.webmanifest?online_check=${ts}`, `/?online_check=${ts}`];
    for (const url of probes) {
      try {
        const resp = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (resp.ok || resp.status === 304) return true;
      } catch {
        // Try the next endpoint before deciding the network is unreachable.
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
};

/** Tracks real reachability. Treats only confirmed failures as offline so we
 *  don't flash false offline banners when Supabase rate-limits or CORS-blocks. */
export function useNetworkStatus(): { online: boolean; offline: boolean } {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const failures = useRef(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await probeOnline();
      if (!alive) return;
      if (ok) {
        failures.current = 0;
        setOnline(true);
        return;
      }
      failures.current += 1;
      if (typeof navigator !== "undefined" && navigator.onLine === false) setOnline(false);
      else if (failures.current >= 3) setOnline(false);
    };
    const on = () => { failures.current = 0; setOnline(true); void check(); };
    const off = () => { failures.current = 3; setOnline(false); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return { online, offline: !online };
}
