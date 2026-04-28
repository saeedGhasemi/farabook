// Client-side image compression + smart upload helpers.
// We downscale large images and re-encode as WebP/JPEG before upload, while
// also keeping the original so users can opt to view the full-quality version.

import { supabase } from "@/integrations/supabase/client";

export interface OptimizeOptions {
  /** Max edge (longest side) in pixels for the optimized variant. */
  maxEdge?: number;
  /** JPEG/WebP quality 0-1. */
  quality?: number;
  /** Output mime — defaults to image/webp (falls back to jpeg). */
  mime?: "image/webp" | "image/jpeg";
}

/** Files smaller than this and already small dims are uploaded as-is. */
const PASSTHROUGH_BYTES = 200 * 1024; // 200 KB

const loadImage = (file: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

/**
 * Compress an image file in the browser. Returns the original blob if it is
 * already small enough or if compression somehow made it bigger.
 */
export const compressImage = async (
  file: File,
  opts: OptimizeOptions = {},
): Promise<{ blob: Blob; ext: string; mime: string }> => {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;
  const targetMime = opts.mime ?? "image/webp";

  // Don't bother for non-raster (svg/gif/animated) — keep original.
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
    return { blob: file, ext: file.name.split(".").pop() || "bin", mime: file.type };
  }

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > maxEdge ? maxEdge / longest : 1;

    // Skip work if already small + small file
    if (scale === 1 && file.size <= PASSTHROUGH_BYTES) {
      return { blob: file, ext: file.name.split(".").pop() || "jpg", mime: file.type };
    }

    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, ext: file.name.split(".").pop() || "jpg", mime: file.type };
    ctx.drawImage(img, 0, 0, w, h);

    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), targetMime, quality),
    );
    if (!blob || blob.size >= file.size) {
      // No win — keep original
      return { blob: file, ext: file.name.split(".").pop() || "jpg", mime: file.type };
    }
    const ext = targetMime === "image/webp" ? "webp" : "jpg";
    return { blob, ext, mime: targetMime };
  } catch {
    return { blob: file, ext: file.name.split(".").pop() || "jpg", mime: file.type };
  }
};

/**
 * Upload an image to the book-media bucket: stores an optimized variant and,
 * for raster originals that we actually compressed, also stores the original
 * with an `__orig` suffix so the reader can offer "view original".
 *
 * Returns the public URL of the OPTIMIZED file.
 */
export const uploadOptimizedImage = async (
  userId: string,
  file: File,
  prefix = "img",
  opts: OptimizeOptions = {},
): Promise<string | null> => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = `${userId}/${prefix}/${stamp}`;

  const { blob, ext, mime } = await compressImage(file, opts);

  // Optimized variant
  const optKey = `${base}.${ext}`;
  const up = await supabase.storage.from("book-media").upload(optKey, blob, {
    contentType: mime, upsert: false,
  });
  if (up.error) return null;
  const optUrl = supabase.storage.from("book-media").getPublicUrl(optKey).data.publicUrl;

  // If we actually changed the file, also store the original for opt-in viewing
  if (blob !== file) {
    const origExt = file.name.split(".").pop() || "jpg";
    const origKey = `${base}__orig.${origExt}`;
    // Best-effort; ignore failure so the optimized upload still succeeds.
    await supabase.storage.from("book-media").upload(origKey, file, {
      contentType: file.type, upsert: false,
    });
  }
  return optUrl;
};

/**
 * Given an optimized public URL, derive the matching original URL by swapping
 * the extension with `__orig.<ext>`. We probe a few common extensions because
 * we don't always know which one the original used.
 *
 * Returns a candidate URL that the browser can try to load — if it 404s the
 * UI should silently fall back to the optimized version.
 */
export const deriveOriginalUrl = (optimizedUrl: string): string | null => {
  if (!optimizedUrl) return null;
  // Match: <base>/<stamp>.<ext>?...   →  <base>/<stamp>__orig.<ext-list>
  const m = optimizedUrl.match(/^(.*?)\/([^/?#]+?)\.(webp|jpe?g|png)(\?.*)?$/i);
  if (!m) return null;
  const [, base, stamp, , query = ""] = m;
  // We can't know the original ext for sure — return a "guess" using `.jpg`
  // as the most common case; consumers should `onError` fallback gracefully.
  // Try a chain of extensions via a comma-separated hint string:
  return `${base}/${stamp}__orig.jpg${query}`;
};

/** All candidate original URLs to try, in order. */
export const candidateOriginalUrls = (optimizedUrl: string): string[] => {
  if (!optimizedUrl) return [];
  const m = optimizedUrl.match(/^(.*?)\/([^/?#]+?)\.(webp|jpe?g|png)(\?.*)?$/i);
  if (!m) return [];
  const [, base, stamp, , query = ""] = m;
  return ["jpg", "jpeg", "png", "webp"].map((e) => `${base}/${stamp}__orig.${e}${query}`);
};
