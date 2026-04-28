// Preview dialog shown from the storefront. Lets visitors see the
// first few pages of a book, generate / read its AI summary, and
// listen to it as a spoken narration via the smart TTS helper.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Play, Square, BookOpen, ShoppingBag, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { speakSmart, stopSpeak } from "@/lib/tts";
import { resolveBookCover } from "@/lib/book-media";
import { BookComments } from "@/components/BookComments";
import { BlockRenderer, type Block } from "@/components/reader/BlockRenderer";
import { toast } from "sonner";

interface PreviewBook {
  id: string;
  title: string;
  author: string;
  cover_url: string | null;
  description: string | null;
  category: string | null;
  price: number;
  publisher_id: string | null;
}

interface Props {
  book: PreviewBook | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  isOwned: boolean;
  isOwner: boolean;
  canBuy: boolean;
  onBuy: () => void;
}

type PageBlock = Partial<Block> & { type: string; text?: string; src?: string; caption?: string };
interface PageRow { title?: string; blocks?: PageBlock[] }

const blocksToText = (blocks: PageBlock[] = []) =>
  blocks
    .filter((b) => b.type === "paragraph" || b.type === "heading" || b.type === "quote" || b.type === "callout")
    .map((b) => b.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

export const BookPreviewDialog = ({ book, open, onOpenChange, isOwned, isOwner, canBuy, onBuy }: Props) => {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [previewIdx, setPreviewIdx] = useState<number[]>([0]);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!open || !book) return;
    setSummary(null);
    setPages([]);
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("books")
        .select("pages, ai_summary, preview_pages")
        .eq("id", book.id)
        .maybeSingle();
      const all = (data?.pages as unknown as PageRow[]) ?? [];
      setPages(all);
      setSummary((data?.ai_summary as string | null) ?? null);
      const pi = (data?.preview_pages as number[] | null) ?? [0];
      // Always allow at least the first 2 pages as preview
      const preview = pi && pi.length ? pi : [0, 1];
      setPreviewIdx(preview.filter((i) => i < all.length));
      setLoading(false);
    })();
    return () => { stopSpeak(); setSpeaking(false); };
  }, [open, book]);

  const previewText = useMemo(() => {
    return previewIdx.map((i) => pages[i]).filter(Boolean)
      .map((p) => `${p.title ?? ""}. ${blocksToText(p.blocks)}`)
      .join("\n\n");
  }, [pages, previewIdx]);

  const generateSummary = async () => {
    if (!book) return;
    setSummarizing(true);
    try {
      const sample = pages.slice(0, 5).map((p) => `${p.title ?? ""}\n${blocksToText(p.blocks)}`).join("\n\n").slice(0, 6000);
      const { data, error } = await supabase.functions.invoke("book-ai", {
        body: { text: sample || (book.description ?? book.title), mode: "summary", lang },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const txt: string = data?.content ?? "";
      setSummary(txt);
      // Persist if owner — RLS allows owner update
      if (isOwner) {
        await supabase.from("books").update({ ai_summary: txt }).eq("id", book.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setSummarizing(false);
    }
  };

  const speak = async () => {
    const text = summary || previewText;
    if (!text) return;
    setSpeaking(true);
    await speakSmart({
      text,
      fallbackLang: fa ? "fa" : "en",
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const stop = () => { stopSpeak(); setSpeaking(false); };

  if (!book) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stop(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogHeader>
            <div className="flex items-start gap-4">
              {book.cover_url && (
                <img
                  src={resolveBookCover(book.cover_url, { width: 200, quality: 75 })}
                  alt={book.title}
                  loading="lazy"
                  decoding="async"
                  className="w-20 h-28 object-cover rounded-lg shadow-md flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <DialogTitle className="font-display text-2xl">{book.title}</DialogTitle>
                <DialogDescription className="mt-1">
                  {book.author}
                  {book.category && <Badge variant="secondary" className="ms-2">{book.category}</Badge>}
                </DialogDescription>
                <p className="text-xs text-primary font-semibold mt-2">
                  {book.price === 0 ? (fa ? "رایگان" : "Free") : `${book.price.toLocaleString()} ${fa ? "تومان" : "Toman"}`}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            {/* AI summary */}
            <section className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  {fa ? "خلاصه هوش مصنوعی" : "AI Summary"}
                </h3>
                <div className="flex gap-2">
                  {!summary && (
                    <Button size="sm" variant="outline" onClick={generateSummary} disabled={summarizing}>
                      {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1.5" /> : <Sparkles className="w-3.5 h-3.5 me-1.5" />}
                      {fa ? "تولید" : "Generate"}
                    </Button>
                  )}
                  {speaking ? (
                    <Button size="sm" variant="outline" onClick={stop}>
                      <Square className="w-3.5 h-3.5 me-1.5" />
                      {fa ? "توقف" : "Stop"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={speak} disabled={!summary && !previewText}>
                      <Play className="w-3.5 h-3.5 me-1.5" />
                      {fa ? "خلاصه صوتی" : "Listen"}
                    </Button>
                  )}
                </div>
              </div>
              {summary ? (
                <p className="text-sm leading-relaxed text-foreground/90 bg-secondary/40 rounded-xl p-4">{summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {fa
                    ? "هنوز خلاصه‌ای ساخته نشده. روی «تولید» بزنید تا هوش مصنوعی یک خلاصه کوتاه از کتاب بسازد."
                    : "No summary yet. Click Generate to let AI write a short summary."}
                </p>
              )}
            </section>

            <Separator className="my-4" />

            {/* Preview pages */}
            <section>
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-accent" />
                {fa ? "پیش‌نمایش کتاب" : "Book Preview"}
                <Badge variant="outline" className="text-xs ms-auto">
                  {previewIdx.length} {fa ? "صفحه" : "pages"}
                </Badge>
              </h3>
              <div className="space-y-5">
                {previewIdx.map((i) => {
                  const p = pages[i];
                  if (!p) return null;
                  return (
                    <article key={i} className="paper-card rounded-xl p-4">
                      {p.title && <h4 className="font-display font-bold text-lg mb-2">{p.title}</h4>}
                      <div className="space-y-2 text-sm leading-relaxed">
                        {(p.blocks ?? []).slice(0, 8).map((b, j) => (
                          <BlockRenderer key={j} block={b as Block} fontSize={14} index={j} pageIndex={i} />
                        ))}
                        {(p.blocks?.length ?? 0) > 8 && (
                          <p className="text-xs text-muted-foreground italic">…</p>
                        )}
                      </div>
                    </article>
                  );
                })}
                {previewIdx.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    {fa ? "صفحه‌ای برای پیش‌نمایش وجود ندارد." : "No pages available for preview."}
                  </p>
                )}
              </div>
            </section>

            <Separator className="my-4" />
            <BookComments bookId={book.id} />
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          {isOwned ? (
            <Link to={`/read/${book.id}`}>
              <Button className="gap-1.5"><Check className="w-3.5 h-3.5" /> {fa ? "مطالعه" : "Read"}</Button>
            </Link>
          ) : isOwner ? (
            <Link to={`/edit/${book.id}`}>
              <Button variant="outline">{fa ? "ویرایش" : "Edit"}</Button>
            </Link>
          ) : canBuy ? (
            <Button onClick={onBuy} className="gap-1.5 bg-gradient-warm hover:opacity-90">
              <ShoppingBag className="w-3.5 h-3.5" />
              {book.price === 0 ? (fa ? "افزودن به کتابخانه" : "Add to library") : (fa ? "خرید" : "Buy")}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
