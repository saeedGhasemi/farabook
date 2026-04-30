// useAutoCover: for books missing a cover_url, lazily triggers the
// `book-auto-cover` edge function and returns the resulting URL once
// available. Caches per-book in module-level memory so multiple cards
// for the same book do not double-fire.
//
// Returns the resolved cover URL (or null while pending). Callers should
// fall back to a placeholder while null.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string>(); // bookId -> url
const inflight = new Map<string, Promise<string | null>>();

async function trigger(bookId: string): Promise<string | null> {
  if (cache.has(bookId)) return cache.get(bookId)!;
  if (inflight.has(bookId)) return inflight.get(bookId)!;
  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("book-auto-cover", {
        body: { book_id: bookId },
      });
      if (error) { console.warn("auto-cover", error); return null; }
      const url = (data as { url?: string })?.url || null;
      if (url) cache.set(bookId, url);
      return url;
    } catch (e) {
      console.warn("auto-cover", e);
      return null;
    } finally {
      inflight.delete(bookId);
    }
  })();
  inflight.set(bookId, p);
  return p;
}

export function useAutoCover(bookId: string | undefined, existing: string | null | undefined): string | null {
  const initial = existing && !/placeholder/i.test(existing) ? existing : (bookId ? cache.get(bookId) ?? null : null);
  const [url, setUrl] = useState<string | null>(initial);

  useEffect(() => {
    if (!bookId) return;
    if (existing && !/placeholder/i.test(existing)) { setUrl(existing); return; }
    let alive = true;
    trigger(bookId).then((u) => { if (alive && u) setUrl(u); });
    return () => { alive = false; };
  }, [bookId, existing]);

  return url;
}
