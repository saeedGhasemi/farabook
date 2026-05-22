// Resolves `offline-asset://<bookId>/<key>` URLs to blob: URLs backed by the
// encrypted OfflineStore. Caches blob URLs per (book,key) so the same asset
// is not decrypted twice per session. Call `revokeAllOfflineAssets()` to free.

import { readAsset } from "./OfflineStore";

const cache = new Map<string, string>(); // `${bookId}/${key}` -> blob url
const inflight = new Map<string, Promise<string | null>>();

export const OFFLINE_ASSET_SCHEME = "offline-asset://";

export function isOfflineAssetUrl(url?: string | null): boolean {
  return !!url && url.startsWith(OFFLINE_ASSET_SCHEME);
}

export function parseOfflineAssetUrl(url: string): { bookId: string; assetKey: string } | null {
  if (!isOfflineAssetUrl(url)) return null;
  const rest = url.slice(OFFLINE_ASSET_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return { bookId: rest.slice(0, slash), assetKey: rest.slice(slash + 1) };
}

/** Returns a blob: URL ready to use as <img src> / <video src>, or null if
 *  the asset isn't in the local store (e.g. caller is online — pass through
 *  the original URL instead). */
export async function resolveOfflineAsset(url: string, userId: string): Promise<string | null> {
  const parsed = parseOfflineAssetUrl(url);
  if (!parsed) return null;
  const cacheKey = `${parsed.bookId}/${parsed.assetKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let p = inflight.get(cacheKey);
  if (!p) {
    p = (async () => {
      const a = await readAsset(parsed.bookId, userId, parsed.assetKey);
      if (!a) return null;
      // copy into a fresh ArrayBuffer so TS' Blob types accept it across envs
      const copy = new Uint8Array(a.bytes.byteLength);
      copy.set(a.bytes);
      const blob = new Blob([copy.buffer], { type: a.mime });
      const u = URL.createObjectURL(blob);
      cache.set(cacheKey, u);
      return u;
    })();
    inflight.set(cacheKey, p);
  }
  try { return await p; } finally { inflight.delete(cacheKey); }
}

export function revokeAllOfflineAssets(): void {
  for (const u of cache.values()) URL.revokeObjectURL(u);
  cache.clear();
}
