// Single source of truth for the current reading session for a (user, book) on
// this device. Wraps claim/release/heartbeat edge functions and exposes a
// Realtime listener that fires when *another* device steals the session.
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, getDeviceLabel } from "./deviceId";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const HEARTBEAT_MS = 20_000;

export type LockState =
  | { kind: "idle" }
  | { kind: "claiming" }
  | { kind: "active"; sessionId: string; previousDevice: { device_id: string; device_label: string | null } | null }
  | { kind: "stolen"; byDeviceLabel: string | null }
  | { kind: "offline" }
  | { kind: "error"; message: string };

async function authedFetch(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");
  const res = await fetch(`${FN_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || "request_failed"), { status: res.status, body: j });
  return j;
}

export class ReadingLockManager {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private listeners = new Set<(s: LockState) => void>();
  private state: LockState = { kind: "idle" };

  constructor(private userId: string, private bookId: string) {}

  get current(): LockState { return this.state; }

  subscribe(fn: (s: LockState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(s: LockState) {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  async claim(): Promise<void> {
    this.emit({ kind: "claiming" });
    try {
      const deviceId = await getDeviceId();
      const result = await authedFetch("claim-reading-session", {
        book_id: this.bookId,
        device_id: deviceId,
        device_label: getDeviceLabel(),
      });
      this.emit({ kind: "active", sessionId: result.session_id, previousDevice: result.previous_device ?? null });
      this.startHeartbeat();
      this.attachRealtime(deviceId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (!navigator.onLine) {
        this.emit({ kind: "offline" });
      } else {
        this.emit({ kind: "error", message: err.message });
      }
    }
  }

  async release(reason = "explicit"): Promise<void> {
    this.stopHeartbeat();
    this.detachRealtime();
    try {
      const deviceId = await getDeviceId();
      await authedFetch("release-reading-session", { book_id: this.bookId, device_id: deviceId, reason });
    } catch {
      // Best-effort — sendBeacon path also covers tab-close.
    }
    this.emit({ kind: "idle" });
  }

  releaseOnUnload(): void {
    // Fire-and-forget beacon for tab close / app background.
    void (async () => {
      try {
        const deviceId = await getDeviceId();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const blob = new Blob(
          [JSON.stringify({ book_id: this.bookId, device_id: deviceId, reason: "unload" })],
          { type: "application/json" },
        );
        // sendBeacon doesn't support custom headers; we include token as query.
        const url = `${FN_BASE}/release-reading-session?_=${encodeURIComponent(session.access_token)}`;
        if (navigator.sendBeacon) navigator.sendBeacon(url, blob);
      } catch {
        // ignore
      }
    })();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.claim().catch(() => undefined);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachRealtime(myDeviceId: string) {
    this.detachRealtime();
    this.channel = supabase
      .channel(`reading-${this.userId}-${this.bookId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "book_reading_sessions",
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          const row = payload.new as { book_id: string; device_id: string; released_at: string | null; device_label: string | null };
          if (row.book_id !== this.bookId) return;
          if (row.device_id === myDeviceId && row.released_at) {
            this.stopHeartbeat();
            this.emit({ kind: "stolen", byDeviceLabel: null });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "book_reading_sessions",
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          const row = payload.new as { book_id: string; device_id: string; device_label: string | null };
          if (row.book_id !== this.bookId) return;
          if (row.device_id !== myDeviceId) {
            this.stopHeartbeat();
            this.emit({ kind: "stolen", byDeviceLabel: row.device_label });
          }
        },
      )
      .subscribe();
  }

  private detachRealtime() {
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  destroy() {
    this.stopHeartbeat();
    this.detachRealtime();
    this.listeners.clear();
  }
}
