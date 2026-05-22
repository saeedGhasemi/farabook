// OfflineStore — the single API used by the UI. Wraps the platform DB adapter
// and per-record AES-GCM encryption. Version-aware: never re-downloads a book
// whose `content_version` is unchanged on the server.

import { supabase } from "@/integrations/supabase/client";
import { getAdapter } from "./db";
import {
  decryptBytes, decryptJson, deriveBookKey, encryptBytes, encryptJson, fetchBookPepper, invalidateBookKey,
} from "./crypto";
import { rewritePagesForOffline, ASSET_WALKER_VERSION } from "./assetWalker";
import { registerOfflineBlobUrl, unregisterOfflineBlobUrls } from "@/lib/book-media";
import type { BookCacheRow, BookPageRow, DownloadStatus, HighlightRow, ProgressRow, SyncQueueRow } from "./types";

export interface BookManifest {
  title: string;
  author: string | null;
  cover_url: string | null;
  page_count: number;
  ambient_theme: string | null;
  typography_preset: string | null;
  /** Server-canonical page payloads (block trees). Stored encrypted per page. */
  pages: unknown[];
}

export interface DownloadProgress {
  bookId: string;
  status: DownloadStatus;
  bytesWritten: number;
  totalBytes: number | null;
  message?: string;
}

/** Single-flight per book to avoid duplicate parallel downloads. */
const inflight = new Map<string, Promise<BookCacheRow>>();

async function getKey(userId: string, bookId: string, deviceLabel?: string): Promise<CryptoKey> {
  const adapter = await getAdapter();
  let pepper = await adapter.getMeta(`pepper:${bookId}`);
  if (!pepper) {
    pepper = await fetchBookPepper(bookId, deviceLabel);
    await adapter.setMeta(`pepper:${bookId}`, pepper);
  }
  return deriveBookKey(userId, bookId, pepper);
}

/** Returns the cached row if the local copy is up to date (== server version),
 *  or null when nothing is cached / version mismatch / not ready. */
export async function getCachedIfFresh(bookId: string, userId: string, serverVersion: number): Promise<BookCacheRow | null> {
  const adapter = await getAdapter();
  const row = await adapter.getBookCache(bookId);
  if (!row || row.user_id !== userId) return null;
  if (row.status !== "ready") return null;
  if (row.content_version !== serverVersion) return null;
  if (!row.key_valid) return null;
  return row;
}

export async function readManifest(bookId: string, userId: string): Promise<BookManifest | null> {
  const adapter = await getAdapter();
  const row = await adapter.getBookCache(bookId);
  if (!row?.manifest_enc || !row.manifest_iv) return null;
  const key = await getKey(userId, bookId);
  return decryptJson<BookManifest>(key, row.manifest_enc, row.manifest_iv);
}

export async function readPage(bookId: string, userId: string, pageIndex: number): Promise<unknown | null> {
  const adapter = await getAdapter();
  const row = await adapter.getPage(bookId, pageIndex);
  if (!row) return null;
  const key = await getKey(userId, bookId);
  return decryptJson(key, row.blocks_enc, row.blocks_iv);
}

export async function readAsset(bookId: string, userId: string, assetKey: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const adapter = await getAdapter();
  const row = await adapter.getAsset(bookId, assetKey);
  if (!row) return null;
  const key = await getKey(userId, bookId);
  return { bytes: await decryptBytes(key, row.bytes_enc, row.bytes_iv), mime: row.mime };
}

/** Download (or refresh) a book to the encrypted local store.
 * Skips network entirely if the cached copy is already up to date. */
export async function downloadBook(
  bookId: string,
  userId: string,
  opts: { onProgress?: (p: DownloadProgress) => void; force?: boolean; deviceLabel?: string } = {},
): Promise<BookCacheRow> {
  const existing = inflight.get(bookId);
  if (existing) return existing;

  const task = (async () => {
    const adapter = await getAdapter();
    const onProgress = opts.onProgress ?? (() => {});

    // 1) Fetch authoritative version from server.
    const { data: serverBook, error: bookErr } = await supabase
      .from("books")
      .select("id,title,author,cover_url,ambient_theme,typography_preset,pages,content_version,content_updated_at")
      .eq("id", bookId)
      .maybeSingle();
    if (bookErr || !serverBook) throw bookErr ?? new Error("book_not_found");

    const cached = await adapter.getBookCache(bookId);
    const cachedWalker = Number(await adapter.getMeta(`walker:${bookId}`)) || 0;
    const walkerFresh = cachedWalker === ASSET_WALKER_VERSION;
    if (!opts.force && cached && cached.status === "ready" && cached.content_version === serverBook.content_version && cached.key_valid && walkerFresh) {
      onProgress({ bookId, status: "ready", bytesWritten: cached.size_bytes, totalBytes: cached.size_bytes });
      return cached;
    }

    onProgress({ bookId, status: "downloading", bytesWritten: 0, totalBytes: null });

    // 2) Mark queued/downloading early.
    await adapter.upsertBookCache({
      ...(cached ?? {
        book_id: bookId, user_id: userId, downloaded_at: null, manifest_enc: null, manifest_iv: null, last_error: null, key_valid: true,
      }),
      book_id: bookId, user_id: userId,
      content_version: serverBook.content_version,
      content_updated_at: serverBook.content_updated_at,
      size_bytes: cached?.size_bytes ?? 0,
      status: "downloading",
      manifest_enc: cached?.manifest_enc ?? null,
      manifest_iv: cached?.manifest_iv ?? null,
      last_error: null,
      key_valid: true,
    });

    try {
      // 3) Derive per-(user,book,device) key — also enforces 2-device cap server-side.
      const key = await getKey(userId, bookId, opts.deviceLabel);

      const pagesArr = Array.isArray(serverBook.pages) ? (serverBook.pages as unknown[]) : [];

      // 3a) Walk pages — extract every downloadable asset URL and rewrite the
      // page payload so embedded images/videos point at offline-asset:// keys.
      const { pages: rewrittenPages, assets } = rewritePagesForOffline(pagesArr, bookId);

      const manifest: BookManifest = {
        title: serverBook.title,
        author: serverBook.author,
        cover_url: serverBook.cover_url,
        page_count: rewrittenPages.length,
        ambient_theme: serverBook.ambient_theme,
        typography_preset: serverBook.typography_preset,
        pages: [], // pages are stored separately; manifest holds only metadata
      };

      let bytesWritten = 0;

      // 4) Fetch + encrypt every embedded asset before writing rewritten pages.
      // This keeps older ready copies intact: pages only start pointing to the
      // new offline-asset:// refs after every required media file is present.
      const failedAssets: string[] = [];
      for (const a of assets) {
        try {
          const resp = await fetch(a.url, { credentials: "omit", cache: "no-store", mode: "cors" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = new Uint8Array(await resp.arrayBuffer());
          const enc = await encryptBytes(key, buf);
          await adapter.putAsset({
            book_id: bookId,
            asset_key: a.assetKey,
            mime: resp.headers.get("content-type") ?? "application/octet-stream",
            bytes_enc: enc.data,
            bytes_iv: enc.iv,
            byte_len: buf.byteLength,
          });
          bytesWritten += enc.data.byteLength;
          onProgress({ bookId, status: "downloading", bytesWritten, totalBytes: null });
        } catch (assetErr) {
          failedAssets.push(a.url);
          console.warn(`[offline] asset failed (continuing)`, a.url, assetErr);
        }
      }

      // Best-effort: a few unreachable assets (CORS / 404 / dead CDN) must NOT
      // fail the entire download. The book is still usable; missing media
      // simply falls back to the original URL when the user is online.
      const partialMsg = failedAssets.length
        ? `partial:${failedAssets.length} asset(s) skipped`
        : null;


      // 5) Encrypt + write each (rewritten) page only after assets are complete.
      for (let i = 0; i < rewrittenPages.length; i++) {
        const enc = await encryptJson(key, rewrittenPages[i]);
        const row: BookPageRow = {
          book_id: bookId,
          page_index: i,
          blocks_enc: enc.data,
          blocks_iv: enc.iv,
          byte_len: enc.data.byteLength,
        };
        await adapter.putPage(row);
        bytesWritten += enc.data.byteLength;
        onProgress({ bookId, status: "downloading", bytesWritten, totalBytes: null });
      }

      // 6) Encrypt + cache cover (best effort) as a stable "cover" asset.
      if (serverBook.cover_url) {
        try {
          const resp = await fetch(serverBook.cover_url);
          if (resp.ok) {
            const buf = new Uint8Array(await resp.arrayBuffer());
            const enc = await encryptBytes(key, buf);
            await adapter.putAsset({
              book_id: bookId, asset_key: "cover",
              mime: resp.headers.get("content-type") ?? "image/jpeg",
              bytes_enc: enc.data, bytes_iv: enc.iv, byte_len: buf.byteLength,
            });
            bytesWritten += enc.data.byteLength;
          }
        } catch { /* non-fatal */ }
      }

      // 7) Encrypt manifest.
      const manifestEnc = await encryptJson(key, manifest);

      const finalRow: BookCacheRow = {
        book_id: bookId, user_id: userId,
        content_version: serverBook.content_version,
        content_updated_at: serverBook.content_updated_at,
        downloaded_at: new Date().toISOString(),
        size_bytes: bytesWritten,
        status: "ready",
        manifest_enc: manifestEnc.data,
        manifest_iv: manifestEnc.iv,
        last_error: partialMsg,
        key_valid: true,
      };
      await adapter.upsertBookCache(finalRow);
      await adapter.setMeta(`walker:${bookId}`, String(ASSET_WALKER_VERSION));
      onProgress({ bookId, status: "ready", bytesWritten, totalBytes: bytesWritten, message: partialMsg ?? undefined });
      return finalRow;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (cached?.status === "ready" && cached.manifest_enc && cached.manifest_iv) {
        const preserved = { ...cached, last_error: message };
        await adapter.upsertBookCache(preserved);
        onProgress({ bookId, status: "ready", bytesWritten: cached.size_bytes, totalBytes: cached.size_bytes, message });
        return preserved;
      }
      await adapter.upsertBookCache({
        book_id: bookId, user_id: userId,
        content_version: serverBook.content_version,
        content_updated_at: serverBook.content_updated_at,
        downloaded_at: cached?.downloaded_at ?? null,
        size_bytes: cached?.size_bytes ?? 0,
        status: "failed",
        manifest_enc: cached?.manifest_enc ?? null,
        manifest_iv: cached?.manifest_iv ?? null,
        last_error: message,
        key_valid: true,
      });
      onProgress({ bookId, status: "failed", bytesWritten: 0, totalBytes: null, message });
      throw e;
    }
  })();

  inflight.set(bookId, task);
  try { return await task; } finally { inflight.delete(bookId); }
}

/** Hard-delete the local copy. Called when the user releases a device, the
 *  book is revoked, or the user explicitly removes it. */
export async function removeBookLocally(bookId: string, userId: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.deleteBook(bookId);
  await adapter.setMeta(`pepper:${bookId}`, "");
  invalidateBookKey(userId, bookId);
  unregisterOfflineBlobUrls(bookId);
}

export async function listLocalBooks(userId: string): Promise<BookCacheRow[]> {
  const adapter = await getAdapter();
  return adapter.listBookCache(userId);
}

/** Decrypt every stored asset for a book and register a blob: URL for each
 *  under its `offline-asset://<bookId>/<key>` reference. Once called, any
 *  `<img>` / `<video>` rendered via `resolveBookMedia` resolves transparently
 *  to the local copy. Call before rendering the reader offline. */
export async function precacheBookAssets(bookId: string, userId: string): Promise<number> {
  const adapter = await getAdapter();
  const rows = await adapter.listAssetsByBook(bookId);
  if (!rows.length) return 0;
  const key = await getKey(userId, bookId);
  // Read manifest to map the cover blob URL back to the original cover_url too,
  // so <BookCover src={original_url} /> resolves offline in the Library.
  let originalCoverUrl: string | null = null;
  try {
    const m = await readManifest(bookId, userId);
    originalCoverUrl = m?.cover_url ?? null;
  } catch { /* manifest missing — skip cover aliasing */ }
  const results = await Promise.all(rows.map(async (r) => {
    try {
      const bytes = await decryptBytes(key, r.bytes_enc, r.bytes_iv);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], { type: r.mime });
      const url = URL.createObjectURL(blob);
      registerOfflineBlobUrl(`offline-asset://${bookId}/${r.asset_key}`, url);
      // Alias original cover URL → blob so the offline Library covers render.
      if (r.asset_key === "cover" && originalCoverUrl) {
        registerOfflineBlobUrl(originalCoverUrl, url);
      }
      return 1;
    } catch (e) {
      console.warn("[offline] decrypt asset failed", r.asset_key, e);
      return 0;
    }
  }));
  return results.reduce((a, b) => a + b, 0);
}


/* ---------------- Highlights / progress / sync queue (used by SyncEngine) ---------------- */

export async function saveLocalHighlight(h: HighlightRow): Promise<void> {
  const adapter = await getAdapter();
  await adapter.putHighlight(h);
  await enqueueSync({
    id: crypto.randomUUID(),
    kind: h.deleted_at ? "highlight.delete" : "highlight.upsert",
    payload_json: JSON.stringify(h),
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
  });
}

export async function getLocalHighlights(bookId: string): Promise<HighlightRow[]> {
  const adapter = await getAdapter();
  return adapter.getHighlightsByBook(bookId);
}

export async function saveLocalProgress(p: ProgressRow): Promise<void> {
  const adapter = await getAdapter();
  await adapter.putProgress(p);
  await enqueueSync({
    id: crypto.randomUUID(),
    kind: "progress.update",
    payload_json: JSON.stringify(p),
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
  });
}

export async function enqueueSync(row: SyncQueueRow): Promise<void> {
  const adapter = await getAdapter();
  await adapter.enqueue(row);
}

export async function dueSyncRows(): Promise<SyncQueueRow[]> {
  const adapter = await getAdapter();
  return adapter.dueSyncRows(new Date().toISOString());
}

export async function markSyncDone(id: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.removeSyncRow(id);
}

/** Exponential backoff: 1s, 4s, 16s, 60s, then cap at 60s. */
export async function rescheduleSync(row: SyncQueueRow, err: unknown): Promise<void> {
  const adapter = await getAdapter();
  const seq = [1_000, 4_000, 16_000, 60_000];
  const delay = seq[Math.min(row.attempt_count, seq.length - 1)];
  await adapter.updateSyncRow({
    ...row,
    attempt_count: row.attempt_count + 1,
    next_attempt_at: new Date(Date.now() + delay).toISOString(),
    last_error: err instanceof Error ? err.message : String(err),
  });
}
