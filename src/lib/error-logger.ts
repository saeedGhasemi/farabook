// Centralized client-side error logger. Writes to public.client_error_logs so
// admins can triage user-facing failures from the Admin → "Error logs" tab.
//
// Usage:
//   import { logClientError } from "@/lib/error-logger";
//   logClientError({ source: "offline-download", message: "...", context: {...} });
//
// Also auto-captures window errors and unhandled promise rejections (see
// `installGlobalErrorLogger` called from main.tsx).

import { supabase } from "@/integrations/supabase/client";

export interface ClientErrorPayload {
  source: string;                 // e.g. "offline-download", "reader", "auth"
  message: string;
  level?: "error" | "warn" | "info";
  stack?: string | null;
  context?: Record<string, unknown>;
}

// Tiny in-memory dedupe so a noisy error doesn't spam the DB.
const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

function shouldSkip(key: string): boolean {
  const now = Date.now();
  // Sweep old entries occasionally.
  if (recent.size > 200) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  recent.set(key, now);
  return false;
}

export async function logClientError(p: ClientErrorPayload): Promise<void> {
  try {
    const key = `${p.source}|${p.message}`;
    if (shouldSkip(key)) return;

    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));

    const row = {
      user_id: user?.id ?? null,
      level: p.level ?? "error",
      source: p.source,
      message: String(p.message).slice(0, 2000),
      stack: p.stack ? String(p.stack).slice(0, 8000) : null,
      url: typeof location !== "undefined" ? location.href.slice(0, 1000) : null,
      route: typeof location !== "undefined" ? location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      context: p.context ?? {},
    };

    // Best-effort insert. If offline / RLS denies, ignore silently — we must
    // never throw from the logger itself.
    await supabase.from("client_error_logs").insert(row as any);
  } catch {
    /* swallow */
  }
}

let installed = false;

export function installGlobalErrorLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    // Ignore noisy ResizeObserver warning, which is not a real bug.
    const msg = ev.message || "";
    if (/ResizeObserver loop/i.test(msg)) return;
    logClientError({
      source: "window.error",
      message: msg || "Unknown window error",
      stack: ev.error?.stack ?? null,
      context: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason: any = ev.reason;
    const message = reason?.message ?? String(reason ?? "Unhandled promise rejection");
    logClientError({
      source: "unhandledrejection",
      message,
      stack: reason?.stack ?? null,
    });
  });
}
