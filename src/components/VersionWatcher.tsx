import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { APP_VERSION } from "@/lib/version";

/**
 * On every route change, fetches /version.json with no-cache.
 * If the deployed version differs from the bundled APP_VERSION,
 * forces a full reload so the user gets the latest build.
 */
export const VersionWatcher = () => {
  const location = useLocation();
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (reloadingRef.current) return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (cancelled || !data?.version) return;
        if (data.version !== APP_VERSION) {
          reloadingRef.current = true;
          // Best-effort: clear service worker caches so reload pulls fresh assets.
          try {
            if ("caches" in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
            if ("serviceWorker" in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.update().catch(() => null)));
            }
          } catch {
            /* ignore */
          }
          window.location.reload();
        }
      } catch {
        /* network/offline: ignore */
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return null;
};
