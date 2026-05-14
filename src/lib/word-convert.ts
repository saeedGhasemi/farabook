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
import { unzipSync } from "fflate";
import { convertEmfToDataUrl, convertWmfToDataUrl } from "emf-converter";

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
  "non 2xx",
  "boot_error",
  "boot error",
  "shutdown",
  "terminated",
  "timeout",
  "timed out",
  "504",
  "546",
  "failed to send",
  "failed to fetch",
  "network error",
  "connection",
  "worker",
  "edge function returned",
];

// Fallback decision: only skip fallback when the error is clearly a
// validation / not-found problem we cannot fix by splitting the work.
const NON_RECOVERABLE = [
  "missing importid",
  "import_not_found",
  "book_not_found",
  "forbidden",
  "unauthorized",
  "no_source_docx",
  "invalid",
];

const looksLikeOverload = (msg: string) => {
  const m = (msg || "").toLowerCase();
  if (NON_RECOVERABLE.some((h) => m.includes(h))) return false;
  // Anything else on the first attempt — assume size/memory and try fallback.
  return MEMORY_HINTS.some((h) => m.includes(h)) || true;
};

const readErr = async (error: unknown): Promise<string> => {
  let detail = "";
  try {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      const j = await ctx.clone().json().catch(() => null) as
        | { error?: string; message?: string; code?: string }
        | null;
      detail = j?.error || j?.message || j?.code
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

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [head, payload] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/png";
  const bin = atob(payload || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const updateDocNode = (page: any, blockIdx: number, mut: (node: any) => void) => {
  const content = page?.doc?.content;
  if (!Array.isArray(content)) return;
  const slot = Number(page.blocks?.[blockIdx]?.slot || 0);
  let seen = -1;
  for (const node of content) {
    if (node?.type !== "image_placeholder") continue;
    seen += 1;
    if (seen === blockIdx || Number(node.attrs?.slot || 0) === slot) {
      mut(node);
      return;
    }
  }
};

const fillVectorImagesInBrowser = async (bookId: string, importId: string) => {
  const [{ data: imp }, { data: book }] = await Promise.all([
    supabase.from("word_imports").select("file_path").eq("id", importId).maybeSingle(),
    supabase.from("books").select("pages").eq("id", bookId).maybeSingle(),
  ]);
  const filePath = (imp as any)?.file_path;
  const pages = (book as any)?.pages;
  if (!filePath || !Array.isArray(pages)) return { filled: 0, total: 0 };

  const targets: Array<{ pageIdx: number; blockIdx: number; slot: number; originalPath: string }> = [];
  pages.forEach((page: any, pageIdx: number) => (page.blocks || []).forEach((b: any, blockIdx: number) => {
    const ext = String(b?.originalPath || "").split(".").pop()?.toLowerCase();
    if (b?.type === "image_placeholder" && !b.pendingSrc && (ext === "emf" || ext === "wmf")) {
      targets.push({ pageIdx, blockIdx, slot: Number(b.slot || targets.length + 1), originalPath: b.originalPath });
    }
  }));
  if (!targets.length) return { filled: 0, total: 0 };

  const { data: blob, error } = await supabase.storage.from("book-uploads").download(filePath);
  if (error || !blob) return { filled: 0, total: targets.length };
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
    filter: (f) => targets.some((t) => t.originalPath.toLowerCase() === f.name.toLowerCase()),
  });

  let filled = 0;
  for (const t of targets) {
    const key = Object.keys(files).find((k) => k.toLowerCase() === t.originalPath.toLowerCase());
    if (!key) continue;
    const ext = key.split(".").pop()?.toLowerCase();
    const bytes = files[key];
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const png = ext === "wmf"
      ? await convertWmfToDataUrl(ab, 1400, 1400, 1)
      : await convertEmfToDataUrl(ab, 1400, 1400, 1);
    if (!png) continue;
    const mediaKey = `${filePath.split("/")[0]}/${bookId}/vector-fill/slot-${String(t.slot).padStart(4, "0")}.png`;
    const up = await supabase.storage.from("book-media").upload(mediaKey, dataUrlToBlob(png), { contentType: "image/png", upsert: true });
    if (up.error) continue;
    const url = supabase.storage.from("book-media").getPublicUrl(mediaKey).data.publicUrl;
    const block = pages[t.pageIdx]?.blocks?.[t.blockIdx];
    if (block) Object.assign(block, { pendingSrc: url, contentType: "image/png", reason: "vector_converted", unsupported: false });
    updateDocNode(pages[t.pageIdx], t.blockIdx, (node) => {
      node.attrs = { ...(node.attrs || {}), pendingSrc: url, contentType: "image/png", reason: "vector_converted", unsupported: false };
    });
    filled += 1;
  }
  if (filled) await supabase.from("books").update({ pages }).eq("id", bookId);
  return { filled, total: targets.length };
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
    const vectorStats = await fillVectorImagesInBrowser(textData.book.id, importId);
    if (vectorStats.filled > 0) {
      imageStats.filled += vectorStats.filled;
      imageStats.total = Math.max(imageStats.total, imageStats.filled + imageStats.failures, vectorStats.total);
      imageStats.failures = Math.max(0, imageStats.failures - vectorStats.filled);
    }
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
