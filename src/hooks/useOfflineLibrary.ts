import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listLocalBooks, readManifest } from "@/lib/offline/OfflineStore";
import type { BookCacheRow } from "@/lib/offline/types";

export interface OfflineLibBook {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  /** True when this entry was hydrated from the local encrypted store. */
  offline: true;
  status: BookCacheRow["status"];
  size_bytes: number;
  content_version: number;
}

/** Returns the list of books available in the local OfflineStore, hydrated
 *  with manifest metadata (title/author/cover) so the shelf renders even
 *  when fully offline. */
export function useOfflineLibrary(userId?: string | null) {
  const [books, setBooks] = useState<OfflineLibBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setBooks([]); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listLocalBooks(userId);
        const items: OfflineLibBook[] = [];
        for (const r of rows) {
          if (r.status === "revoked") continue;
          try {
            const m = await readManifest(r.book_id, userId);
            items.push({
              id: r.book_id,
              title: m?.title ?? r.book_id,
              author: m?.author ?? null,
              cover_url: m?.cover_url ?? null,
              offline: true,
              status: r.status,
              size_bytes: r.size_bytes,
              content_version: r.content_version,
            });
          } catch {
            items.push({
              id: r.book_id, title: r.book_id, author: null, cover_url: null,
              offline: true, status: r.status, size_bytes: r.size_bytes,
              content_version: r.content_version,
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

/** Hydrate a cached Supabase session (if any) so `useAuth` can resolve a user
 *  while offline. Returns the user id when available. */
export async function getCachedUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
