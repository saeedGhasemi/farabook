// AI suggestions panel: calls book-suggest, lists each suggestion
// with Accept / Reject buttons + "Apply all". Mutations go through
// the Tiptap editor directly so undo (Ctrl+Z) reverts them.
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, Loader2, X, Check, Type, Quote as QuoteIcon, Lightbulb, Heading2, SplitSquareVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SuggestionOp = "make_callout" | "make_quote" | "make_heading" | "emphasize" | "split_paragraph";

interface Suggestion {
  op: SuggestionOp;
  target_text: string;
  reason: string;
  variant?: string;
  level?: 2 | 3;
  mark?: "bold" | "italic" | "underline";
  split_after?: string;
}

interface Props {
  editor: Editor;
  lang: "fa" | "en";
  onClose: () => void;
}

const opMeta: Record<SuggestionOp, { Icon: any; label_fa: string; label_en: string }> = {
  make_callout: { Icon: Lightbulb, label_fa: "تبدیل به نکته", label_en: "Turn into callout" },
  make_quote: { Icon: QuoteIcon, label_fa: "تبدیل به نقل‌قول", label_en: "Turn into quote" },
  make_heading: { Icon: Heading2, label_fa: "تبدیل به تیتر", label_en: "Turn into heading" },
  emphasize: { Icon: Type, label_fa: "تأکید روی عبارت", label_en: "Emphasize phrase" },
  split_paragraph: { Icon: SplitSquareVertical, label_fa: "شکستن پاراگراف", label_en: "Split paragraph" },
};

/** Find a text range in the doc that exactly matches `needle`. Returns [from, to] or null. */
const findRange = (editor: Editor, needle: string): [number, number] | null => {
  if (!needle) return null;
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  // Map plain text index back to PM positions by walking the doc.
  let plainPos = 0;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0 && to >= 0) return false;
    if (node.isText) {
      const len = node.text!.length;
      const end = plainPos + len;
      if (from < 0 && idx >= plainPos && idx <= end) {
        from = pos + (idx - plainPos);
      }
      const targetEnd = idx + needle.length;
      if (from >= 0 && to < 0 && targetEnd >= plainPos && targetEnd <= end) {
        to = pos + (targetEnd - plainPos);
      }
      plainPos = end;
    } else if (node.isBlock && plainPos > 0) {
      // Block separator counts as one char ("\n") for the textBetween call above.
      plainPos += 1;
    }
    return true;
  });
  if (from < 0 || to < 0 || to <= from) return null;
  return [from, to];
};

const applySuggestion = (editor: Editor, s: Suggestion): boolean => {
  const range = findRange(editor, s.target_text);
  if (!range) return false;
  const [from, to] = range;
  const chain = editor.chain().focus().setTextSelection({ from, to });
  switch (s.op) {
    case "make_callout":
      return chain.setNode("callout", { variant: s.variant || "info" }).run();
    case "make_quote":
      return chain.setNode("quote").run();
    case "make_heading":
      return chain.setNode("heading", { level: s.level ?? 2 }).run();
    case "emphasize": {
      const m = s.mark || "bold";
      if (m === "bold") return chain.toggleBold().run();
      if (m === "italic") return chain.toggleItalic().run();
      return chain.toggleUnderline().run();
    }
    case "split_paragraph":
      // Split at end of target_text
      return chain.setTextSelection({ from: to, to }).splitBlock().run();
    default:
      return false;
  }
};

export const AiSuggestPanel = ({ editor, lang, onClose }: Props) => {
  const fa = lang === "fa";
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set());

  const fetchSuggestions = async () => {
    setLoading(true);
    setSuggestions([]);
    setDone(new Set());
    try {
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
      if (text.trim().length < 20) {
        toast.error(fa ? "متن خیلی کوتاه است" : "Text is too short");
        return;
      }
      const { data, error } = await supabase.functions.invoke("book-suggest", {
        body: { text, lang },
      });
      if (error) throw error;
      const list = (data?.suggestions ?? []) as Suggestion[];
      setSuggestions(list);
      if (!list.length) toast.info(fa ? "پیشنهاد جدیدی پیدا نشد" : "No suggestions found");
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطا در دریافت پیشنهادها" : "Failed to fetch suggestions"));
    } finally {
      setLoading(false);
    }
  };

  const accept = (idx: number) => {
    const ok = applySuggestion(editor, suggestions[idx]);
    if (!ok) {
      toast.error(fa ? "متن هدف پیدا نشد" : "Target text not found");
      return;
    }
    setDone((prev) => { const s = new Set(prev); s.add(idx); return s; });
  };
  const reject = (idx: number) => {
    setDone((prev) => { const s = new Set(prev); s.add(idx); return s; });
  };
  const applyAll = () => {
    let applied = 0;
    suggestions.forEach((s, i) => {
      if (done.has(i)) return;
      if (applySuggestion(editor, s)) applied++;
    });
    setDone(new Set(suggestions.map((_, i) => i)));
    toast.success(fa ? `${applied} پیشنهاد اعمال شد` : `${applied} suggestions applied`);
  };

  return (
    <div className="rounded-2xl border bg-card/80 p-4 shadow-paper">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold">{fa ? "دستیار هوشمند صفحه" : "Page AI assistant"}</h3>
        <p className="text-xs text-muted-foreground hidden sm:block">
          {fa ? "بر اساس متن این صفحه پیشنهادهایی برای جذاب‌تر و آموزنده‌تر شدن می‌دهد." : "Suggests enrichments based on this page text."}
        </p>
        <Button variant="ghost" size="icon" className="h-7 w-7 ms-auto" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {!suggestions.length && !loading && (
        <Button onClick={fetchSuggestions} className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Sparkles className="w-4 h-4 me-1.5" />
          {fa ? "تحلیل صفحه و پیشنهاد بده" : "Analyze page & suggest"}
        </Button>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          {fa ? "در حال تحلیل…" : "Analyzing…"}
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={fetchSuggestions} disabled={loading}>
              {fa ? "بازخوانی" : "Refresh"}
            </Button>
            <Button size="sm" onClick={applyAll} className="bg-stage-published text-stage-published-foreground hover:bg-stage-published/90">
              <Check className="w-3.5 h-3.5 me-1" />
              {fa ? "اعمال همه" : "Apply all"}
            </Button>
            <span className="text-xs text-muted-foreground ms-auto">
              {done.size}/{suggestions.length}
            </span>
          </div>

          <ul className="space-y-2">
            {suggestions.map((s, i) => {
              const meta = opMeta[s.op];
              const Icon = meta?.Icon ?? Sparkles;
              const isDone = done.has(i);
              return (
                <li
                  key={i}
                  className={`rounded-xl border p-3 transition ${
                    isDone ? "opacity-50 bg-muted/30" : "bg-background/60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold mb-1">
                        {fa ? meta?.label_fa : meta?.label_en}
                        {s.variant && <span className="ms-2 text-[10px] uppercase text-muted-foreground">{s.variant}</span>}
                        {s.mark && <span className="ms-2 text-[10px] uppercase text-muted-foreground">{s.mark}</span>}
                      </div>
                      <p className="text-sm text-foreground/90 line-clamp-2 leading-relaxed mb-1" dir="auto">
                        “{s.target_text}”
                      </p>
                      <p className="text-[11px] text-muted-foreground">{s.reason}</p>
                    </div>
                    {!isDone && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" className="h-7 px-2 bg-stage-published text-stage-published-foreground hover:bg-stage-published/90" onClick={() => accept(i)}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => reject(i)}>
                          <X className="w-3.5 h-3.5" />
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
  );
};
