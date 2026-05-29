// Local image pipeline for the Word upload wizard.
// • Converts EMF/WMF → PNG via emf-converter.
// • Optimizes any single image >2MB (re-encode at q=0.9, downscale only if huge).
// • Dedupes by SHA-1 so identical images are uploaded once.
// • Preserves quality — no max-edge limit when image is small enough.

import { convertEmfToDataUrl, convertWmfToDataUrl } from "emf-converter";
import type { OoxmlMedia } from "./ooxml-reader";

const TWO_MB = 2 * 1024 * 1024;
/** When optimizing huge images, cap longest edge to this. */
const MAX_EDGE_FOR_BIG = 2400;
const QUALITY = 0.9;

export interface ProcessedImage {
  /** Original docx media name (e.g. "image3.png") — used to rewrite media:// urls. */
  originalName: string;
  /** Content-addressable name used for storage: "<sha1>.<ext>". */
  storageName: string;
  sha1: string;
  blob: Blob;
  contentType: string;
  originalBytes: number;
  finalBytes: number;
  /** True if we converted EMF/WMF or re-encoded for size. */
  transformed: boolean;
  note?: string;
}

export interface PipelineResult {
  images: ProcessedImage[];
  /** Map: original docx media name → storageName (sha1.ext) for rewriting AST. */
  nameToStorage: Map<string, string>;
  /** Skipped because conversion failed. */
  failures: Array<{ name: string; reason: string }>;
  totalOriginalBytes: number;
  totalFinalBytes: number;
  emfConverted: number;
  optimized: number;
  duplicates: number;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-1", ab);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function dataUrlToUint8(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const [head, payload] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/png";
  const bin = atob(payload || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

async function loadImage(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function optimizeBigRaster(blob: Blob, mime: string): Promise<Blob> {
  if (blob.size <= TWO_MB) return blob;
  const img = await loadImage(blob);
  if (!img) return blob;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > MAX_EDGE_FOR_BIG ? MAX_EDGE_FOR_BIG / longest : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(img, 0, 0, w, h);
  const outMime = /png/i.test(mime) ? "image/jpeg" : mime; // PNG≥2MB usually wins as JPEG
  const out: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), outMime, QUALITY),
  );
  return out && out.size < blob.size ? out : blob;
}

function extOf(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/jpeg|jpg/i.test(mime)) return "jpg";
  if (/webp/i.test(mime)) return "webp";
  if (/gif/i.test(mime)) return "gif";
  if (/svg/i.test(mime)) return "svg";
  return "bin";
}

export async function processImagesLocally(media: OoxmlMedia[]): Promise<PipelineResult> {
  const out: ProcessedImage[] = [];
  const nameToStorage = new Map<string, string>();
  const seenSha = new Map<string, ProcessedImage>();
  const failures: Array<{ name: string; reason: string }> = [];
  let totalOriginalBytes = 0;
  let totalFinalBytes = 0;
  let emfConverted = 0;
  let optimized = 0;
  let duplicates = 0;

  for (const m of media) {
    totalOriginalBytes += m.bytes.byteLength;
    const ext = (m.name.split(".").pop() || "").toLowerCase();
    let bytes: Uint8Array = m.bytes;
    let contentType = m.contentType;
    let transformed = false;
    let note: string | undefined;

    try {
      if (ext === "emf" || ext === "wmf") {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const dataUrl = ext === "wmf"
          ? await convertWmfToDataUrl(ab, 1600, 1600, 1)
          : await convertEmfToDataUrl(ab, 1600, 1600, 1);
        if (!dataUrl) {
          failures.push({ name: m.name, reason: `تبدیل ${ext.toUpperCase()} ناموفق بود` });
          continue;
        }
        const r = dataUrlToUint8(dataUrl);
        bytes = r.bytes; contentType = r.mime; transformed = true; emfConverted++;
        note = `${ext.toUpperCase()} → PNG`;
      }

      let blob: Blob = new Blob([bytes as BlobPart], { type: contentType });
      if (blob.size > TWO_MB && /png|jpeg|jpg|webp/i.test(contentType)) {
        const beforeSize = blob.size;
        blob = await optimizeBigRaster(blob, contentType);
        if (blob.size < beforeSize) {
          transformed = true; optimized++;
          contentType = blob.type || contentType;
          note = (note ? note + " · " : "") + `بهینه‌سازی ${(beforeSize/1024/1024).toFixed(1)}→${(blob.size/1024/1024).toFixed(1)}MB`;
          bytes = new Uint8Array(await blob.arrayBuffer());
        }
      }

      const sha = await sha1Hex(bytes);
      const dup = seenSha.get(sha);
      if (dup) {
        nameToStorage.set(m.name, dup.storageName);
        duplicates++;
        continue;
      }

      const storageName = `${sha}.${extOf(contentType)}`;
      const item: ProcessedImage = {
        originalName: m.name,
        storageName,
        sha1: sha,
        blob,
        contentType,
        originalBytes: m.bytes.byteLength,
        finalBytes: bytes.byteLength,
        transformed,
        note,
      };
      seenSha.set(sha, item);
      nameToStorage.set(m.name, storageName);
      out.push(item);
      totalFinalBytes += bytes.byteLength;
    } catch (e: any) {
      failures.push({ name: m.name, reason: e?.message ?? String(e) });
    }
  }

  return {
    images: out, nameToStorage, failures,
    totalOriginalBytes, totalFinalBytes,
    emfConverted, optimized, duplicates,
  };
}

/** Rewrite `media://<name>` srcs in AST to `media://<storageName>` (sha1.ext). */
export function rewriteMediaPlaceholders(doc: { content: any[] }, nameToStorage: Map<string, string>): number {
  let n = 0;
  const visit = (nodes: any[] | undefined) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node?.type === "image" && typeof node.attrs?.src === "string") {
        const m = node.attrs.src.match(/^media:\/\/(.+)$/);
        if (m) {
          const mapped = nameToStorage.get(m[1]);
          if (mapped && mapped !== m[1]) {
            node.attrs.src = `media://${mapped}`;
            n++;
          }
        }
      }
      if (Array.isArray(node?.content)) visit(node.content);
    }
  };
  visit(doc.content);
  return n;
}
