// Phase 6 — bridge between Reader.tsx and OfflineStore.
// Lets the Reader transparently read from the encrypted local cache when the
// network is unavailable, and write highlights/progress local-first so the
// SyncEngine can flush them when connectivity returns.

import {
  readManifest, readPage,
  saveLocalHighlight, saveLocalProgress, getLocalHighlights,
  getCachedIfFresh, precacheBookAssets,
} from "./OfflineStore";
import { triggerSync } from "./SyncEngine";
import type { HighlightRow, ProgressRow } from "./types";

export interface OfflineBook {
  id: string;
  title: string;
  author: string;
  ambient_theme: string | null;
  typography_preset: string | null;
  pages: unknown[];
  /** Marker so Reader knows ownership/lock checks already passed at download time. */
  __source: "offline";
}

/** Try to assemble the book from the encrypted local store. Returns null if
 *  no usable copy exists (no manifest, missing pages, or version not ready). */
export async function loadOfflineBook(bookId: string, userId: string): Promise<OfflineBook | null> {
  try {
    const manifest = await readManifest(bookId, userId);
    if (!manifest) return null;
    // Decrypt asset blob URLs and pages in parallel — order-independent.
    const [_, ...pages] = await Promise.all([
      precacheBookAssets(bookId, userId),
      ...Array.from({ length: manifest.page_count }, (_, i) => readPage(bookId, userId, i)),
    ]);
    void _;
    if (pages.some((p) => p == null)) return null;
    return {
      id: bookId,
      title: manifest.title,
      author: manifest.author ?? "",
      ambient_theme: manifest.ambient_theme,
      typography_preset: manifest.typography_preset,
      pages,
      __source: "offline",
    };
  } catch {
    return null;
  }
}

/** True when the local copy matches the given server version and is ready. */
export async function hasFreshOfflineCopy(bookId: string, userId: string, serverVersion: number): Promise<boolean> {
  const row = await getCachedIfFresh(bookId, userId, serverVersion);
  return !!row;
}

/* ----------- Highlights (local-first) ----------- */

export interface HighlightInput {
  id?: string;
  bookId: string;
  userId: string;
  pageIndex: number;
  text: string;
  color: string;
  note?: string | null;
  isPublic?: boolean;
}

export async function saveHighlightOfflineFirst(input: HighlightInput): Promise<HighlightRow> {
  const now = new Date().toISOString();
  const id = input.id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const row: HighlightRow = {
    id,
    client_id: id,
    book_id: input.bookId,
    user_id: input.userId,
    page_index: input.pageIndex,
    text: input.text,
    color: input.color,
    note: input.note ?? null,
    is_public: !!input.isPublic,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    synced: false,
  };
  await saveLocalHighlight(row);
  void triggerSync();
  return row;
}

export async function updateHighlightOfflineFirst(
  existing: HighlightRow,
  patch: Partial<Pick<HighlightRow, "note" | "color" | "text" | "is_public">>,
): Promise<HighlightRow> {
  const row: HighlightRow = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
    synced: false,
  };
  await saveLocalHighlight(row);
  void triggerSync();
  return row;
}

export async function deleteHighlightOfflineFirst(existing: HighlightRow): Promise<HighlightRow> {
  const now = new Date().toISOString();
  const row: HighlightRow = { ...existing, deleted_at: now, updated_at: now, synced: false };
  await saveLocalHighlight(row);
  void triggerSync();
  return row;
}

export async function listOfflineHighlights(bookId: string): Promise<HighlightRow[]> {
  const rows = await getLocalHighlights(bookId);
  return rows.filter((r) => !r.deleted_at);
}

/* ----------- Progress (local-first) ----------- */

export async function persistProgressOfflineFirst(
  bookId: string,
  userId: string,
  currentPage: number,
  progress01: number,
): Promise<void> {
  const row: ProgressRow = {
    book_id: bookId,
    user_id: userId,
    current_page: currentPage,
    progress: Math.max(0, Math.min(1, progress01)),
    updated_at: new Date().toISOString(),
    synced: false,
  };
  await saveLocalProgress(row);
  void triggerSync();
}
