// Preview dialog shown from the storefront. Re-designed for a richer,
// magazine-like layout: large cover hero with gradient overlay, tabbed
// content (Summary / Preview / Comments) and clearer CTAs.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Play, Square, BookOpen, ShoppingBag, Check, MessageCircle, Star, Volume2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { speakSmart, stopSpeak } from "@/lib/tts";
import { resolveBookCover } from "@/lib/book-media";
import { useAutoCover } from "@/hooks/useAutoCover";
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

interface BookIdentity {
  subtitle: string | null;
  book_type: string | null;
  contributors: Array<{ name: string; role: string }> | null;
  publisher: string | null;
  publication_year: number | null;
  edition: string | null;
  isbn: string | null;
  page_count: number | null;
  language: string | null;
  original_title: string | null;
  original_language: string | null;
  series_name: string | null;
  series_index: number | null;
  categories: string[] | null;
  subjects: string[] | null;
}

const BOOK_TYPE_FA: Record<string, string> = {
  authored: "تألیف", translation: "ترجمه", compilation: "گردآوری",
  edited: "ویراستاری", adaptation: "اقتباس", anthology: "مجموعه", textbook: "درسی",
};
const BOOK_TYPE_EN: Record<string, string> = {
  authored: "Authored", translation: "Translation", compilation: "Compilation",
  edited: "Edited", adaptation: "Adaptation", anthology: "Anthology", textbook: "Textbook",
};
const ROLE_FA: Record<string, string> = {
  author: "نویسنده", coauthor: "هم‌نویسنده", translator: "مترجم", editor: "ویراستار",
  compiler: "گردآورنده", illustrator: "تصویرگر", foreword: "مقدمه‌نویس", narrator: "گوینده",
};
const ROLE_EN: Record<string, string> = {
  author: "Author", coauthor: "Co-author", translator: "Translator", editor: "Editor",
  compiler: "Compiler", illustrator: "Illustrator", foreword: "Foreword by", narrator: "Narrator",
};

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
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<BookIdentity | null>(null);

  useEffect(() => {
    if (!open || !book) return;
    setSummary(null); setPages([]); setLoading(true); setTtsError(null); setIdentity(null);
    (async () => {
      const [{ data }, { data: cs }] = await Promise.all([
        supabase.from("books").select("pages, ai_summary, preview_pages, subtitle, book_type, contributors, publisher, publication_year, edition, isbn, page_count, language, original_title, original_language, series_name, series_index, categories, subjects").eq("id", book.id).maybeSingle(),
        supabase.from("book_comments").select("rating").eq("book_id", book.id).not("rating", "is", null),
      ]);
      const all = (data?.pages as unknown as PageRow[]) ?? [];
      setPages(all);
      setSummary((data?.ai_summary as string | null) ?? null);
      const pi = (data?.preview_pages as number[] | null) ?? [0];
      const preview = pi && pi.length ? pi : [0, 1];
      setPreviewIdx(preview.filter((i) => i < all.length));
      const ratings = ((cs as Array<{ rating: number | null }>) || []).map((r) => r.rating).filter((r): r is number => !!r);
      setRatingCount(ratings.length);
      setRatingAvg(ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null);
      if (data) {
        setIdentity({
          subtitle: (data as any).subtitle ?? null,
          book_type: (data as any).book_type ?? null,
          contributors: (data as any).contributors ?? null,
          publisher: (data as any).publisher ?? null,
          publication_year: (data as any).publication_year ?? null,
          edition: (data as any).edition ?? null,
          isbn: (data as any).isbn ?? null,
          page_count: (data as any).page_count ?? null,
          language: (data as any).language ?? null,
          original_title: (data as any).original_title ?? null,
          original_language: (data as any).original_language ?? null,
          series_name: (data as any).series_name ?? null,
          series_index: (data as any).series_index ?? null,
          categories: (data as any).categories ?? null,
          subjects: (data as any).subjects ?? null,
        });
      }
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
      if (isOwner) await supabase.from("books").update({ ai_summary: txt }).eq("id", book.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setSummarizing(false);
    }
  };

  const speak = async () => {
    const text = summary || previewText;
    if (!text) return;
    setTtsError(null);
    setSpeaking(true);
    await speakSmart({
      text,
      fallbackLang: fa ? "fa" : "en",
      onEnd: () => setSpeaking(false),
      onError: () => {
        setSpeaking(false);
        setTtsError(fa
          ? "متأسفانه پخش صوتی فارسی در این مرورگر در دسترس نیست."
          : "Speech playback failed for this language.");
      },
    });
  };

  const stop = () => { stopSpeak(); setSpeaking(false); };

  // Hooks must run unconditionally — call before any early return.
  const autoCover = useAutoCover(book?.id ?? "", book?.cover_url ?? null);
  const cover = autoCover ? resolveBookCover(autoCover, { width: 600, quality: 80 }) : null;

  if (!book) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stop(); onOpenChange(o); }}>
      <DialogContent className="max-w-4xl h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* HERO */}
        <div className="relative shrink-0 overflow-hidden">
          {cover && (
            <div
              className="absolute inset-0 bg-cover bg-center scale-110 blur-2xl opacity-40"
              style={{ backgroundImage: `url(${cover})` }}
              aria-hidden
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" aria-hidden />
          <DialogHeader className="relative px-6 pt-6 pb-5">
            <div className="flex items-start gap-5">
              {cover ? (
                <img
                  src={cover}
                  alt={book.title}
                  loading="lazy"
                  decoding="async"
                  className="w-28 h-40 md:w-32 md:h-44 object-cover rounded-xl shadow-2xl ring-1 ring-border flex-shrink-0"
                />
              ) : (
                <div className="w-28 h-40 md:w-32 md:h-44 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0">
                  <BookOpen className="w-10 h-10" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  {book.category && <Badge variant="secondary" className="text-[10px]">{book.category}</Badge>}
                  {ratingAvg !== null && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Star className="w-3 h-3 fill-accent text-accent" />
                      {ratingAvg.toFixed(1)} ({ratingCount.toLocaleString(fa ? "fa-IR" : undefined)})
                    </Badge>
                  )}
                </div>
                <DialogTitle className="font-display text-2xl md:text-3xl leading-tight">{book.title}</DialogTitle>
                <DialogDescription className="mt-1 text-base">{book.author}</DialogDescription>
                {book.description && (
                  <p className="mt-3 text-sm text-foreground/80 line-clamp-2 leading-relaxed">{book.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-base font-bold text-primary">
                    {book.price === 0 ? (fa ? "رایگان" : "Free") : `${book.price.toLocaleString()} ${fa ? "تومان" : "Toman"}`}
                  </span>
                  {isOwned ? (
                    <Link to={`/read/${book.id}`}>
                      <Button size="sm" className="gap-1.5"><Check className="w-3.5 h-3.5" /> {fa ? "مطالعه" : "Read"}</Button>
                    </Link>
                  ) : isOwner ? (
                    <Link to={`/edit/${book.id}`}>
                      <Button size="sm" variant="outline">{fa ? "ویرایش" : "Edit"}</Button>
                    </Link>
                  ) : canBuy ? (
                    <Button size="sm" onClick={onBuy} className="gap-1.5 bg-gradient-warm hover:opacity-90">
                      <ShoppingBag className="w-3.5 h-3.5" />
                      {book.price === 0 ? (fa ? "افزودن به کتابخانه" : "Add to library") : (fa ? "خرید" : "Buy")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="summary" className="flex-1 min-h-0 flex flex-col" dir={fa ? "rtl" : "ltr"}>
            <div className="px-6 border-b shrink-0">
              <TabsList className="h-10">
                <TabsTrigger value="summary" className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {fa ? "خلاصه" : "Summary"}
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> {fa ? "پیش‌نمایش" : "Preview"}
                  <Badge variant="outline" className="ms-1 text-[10px] h-4 px-1">{previewIdx.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="identity" className="gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> {fa ? "شناسنامه" : "Identity"}
                </TabsTrigger>
                <TabsTrigger value="comments" className="gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" /> {fa ? "نظرات" : "Comments"}
                  {ratingCount > 0 && (
                    <Badge variant="outline" className="ms-1 text-[10px] h-4 px-1">{ratingCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
              <TabsContent value="summary" className="mt-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!summary && (
                    <Button size="sm" variant="outline" onClick={generateSummary} disabled={summarizing} className="gap-1.5">
                      {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {fa ? "تولید خلاصه" : "Generate summary"}
                    </Button>
                  )}
                  {speaking ? (
                    <Button size="sm" variant="outline" onClick={stop} className="gap-1.5">
                      <Square className="w-3.5 h-3.5" /> {fa ? "توقف" : "Stop"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={speak} disabled={!summary && !previewText} className="gap-1.5">
                      <Volume2 className="w-3.5 h-3.5" /> {fa ? "خلاصه صوتی" : "Listen"}
                    </Button>
                  )}
                </div>
                {ttsError && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{ttsError}</span>
                  </div>
                )}
                {summary ? (
                  <div className="rounded-2xl border bg-gradient-to-br from-secondary/40 to-secondary/10 p-5">
                    <p className="text-sm leading-loose text-foreground/90 whitespace-pre-wrap">{summary}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {fa
                      ? "هنوز خلاصه‌ای ساخته نشده. روی «تولید خلاصه» بزنید تا هوش مصنوعی خلاصه کوتاهی از کتاب آماده کند."
                      : "No summary yet. Click Generate to create one."}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="preview" className="mt-0 space-y-4">
                {previewIdx.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic text-center py-8">
                    {fa ? "صفحه‌ای برای پیش‌نمایش وجود ندارد." : "No preview pages."}
                  </p>
                ) : (
                  previewIdx.map((i) => {
                    const p = pages[i];
                    if (!p) return null;
                    return (
                      <article key={i} className="paper-card rounded-xl p-5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                          {fa ? `صفحه ${(i + 1).toLocaleString("fa-IR")}` : `Page ${i + 1}`}
                        </div>
                        {p.title && <h4 className="font-display font-bold text-lg mb-3">{p.title}</h4>}
                        <div className="space-y-2 text-sm leading-relaxed">
                          {(p.blocks ?? []).slice(0, 10).map((b, j) => (
                            <BlockRenderer key={j} block={b as Block} fontSize={14} index={j} pageIndex={i} />
                          ))}
                          {(p.blocks?.length ?? 0) > 10 && (
                            <p className="text-xs text-muted-foreground italic">…</p>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </TabsContent>

              <TabsContent value="identity" className="mt-0">
                <IdentityBlock identity={identity} bookTitle={book.title} fa={fa} />
              </TabsContent>

              <TabsContent value="comments" className="mt-0">
                <BookComments bookId={book.id} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ---------- Book identity block ---------- */
const IdentityBlock = ({
  identity, bookTitle, fa,
}: { identity: BookIdentity | null; bookTitle: string; fa: boolean }) => {
  if (!identity) {
    return (
      <p className="text-sm text-muted-foreground italic">
        {fa ? "اطلاعاتی برای نمایش نیست." : "No identity data."}
      </p>
    );
  }
  const grouped = new Map<string, string[]>();
  for (const c of identity.contributors ?? []) {
    if (!c?.name?.trim()) continue;
    const key = c.role || "author";
    const arr = grouped.get(key) ?? [];
    arr.push(c.name.trim());
    grouped.set(key, arr);
  }
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-xs text-muted-foreground min-w-[110px]">{label}</dt>
      <dd className="text-sm font-medium text-foreground/90 flex-1">{value}</dd>
    </div>
  );
  const fmtNum = (n: number) => n.toLocaleString(fa ? "fa-IR" : undefined);
  const bookTypeLabel = identity.book_type
    ? (fa ? BOOK_TYPE_FA[identity.book_type] : BOOK_TYPE_EN[identity.book_type]) || identity.book_type
    : null;

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-secondary/30 to-secondary/5 p-5">
      <h3 className="font-display font-bold text-base mb-1">{fa ? "شناسنامه کتاب" : "Book identity"}</h3>
      {identity.subtitle && (
        <p className="text-sm text-muted-foreground italic mb-3">{identity.subtitle}</p>
      )}
      <dl className="space-y-0.5">
        {bookTypeLabel && <Row label={fa ? "نوع کتاب" : "Type"} value={bookTypeLabel} />}
        {[...grouped.entries()].map(([role, names]) => (
          <Row
            key={role}
            label={fa ? (ROLE_FA[role] ?? role) : (ROLE_EN[role] ?? role)}
            value={names.join("، ")}
          />
        ))}
        {identity.publisher && <Row label={fa ? "ناشر" : "Publisher"} value={identity.publisher} />}
        {identity.publication_year != null && (
          <Row label={fa ? "سال انتشار" : "Year"} value={fmtNum(identity.publication_year)} />
        )}
        {identity.edition && <Row label={fa ? "نوبت چاپ" : "Edition"} value={identity.edition} />}
        {identity.isbn && <Row label="ISBN" value={identity.isbn} />}
        {identity.page_count != null && (
          <Row label={fa ? "تعداد صفحات" : "Pages"} value={fmtNum(identity.page_count)} />
        )}
        {identity.language && <Row label={fa ? "زبان" : "Language"} value={identity.language} />}
        {(identity.original_title || identity.original_language) && (
          <Row
            label={fa ? "اثر اصلی" : "Original"}
            value={[identity.original_title, identity.original_language && `(${identity.original_language})`].filter(Boolean).join(" ")}
          />
        )}
        {identity.series_name && (
          <Row
            label={fa ? "مجموعه" : "Series"}
            value={`${identity.series_name}${identity.series_index != null ? ` — ${fa ? "جلد" : "vol."} ${fmtNum(identity.series_index)}` : ""}`}
          />
        )}
        {identity.categories?.length ? (
          <Row
            label={fa ? "دسته‌بندی" : "Categories"}
            value={
              <div className="flex flex-wrap gap-1">
                {identity.categories.map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            }
          />
        ) : null}
        {identity.subjects?.length ? (
          <Row
            label={fa ? "موضوعات" : "Subjects"}
            value={
              <div className="flex flex-wrap gap-1">
                {identity.subjects.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            }
          />
        ) : null}
      </dl>
      {grouped.size === 0 && !identity.publisher && !identity.isbn && (
        <p className="text-xs text-muted-foreground mt-2">
          {fa ? `هنوز شناسنامه‌ای برای «${bookTitle}» ثبت نشده است.` : `No identity recorded yet for "${bookTitle}".`}
        </p>
      )}
    </div>
  );
};
