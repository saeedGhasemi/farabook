import { useEffect, useState } from "react";

// Same-origin probe: hits a static asset the server always serves. Supabase
// REST probes are unreliable (RLS/CORS/auth/rate-limit can return errors even
// when the network is fine), which caused false "offline" banners.
const probeOnline = async (): Promise<boolean> => {
  if (typeof window === "undefined") return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const resp = await fetch(`/manifest.webmanifest?online_check=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return resp.ok || resp.status === 304;
  } catch {
    // Network truly unreachable.
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
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await probeOnline();
      if (alive) setOnline(ok);
    };
    const on = () => { setOnline(true); void check(); };
    const off = () => { setOnline(false); };
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
