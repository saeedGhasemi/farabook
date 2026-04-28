// AI suggestions side-panel. Two main improvements vs the old panel:
//  1) Each suggestion has a "Find" button that scrolls the editor to the
//     target text and briefly highlights it — so the user no longer has
//     to scroll back and forth manually.
//  2) Before generating AI images for interactive blocks (timeline /
//     scrollytelling), we count how many images would be generated and
//     ask the user to confirm the credit cost.
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Sparkles, Loader2, X, Check, Type, Quote as QuoteIcon, Lightbulb,
  Heading2, SplitSquareVertical, ListOrdered, Layers, RefreshCw, Eye,
  Image as ImageIcon, Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAiCosts } from "@/hooks/useAiCosts";
import { useCredits } from "@/hooks/useCredits";
import { CREDITS_REFRESH_EVENT } from "@/lib/credits-bus";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SuggestionOp =
  | "make_callout" | "make_quote" | "make_heading"
  | "emphasize" | "split_paragraph"
  | "insert_timeline" | "insert_scrollytelling";

interface Step { marker?: string; title?: string; description?: string; image_prompt?: string; image?: string }

interface Suggestion {
  op: SuggestionOp;
  target_text?: string;
  reason: string;
  variant?: string;
  level?: 2 | 3;
  mark?: "bold" | "italic" | "underline";
  split_after?: string;
  title?: string;
  steps?: Step[];
}

interface Props {
  editor: Editor;
  lang: "fa" | "en";
  onClose: () => void;
  bookId?: string;
  /** Stable key per chapter; suggestions are cached per key so switching
   *  chapters and coming back restores the previous list without spending
   *  credits again. */
  chapterKey?: string;
}

// Module-level cache so suggestions survive panel unmount/remount when
// the user collapses the AI side-panel or switches chapters.
type CacheEntry = {
  suggestions: Suggestion[];
  accepted: Array<[number, number]>;
  rejected: number[];
  error: string | null;
  /** Lightweight fingerprint of the chapter text at the time suggestions
   *  were generated. If the current doc no longer matches, the cache is
   *  considered stale and discarded so the user doesn't see suggestions
   *  pointing at text that has changed substantially. */
  fingerprint?: string;
};
const suggestionCache: Map<string, CacheEntry> = new Map();

/** Cheap, stable fingerprint: length + djb2-style hash of the plain text.
 *  Sensitive to any character change, but ignores prosemirror node ids. */
const computeDocFingerprint = (editor: Editor): string => {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
};

const opMeta: Record<SuggestionOp, { Icon: any; label_fa: string; label_en: string }> = {
  make_callout:        { Icon: Lightbulb,           label_fa: "بلوک نکته", label_en: "Callout block" },
  make_quote:          { Icon: QuoteIcon,           label_fa: "نقل‌قول", label_en: "Quote" },
  make_heading:        { Icon: Heading2,            label_fa: "تیتر", label_en: "Heading" },
  emphasize:           { Icon: Type,                label_fa: "تأکید", label_en: "Emphasize" },
  split_paragraph:     { Icon: SplitSquareVertical, label_fa: "شکستن پاراگراف", label_en: "Split paragraph" },
  insert_timeline:     { Icon: ListOrdered,         label_fa: "تایم‌لاین", label_en: "Timeline" },
  insert_scrollytelling:{Icon: Layers,              label_fa: "اسکرولی‌تلینگ", label_en: "Scrollytelling" },
};

const findRange = (editor: Editor, needle: string): [number, number] | null => {
  if (!needle) return null;
  // Build a plain-text index alongside doc positions so the mapping is
  // exact. We mirror ProseMirror's textBetween(blockSep="\n") behavior:
  // each top-level block boundary contributes "\n" separators between
  // them. Within a block, contiguous text nodes concatenate.
  const segments: { from: number; to: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      segments.push({ from: pos, to: pos + node.text.length, text: node.text });
    }
    return true;
  });
  // Build plain text by joining segments with "\n" between distinct
  // top-level blocks. We approximate by inserting a separator whenever
  // the next text segment starts in a new block (i.e. there's a
  // non-text gap between segments).
  let plain = "";
  const map: Array<{ plainStart: number; from: number; to: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) {
      // If gap exists between previous segment end and this start in
      // the doc, insert a "\n" separator (matches textBetween "\n").
      const prev = segments[i - 1];
      if (seg.from > prev.to) plain += "\n";
    }
    map.push({ plainStart: plain.length, from: seg.from, to: seg.to });
    plain += seg.text;
  }
  const idx = plain.indexOf(needle);
  if (idx < 0) return null;
  const targetEnd = idx + needle.length;
  let from = -1, to = -1;
  for (const m of map) {
    const segLen = m.to - m.from;
    const segPlainEnd = m.plainStart + segLen;
    if (from < 0 && idx >= m.plainStart && idx <= segPlainEnd) {
      from = m.from + (idx - m.plainStart);
    }
    if (targetEnd >= m.plainStart && targetEnd <= segPlainEnd) {
      to = m.from + (targetEnd - m.plainStart);
      break;
    }
  }
  if (from < 0 || to < 0 || to <= from) return null;
  return [from, to];
};

const attrsForNode = (nodeType: any, attrs: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => key in nodeType.attrs));

const convertExactRangeToBlock = (
  editor: Editor,
  from: number,
  to: number,
  blockName: "callout" | "quote" | "heading",
  attrs: Record<string, unknown> = {},
): boolean => {
  const { state, view } = editor;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;

  const parent = $from.parent;
  const depth = $from.depth;
  const parentStart = $from.before(depth);
  const parentEnd = $from.after(depth);
  const contentStart = $from.start(depth);
  const fromOffset = Math.max(0, from - contentStart);
  const toOffset = Math.min(parent.content.size, to - contentStart);
  if (toOffset <= fromOffset) return false;

  const targetType = state.schema.nodes[blockName];
  if (!targetType) return false;

  const before = parent.content.cut(0, fromOffset);
  const selected = parent.content.cut(fromOffset, toOffset);
  const after = parent.content.cut(toOffset, parent.content.size);
  const nodes: any[] = [];
  if (before.size) nodes.push(parent.type.create(parent.attrs, before, parent.marks));
  nodes.push(targetType.create(attrsForNode(targetType, { ...attrs, dir: parent.attrs?.dir }), selected));
  if (after.size) nodes.push(parent.type.create(parent.attrs, after, parent.marks));

  const tr = state.tr.replaceWith(parentStart, parentEnd, nodes).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
};

/** Scroll the editor to a target text and briefly highlight it. */
const focusTarget = (editor: Editor, needle?: string) => {
  if (!needle) return false;
  const range = findRange(editor, needle);
  if (!range) return false;
  const [from, to] = range;
  editor.chain().focus().setTextSelection({ from, to }).run();
  // Find DOM node and scroll it into view
  try {
    const dom = (editor.view as any).domAtPos(from)?.node as Node | undefined;
    const el = (dom?.nodeType === 3 ? dom.parentElement : (dom as Element)) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ai-target-flash");
      setTimeout(() => el.classList.remove("ai-target-flash"), 1500);
    }
  } catch { /* ignore */ }
  return true;
};

const applySuggestion = (editor: Editor, s: Suggestion): boolean => {
  if (s.op === "insert_timeline" || s.op === "insert_scrollytelling") {
    const steps = (s.steps || []).map((st) => ({
      marker: st.marker || "",
      title: st.title || "",
      description: st.description || "",
      image: st.image || "",
    }));
    if (!steps.length) return false;
    const nodeType = s.op === "insert_timeline" ? "timeline" : "scrollytelling";
    let insertPos = editor.state.doc.content.size;
    if (s.target_text) {
      const range = findRange(editor, s.target_text);
      if (range) insertPos = range[1];
    }
    return editor.chain().focus().insertContentAt(insertPos, {
      type: nodeType,
      attrs: { title: s.title || "", steps },
    }).run();
  }

  if (!s.target_text) return false;
  const range = findRange(editor, s.target_text);
  if (!range) return false;
  const [from, to] = range;
  const chain = editor.chain().focus().setTextSelection({ from, to });
  switch (s.op) {
    case "make_callout":
      return convertExactRangeToBlock(editor, from, to, "callout", { variant: s.variant || "info" });
    case "make_quote":
      return convertExactRangeToBlock(editor, from, to, "quote");
    case "make_heading":
      return convertExactRangeToBlock(editor, from, to, "heading", { level: s.level ?? 2 });
    case "emphasize": {
      const m = s.mark || "bold";
      if (m === "bold") return chain.setBold().run();
      if (m === "italic") return chain.setItalic().run();
      return chain.setUnderline().run();
    }
    case "split_paragraph":
      return chain.setTextSelection({ from: to, to }).splitBlock().run();
    default:
      return false;
  }
};

const countImageSteps = (s: Suggestion) =>
  (s.steps || []).filter((st) => !st.image && st.image_prompt).length;

export const AiSuggestPanel = ({ editor, lang, onClose, bookId, chapterKey }: Props) => {
  const fa = lang === "fa";
  const { costs } = useAiCosts();
  const { credits, refresh: refreshCredits } = useCredits();
  // Restore from per-chapter cache when remounting for the same chapter,
  // but only if the chapter content fingerprint still matches. If the
  // user has made substantial edits since the suggestions were generated,
  // we drop the stale cache so they don't see mismatched suggestions.
  const currentFingerprint = useMemo(() => computeDocFingerprint(editor), [editor]);
  const rawCached = chapterKey ? suggestionCache.get(chapterKey) : undefined;
  const cached = rawCached && rawCached.fingerprint === currentFingerprint ? rawCached : undefined;
  if (chapterKey && rawCached && !cached) {
    suggestionCache.delete(chapterKey);
  }
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(cached?.suggestions ?? []);
  const [accepted, setAccepted] = useState<Map<number, number>>(
    new Map(cached?.accepted ?? []),
  );
  const [rejected, setRejected] = useState<Set<number>>(
    new Set(cached?.rejected ?? []),
  );
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(cached?.error ?? null);
  // Fingerprint of the doc when the current suggestion list was generated.
  // Used to detect when the chapter content has drifted enough that the
  // cached suggestions are no longer valid.
  const [genFingerprint, setGenFingerprint] = useState<string | null>(
    cached?.fingerprint ?? null,
  );

  // Confirmation dialog for image generation cost
  const [confirmState, setConfirmState] = useState<
    | { kind: "single"; idx: number; imageCount: number }
    | { kind: "all"; imageCount: number; itemCount: number }
    | null
  >(null);

  const done = useMemo(() => new Set<number>([...accepted.keys(), ...rejected]), [accepted, rejected]);

  const getHistorySize = () => {
    const h: any = (editor.state as any).history$?.done;
    return h?.eventCount ?? h?.items?.length ?? 0;
  };

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const histSize = getHistorySize();
      setAccepted((prev) => {
        if (!prev.size) return prev;
        let changed = false;
        const next = new Map(prev);
        for (const [idx, mark] of prev) {
          if (histSize < mark) { next.delete(idx); changed = true; }
        }
        return changed ? next : prev;
      });
    };
    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const fetchSuggestions = async () => {
    setLoading(true);
    setSuggestions([]);
    setAccepted(new Map());
    setRejected(new Set());
    setError(null);
    try {
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
      if (text.trim().length < 20) {
        setError(fa ? "متن این صفحه خیلی کوتاه است. ابتدا چند پاراگراف بنویسید." : "Page text is too short.");
        return;
      }
      if (credits < costs.text_suggest) {
        setError(fa
          ? `برای دریافت پیشنهادها به ${costs.text_suggest} اعتبار نیاز دارید. اعتبار شما: ${credits}`
          : `Need ${costs.text_suggest} credits, you have ${credits}`);
        return;
      }
      const { data, error } = await supabase.functions.invoke("book-suggest", {
        body: { text, lang, book_id: bookId || null },
      });
      if (error) throw error;
      const list = (data?.suggestions ?? []) as Suggestion[];
      setSuggestions(list);
      setGenFingerprint(computeDocFingerprint(editor));
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      if (data?.cost) toast.success(fa ? `${data.cost} اعتبار کسر شد` : `${data.cost} credits charged`);
      if (!list.length) setError(fa ? "پیشنهاد جدیدی پیدا نشد." : "No suggestions found.");
    } catch (e: any) {
      setError(e?.message || (fa ? "خطا در دریافت پیشنهادها" : "Failed to fetch suggestions"));
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount only when there are no cached suggestions for
  // this chapter. Otherwise restore is enough — the user can hit the
  // Refresh button to spend credits and regenerate.
  useEffect(() => {
    if (suggestions.length > 0 || cached) return;
    void (async () => { await refreshCredits(); await fetchSuggestions(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current state into the per-chapter cache so it can be
  // restored when the panel is reopened (e.g. after switching chapters).
  useEffect(() => {
    if (!chapterKey) return;
    suggestionCache.set(chapterKey, {
      suggestions,
      accepted: Array.from(accepted.entries()),
      rejected: Array.from(rejected),
      error,
    });
  }, [chapterKey, suggestions, accepted, rejected, error]);

  const enrichWithImages = async (s: Suggestion): Promise<Suggestion> => {
    if (s.op !== "insert_timeline" && s.op !== "insert_scrollytelling") return s;
    if (!s.steps?.length) return s;
    const enriched = await Promise.all(
      s.steps.map(async (st) => {
        if (st.image || !st.image_prompt) return st;
        try {
          const { data, error } = await supabase.functions.invoke("book-image-gen", {
            body: { prompt: `${st.image_prompt}. Style: clean modern editorial illustration, soft palette, no text.`, lang, book_id: bookId || null },
          });
          if (error) throw error;
          if (data?.url) return { ...st, image: data.url as string };
        } catch (e) {
          console.warn("image gen failed:", e);
        }
        return st;
      }),
    );
    return { ...s, steps: enriched };
  };

  const performAccept = async (idx: number, withImages = true) => {
    if (busyIdx !== null) return;
    setBusyIdx(idx);
    try {
      const s = withImages ? await enrichWithImages(suggestions[idx]) : suggestions[idx];
      setSuggestions((prev) => prev.map((x, i) => (i === idx ? s : x)));
      const ok = applySuggestion(editor, s);
      if (!ok) {
        toast.error(fa ? "اعمال این پیشنهاد ممکن نشد" : "Could not apply suggestion");
        return;
      }
      const mark = getHistorySize();
      setAccepted((prev) => { const next = new Map(prev); next.set(idx, mark); return next; });
      window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
      void refreshCredits();
    } finally {
      setBusyIdx(null);
    }
  };

  const accept = (idx: number) => {
    const s = suggestions[idx];
    const imageCount = countImageSteps(s);
    if (imageCount > 0) {
      const total = imageCount * costs.image_gen;
      if (credits < total) {
        toast.error(fa
          ? `این کار به ${total} اعتبار برای ${imageCount} تصویر نیاز دارد.`
          : `Need ${total} credits for ${imageCount} images.`);
        return;
      }
      setConfirmState({ kind: "single", idx, imageCount });
      return;
    }
    void performAccept(idx);
  };

  const reject = (idx: number) => {
    setRejected((prev) => { const s = new Set(prev); s.add(idx); return s; });
  };

  const performApplyAll = async (withImages = true) => {
    let applied = 0;
    for (let i = 0; i < suggestions.length; i++) {
      if (done.has(i)) continue;
      setBusyIdx(i);
      const s = withImages ? await enrichWithImages(suggestions[i]) : suggestions[i];
      setSuggestions((prev) => prev.map((x, k) => (k === i ? s : x)));
      if (applySuggestion(editor, s)) {
        const mark = getHistorySize();
        setAccepted((prev) => { const next = new Map(prev); next.set(i, mark); return next; });
        applied++;
      }
    }
    setBusyIdx(null);
    void refreshCredits();
    window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
    toast.success(fa ? `${applied} پیشنهاد اعمال شد` : `${applied} suggestions applied`);
  };

  const applyAll = () => {
    const pending = suggestions.filter((_, i) => !done.has(i));
    const imageCount = pending.reduce((n, s) => n + countImageSteps(s), 0);
    if (imageCount > 0) {
      const total = imageCount * costs.image_gen;
      if (credits < total) {
        toast.error(fa
          ? `اعمال همه به ${total} اعتبار برای ${imageCount} تصویر نیاز دارد.`
          : `Need ${total} credits for ${imageCount} images.`);
        return;
      }
      setConfirmState({ kind: "all", imageCount, itemCount: pending.length });
      return;
    }
    void performApplyAll();
  };

  const Icon = Sparkles;

  return (
    <>
      <div className="rounded-2xl border bg-card/95 backdrop-blur p-3 shadow-paper flex flex-col max-h-[calc(100vh-7rem)]">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <Icon className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold flex-1">{fa ? "دستیار هوشمند" : "AI assistant"}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={fa ? "بازخوانی" : "Refresh"} onClick={fetchSuggestions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Cost + balance reminder banner */}
        <div className="rounded-lg bg-muted/40 border text-[11px] px-2 py-1.5 mb-2 flex items-center gap-2 shrink-0 flex-wrap">
          <Coins className="w-3 h-3 text-accent" />
          <span className="text-muted-foreground">
            {fa
              ? `متنی: ${costs.text_suggest} • تصویر: ${costs.image_gen}`
              : `Text: ${costs.text_suggest} • Image: ${costs.image_gen}`}
          </span>
          <span className="ms-auto font-mono text-foreground">
            {fa ? "اعتبار شما:" : "Balance:"} {credits.toLocaleString()}
          </span>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            {fa ? "در حال تحلیل…" : "Analyzing…"}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p>{error}</p>
            <Button
              size="sm"
              className="w-full h-8 bg-stage-published text-stage-published-foreground hover:bg-stage-published/90"
              onClick={() => { void refreshCredits(); void fetchSuggestions(); }}
            >
              <RefreshCw className="w-3.5 h-3.5 me-1.5" />
              {fa ? "ادامه بده / تلاش دوباره" : "Continue / Try again"}
            </Button>
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <Button
                size="sm"
                onClick={applyAll}
                className="bg-stage-published text-stage-published-foreground hover:bg-stage-published/90 h-7"
                disabled={done.size === suggestions.length || busyIdx !== null}
              >
                {busyIdx !== null ? <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" /> : <Check className="w-3.5 h-3.5 me-1" />}
                {fa ? "اعمال همه" : "Apply all"}
              </Button>
              <span className="text-xs text-muted-foreground ms-auto">
                {done.size}/{suggestions.length}
              </span>
            </div>

            <ul className="space-y-2 overflow-y-auto pe-1 flex-1 min-h-0">
              {suggestions.map((s, i) => {
                const meta = opMeta[s.op];
                const ItemIcon = meta?.Icon ?? Sparkles;
                const isDone = done.has(i);
                const isInsert = s.op === "insert_timeline" || s.op === "insert_scrollytelling";
                const imgCount = countImageSteps(s);
                return (
                  <li
                    key={i}
                    className={`rounded-xl border p-2.5 transition ${
                      isDone ? "opacity-50 bg-muted/30" : "bg-background/60 hover:bg-background/80"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <ItemIcon className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold mb-0.5 flex items-center gap-1 flex-wrap">
                          <span>{fa ? meta?.label_fa : meta?.label_en}</span>
                          {s.variant && <span className="text-[10px] uppercase text-muted-foreground">{s.variant}</span>}
                          {s.mark && <span className="text-[10px] uppercase text-muted-foreground">{s.mark}</span>}
                          {imgCount > 0 && (
                            <span className="text-[10px] text-primary inline-flex items-center gap-0.5">
                              <ImageIcon className="w-2.5 h-2.5" />
                              {imgCount}× = {imgCount * costs.image_gen}
                            </span>
                          )}
                        </div>
                        {isInsert && s.title && (
                          <p className="text-xs font-semibold text-foreground mb-0.5" dir="auto">{s.title}</p>
                        )}
                        {s.target_text && (
                          <button
                            type="button"
                            className="text-xs text-foreground/80 line-clamp-2 leading-relaxed mb-0.5 text-start hover:text-accent transition"
                            dir="auto"
                            onClick={() => {
                              if (!focusTarget(editor, s.target_text)) {
                                toast.error(fa ? "متن مرجع پیدا نشد" : "Target not found");
                              }
                            }}
                            title={fa ? "نمایش در متن" : "Show in text"}
                          >
                            “{s.target_text}”
                          </button>
                        )}
                        <p className="text-[10px] text-muted-foreground">{s.reason}</p>
                        {busyIdx === i && (
                          <p className="text-[10px] text-accent mt-1 flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            {fa ? "در حال اعمال…" : "Applying…"}
                          </p>
                        )}
                      </div>
                      {!isDone && (
                        <div className="flex flex-col gap-1 shrink-0">
                          {s.target_text && (
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => focusTarget(editor, s.target_text)}
                              title={fa ? "نمایش در متن" : "Find"}
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="h-6 w-6 p-0 bg-stage-published text-stage-published-foreground hover:bg-stage-published/90"
                            onClick={() => accept(i)}
                            disabled={busyIdx !== null}
                            title={fa ? "تأیید و اعمال" : "Accept"}
                          >
                            {busyIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-6 w-6 p-0"
                            onClick={() => reject(i)}
                            disabled={busyIdx !== null}
                            title={fa ? "رد" : "Reject"}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <AlertDialog open={!!confirmState} onOpenChange={(o) => { if (!o) setConfirmState(null); }}>
        <AlertDialogContent dir={fa ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-accent" />
              {fa ? "تأیید تولید تصویر هوش مصنوعی" : "Confirm AI image generation"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirmState && (
                  <>
                    <p>
                      {fa
                        ? `این عمل ${confirmState.imageCount} تصویر تولید می‌کند.`
                        : `This will generate ${confirmState.imageCount} image(s).`}
                    </p>
                    <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span>{fa ? "هر تصویر" : "Per image"}</span>
                        <span className="font-mono">{costs.image_gen} {fa ? "اعتبار" : "credits"}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t pt-1">
                        <span>{fa ? "هزینه کل" : "Total"}</span>
                        <span className="font-mono text-accent">
                          −{confirmState.imageCount * costs.image_gen} {fa ? "اعتبار" : "credits"}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{fa ? "اعتبار شما پس از این" : "Balance after"}</span>
                        <span className="font-mono">
                          {(credits - confirmState.imageCount * costs.image_gen).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {fa
                        ? "اگر می‌خواهید بعداً خودتان عکس بگذارید، «بدون تولید عکس» را انتخاب کنید."
                        : "Pick \"Without images\" if you want to add your own images later."}
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 flex-col sm:flex-row">
            <AlertDialogCancel className="mt-0">{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const s = confirmState;
                setConfirmState(null);
                if (!s) return;
                if (s.kind === "single") void performAccept(s.idx, false);
                else void performApplyAll(false);
              }}
            >
              {fa ? "بدون تولید عکس" : "Without images"}
            </Button>
            <AlertDialogAction
              className="bg-stage-published text-stage-published-foreground hover:bg-stage-published/90"
              onClick={() => {
                const s = confirmState;
                setConfirmState(null);
                if (!s) return;
                if (s.kind === "single") void performAccept(s.idx, true);
                else void performApplyAll(true);
              }}
            >
              {fa ? "تأیید با تولید عکس" : "Confirm with images"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
