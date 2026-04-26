// Publish wizard: review metadata, set price/audience/category/tags,
// pick which pages are public preview, generate AI summary + audio,
// then push to "published" status via the book-publish edge function.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Loader2, Rocket, Sparkles, Volume2, X, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { speakSmart, stopSpeak } from "@/lib/tts";
import { RevenueShareEditor } from "@/components/publish/RevenueShareEditor";
import { estimateComplexity, showInsufficientCreditsToast } from "@/lib/credit-guard";
import { pulseCredits, requestCreditsRefresh } from "@/lib/credits-bus";
import { ConfirmTransactionDialog } from "@/components/ConfirmTransactionDialog";
import { useCredits } from "@/hooks/useCredits";

interface BookRow {
  id: string;
  title: string;
  title_en: string | null;
  author: string;
  publisher: string | null;
  publisher_id: string | null;
  description: string | null;
  category: string | null;
  audience: string | null;
  isbn: string | null;
  language: string | null;
  tags: string[] | null;
  price: number;
  preview_pages: number[] | null;
  pages: any[];
  status: string;
  ai_summary: string | null;
  ai_audio_url: string | null;
  author_user_id: string | null;
  first_published_paid: boolean;
}

const Publish = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { lang, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<BookRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [estimatedFactor, setEstimatedFactor] = useState(1);
  const { credits } = useCredits();

  // Form
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [isbn, setIsbn] = useState("");
  const [language, setLanguage] = useState<"fa" | "en">("fa");
  const [tagsInput, setTagsInput] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [previewPages, setPreviewPages] = useState<number[]>([0]);

  // AI options
  const [genSummary, setGenSummary] = useState(true);
  const [genAudio, setGenAudio] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<"lovable" | "browser">("lovable");

  // Browser TTS preview
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (!user) { nav("/auth"); return; }
    (async () => {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        toast.error(lang === "fa" ? "کتاب یافت نشد" : "Book not found");
        nav("/library");
        return;
      }
      if (data.publisher_id !== user.id) {
        toast.error(lang === "fa" ? "اجازه دسترسی ندارید" : "Forbidden");
        nav("/library");
        return;
      }
      const b = data as unknown as BookRow;
      setBook(b);
      setTitle(b.title || "");
      setTitleEn(b.title_en || "");
      setAuthor(b.author || "");
      setPublisher(b.publisher || "");
      setDescription(b.description || "");
      setCategory(b.category || "");
      setAudience(b.audience || "");
      setIsbn(b.isbn || "");
      setLanguage((b.language as any) || "fa");
      setTagsInput((b.tags || []).join(", "));
      setPrice(Number(b.price) || 0);
      setPreviewPages(b.preview_pages?.length ? b.preview_pages : [0]);
      setLoading(false);
    })();
  }, [id, user, nav, lang]);

  const togglePreviewPage = (i: number) => {
    setPreviewPages((cur) =>
      cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b),
    );
  };

  const openPublishConfirm = async () => {
    if (!book) return;
    if (!title.trim()) { toast.error(lang === "fa" ? "عنوان لازم است" : "Title required"); return; }
    // Already paid → skip confirm (no fee)
    if (book.first_published_paid) { setEstimatedFee(0); setEstimatedFactor(1); setConfirmOpen(true); return; }
    const factor = estimateComplexity(book.pages || []);
    setEstimatedFactor(factor);
    // Pull current fee settings
    const { data: fee } = await supabase.from("platform_fee_settings").select("book_publish_mode, book_publish_value").eq("id", 1).maybeSingle();
    const base = Number(book.price) || 0;
    const mode = (fee as any)?.book_publish_mode || "fixed";
    const value = Number((fee as any)?.book_publish_value || 50);
    const baseFee = mode === "percent" ? Math.round((base * value) / 100) : Math.round(value);
    setEstimatedFee(Math.max(0, baseFee * factor));
    setConfirmOpen(true);
  };

  const handlePublish = async () => {
    if (!book) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      // 1) First-time publish fee (auto complexity, deducted from publisher)
      if (!book.first_published_paid) {
        const complexity = estimateComplexity(book.pages || []);
        const { data: payRes, error: payErr } = await (supabase.rpc as any)(
          "publish_book_paid",
          { _book_id: book.id, _complexity: complexity },
        );
        if (payErr) {
          if (String(payErr.message).includes("insufficient_credits")) {
            showInsufficientCreditsToast(lang, estimatedFee, (to) => nav(to));
            setBusy(false);
            return;
          }
          throw payErr;
        }
        const fee = Number((payRes as any)?.fee || 0);
        const newBal = Number((payRes as any)?.new_balance || 0);
        if (fee > 0) {
          pulseCredits({ delta: -fee, newBalance: newBal });
          requestCreditsRefresh();
          toast.success(
            lang === "fa"
              ? `هزینه انتشار (${fee.toLocaleString("fa-IR")} اعتبار، ضریب ${complexity}×) کسر شد`
              : `Publish fee ${fee.toLocaleString()} (factor ${complexity}×) deducted`,
          );
        }
      }

      // 2) Push metadata + AI generation through the edge function
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke("book-publish", {
        body: {
          bookId: book.id,
          metadata: {
            title, title_en: titleEn || null, author,
            publisher: publisher || null,
            description: description || null,
            category: category || null,
            audience: audience || null,
            isbn: isbn || null,
            language,
            tags,
            price,
            preview_pages: previewPages,
          },
          generateSummary: genSummary,
          generateAudio: genAudio && ttsProvider === "lovable",
          ttsProvider,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(lang === "fa" ? "کتاب منتشر شد 🎉" : "Book published 🎉");
      nav(`/read/${book.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const previewSpeak = () => {
    const sample = description || title;
    if (!sample) return;
    setSpeaking(true);
    speakSmart({
      text: sample,
      fallbackLang: language,
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };
  const stopPreviewSpeak = () => { stopSpeak(); setSpeaking(false); };

  if (loading || !book) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="container py-8 md:py-12 min-h-[calc(100vh-4rem)] max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <Back className="w-4 h-4 me-1.5" />
            {lang === "fa" ? "بازگشت" : "Back"}
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
              <Rocket className="w-5 h-5 text-accent" />
              {lang === "fa" ? "انتشار کتاب" : "Publish Book"}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {lang === "fa"
                ? "اطلاعات نهایی، قیمت و گزینه‌های هوش مصنوعی را تنظیم کنید."
                : "Finalize metadata, price, and AI options."}
            </p>
          </div>
        </div>
        <Badge variant={book.status === "published" ? "default" : "outline"}>
          {book.status === "published"
            ? (lang === "fa" ? "منتشر شده" : "Published")
            : (lang === "fa" ? "پیش‌نویس" : "Draft")}
        </Badge>
      </motion.div>

      <div className="space-y-6">
        {/* Core metadata */}
        <section className="glass-strong rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-bold text-lg">
            {lang === "fa" ? "مشخصات اصلی" : "Core metadata"}
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>{lang === "fa" ? "عنوان *" : "Title *"}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{lang === "fa" ? "عنوان انگلیسی" : "English title"}</Label>
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{lang === "fa" ? "نویسنده" : "Author"}</Label>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{lang === "fa" ? "ناشر" : "Publisher"}</Label>
              <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{lang === "fa" ? "دسته‌بندی" : "Category"}</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={lang === "fa" ? "مثلاً پاتولوژی، ادبیات…" : "e.g. Pathology, Fiction…"}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{lang === "fa" ? "مخاطب" : "Audience"}</Label>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder={lang === "fa" ? "دانشجو / عمومی / متخصص" : "Student / General / Professional"}
                className="mt-1"
              />
            </div>
            <div>
              <Label>ISBN</Label>
              <Input value={isbn} onChange={(e) => setIsbn(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{lang === "fa" ? "زبان" : "Language"}</Label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div>
            <Label>{lang === "fa" ? "توضیحات کوتاه" : "Short description"}</Label>
            <Textarea
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{lang === "fa" ? "برچسب‌ها (با کاما جدا کنید)" : "Tags (comma-separated)"}</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={lang === "fa" ? "مثال: خون‌شناسی، آناتومی" : "e.g. hematology, anatomy"}
              className="mt-1"
            />
          </div>
        </section>

        {/* Pricing */}
        <section className="glass-strong rounded-2xl p-5 space-y-3">
          <h2 className="font-display font-bold text-lg">
            {lang === "fa" ? "قیمت‌گذاری" : "Pricing"}
          </h2>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="max-w-[200px]"
            />
            <span className="text-sm text-muted-foreground">
              {lang === "fa" ? "تومان (۰ = رایگان)" : "Toman (0 = free)"}
            </span>
          </div>
        </section>

        {/* Revenue split */}
        <section className="glass-strong rounded-2xl p-5 space-y-3">
          <h2 className="font-display font-bold text-lg">
            {lang === "fa" ? "سهم‌بندی درآمد" : "Revenue split"}
          </h2>
          <RevenueShareEditor
            bookId={book.id}
            publisherId={book.publisher_id || user!.id}
            authorUserId={book.author_user_id}
            lang={lang}
          />
        </section>

        {/* Preview pages */}
        <section className="glass-strong rounded-2xl p-5 space-y-3">
          <h2 className="font-display font-bold text-lg">
            {lang === "fa" ? "صفحات پیش‌نمایش رایگان" : "Free preview pages"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {lang === "fa"
              ? "صفحاتی که کاربران قبل از خرید می‌توانند ببینند را تیک بزنید."
              : "Pick which pages anyone can preview before buying."}
          </p>
          <div className="flex flex-wrap gap-2">
            {(book.pages || []).map((p, i) => {
              const active = previewPages.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => togglePreviewPage(i)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                    active
                      ? "bg-accent/15 border-accent text-foreground"
                      : "bg-background/40 border-border text-muted-foreground hover:border-accent/40"
                  }`}
                >
                  <span className="tabular-nums me-1">{i + 1}.</span>
                  <span className="line-clamp-1 inline-block max-w-[180px] align-middle">
                    {p?.title || (lang === "fa" ? "بدون عنوان" : "Untitled")}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* AI options */}
        <section className="glass-strong rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            {lang === "fa" ? "گزینه‌های هوش مصنوعی" : "AI options"}
          </h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={genSummary}
              onChange={(e) => setGenSummary(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                {lang === "fa" ? "تولید خلاصه ۲–۳ پاراگرافی" : "Generate 2–3 paragraph summary"}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === "fa"
                  ? "از کل متن کتاب، یک خلاصه‌ی توصیفی و گیرا با هوش مصنوعی ساخته می‌شود."
                  : "AI creates a captivating descriptive summary from the full manuscript."}
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={genAudio}
              onChange={(e) => setGenAudio(e.target.checked)}
              disabled={!genSummary}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                {lang === "fa" ? "روایت صوتی خلاصه" : "Audio narration of summary"}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === "fa"
                  ? "روش تولید صدا را انتخاب کنید."
                  : "Choose how the audio is produced."}
              </p>
              {genAudio && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { v: "lovable", fa: "صدای طبیعی AI", en: "AI natural voice" },
                    { v: "browser", fa: "صدای مرورگر (رایگان)", en: "Browser voice (free)" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setTtsProvider(opt.v as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        ttsProvider === opt.v
                          ? "bg-accent text-accent-foreground border-accent"
                          : "bg-background/40 border-border hover:border-accent/40"
                      }`}
                    >
                      {lang === "fa" ? opt.fa : opt.en}
                    </button>
                  ))}
                  {ttsProvider === "browser" && (description || title) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={speaking ? stopPreviewSpeak : previewSpeak}
                      className="h-8"
                    >
                      {speaking ? <X className="w-3.5 h-3.5 me-1" /> : <Volume2 className="w-3.5 h-3.5 me-1" />}
                      {speaking
                        ? (lang === "fa" ? "توقف" : "Stop")
                        : (lang === "fa" ? "پیش‌نمایش صدا" : "Preview voice")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </label>

          {book.ai_summary && (
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
              <div className="text-xs uppercase text-accent font-semibold mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {lang === "fa" ? "خلاصه قبلی موجود" : "Existing summary"}
              </div>
              <p className="text-xs leading-relaxed text-foreground/80 line-clamp-3">
                {book.ai_summary}
              </p>
            </div>
          )}
        </section>

        {/* Submit */}
        <div className="sticky bottom-4 z-30">
          <div className="glass-strong rounded-2xl p-3 flex items-center justify-between gap-3 shadow-elegant">
            <p className="text-xs text-muted-foreground">
              {lang === "fa"
                ? "پس از انتشار، کتاب در فروشگاه قابل مشاهده می‌شود."
                : "After publishing, the book becomes visible in the store."}
            </p>
            <Button
              onClick={handlePublish}
              disabled={busy}
              className="bg-gradient-warm hover:opacity-90 gap-2"
            >
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {lang === "fa" ? "در حال انتشار…" : "Publishing…"}</>
              ) : (
                <><Rocket className="w-4 h-4" /> {lang === "fa" ? "انتشار" : "Publish"}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Publish;
