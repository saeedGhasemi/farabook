// Standalone image review dialog. Scans every chapter for image and
// image_placeholder nodes and shows a thumbnail grid grouped by page so
// the user can verify each placement without paging through the editor.
// Reviewed-state is persisted per book in localStorage.
import { useMemo, useState, useEffect } from "react";
import { LayoutGrid, MousePointerClick, Check, AlertTriangle, ImageIcon, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { resolveBookMedia } from "@/lib/book-media";
import type { TextPage } from "@/lib/tiptap-doc";

// Persian/English figure label detector — duplicated from word-import to
// keep this component fully client-side.
const FIG_RE = /^(شکل|تصویر|نگاره|figure|fig\.?)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;

interface SuggestedCaption {
  text: string;
  fromBlockOffset: number; // 1 = next block, etc.
}

interface Item {
  key: string;
  pageIndex: number;
  blockIndex: number;
  type: "image" | "placeholder";
  src?: string;
  caption?: string;
  figureNumber?: string;
  slot?: number;
  originalPath?: string;
  reason?: string;
  pendingSrc?: string;
  suggestedCaption?: SuggestedCaption;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: TextPage[];
  bookId?: string;
  onJump: (pageIndex: number, blockIndex?: number) => void;
  reviewed: Set<string>;
  onToggleReviewed: (key: string) => void;
  /** Run the full auto-placement pipeline (opens the side panel). */
  onAutoPlaceAll?: () => void;
  /** Replace placeholder with image, optionally consuming a caption block. */
  onFinalizePlaceholder?: (
    pageIndex: number,
    blockIndex: number,
    options: { caption: string; consumeCaptionOffset?: number },
  ) => void;
  pendingPlaceholderTotal?: number;
}

export const ImageReviewDialog = ({
  open, onOpenChange, pages, onJump, reviewed, onToggleReviewed,
  onAutoPlaceAll, onFinalizePlaceholder, pendingPlaceholderTotal,
}: Props) => {
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    pages.forEach((p, pi) => {
      const content = (p.doc?.content ?? []) as any[];
      content.forEach((node, bi) => {
        if (!node) return;
        if (node.type === "image") {
          out.push({
            key: `${pi}:${bi}:img`,
            pageIndex: pi,
            blockIndex: bi,
            type: "image",
            src: node.attrs?.src,
            caption: node.attrs?.caption,
            figureNumber: node.attrs?.figureNumber,
          });
        } else if (node.type === "image_placeholder") {
          // Look ahead a few blocks for a "شکل/Figure ..." paragraph to
          // suggest as caption.
          let suggested: SuggestedCaption | undefined;
          for (let j = 1; j <= 3 && bi + j < content.length; j += 1) {
            const next = content[bi + j];
            if (!next) continue;
            if (next.type === "image" || next.type === "image_placeholder") break;
            if (next.type !== "paragraph" && next.type !== "heading") continue;
            const text = (next.content ?? [])
              .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
              .join("")
              .trim();
            if (!text) continue;
            if (FIG_RE.test(text)) {
              suggested = { text, fromBlockOffset: j };
              break;
            }
            // first non-fig text block — stop searching
            break;
          }
          out.push({
            key: `${pi}:${bi}:ph`,
            pageIndex: pi,
            blockIndex: bi,
            type: "placeholder",
            src: node.attrs?.pendingSrc || undefined,
            pendingSrc: node.attrs?.pendingSrc || undefined,
            caption: node.attrs?.caption,
            figureNumber: node.attrs?.figureNumber,
            slot: node.attrs?.slot,
            originalPath: node.attrs?.originalPath,
            reason: node.attrs?.reason,
            suggestedCaption: suggested,
          });
        }
      });
    });
    return out;
  }, [pages]);

  const placedCount = items.filter((i) => i.type === "image").length;
  const placeholderCount = items.length - placedCount;
  const pendingNoSrcCount = pendingPlaceholderTotal ?? items.filter((i) => i.type === "placeholder" && !i.pendingSrc).length;

  // Per-card editable captions (seeded from suggestion or existing caption).
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [acceptSuggestion, setAcceptSuggestion] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Seed defaults whenever items change while dialog is open
    if (!open) return;
    setCaptionDrafts((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.key] === undefined) {
          next[it.key] = it.caption || it.suggestedCaption?.text || "";
        }
      }
      return next;
    });
    setAcceptSuggestion((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.key] === undefined) {
          next[it.key] = !!it.suggestedCaption;
        }
      }
      return next;
    });
  }, [items, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" />
            مرور همه تصاویر کتاب
          </DialogTitle>
          <DialogDescription>
            {items.length} تصویر — {placedCount} درج‌شده، {placeholderCount} پیش‌نویس · {reviewed.size} مورد بررسی‌شده. روی هر کارت بزنید تا به محل دقیق آن در ادیتور پرش کند.
          </DialogDescription>
        </DialogHeader>

        {onAutoPlaceAll && pendingNoSrcCount > 0 && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-foreground">
              <Sparkles className="w-3.5 h-3.5 inline me-1 text-primary" />
              {pendingNoSrcCount} تصویر هنوز از فایل Word استخراج نشده‌اند.
            </div>
            <Button size="sm" onClick={() => { onAutoPlaceAll(); onOpenChange(false); }}>
              <Wand2 className="w-3.5 h-3.5 me-1" /> جایگذاری خودکار همه
            </Button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-12">
            <ImageIcon className="w-4 h-4 me-2" /> هیچ تصویری در این کتاب یافت نشد
          </div>
        ) : (
          <div className="overflow-y-auto -mx-2 px-2 pb-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((it) => {
                const isReviewed = reviewed.has(it.key);
                const isPlaceholder = it.type === "placeholder";
                const hasPending = isPlaceholder && !!it.pendingSrc;
                const captionValue = captionDrafts[it.key] ?? (it.caption || it.suggestedCaption?.text || "");
                const willConsumeCaption = hasPending
                  && !!it.suggestedCaption
                  && (acceptSuggestion[it.key] ?? true)
                  && captionValue.trim() === it.suggestedCaption.text.trim();
                return (
                  <div
                    key={it.key}
                    className={`group rounded-xl border overflow-hidden bg-card/60 transition flex flex-col ${
                      isReviewed ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
                      : isPlaceholder ? "border-amber-500/50"
                      : "hover:border-primary/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => { onJump(it.pageIndex, it.blockIndex); onOpenChange(false); }}
                      className="block w-full bg-muted/40 aspect-[4/3] overflow-hidden relative"
                      title="مشاهده در کتاب"
                    >
                      {it.src ? (
                        <img
                          src={resolveBookMedia(it.src)}
                          alt={it.caption || ""}
                          loading="lazy"
                          className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-amber-600">
                          <AlertTriangle className="w-6 h-6" />
                        </div>
                      )}
                      <span className="absolute top-1 start-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-mono">
                        صفحه {it.pageIndex + 1}
                      </span>
                      {isPlaceholder && (
                        <span className="absolute bottom-1 start-1 rounded-md bg-amber-500/90 text-white px-1.5 py-0.5 text-[9px]">
                          پیش‌نویس
                        </span>
                      )}
                      {isReviewed && (
                        <span className="absolute top-1 end-1 rounded-full bg-emerald-500 text-white p-1">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                    <div className="p-2 space-y-1.5 flex-1 flex flex-col">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="truncate" title={it.caption || it.figureNumber || ""}>
                          {it.figureNumber || (it.slot ? `تصویر ${it.slot}` : `بلوک ${it.blockIndex + 1}`)}
                        </span>
                      </div>
                      {hasPending && (
                        <>
                          <Input
                            value={captionValue}
                            placeholder="کپشن (اختیاری)…"
                            className="h-7 text-[11px]"
                            onChange={(e) => {
                              setCaptionDrafts((prev) => ({ ...prev, [it.key]: e.target.value }));
                            }}
                          />
                          {it.suggestedCaption && (
                            <label className="flex items-start gap-1 text-[10px] text-muted-foreground cursor-pointer leading-snug">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={acceptSuggestion[it.key] ?? true}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setAcceptSuggestion((prev) => ({ ...prev, [it.key]: checked }));
                                  if (checked) {
                                    setCaptionDrafts((prev) => ({ ...prev, [it.key]: it.suggestedCaption!.text }));
                                  }
                                }}
                              />
                              <span>
                                <Sparkles className="w-2.5 h-2.5 inline me-0.5 text-primary" />
                                استفاده از کپشن پیشنهادی و حذف از متن
                              </span>
                            </label>
                          )}
                        </>
                      )}
                      {!hasPending && it.caption && (
                        <div className="text-[10px] text-muted-foreground line-clamp-2" title={it.caption}>
                          {it.caption}
                        </div>
                      )}
                      <div className="flex gap-1.5 mt-auto pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-[11px]"
                          onClick={() => { onJump(it.pageIndex, it.blockIndex); onOpenChange(false); }}
                        >
                          <MousePointerClick className="w-3 h-3 me-1" /> مشاهده
                        </Button>
                        <Button
                          size="sm"
                          variant={isReviewed ? "default" : "secondary"}
                          className="h-7 text-[11px]"
                          onClick={() => {
                            if (hasPending && onFinalizePlaceholder) {
                              onFinalizePlaceholder(it.pageIndex, it.blockIndex, {
                                caption: captionValue.trim(),
                                consumeCaptionOffset: willConsumeCaption ? it.suggestedCaption!.fromBlockOffset : undefined,
                              });
                            }
                            if (!isReviewed) onToggleReviewed(it.key);
                          }}
                        >
                          <Check className="w-3 h-3 me-1" />
                          {hasPending ? "تایید و درج" : isReviewed ? "بررسی شد" : "تایید"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
