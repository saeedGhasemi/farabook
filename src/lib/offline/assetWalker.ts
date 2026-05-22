// Walks a book's page block tree to find downloadable assets (images/videos/
// audio) and rewrites their `src`/`poster` URLs to `offline-asset://<bookId>/<key>`
// references. Returns the modified pages plus the list of assets to fetch.
//
// embed providers (YouTube/Aparat/Vimeo) cannot be downloaded for copyright
// reasons — we leave their URLs intact and the reader shows a "requires
// internet" placeholder when offline.

export interface AssetRef {
  url: string;       // original absolute or relative URL
  assetKey: string;  // stable key used inside the encrypted store
}

const EMBED_HOSTS = [
  "youtube.com", "www.youtube.com", "youtu.be",
  "vimeo.com", "player.vimeo.com",
  "aparat.com", "www.aparat.com",
];

function isEmbedUrl(url: string): boolean {
  try {
    const u = new URL(url, "https://example.com");
    return EMBED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch { return false; }
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

function isOfflineRef(url: string): boolean {
  return url.startsWith("offline-asset://");
}

/** Stable, FS-safe key derived from the URL. We hash via simple FNV-1a to
 *  avoid pulling crypto for a non-secret key; collisions would only affect
 *  one user's cache and self-heal on next download. */
function keyFor(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  // include extension hint so we can serve correct MIME at read time
  const m = /\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/.exec(url);
  return `media/${hex}${m ? "." + m[1].toLowerCase() : ""}`;
}

/** Recursively walks an arbitrary JSON-like value and applies `visit` to
 *  every string-valued `src`/`poster`/`url` field on object nodes. */
function walk(node: unknown, visit: (obj: Record<string, unknown>, field: string, value: string) => void): void {
  if (!node) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (k === "src" || k === "poster" || k === "url")) {
      visit(obj, k, v);
    } else if (v && typeof v === "object") {
      walk(v, visit);
    }
  }
  // images: string[] (gallery)
  if (Array.isArray(obj.images)) {
    obj.images = (obj.images as unknown[]).map((entry) => {
      if (typeof entry === "string") {
        const replaced = { value: entry };
        visit(replaced as unknown as Record<string, unknown>, "value", entry);
        return replaced.value;
      }
      return entry;
    });
  }
}

export interface RewriteResult {
  /** Deep-cloned pages with downloadable URLs rewritten to offline-asset://. */
  pages: unknown[];
  /** Unique assets to fetch & encrypt. */
  assets: AssetRef[];
}

/** Mutates a deep clone of `pages` and returns it together with the list of
 *  assets that need to be downloaded. Pure — does no I/O. */
export function rewritePagesForOffline(pages: unknown[], bookId: string): RewriteResult {
  const cloned = JSON.parse(JSON.stringify(pages)) as unknown[];
  const seen = new Map<string, string>(); // url -> assetKey

  walk(cloned, (obj, field, value) => {
    if (!value || isOfflineRef(value) || isEmbedUrl(value)) return;
    if (!isAbsoluteUrl(value) && !value.startsWith("/")) return; // skip data:/blob:/etc
    let key = seen.get(value);
    if (!key) {
      key = keyFor(value);
      seen.set(value, key);
    }
    obj[field] = `offline-asset://${bookId}/${key}`;
  });

  const assets: AssetRef[] = Array.from(seen.entries()).map(([url, assetKey]) => ({ url, assetKey }));
  return { pages: cloned, assets };
}
