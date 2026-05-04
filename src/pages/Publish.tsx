// Publish wizard: review metadata, set price/audience/category/tags,
// pick which pages are public preview, generate AI summary + audio,
// then push to "published" status via the book-publish edge function.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Loader2, Rocket, Sparkles, Volume2, X, CheckCircle2,
  Circle, Tag, PieChart, BookMarked,
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
import {
  BookMetadataForm,
  DEFAULT_METADATA,
  normalizeMetadata,
  formatContributorsLine,
  type BookMetadata,
} from "@/components/book-metadata/BookMetadataForm";

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
  // rich metadata (added)
  subtitle: string | null;
  book_type: string | null;
  contributors: any;
  publication_year: number | null;
  edition: string | null;
  page_count: number | null;
  series_name: string | null;
  series_index: number | null;
  original_title: string | null;
  original_language: string | null;
  categories: string[] | null;
  subjects: string[] | null;
}

const Publish = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<BookRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [estimatedFactor, setEstimatedFactor] = useState(1);
  const { credits } = useCredits();

  // Rich book metadata
  const [meta, setMeta] = useState<BookMetadata>(DEFAULT_METADATA);
  const [titleEn, setTitleEn] = useState("");
  const [audience, setAudience] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [previewPages, setPreviewPages] = useState<number[]>([0]);
  const [sharesSaved, setSharesSaved] = useState(false);
  const [saleMode, setSaleMode] = useState<"free" | "paid" | null>(null);

  // AI options
  const [genSummary, setGenSummary] = useState(true);
  const [genAudio, setGenAudio] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<"lovable" | "browser">("lovable");

  // Browser TTS preview
  const [speaking, setSpeaking] = useState(false);

  // Step completion
  const priceStepDone = saleMode === "free" || (saleMode === "paid" && price > 0);
  const sharesStepDone = saleMode === "free" || (saleMode === "paid" && sharesSaved);
  const previewStepDone = (previewPages?.length ?? 0) > 0;
  const allStepsDone = priceStepDone && sharesStepDone && previewStepDone && !!meta.title.trim();

  const Step = ({
    n, done, icon: Icon, title: t, hint, anchor,
  }: { n: number; done: boolean; icon: any; title: string; hint: string; anchor: string }) => (
    <a
      href={`#${anchor}`}
      className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
        done
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-background/40 hover:border-accent/40"
      }`}
    >
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
        done ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/70"
      }`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : n}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-accent" />
          {t}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{hint}</p>
      </div>
    </a>
  );

  useEffect(() => {
    if (!id) return;
    if (authLoading) return;
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
      // Hydrate the rich metadata form from the row
      setMeta(normalizeMetadata({
        title: b.title || "",
        subtitle: b.subtitle || "",
        description: b.description || "",
        book_type: (b.book_type as any) || "authored",
        contributors: Array.isArray(b.contributors) && b.contributors.length
          ? (b.contributors as any)
          : (b.author ? [{ name: b.author, role: "author" }] : [{ name: "", role: "author" }]),
        publisher: b.publisher || "",
        publication_year: b.publication_year ?? null,
        edition: b.edition || "",
        isbn: b.isbn || "",
        page_count: b.page_count ?? null,
        language: b.language || "fa",
        original_title: b.original_title || "",
        original_language: b.original_language || "",
        categories: (b.categories?.length ? b.categories : (b.category ? [b.category] : [])) as string[],
        subjects: (b.subjects || []) as string[],
        series_name: b.series_name || "",
        series_index: b.series_index ?? null,
      }));
      setTitleEn(b.title_en || "");
      setCategory(b.category || "");
      setAudience(b.audience || "");
      setTagsInput((b.tags || []).join(", "));
      const loadedPrice = Number(b.price) || 0;
      setPrice(loadedPrice);
      setSaleMode(b.status === "published" || b.first_published_paid ? (loadedPrice > 0 ? "paid" : "free") : (loadedPrice > 0 ? "paid" : null));
      setPreviewPages(b.preview_pages?.length ? b.preview_pages : [0]);
      if (b.status === "published") setSharesSaved(true);
      setLoading(false);
    })();
  }, [id, user, authLoading, nav, lang]);

  const togglePreviewPage = (i: number) => {
    setPreviewPages((cur) =>
      cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b),
    );
  };

  const openPublishConfirm = async () => {
    if (!book) return;
    if (!allStepsDone) {
      toast.error(lang === "fa" ? "ابتدا قیمت، سهم‌بندی و پیش‌نمایش را کامل کنید" : "Complete pricing, shares, and preview first");
      return;
    }
    if (!meta.title.trim()) { toast.error(lang === "fa" ? "عنوان لازم است" : "Title required"); return; }
    // Already paid → skip confirm (no fee)
    if (book.first_published_paid) { setEstimatedFee(0); setEstimatedFactor(1); setConfirmOpen(true); return; }
    const factor = estimateComplexity(book.pages || []);
    setEstimatedFactor(factor);
    // Pull current fee settings
    const { data: fee } = await supabase.from("platform_fee_settings").select("book_publish_mode, book_publish_value").eq("id", 1).maybeSingle();
    const base = Number(price) || 0;
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
      const primaryAuthor = (meta.contributors?.find((c) => c.role === "author")?.name) || meta.contributors?.[0]?.name || "";
      const { data, error } = await supabase.functions.invoke("book-publish", {
        body: {
          bookId: book.id,
          metadata: {
            title: meta.title,
            title_en: titleEn || null,
            author: primaryAuthor,
            subtitle: meta.subtitle || null,
            book_type: meta.book_type,
            contributors: meta.contributors,
            publisher: meta.publisher || null,
            description: meta.description || null,
            category: category || (meta.categories?.[0] ?? null),
            categories: meta.categories,
            subjects: meta.subjects,
            audience: audience || null,
            isbn: meta.isbn || null,
            publication_year: meta.publication_year ?? null,
            edition: meta.edition || null,
            page_count: meta.page_count ?? null,
            series_name: meta.series_name || null,
            series_index: meta.series_index ?? null,
            original_title: meta.original_title || null,
            original_language: meta.original_language || null,
            language: meta.language || "fa",
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
        className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <Back className="w-4 h-4 me-1.5" />
            {lang === "fa" ? "بازگشت" : "Back"}
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
              <Rocket className="w-5 h-5 text-accent" />
              {lang === "fa" ? "قیمت، سهام و انتشار" : "Price, shares & publish"}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {lang === "fa"
                ? "بعد از پایان ویرایش محتوا، اینجا قیمت، فروشگاه و سهم ذینفع‌ها نهایی می‌شود."
                : "After content editing, finalize price, storefront, and stakeholder shares here."}
            </p>
          </div>
        </div>
        <Badge variant={book.status === "published" ? "default" : "outline"}>
          {book.status === "published"
            ? (lang === "fa" ? "منتشر شده" : "Published")
            : (lang === "fa" ? "پیش‌نویس" : "Draft")}
        </Badge>
      </motion.div>

      {/* Step-by-step guide */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-2xl p-4 mb-6"
      >
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            {lang === "fa" ? "راهنمای انتشار — ۳ قدم" : "Publishing guide — 3 steps"}
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {lang === "fa"
              ? "اول قیمت یا رایگان بودن را انتخاب کنید، بعد سهم‌بندی را ذخیره کنید؛ دکمه نهایی فقط بعد از تکمیل فعال می‌شود."
              : "Publish unlocks when all three steps are checked."}
          </span>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          <Step
            n={1}
            done={priceStepDone}
            icon={Tag}
            anchor="step-price"
            title={lang === "fa" ? "قیمت کتاب" : "Book price"}
            hint={
              lang === "fa"
                ? "در بخش «قیمت‌گذاری» مبلغ را به تومان وارد کنید (۰ = رایگان)."
                : "Enter the price in Toman in the Pricing section (0 = free)."
            }
          />
          <Step
            n={2}
            done={sharesStepDone}
            icon={PieChart}
            anchor="step-shares"
            title={lang === "fa" ? "درصد سهام / سهم‌ها" : "Revenue split"}
            hint={
              lang === "fa"
                ? "در «سهم‌بندی درآمد»، درصد نویسنده/ادیتور را وارد کرده و «ذخیره» را بزنید. باقی‌مانده خودکار سهم ناشر است. (برای کتاب رایگان لازم نیست)"
                : "Set author/editor percentages in Revenue split and click Save. Remainder goes to publisher. (Skipped for free books)"
            }
          />
          <Step
            n={3}
            done={previewStepDone}
            icon={BookMarked}
            anchor="step-preview"
            title={lang === "fa" ? "صفحات پیش‌نمایش" : "Preview pages"}
            hint={
              lang === "fa"
                ? "حداقل یک صفحه را به‌عنوان نمونه‌ی رایگان فروشگاه انتخاب کنید."
                : "Pick at least one page as a free store sample."
            }
          />
        </div>
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
        <section id="step-price" className="glass-strong rounded-2xl p-5 space-y-3 scroll-mt-24">
          <h2 className="font-display font-bold text-lg">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-accent-foreground text-xs me-2">1</span>
            {lang === "fa" ? "قیمت‌گذاری" : "Pricing"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {lang === "fa"
              ? "قیمت کتاب را به تومان وارد کنید. عدد ۰ یعنی کتاب رایگان منتشر می‌شود."
              : "Enter the book price in Toman. Use 0 to publish for free."}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setSaleMode("free"); setPrice(0); }}
              className={`rounded-xl border p-4 text-start transition-all ${
                saleMode === "free" ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40"
              }`}
            >
              <div className="font-semibold text-sm">{lang === "fa" ? "کتاب رایگان" : "Free book"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {lang === "fa" ? "قیمت صفر می‌شود و سهم‌بندی درآمد لازم نیست." : "Price is zero and revenue split is skipped."}
              </p>
            </button>
            <button
              type="button"
              onClick={() => { setSaleMode("paid"); if (price <= 0) setPrice(10000); setSharesSaved(false); }}
              className={`rounded-xl border p-4 text-start transition-all ${
                saleMode === "paid" ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40"
              }`}
            >
              <div className="font-semibold text-sm">{lang === "fa" ? "کتاب فروشی / پولی" : "Paid book"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {lang === "fa" ? "قیمت را وارد کنید و بعد سهم نویسنده/ادیتور را ذخیره کنید." : "Enter price, then save author/editor shares."}
              </p>
            </button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Input
              type="number"
              min={0}
              step={1000}
              value={price}
              disabled={saleMode === "free"}
              onChange={(e) => { setSaleMode("paid"); setPrice(Number(e.target.value) || 0); setSharesSaved(false); }}
              className="sm:max-w-[220px]"
            />
            <span className="text-sm text-muted-foreground">
              {lang === "fa" ? "تومان (۰ = رایگان)" : "Toman (0 = free)"}
            </span>
          </div>
        </section>

        {/* Revenue split */}
        <section id="step-shares" className="glass-strong rounded-2xl p-5 space-y-3 scroll-mt-24">
          <h2 className="font-display font-bold text-lg">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-accent-foreground text-xs me-2">2</span>
            {lang === "fa" ? "سهم‌بندی درآمد" : "Revenue split"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {lang === "fa"
              ? "درصد سهم نویسنده و ادیتورها را تعیین و دکمه «ذخیره سهم‌بندی» را بزنید. درصد باقی‌مانده به‌صورت خودکار سهم ناشر (شما) خواهد بود. سهم پلتفرم از پیش از مجموع کسر شده است."
              : "Set the author/editor percentages and click Save. Whatever remains is the publisher's share. The platform fee is already reserved."}
          </p>
          {saleMode !== "paid" && (
            <div className="text-[11px] rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-accent">
              {lang === "fa"
                ? "اگر کتاب رایگان باشد، سهم‌بندی درآمد لازم نیست. برای کتاب پولی اول در قدم ۱ گزینه «کتاب فروشی / پولی» را انتخاب کنید."
                : "Free books do not need revenue split. For a paid book, select Paid book in step 1 first."}
            </div>
          )}
          {saleMode === "paid" ? (
            <RevenueShareEditor
              bookId={book.id}
              publisherId={book.publisher_id || user!.id}
              authorUserId={book.author_user_id}
              lang={lang}
              onSavedChange={() => setSharesSaved(true)}
            />
          ) : null}
        </section>

        {/* Preview pages */}
        <section id="step-preview" className="glass-strong rounded-2xl p-5 space-y-3 scroll-mt-24">
          <h2 className="font-display font-bold text-lg">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-accent-foreground text-xs me-2">3</span>
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
              {allStepsDone
                ? (lang === "fa"
                    ? "همه‌چیز آماده است. حالا دکمه نهایی انتشار فعال است."
                    : "Everything's ready. After publishing, your book becomes visible in the store.")
                : (lang === "fa"
                    ? `${[!priceStepDone && "۱) تعیین رایگان/پولی و قیمت", !sharesStepDone && "۲) ذخیره سهم‌بندی", !previewStepDone && "۳) پیش‌نمایش"].filter(Boolean).join(" • ")} باقی مانده`
                    : `Pending: ${[!priceStepDone && "Price", !sharesStepDone && "Shares", !previewStepDone && "Preview"].filter(Boolean).join(" • ")}`)}
            </p>
            <Button
              onClick={openPublishConfirm}
              disabled={busy || !allStepsDone}
              className="bg-gradient-warm hover:opacity-90 gap-2"
              title={!allStepsDone ? (lang === "fa" ? "اول سه قدم قیمت، سهم‌بندی و پیش‌نمایش را تکمیل کنید" : "Complete price, shares, and preview first") : undefined}
            >
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {lang === "fa" ? "در حال انتشار…" : "Publishing…"}</>
              ) : (
                <><Rocket className="w-4 h-4" /> {lang === "fa" ? "انتشار نهایی" : "Final publish"}</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmTransactionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={lang === "fa" ? "تأیید انتشار کتاب" : "Confirm publication"}
        description={
          book.first_published_paid
            ? (lang === "fa"
                ? "این کتاب قبلاً منتشر شده و هزینه‌ای کسر نمی‌شود؛ فقط به‌روزرسانی انجام می‌شود."
                : "Already paid; only metadata will be updated.")
            : (lang === "fa"
                ? `هزینه انتشار با توجه به حجم/پیچیدگی کتاب، با ضریب ${estimatedFactor}× محاسبه شده است.`
                : `Publish fee calculated using a complexity factor of ${estimatedFactor}×.`)
        }
        currentBalance={credits}
        cost={estimatedFee}
        lang={lang}
        confirmLabel={lang === "fa" ? "تأیید و انتشار" : "Confirm & publish"}
        onConfirm={handlePublish}
      />
    </main>
  );
};

export default Publish;
