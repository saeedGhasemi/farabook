// SyncEngine — Phase 7
// Drains the local sync_queue (highlights / progress writes that happened while
// offline or that failed) and pulls server-side highlights touched since the
// last known cursor. Last-write-wins by `updated_at`.
//
// Lifecycle: start() once on app boot after the user is known. The engine
// re-runs on:
//   - app start
//   - `online` event
//   - every 30s while the tab is visible
//   - explicit triggerSync() from UI (e.g. after saving a highlight)
//
// Backoff for failed pushes is handled inside OfflineStore.rescheduleSync.

import { supabase } from "@/integrations/supabase/client";
import { getAdapter } from "./db";
import {
  dueSyncRows, markSyncDone, rescheduleSync,
} from "./OfflineStore";
import type { HighlightRow, ProgressRow, SyncQueueRow } from "./types";

const PULL_CURSOR_KEY = "sync:highlights_cursor";
const PERIOD_MS = 30_000;

let running = false;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let currentUserId: string | null = null;

interface Listener { (state: { lastRunAt: string; pushed: number; pulled: number; failed: number }): void }
const listeners = new Set<Listener>();
export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Public entrypoint. Safe to call multiple times. */
export function startSyncEngine(userId: string): void {
  if (started && currentUserId === userId) return;
  stopSyncEngine();
  currentUserId = userId;
  started = true;

  const kick = () => { void runOnce(userId); };

  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  timer = setInterval(kick, PERIOD_MS);
  kick();
}

export function stopSyncEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  currentUserId = null;
}

export async function triggerSync(): Promise<void> {
  if (currentUserId) await runOnce(currentUserId);
}

async function runOnce(userId: string): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
  let pushed = 0, pulled = 0, failed = 0;
  try {
    pushed += await drainQueue();
    pulled += await pullRemoteHighlights(userId);
  } catch {
    failed++;
  } finally {
    running = false;
    const state = { lastRunAt: new Date().toISOString(), pushed, pulled, failed };
    listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
  }
}

/* ---------------- PUSH ---------------- */

async function drainQueue(): Promise<number> {
  const rows = await dueSyncRows();
  let ok = 0;
  for (const row of rows) {
    try {
      await processRow(row);
      await markSyncDone(row.id);
      ok++;
    } catch (e) {
      await rescheduleSync(row, e);
    }
  }
  return ok;
}

async function processRow(row: SyncQueueRow): Promise<void> {
  const payload = JSON.parse(row.payload_json);
  switch (row.kind) {
    case "highlight.upsert": return pushHighlightUpsert(payload as HighlightRow);
    case "highlight.delete": return pushHighlightDelete(payload as HighlightRow);
    case "progress.update":  return pushProgress(payload as ProgressRow);
    case "device.heartbeat": return; // reserved
    default: throw new Error(`unknown_sync_kind:${row.kind}`);
  }
}

async function pushHighlightUpsert(h: HighlightRow): Promise<void> {
  // Use the local UUID as the server PK so re-pushes are idempotent.
  const { error } = await supabase.from("highlights").upsert({
    id: h.id,
    client_id: h.client_id,
    user_id: h.user_id,
    book_id: h.book_id,
    page_index: h.page_index,
    text: h.text,
    color: h.color,
    note: h.note,
    is_public: h.is_public,
    updated_at: h.updated_at,
  }, { onConflict: "id" });
  if (error) throw error;
  await markLocalHighlightSynced(h);
}

async function pushHighlightDelete(h: HighlightRow): Promise<void> {
  // Soft-delete: server keeps the row but sets deleted_at so other devices
  // can converge. Hard-delete left to a server-side cleanup job.
  const { error } = await supabase.from("highlights")
    .update({ deleted_at: h.deleted_at, updated_at: h.updated_at })
    .eq("id", h.id);
  if (error) throw error;
  await markLocalHighlightSynced(h);
}

async function markLocalHighlightSynced(h: HighlightRow): Promise<void> {
  const adapter = await getAdapter();
  await adapter.putHighlight({ ...h, synced: true });
}

async function pushProgress(p: ProgressRow): Promise<void> {
  // Only forward if user owns the book row in user_books.
  const { error } = await supabase.from("user_books")
    .update({
      current_page: p.current_page,
      progress: p.progress,
      status: p.progress >= 1 ? "finished" : p.progress > 0 ? "reading" : "unread",
    })
    .eq("user_id", p.user_id)
    .eq("book_id", p.book_id);
  if (error) throw error;
  const adapter = await getAdapter();
  await adapter.putProgress({ ...p, synced: true });
}

/* ---------------- PULL ---------------- */

async function pullRemoteHighlights(userId: string): Promise<number> {
  const adapter = await getAdapter();
  const cursor = (await adapter.getMeta(PULL_CURSOR_KEY)) ?? "1970-01-01T00:00:00Z";
  const { data, error } = await supabase
    .from("highlights")
    .select("id, client_id, user_id, book_id, page_index, text, color, note, is_public, created_at, updated_at, deleted_at")
    .eq("user_id", userId)
    .gt("updated_at", cursor)
    .order("updated_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as Array<HighlightRow>;
  if (rows.length === 0) return 0;

  // Last-write-wins merge: only overwrite local rows whose updated_at is older.
  for (const remote of rows) {
    const all = await adapter.getHighlightsByBook(remote.book_id);
    const localById = all.find((r) => r.id === remote.id);
    const localByClient = !localById && remote.client_id
      ? all.find((r) => r.client_id === remote.client_id)
      : undefined;
    const local = localById ?? localByClient;
    if (local && local.updated_at >= remote.updated_at && local.synced) continue;
    await adapter.putHighlight({
      ...remote,
      client_id: remote.client_id ?? remote.id,
      synced: true,
    });
  }

  const latest = rows[rows.length - 1].updated_at;
  await adapter.setMeta(PULL_CURSOR_KEY, latest);
  return rows.length;
}
