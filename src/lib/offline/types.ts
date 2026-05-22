// Final OfflineStore schemas — shared between IndexedDB (web) and SQLCipher (native).
// Every row that contains book content is stored encrypted at rest.

export type DownloadStatus = "queued" | "downloading" | "ready" | "stale" | "failed" | "revoked";

export interface BookCacheRow {
  book_id: string;
  user_id: string;
  content_version: number;
  content_updated_at: string; // ISO
  downloaded_at: string | null;
  size_bytes: number;
  status: DownloadStatus;
  /** Encrypted JSON manifest: title, author, cover_url, page_count, chapters, preview_pages. */
  manifest_enc: Uint8Array | null;
  /** AES-GCM IV used for manifest_enc (12 bytes). */
  manifest_iv: Uint8Array | null;
  last_error: string | null;
  /** True after successful key/ownership re-validation against server. */
  key_valid: boolean;
}

export interface BookPageRow {
  book_id: string;
  page_index: number;
  /** Encrypted JSON blob containing the page's block tree (BlockRenderer payload). */
  blocks_enc: Uint8Array;
  blocks_iv: Uint8Array;
  /** Plain text snapshot length — used only for sizing/UI, never reveals content. */
  byte_len: number;
}

export interface BookAssetRow {
  book_id: string;
  asset_key: string; // e.g. "cover", "img/abc.jpg"
  mime: string;
  /** Encrypted bytes. */
  bytes_enc: Uint8Array;
  bytes_iv: Uint8Array;
  byte_len: number;
}

export interface HighlightRow {
  /** Local primary key — equals server `id` once synced, otherwise `client_id`. */
  id: string;
  client_id: string;
  book_id: string;
  user_id: string;
  page_index: number;
  /** Index of the block inside the page (paragraph, heading, …). Optional for legacy data. */
  block_index?: number | null;
  /** 1-based occurrence of `text` within that block. Optional for legacy data. */
  occurrence?: number | null;
  text: string;
  color: string;
  note: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** False = pending push to server. */
  synced: boolean;
}

export interface ProgressRow {
  book_id: string;
  user_id: string;
  current_page: number;
  progress: number; // 0..1
  updated_at: string;
  synced: boolean;
}

export type SyncKind =
  | "highlight.upsert"
  | "highlight.delete"
  | "progress.update"
  | "device.heartbeat";

export interface SyncQueueRow {
  id: string; // uuid
  kind: SyncKind;
  payload_json: string;
  attempt_count: number;
  next_attempt_at: string; // ISO
  last_error: string | null;
  created_at: string;
}

export interface MetaRow {
  key: string; // e.g. "device_salt", "pepper:<bookId>", "schema_version"
  value: string;
}

export const OFFLINE_SCHEMA_VERSION = 1;

/** Single SQL schema reused by SQLCipher (native). IndexedDB defines stores in db.ts. */
export const SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS books_cache (
  book_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  content_updated_at TEXT NOT NULL,
  downloaded_at TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  manifest_enc BLOB,
  manifest_iv BLOB,
  last_error TEXT,
  key_valid INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_books_cache_user ON books_cache(user_id);

CREATE TABLE IF NOT EXISTS book_pages (
  book_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  blocks_enc BLOB NOT NULL,
  blocks_iv BLOB NOT NULL,
  byte_len INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, page_index)
);

CREATE TABLE IF NOT EXISTS book_assets (
  book_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes_enc BLOB NOT NULL,
  bytes_iv BLOB NOT NULL,
  byte_len INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, asset_key)
);

CREATE TABLE IF NOT EXISTS highlights_local (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL,
  note TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hl_book ON highlights_local(book_id, page_index);
CREATE INDEX IF NOT EXISTS idx_hl_pending ON highlights_local(synced);

CREATE TABLE IF NOT EXISTS progress_local (
  book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  current_page INTEGER NOT NULL,
  progress REAL NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, user_id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_next ON sync_queue(next_attempt_at);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
