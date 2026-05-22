import { useEffect, useState } from "react";

/** Tracks `navigator.onLine` with online/offline event listeners. SSR-safe. */
export function useNetworkStatus(): { online: boolean; offline: boolean } {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return { online, offline: !online };
}
