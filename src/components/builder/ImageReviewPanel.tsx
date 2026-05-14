// Side panel (like the AI assistant) listing every image / placeholder
// in the book with thumbnails. Click an item to jump to that exact image
// in the editor. Items needing user attention (no caption, missing
// figure number match, empty placeholder) are colored differently.
import { useMemo, useState, useEffect } from "react";
import {
  X, Check, AlertTriangle, ImageIcon, Sparkles, Wand2, MousePointerClick,
  AlignVerticalJustifyCenter, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveBookMedia } from "@/lib/book-media";
import type { TextPage } from "@/lib/tiptap-doc";

const FIG_RE = /^(شکل|تصویر|نگاره|figure|fig\.?)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;
const FIG_NUM_RE = /(?:شکل|تصویر|نگاره|figure|fig\.?)\s*([\d\u06F0-\u06F9۰-۹]+(?:[.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?)/i;

const normalizeNum = (s: string) =>
  s
    .replace(/[\u06F0-\u06F9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06F0 + 0x30))
    .replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x30))
    .replace(/[\u2013\u2014]/g, "-")
    .toLowerCase()
    .trim();

const blockText = (node: any): string =>
  (node?.content ?? [])
    .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
    .join("")
    .trim();

interface SuggestedCaption {
  text: string;
  fromBlockOffset: number;
  num?: string;
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
  pendingSrc?: string;
  suggestedCaption?: SuggestedCaption;
  attention?: "missing-image" | "missing-caption" | "mismatch";
}

interface Props {
  pages: TextPage[];
  onClose: () => void;
  onJump: (pageIndex: number, blockIndex: number) => void;
  reviewed: Set<string>;
  onToggleReviewed: (key: string) => void;
  onAutoPlaceAll?: () => void;
  onAutoAlign?: () => void;
  onFinalizePlaceholder?: (
    pageIndex: number,
    blockIndex: number,
    options: { caption: string; consumeCaptionOffset?: number },
  ) => void;
}

type SortMode = "attention-first" | "ok-first" | "page-order";

export const ImageReviewPanel = ({
  pages, onClose, onJump, reviewed, onToggleReviewed,
  onAutoPlaceAll, onAutoAlign, onFinalizePlaceholder,
}: Props) => {
  const [filter, setFilter] = useState<"all" | "attention">("attention");
  const [sortMode, setSortMode] = useState<SortMode>("attention-first");

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    pages.forEach((p, pi) => {
      const content = (p.doc?.content ?? []) as any[];
      content.forEach((node, bi) => {
        if (!node) return;
        const isImg = node.type === "image";
        const isPh = node.type === "image_placeholder";
        if (!isImg && !isPh) return;

        // Look ahead for caption suggestion (FIG_RE in next ~3 blocks)
        let suggested: SuggestedCaption | undefined;
        for (let j = 1; j <= 3 && bi + j < content.length; j += 1) {
          const next = content[bi + j];
          if (!next) continue;
          if (next.type === "image" || next.type === "image_placeholder") break;
          if (next.type !== "paragraph" && next.type !== "heading") continue;
          const text = blockText(next);
          if (!text) continue;
          if (FIG_RE.test(text)) {
            const m = text.match(FIG_NUM_RE);
            suggested = { text, fromBlockOffset: j, num: m?.[1] ? normalizeNum(m[1]) : undefined };
            break;
          }
          break;
        }

        const figNum = node.attrs?.figureNumber
          ? normalizeNum(String(node.attrs.figureNumber).match(FIG_NUM_RE)?.[1] || node.attrs.figureNumber)
          : undefined;

        let attention: Item["attention"] | undefined;
        if (isPh && !node.attrs?.pendingSrc) attention = "missing-image";
        else if (isImg && !node.attrs?.caption) {
          // image with no caption — flag for review unless adjacent FIG_RE matches
          if (!suggested) attention = "missing-caption";
        }
        if (figNum && suggested?.num && figNum !== suggested.num) attention = "mismatch";

        out.push({
          key: `${pi}:${bi}:${isImg ? "img" : "ph"}`,
          pageIndex: pi,
          blockIndex: bi,
          type: isImg ? "image" : "placeholder",
          src: isImg ? node.attrs?.src : node.attrs?.pendingSrc || undefined,
          pendingSrc: isPh ? node.attrs?.pendingSrc || undefined : undefined,
          caption: node.attrs?.caption,
          figureNumber: node.attrs?.figureNumber,
          slot: node.attrs?.slot,
          suggestedCaption: suggested,
          attention,
        });
      });
    });
    return out;
  }, [pages]);

  const total = items.length;
  const attentionCount = items.filter((i) => i.attention).length;
  const placeholderEmpty = items.filter((i) => i.type === "placeholder" && !i.pendingSrc).length;
  const visible = filter === "attention" ? items.filter((i) => i.attention || (i.type === "placeholder" && i.pendingSrc)) : items;

  // Per-card editable caption drafts
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [acceptSuggestion, setAcceptSuggestion] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setCaptionDrafts((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (next[it.key] === undefined) next[it.key] = it.caption || it.suggestedCaption?.text || "";
      }
      return next;
    });
    setAcceptSuggestion((prev) => {
      const next = { ...prev };
      for (const it of items) if (next[it.key] === undefined) next[it.key] = !!it.suggestedCaption;
      return next;
    });
  }, [items]);

  return (
    <div className="rounded-2xl border bg-card/80 backdrop-blur shadow-sm flex flex-col max-h-[calc(100vh-6rem)]">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold flex-1 truncate">مرور تصاویر</h3>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="px-3 py-2 border-b space-y-2">
        <div className="text-[11px] text-muted-foreground">
          {total} تصویر · <span className="text-amber-600 dark:text-amber-400 font-medium">{attentionCount}</span> نیاز به بررسی
          {placeholderEmpty > 0 && <> · <span className="text-destructive font-medium">{placeholderEmpty}</span> بدون فایل</>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {onAutoPlaceAll && placeholderEmpty > 0 && (
            <Button size="sm" className="h-7 text-[11px] flex-1" onClick={onAutoPlaceAll}>
              <Wand2 className="w-3 h-3 me-1" /> جایگذاری همه
            </Button>
          )}
          {onAutoAlign && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1" onClick={onAutoAlign}>
              <AlignVerticalJustifyCenter className="w-3 h-3 me-1" /> هم‌ترازی شکل‌ها
            </Button>
          )}
        </div>
        <div className="flex gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setFilter("attention")}
            className={`px-2 py-0.5 rounded-md transition ${filter === "attention" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium" : "hover:bg-muted text-muted-foreground"}`}
          >
            نیاز به بررسی ({attentionCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-2 py-0.5 rounded-md transition ${filter === "all" ? "bg-muted font-medium" : "hover:bg-muted text-muted-foreground"}`}
          >
            همه ({total})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {visible.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            {filter === "attention" ? "همه تصاویر بررسی‌شده‌اند 🎉" : "تصویری یافت نشد"}
          </div>
        ) : (
          visible.map((it) => {
            const isReviewed = reviewed.has(it.key);
            const isExpanded = expanded === it.key;
            const hasPending = it.type === "placeholder" && !!it.pendingSrc;
            const captionValue = captionDrafts[it.key] ?? "";
            const willConsume = hasPending && !!it.suggestedCaption
              && (acceptSuggestion[it.key] ?? true)
              && captionValue.trim() === it.suggestedCaption.text.trim();

            const borderCls =
              it.attention === "missing-image" ? "border-destructive/60 bg-destructive/5"
              : it.attention === "mismatch" ? "border-orange-500/60 bg-orange-500/10"
              : it.attention === "missing-caption" ? "border-amber-500/60 bg-amber-500/10"
              : isReviewed ? "border-emerald-500/50 bg-emerald-500/5"
              : "border-border hover:border-primary/40";

            return (
              <div key={it.key} className={`rounded-lg border transition ${borderCls}`}>
                <div className="flex gap-2 p-1.5">
                  <button
                    type="button"
                    onClick={() => onJump(it.pageIndex, it.blockIndex)}
                    className="block w-16 h-12 rounded-md overflow-hidden bg-muted/50 shrink-0 relative"
                    title="پرش به تصویر"
                  >
                    {it.src ? (
                      <img
                        src={resolveBookMedia(it.src)}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-amber-600">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                    )}
                    {isReviewed && (
                      <span className="absolute top-0 end-0 bg-emerald-500 text-white p-0.5 rounded-bl-md">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onJump(it.pageIndex, it.blockIndex)}
                      className="block w-full text-start"
                    >
                      <div className="flex items-center gap-1 text-[11px] flex-wrap">
                        <span className="text-muted-foreground tabular-nums">ص{it.pageIndex + 1}</span>
                        {it.figureNumber && <span className="font-semibold truncate">{it.figureNumber}</span>}
                        {!it.figureNumber && it.slot ? <span className="text-muted-foreground">#{it.slot}</span> : null}
                        {it.attention === "mismatch" && <span className="text-orange-700 dark:text-orange-400 text-[10px]">عدم تطابق شماره</span>}
                        {it.attention === "missing-caption" && <span className="text-amber-700 dark:text-amber-400 text-[10px]">بدون کپشن</span>}
                        {it.attention === "missing-image" && <span className="text-destructive text-[10px]">بدون فایل</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1" title={it.caption || it.suggestedCaption?.text || ""}>
                        {it.caption || it.suggestedCaption?.text || "—"}
                      </div>
                    </button>
                  </div>

                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onJump(it.pageIndex, it.blockIndex)}
                      className="p-1 rounded hover:bg-muted"
                      title="مشاهده"
                    >
                      <MousePointerClick className="w-3 h-3" />
                    </button>
                    {(hasPending || it.attention) && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : it.key)}
                        className="p-1 rounded hover:bg-muted"
                        title={isExpanded ? "بستن" : "باز کردن"}
                      >
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggleReviewed(it.key)}
                      className={`p-1 rounded ${isReviewed ? "bg-emerald-500 text-white" : "hover:bg-muted"}`}
                      title={isReviewed ? "بررسی شد" : "علامت بررسی"}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {isExpanded && (hasPending || it.attention) && (
                  <div className="px-1.5 pb-1.5 space-y-1.5">
                    {hasPending && onFinalizePlaceholder && (
                      <>
                        <Input
                          value={captionValue}
                          placeholder="کپشن…"
                          className="h-7 text-[11px]"
                          onChange={(e) => setCaptionDrafts((p) => ({ ...p, [it.key]: e.target.value }))}
                        />
                        {it.suggestedCaption && (
                          <label className="flex items-start gap-1 text-[10px] text-muted-foreground cursor-pointer leading-snug">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={acceptSuggestion[it.key] ?? true}
                              onChange={(e) => {
                                const c = e.target.checked;
                                setAcceptSuggestion((p) => ({ ...p, [it.key]: c }));
                                if (c) setCaptionDrafts((p) => ({ ...p, [it.key]: it.suggestedCaption!.text }));
                              }}
                            />
                            <span><Sparkles className="w-2.5 h-2.5 inline me-0.5 text-primary" />کپشن پیشنهادی + حذف از متن</span>
                          </label>
                        )}
                        <Button
                          size="sm"
                          className="h-7 w-full text-[11px]"
                          onClick={() => {
                            onFinalizePlaceholder(it.pageIndex, it.blockIndex, {
                              caption: captionValue.trim(),
                              consumeCaptionOffset: willConsume ? it.suggestedCaption!.fromBlockOffset : undefined,
                            });
                            if (!isReviewed) onToggleReviewed(it.key);
                            setExpanded(null);
                          }}
                        >
                          <Check className="w-3 h-3 me-1" /> تایید و درج
                        </Button>
                      </>
                    )}
                    {it.attention === "mismatch" && (
                      <div className="text-[10px] text-orange-700 dark:text-orange-400">
                        شماره تصویر «{it.figureNumber}» با شماره کپشن مجاور ({it.suggestedCaption?.num}) جور نیست. از «هم‌ترازی شکل‌ها» استفاده کنید.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
