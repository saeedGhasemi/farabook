import { useEffect, useState } from "react";
import { isOfflineAssetUrl, resolveOfflineAsset } from "@/lib/offline/assetResolver";
import { useAuth } from "@/hooks/useAuth";

/** If `src` is an `offline-asset://` URL, resolves it to a blob: URL by
 *  decrypting the asset from the local store. Otherwise returns `src` as-is.
 *  Returns null while resolving so callers can render a skeleton. */
export function useOfflineAsset(src: string | null | undefined): string | null {
  const { user } = useAuth();
  const [resolved, setResolved] = useState<string | null>(() =>
    src && !isOfflineAssetUrl(src) ? src : null,
  );

  useEffect(() => {
    if (!src) { setResolved(null); return; }
    if (!isOfflineAssetUrl(src)) { setResolved(src); return; }
    if (!user) { setResolved(null); return; }
    let cancelled = false;
    resolveOfflineAsset(src, user.id).then((u) => {
      if (!cancelled) setResolved(u);
    });
    return () => { cancelled = true; };
  }, [src, user]);

  return resolved;
}
