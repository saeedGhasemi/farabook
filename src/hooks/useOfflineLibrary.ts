import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listLocalBooks, readManifest, precacheBookAssets } from "@/lib/offline/OfflineStore";
import { getAdapter } from "@/lib/offline/db";
import type { BookCacheRow, ProgressRow } from "@/lib/offline/types";

export interface OfflineLibBook {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  offline: true;
  status: BookCacheRow["status"];
  size_bytes: number;
  content_version: number;
  /** 0..1 — read from local progress_local store if present. */
  progress: number;
  current_page: number;
}

export function useOfflineLibrary(userId?: string | null) {
  const [books, setBooks] = useState<OfflineLibBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setBooks([]); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listLocalBooks(userId);
        const adapter = await getAdapter();
        const items: OfflineLibBook[] = [];
        for (const r of rows) {
          if (r.status === "revoked") continue;
          try {
            const m = await readManifest(r.book_id, userId);
            // Decrypt+register cached asset blob URLs (incl. cover) so the
            // Library thumbnails render even after a cold reload while offline.
            await precacheBookAssets(r.book_id, userId).catch(() => 0);
            const prog: ProgressRow | undefined = await adapter.getProgress(r.book_id, userId);
            items.push({
              id: r.book_id,
              title: m?.title ?? r.book_id,
              author: m?.author ?? null,
              cover_url: m?.cover_url ?? null,
              offline: true,
              status: r.status,
              size_bytes: r.size_bytes,
              content_version: r.content_version,
              progress: prog?.progress ?? 0,
              current_page: prog?.current_page ?? 0,
            });
          } catch {
            items.push({
              id: r.book_id, title: r.book_id, author: null, cover_url: null,
              offline: true, status: r.status, size_bytes: r.size_bytes,
              content_version: r.content_version, progress: 0, current_page: 0,
            });
          }
        }
        if (!cancelled) setBooks(items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { books, loading };
}

export async function getCachedUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
