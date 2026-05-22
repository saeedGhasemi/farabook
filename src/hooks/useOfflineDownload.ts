// Per-book offline download controller. Subscribes to OfflineStore progress for
// one book, exposes status + percentage + actions to the UI.

import { useCallback, useEffect, useState } from "react";
import {
  downloadBook,
  removeBookLocally,
  type DownloadProgress,
} from "@/lib/offline/OfflineStore";
import { getAdapter } from "@/lib/offline/db";
import { ASSET_WALKER_VERSION } from "@/lib/offline/assetWalker";
import type { DownloadStatus } from "@/lib/offline/types";

export interface OfflineState {
  status: DownloadStatus | "idle";
  bytesWritten: number;
  totalBytes: number | null;
  contentVersion: number | null;
  error: string | null;
  /** True when the local copy is ready AND matches the latest known server version. */
  isFresh: boolean;
}

const initial: OfflineState = {
  status: "idle",
  bytesWritten: 0,
  totalBytes: null,
  contentVersion: null,
  error: null,
  isFresh: false,
};

export function useOfflineDownload(bookId: string | undefined, userId: string | undefined) {
  const [state, setState] = useState<OfflineState>(initial);

  const onProgress = useCallback((p: DownloadProgress) => {
    setState((s) => ({
      ...s,
      status: p.status,
      bytesWritten: p.bytesWritten,
      totalBytes: p.totalBytes,
      error: p.message ?? null,
      isFresh: p.status === "ready",
    }));
  }, []);

  const download = useCallback(async (deviceLabel?: string) => {
    if (!bookId || !userId) return;
    try {
      const row = await downloadBook(bookId, userId, { onProgress, deviceLabel });
      setState({
        status: row.status,
        bytesWritten: row.size_bytes,
        totalBytes: row.size_bytes,
        contentVersion: row.content_version,
        error: row.last_error,
        isFresh: row.status === "ready",
      });
    } catch (e) {
      setState((s) => ({ ...s, status: "failed", error: e instanceof Error ? e.message : String(e) }));
      throw e;
    }
  }, [bookId, userId, onProgress]);

  // Hydrate from local cache + auto-resume interrupted downloads on mount.
  useEffect(() => {
    if (!bookId || !userId) return;
    let alive = true;
    (async () => {
      const adapter = await getAdapter();
      const row = await adapter.getBookCache(bookId);
      if (!alive || !row || row.user_id !== userId) return;
      setState({
        status: row.status,
        bytesWritten: row.size_bytes,
        totalBytes: row.size_bytes || null,
        contentVersion: row.content_version,
        error: row.last_error,
        isFresh: row.status === "ready" && row.key_valid,
      });
      const cachedWalker = Number(await adapter.getMeta(`walker:${bookId}`)) || 0;
      const onLine = typeof navigator !== "undefined" && navigator.onLine;
      // Walker upgrade: silently re-download newer schemas.
      if (row.status === "ready" && row.key_valid && cachedWalker !== ASSET_WALKER_VERSION && onLine) {
        try { await downloadBook(bookId, userId, { force: true, onProgress }); }
        catch (e) { console.warn("[offline] walker-upgrade re-download failed", e); }
      }
      // Auto-resume: a "downloading" or "failed" row means a previous attempt
      // was interrupted. Pick it up automatically — no user click required.
      if ((row.status === "downloading" || row.status === "failed") && onLine) {
        try { await downloadBook(bookId, userId, { onProgress }); }
        catch (e) { console.warn("[offline] auto-resume failed", e); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, userId]);

  // Auto-resume when the network comes back.
  useEffect(() => {
    if (!bookId || !userId) return;
    const onOnline = () => {
      if (state.status === "downloading" || state.status === "failed") {
        downloadBook(bookId, userId, { onProgress }).catch((e) =>
          console.warn("[offline] online-resume failed", e));
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [bookId, userId, state.status, onProgress]);

  const remove = useCallback(async () => {
    if (!bookId || !userId) return;
    await removeBookLocally(bookId, userId);
    setState(initial);
  }, [bookId, userId]);

  const percent = state.totalBytes && state.totalBytes > 0
    ? Math.min(100, Math.round((state.bytesWritten / state.totalBytes) * 100))
    : state.status === "downloading" ? null : state.status === "ready" ? 100 : 0;

  return { state, percent, download, remove };
}

