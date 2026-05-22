import { useEffect, useState } from "react";

const probeOnline = async (): Promise<boolean> => {
  if (typeof window === "undefined") return true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const url = base
      ? `${base}/rest/v1/books?select=id&limit=1&online_check=${Date.now()}`
      : `/manifest.webmanifest?online_check=${Date.now()}`;
    const resp = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: key ? { apikey: key, authorization: `Bearer ${key}` } : undefined,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
};

/** Tracks real backend reachability; `navigator.onLine` alone is unreliable. */
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
    const off = () => { setOnline(false); void check(); };
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
