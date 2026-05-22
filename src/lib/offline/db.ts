// Low-level DB adapter. Web uses IndexedDB (idb) + AES-GCM per-record encryption.
// Native (Capacitor) uses @capacitor-community/sqlite with SQLCipher at-rest encryption.
//
// Both adapters expose the same key/value-ish CRUD surface used by OfflineStore.

import { openDB, type IDBPDatabase } from "idb";
import { OFFLINE_SCHEMA_VERSION, type BookCacheRow, type BookPageRow, type BookAssetRow, type HighlightRow, type ProgressRow, type SyncQueueRow } from "./types";

const DB_NAME = "farabook-offline";

interface Adapter {
  init(): Promise<void>;
  // books_cache
  upsertBookCache(row: BookCacheRow): Promise<void>;
  getBookCache(bookId: string): Promise<BookCacheRow | undefined>;
  listBookCache(userId: string): Promise<BookCacheRow[]>;
  deleteBook(bookId: string): Promise<void>;
  // pages
  putPage(row: BookPageRow): Promise<void>;
  getPage(bookId: string, pageIndex: number): Promise<BookPageRow | undefined>;
  // assets
  putAsset(row: BookAssetRow): Promise<void>;
  getAsset(bookId: string, key: string): Promise<BookAssetRow | undefined>;
  // highlights
  putHighlight(row: HighlightRow): Promise<void>;
  getHighlightsByBook(bookId: string): Promise<HighlightRow[]>;
  getPendingHighlights(): Promise<HighlightRow[]>;
  // progress
  putProgress(row: ProgressRow): Promise<void>;
  getProgress(bookId: string, userId: string): Promise<ProgressRow | undefined>;
  // sync queue
  enqueue(row: SyncQueueRow): Promise<void>;
  dueSyncRows(now: string): Promise<SyncQueueRow[]>;
  removeSyncRow(id: string): Promise<void>;
  updateSyncRow(row: SyncQueueRow): Promise<void>;
  // meta
  setMeta(k: string, v: string): Promise<void>;
  getMeta(k: string): Promise<string | undefined>;
  // bulk
  wipe(): Promise<void>;
}

/* ---------------- IndexedDB (web) ---------------- */

let webDb: IDBPDatabase | null = null;

async function ensureWebDb(): Promise<IDBPDatabase> {
  if (webDb) return webDb;
  webDb = await openDB(DB_NAME, OFFLINE_SCHEMA_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("books_cache")) {
        const s = db.createObjectStore("books_cache", { keyPath: "book_id" });
        s.createIndex("user_id", "user_id");
      }
      if (!db.objectStoreNames.contains("book_pages")) {
        db.createObjectStore("book_pages", { keyPath: ["book_id", "page_index"] });
      }
      if (!db.objectStoreNames.contains("book_assets")) {
        db.createObjectStore("book_assets", { keyPath: ["book_id", "asset_key"] });
      }
      if (!db.objectStoreNames.contains("highlights_local")) {
        const s = db.createObjectStore("highlights_local", { keyPath: "id" });
        s.createIndex("book_id", "book_id");
        s.createIndex("synced", "synced");
      }
      if (!db.objectStoreNames.contains("progress_local")) {
        db.createObjectStore("progress_local", { keyPath: ["book_id", "user_id"] });
      }
      if (!db.objectStoreNames.contains("sync_queue")) {
        const s = db.createObjectStore("sync_queue", { keyPath: "id" });
        s.createIndex("next_attempt_at", "next_attempt_at");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
  return webDb;
}

const webAdapter: Adapter = {
  async init() {
    await ensureWebDb();
  },
  async upsertBookCache(r) { const db = await ensureWebDb(); await db.put("books_cache", r); },
  async getBookCache(id) { const db = await ensureWebDb(); return db.get("books_cache", id) as Promise<BookCacheRow | undefined>; },
  async listBookCache(userId) {
    const db = await ensureWebDb();
    return (await db.getAllFromIndex("books_cache", "user_id", userId)) as BookCacheRow[];
  },
  async deleteBook(bookId) {
    const db = await ensureWebDb();
    const tx = db.transaction(["books_cache", "book_pages", "book_assets"], "readwrite");
    await tx.objectStore("books_cache").delete(bookId);
    // delete pages/assets by range scan
    for (const store of ["book_pages", "book_assets"] as const) {
      const s = tx.objectStore(store);
      let cur = await s.openCursor();
      while (cur) {
        const key = cur.key as [string, unknown];
        if (Array.isArray(key) && key[0] === bookId) await cur.delete();
        cur = await cur.continue();
      }
    }
    await tx.done;
  },
  async putPage(r) { const db = await ensureWebDb(); await db.put("book_pages", r); },
  async getPage(b, p) { const db = await ensureWebDb(); return db.get("book_pages", [b, p]) as Promise<BookPageRow | undefined>; },
  async putAsset(r) { const db = await ensureWebDb(); await db.put("book_assets", r); },
  async getAsset(b, k) { const db = await ensureWebDb(); return db.get("book_assets", [b, k]) as Promise<BookAssetRow | undefined>; },
  async putHighlight(r) { const db = await ensureWebDb(); await db.put("highlights_local", r); },
  async getHighlightsByBook(b) {
    const db = await ensureWebDb();
    return (await db.getAllFromIndex("highlights_local", "book_id", b)) as HighlightRow[];
  },
  async getPendingHighlights() {
    const db = await ensureWebDb();
    const all = (await db.getAll("highlights_local")) as HighlightRow[];
    return all.filter((h) => !h.synced);
  },
  async putProgress(r) { const db = await ensureWebDb(); await db.put("progress_local", r); },
  async getProgress(b, u) { const db = await ensureWebDb(); return db.get("progress_local", [b, u]) as Promise<ProgressRow | undefined>; },
  async enqueue(r) { const db = await ensureWebDb(); await db.put("sync_queue", r); },
  async dueSyncRows(now) {
    const db = await ensureWebDb();
    const all = (await db.getAll("sync_queue")) as SyncQueueRow[];
    return all.filter((r) => r.next_attempt_at <= now);
  },
  async removeSyncRow(id) { const db = await ensureWebDb(); await db.delete("sync_queue", id); },
  async updateSyncRow(r) { const db = await ensureWebDb(); await db.put("sync_queue", r); },
  async setMeta(k, v) { const db = await ensureWebDb(); await db.put("meta", { key: k, value: v }); },
  async getMeta(k) { const db = await ensureWebDb(); const row = await db.get("meta", k); return (row as { value: string } | undefined)?.value; },
  async wipe() {
    const db = await ensureWebDb();
    for (const name of ["books_cache", "book_pages", "book_assets", "highlights_local", "progress_local", "sync_queue", "meta"]) {
      await db.clear(name);
    }
  },
};

/* ---------------- Native SQLCipher (Capacitor) ---------------- */
// Lazy-loaded so the web bundle doesn't include the plugin. The native adapter
// will be wired up the first time it's used inside a Capacitor runtime; until
// then we transparently fall back to IndexedDB.

import { SQL_SCHEMA } from "./types";

let nativeAdapter: Adapter | null = null;

function isNative(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

async function buildNativeAdapter(passphrase: string): Promise<Adapter> {
  const mod = await import("@capacitor-community/sqlite");
  const sqlite = new mod.SQLiteConnection(mod.CapacitorSQLite);
  const dbName = "farabook_offline";
  // Register the per-device passphrase before opening; SQLCipher handles
  // page-level encryption from that point on.
  try { await mod.CapacitorSQLite.setEncryptionSecret({ passphrase }); } catch { /* already set */ }
  const db = await sqlite.createConnection(dbName, true, "secret", OFFLINE_SCHEMA_VERSION, false);
  await db.open();
  await db.execute(SQL_SCHEMA);


  const run = async (sql: string, values: unknown[] = []) => { await db.run(sql, values); };
  const query = async <T,>(sql: string, values: unknown[] = []): Promise<T[]> => {
    const r = await db.query(sql, values);
    return (r.values ?? []) as T[];
  };

  return {
    async init() { /* already opened */ },
    async upsertBookCache(r) {
      await run(
        `INSERT INTO books_cache(book_id,user_id,content_version,content_updated_at,downloaded_at,size_bytes,status,manifest_enc,manifest_iv,last_error,key_valid)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(book_id) DO UPDATE SET
           user_id=excluded.user_id, content_version=excluded.content_version, content_updated_at=excluded.content_updated_at,
           downloaded_at=excluded.downloaded_at, size_bytes=excluded.size_bytes, status=excluded.status,
           manifest_enc=excluded.manifest_enc, manifest_iv=excluded.manifest_iv, last_error=excluded.last_error, key_valid=excluded.key_valid`,
        [r.book_id, r.user_id, r.content_version, r.content_updated_at, r.downloaded_at, r.size_bytes, r.status, r.manifest_enc, r.manifest_iv, r.last_error, r.key_valid ? 1 : 0],
      );
    },
    async getBookCache(id) { const rows = await query<BookCacheRow>("SELECT * FROM books_cache WHERE book_id=?", [id]); return rows[0]; },
    async listBookCache(userId) { return query<BookCacheRow>("SELECT * FROM books_cache WHERE user_id=?", [userId]); },
    async deleteBook(b) {
      await run("DELETE FROM book_pages WHERE book_id=?", [b]);
      await run("DELETE FROM book_assets WHERE book_id=?", [b]);
      await run("DELETE FROM books_cache WHERE book_id=?", [b]);
    },
    async putPage(r) {
      await run(
        `INSERT INTO book_pages(book_id,page_index,blocks_enc,blocks_iv,byte_len) VALUES(?,?,?,?,?)
         ON CONFLICT(book_id,page_index) DO UPDATE SET blocks_enc=excluded.blocks_enc, blocks_iv=excluded.blocks_iv, byte_len=excluded.byte_len`,
        [r.book_id, r.page_index, r.blocks_enc, r.blocks_iv, r.byte_len],
      );
    },
    async getPage(b, p) { const rows = await query<BookPageRow>("SELECT * FROM book_pages WHERE book_id=? AND page_index=?", [b, p]); return rows[0]; },
    async putAsset(r) {
      await run(
        `INSERT INTO book_assets(book_id,asset_key,mime,bytes_enc,bytes_iv,byte_len) VALUES(?,?,?,?,?,?)
         ON CONFLICT(book_id,asset_key) DO UPDATE SET mime=excluded.mime, bytes_enc=excluded.bytes_enc, bytes_iv=excluded.bytes_iv, byte_len=excluded.byte_len`,
        [r.book_id, r.asset_key, r.mime, r.bytes_enc, r.bytes_iv, r.byte_len],
      );
    },
    async getAsset(b, k) { const rows = await query<BookAssetRow>("SELECT * FROM book_assets WHERE book_id=? AND asset_key=?", [b, k]); return rows[0]; },
    async putHighlight(r) {
      await run(
        `INSERT INTO highlights_local(id,client_id,book_id,user_id,page_index,text,color,note,is_public,created_at,updated_at,deleted_at,synced)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, color=excluded.color, note=excluded.note,
           is_public=excluded.is_public, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, synced=excluded.synced`,
        [r.id, r.client_id, r.book_id, r.user_id, r.page_index, r.text, r.color, r.note, r.is_public ? 1 : 0, r.created_at, r.updated_at, r.deleted_at, r.synced ? 1 : 0],
      );
    },
    async getHighlightsByBook(b) { return query<HighlightRow>("SELECT * FROM highlights_local WHERE book_id=? AND deleted_at IS NULL", [b]); },
    async getPendingHighlights() { return query<HighlightRow>("SELECT * FROM highlights_local WHERE synced=0"); },
    async putProgress(r) {
      await run(
        `INSERT INTO progress_local(book_id,user_id,current_page,progress,updated_at,synced) VALUES(?,?,?,?,?,?)
         ON CONFLICT(book_id,user_id) DO UPDATE SET current_page=excluded.current_page, progress=excluded.progress, updated_at=excluded.updated_at, synced=excluded.synced`,
        [r.book_id, r.user_id, r.current_page, r.progress, r.updated_at, r.synced ? 1 : 0],
      );
    },
    async getProgress(b, u) { const rows = await query<ProgressRow>("SELECT * FROM progress_local WHERE book_id=? AND user_id=?", [b, u]); return rows[0]; },
    async enqueue(r) {
      await run(
        `INSERT INTO sync_queue(id,kind,payload_json,attempt_count,next_attempt_at,last_error,created_at) VALUES(?,?,?,?,?,?,?)`,
        [r.id, r.kind, r.payload_json, r.attempt_count, r.next_attempt_at, r.last_error, r.created_at],
      );
    },
    async dueSyncRows(now) { return query<SyncQueueRow>("SELECT * FROM sync_queue WHERE next_attempt_at <= ? ORDER BY next_attempt_at", [now]); },
    async removeSyncRow(id) { await run("DELETE FROM sync_queue WHERE id=?", [id]); },
    async updateSyncRow(r) {
      await run(
        `UPDATE sync_queue SET attempt_count=?, next_attempt_at=?, last_error=? WHERE id=?`,
        [r.attempt_count, r.next_attempt_at, r.last_error, r.id],
      );
    },
    async setMeta(k, v) {
      await run(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [k, v]);
    },
    async getMeta(k) { const rows = await query<{ value: string }>("SELECT value FROM meta WHERE key=?", [k]); return rows[0]?.value; },
    async wipe() {
      for (const t of ["books_cache", "book_pages", "book_assets", "highlights_local", "progress_local", "sync_queue", "meta"]) {
        await run(`DELETE FROM ${t}`);
      }
    },
  };
}

/** Returns the platform-appropriate adapter. On native, `passphrase` is the
 * SQLCipher key (derived from device-salt + user-id + server-pepper). */
export async function getAdapter(passphrase?: string): Promise<Adapter> {
  if (isNative() && passphrase) {
    if (!nativeAdapter) nativeAdapter = await buildNativeAdapter(passphrase);
    return nativeAdapter;
  }
  await webAdapter.init();
  return webAdapter;
}

export type { Adapter };
