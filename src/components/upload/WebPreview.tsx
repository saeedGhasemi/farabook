// Local web-preview of the imported book — text, images (blob URLs),
// math, footnotes, special inline marks — so the user can verify the
// conversion before uploading. Limited to the first 50 print pages
// (or 400 blocks when the doc has no print-page markers) to stay fast.

import { useEffect, useMemo, useRef } from "react";
import type { TiptapDoc } from "@/lib/tiptap-doc";
import { docToLegacyBlocks } from "@/lib/tiptap-doc";
import { BlockRenderer, type Block } from "@/components/reader/BlockRenderer";
import { registerOfflineBlobUrl } from "@/lib/book-media";

interface Props {
  doc: TiptapDoc;
  /** map: docx media storageName → blob: URL. */
  mediaUrls: Map<string, string>;
  /** Hard cap on number of print pages to render (default 60). */
  maxPrintPages?: number;
  /** Fallback cap on blocks when no print-pages exist. */
  maxBlocksFallback?: number;
}

export const WebPreview = ({ doc, mediaUrls, maxPrintPages = 60, maxBlocksFallback = 480 }: Props) => {
  // Alias media:// urls → blob: urls so the renderer can show local images.
  const aliasedRef = useRef<string[]>([]);
  useEffect(() => {
    const aliased: string[] = [];
    for (const [name, blobUrl] of mediaUrls.entries()) {
      const key = `media://${name}`;
      registerOfflineBlobUrl(key, blobUrl);
      aliased.push(key);
    }
    aliasedRef.current = aliased;
    // We intentionally don't unregister — the wizard revokes the blob URLs
    // on unmount which makes the entries harmless.
  }, [mediaUrls]);

  const blocks = useMemo<Block[]>(() => {
    const all = docToLegacyBlocks(doc) as Block[];
    // Count print_page markers
    const pageMarkers: number[] = [];
    all.forEach((b, i) => { if (b.type === "print_page") pageMarkers.push(i); });
    if (pageMarkers.length > maxPrintPages) {
      // Cut right before the (maxPrintPages+1)-th marker
      return all.slice(0, pageMarkers[maxPrintPages]);
    }
    if (pageMarkers.length === 0 && all.length > maxBlocksFallback) {
      return all.slice(0, maxBlocksFallback);
    }
    return all;
  }, [doc, maxPrintPages, maxBlocksFallback]);

  const allBlocks = docToLegacyBlocks(doc) as Block[];
  const truncated = blocks.length < allBlocks.length;

  return (
    <div className="space-y-1">
      {truncated && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50/40 dark:bg-amber-950/20 border border-amber-300/40 rounded px-2 py-1.5 mb-2">
          برای جلوگیری از کندی، فقط بخشی از کتاب در پیش‌نمایش نشان داده شده است
          (تا ۵۰ صفحهٔ چاپی یا ۴۰۰ بلوک نخست).
        </div>
      )}
      <div className="rounded-md border bg-card max-h-[600px] overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none">
        {blocks.map((block, index) => (
          <BlockRenderer key={index} block={block} index={index} fontSize={15} />
        ))}
        {blocks.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">محتوایی برای پیش‌نمایش نیست.</p>
        )}
      </div>
    </div>
  );
};
