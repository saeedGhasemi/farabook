// Shared helper for converting a previously-uploaded Word import into a book.
// On large/heavy files, the single-shot conversion can exceed Edge Function
// memory limits. This helper transparently falls back to a two-phase flow:
//   1) Convert text/structure only (skipImages=true) — light & reliable.
//   2) Iteratively fill image placeholders in small batches via
//      `docx-image-fill` — each call only inflates a handful of media files.
//
// The caller passes lightweight callbacks so the UI can display real-time
// status (e.g. "تبدیل متن انجام شد، در حال جایگذاری تصاویر…").

import { supabase } from "@/integrations/supabase/client";

export interface ConvertOptions {
  importId: string;
  /** When set, an existing book will be replaced (re-convert mode). */
  replaceBookId?: string | null;
  /** Notify the UI of stage changes / fallbacks. */
  onStatus?: (msg: string) => void;
  /** Progress fraction 0-1 for image fill phase. */
  onImageProgress?: (filled: number, total: number) => void;
}

export interface ConvertResult {
  bookId: string;
  chapters: number;
  imagesFilled: number;
  imagesTotal: number;
  imageFailures: number;
  /** True if we used the text-only fallback path. */
  usedFallback: boolean;
}

const MEMORY_HINTS = [
  "memory limit",
  "worker_limit",
  "wall clock",
  "exceeded",
  "out of memory",
  "killed",
  "non-2xx",
  "boot_error",
];

const looksLikeOverload = (msg: string) => {
  const m = msg.toLowerCase();
  return MEMORY_HINTS.some((h) => m.includes(h));
};

const readErr = async (error: unknown): Promise<string> => {
  let detail = "";
  try {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      const j = await ctx.clone().json().catch(() => null);
      detail = (j as { error?: string } | null)?.error
        || (await ctx.clone().text().catch(() => ""))
        || "";
    }
  } catch { /* ignore */ }
  if (!detail && error instanceof Error) detail = error.message;
  return detail || "conversion_failed";
};

const callImport = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("word-import", { body });
  if (error) {
    const detail = await readErr(error);
    const e = new Error(detail);
    (e as { _raw?: unknown })._raw = error;
    throw e;
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as { book: { id: string }; chapters?: number };
};

const fillImages = async (
  bookId: string,
  importId: string,
  onImageProgress?: (filled: number, total: number) => void,
): Promise<{ filled: number; total: number; failures: number }> => {
  let startSlot = 0;
  let filled = 0;
  let total = 0;
  let failures = 0;
  let safety = 200; // hard cap on iterations
  while (safety-- > 0) {
    const { data, error } = await supabase.functions.invoke("docx-image-fill", {
      body: { bookId, importId, batchSize: 12, startSlot },
    });
    if (error) {
      // Image fill failed — surface but don't undo the text conversion.
      const detail = await readErr(error);
      throw new Error(detail);
    }
    const r = data as {
      done: boolean;
      totalSlots: number;
      filled: number;
      failures: { slot: number }[];
      nextStartSlot: number | null;
    };
    total = r.totalSlots;
    filled += r.filled || 0;
    failures += (r.failures?.length || 0);
    onImageProgress?.(filled + failures, total);
    if (r.done || r.nextStartSlot == null) break;
    startSlot = r.nextStartSlot;
  }
  return { filled, total, failures };
};

export const convertWordImport = async (opts: ConvertOptions): Promise<ConvertResult> => {
  const { importId, replaceBookId, onStatus, onImageProgress } = opts;

  const baseBody: Record<string, unknown> = { importId };
  if (replaceBookId) baseBody.replaceBookId = replaceBookId;

  // --- Attempt 1: full conversion (text + images in one shot) ---
  try {
    onStatus?.("در حال تبدیل کتاب…");
    const data = await callImport({ ...baseBody, skipImages: false });
    return {
      bookId: data.book.id,
      chapters: data.chapters || 0,
      imagesFilled: 0,
      imagesTotal: 0,
      imageFailures: 0,
      usedFallback: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!looksLikeOverload(msg)) {
      // Genuine error unrelated to size — bubble up.
      throw e;
    }
    onStatus?.(
      "حجم فایل/تصاویر زیاد است. تبدیل متن جداگانه انجام و سپس تصاویر مرحله‌به‌مرحله جایگذاری می‌شوند…",
    );
  }

  // --- Attempt 2: text-only ---
  let textData: { book: { id: string }; chapters?: number };
  try {
    textData = await callImport({ ...baseBody, skipImages: true });
  } catch (e) {
    // Even text conversion failed — give up.
    throw e;
  }

  // --- Attempt 3: iterative image fill ---
  let imageStats = { filled: 0, total: 0, failures: 0 };
  try {
    onStatus?.("تبدیل متن انجام شد. در حال جایگذاری تصاویر…");
    imageStats = await fillImages(textData.book.id, importId, onImageProgress);
  } catch (e) {
    // Text book is already created; tolerate partial image fill.
    onStatus?.(
      `جایگذاری بعضی تصاویر ناتمام ماند: ${e instanceof Error ? e.message : "خطا"}. می‌توانید بعداً از ادیتور دوباره تلاش کنید.`,
    );
  }

  return {
    bookId: textData.book.id,
    chapters: textData.chapters || 0,
    imagesFilled: imageStats.filled,
    imagesTotal: imageStats.total,
    imageFailures: imageStats.failures,
    usedFallback: true,
  };
};
