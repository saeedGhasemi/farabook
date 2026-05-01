// useAutoCover: for books missing a cover_url, lazily triggers the
// `book-auto-cover` edge function and returns the resulting URL once
// available.
//
// Cache strategy:
// - In-memory cache is keyed by `${COVER_VERSION}:${bookId}` so bumping
//   COVER_VERSION whenever the edge function or fallback changes
//   automatically invalidates stale null/error states for the session.
// - sessionStorage mirrors the cache so a page reload also picks up the
//   new version cleanly.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Bump this whenever the edge function or fallback logic changes so
// previously failed attempts get retried instead of being stuck.
const COVER_VERSION = "v3";
const SS_PREFIX = `auto-cover:${COVER_VERSION}:`;

const cache = new Map<string, string>(); // key -> url
const inflight = new Map<string, Promise<string | null>>();

const keyFor = (bookId: string) => `${COVER_VERSION}:${bookId}`;

const readSession = (bookId: string): string | null => {
  try { return sessionStorage.getItem(SS_PREFIX + bookId); } catch { return null; }
};
const writeSession = (bookId: string, url: string) => {
  try { sessionStorage.setItem(SS_PREFIX + bookId, url); } catch { /* noop */ }
};
const clearOldVersions = () => {
  try {
    const keep = SS_PREFIX;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("auto-cover:") && !k.startsWith(keep)) sessionStorage.removeItem(k);
    }
  } catch { /* noop */ }
};
clearOldVersions();

async function trigger(bookId: string): Promise<string | null> {
  const k = keyFor(bookId);
  if (cache.has(k)) return cache.get(k)!;
  const ss = readSession(bookId);
  if (ss) { cache.set(k, ss); return ss; }
  if (inflight.has(k)) return inflight.get(k)!;
  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("book-auto-cover", {
        body: { book_id: bookId, v: COVER_VERSION },
      });
      if (error) { console.warn("auto-cover", error); return null; }
      const url = (data as { url?: string })?.url || null;
      if (url) { cache.set(k, url); writeSession(bookId, url); }
      return url;
    } catch (e) {
      console.warn("auto-cover", e);
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

export function useAutoCover(bookId: string | undefined, existing: string | null | undefined): string | null {
  const hasReal = !!(existing && !/placeholder/i.test(existing));
  const initial = hasReal ? (existing as string) : (bookId ? cache.get(keyFor(bookId)) ?? readSession(bookId) : null);
  const [url, setUrl] = useState<string | null>(initial);

  useEffect(() => {
    if (!bookId) return;
    if (hasReal) { setUrl(existing as string); return; }
    let alive = true;
    trigger(bookId).then((u) => { if (alive && u) setUrl(u); });
    return () => { alive = false; };
  }, [bookId, existing, hasReal]);

  return url;
}
