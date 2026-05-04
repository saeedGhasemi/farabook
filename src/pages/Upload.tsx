import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Upload as UploadIcon,
  Loader2,
  FileText,
  Sparkles,
  Wand2,
  CheckCircle2,
  RefreshCw,
  Trash2,
  AlertTriangle,
  ImageOff,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BookEditor } from "@/components/builder/BookEditor";
import {
  BookMetadataForm,
  DEFAULT_METADATA,
  formatContributorsLine,
  type BookMetadata,
} from "@/components/book-metadata/BookMetadataForm";
import { startResumableUpload } from "@/lib/resumable-upload";

type ImportRow = {
  id: string;
  user_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  title: string;
  author: string;
  description: string | null;
  status: "uploaded" | "converting" | "done" | "failed";
  last_error: string | null;
  book_id: string | null;
  chapters_count: number | null;
  images_count: number | null;
  skipped_images_count: number | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

const STALE_CONVERSION_MS = 3 * 60 * 1000;

const Upload = () => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const fa = lang === "fa";

  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<BookMetadata>({ ...DEFAULT_METADATA });
  const [busy, setBusy] = useState(false);

  // 0 idle · 1 uploading · 2 processing · 3 done
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [processPct, setProcessPct] = useState(0);
  const procTickRef = useRef<number | null>(null);

  const [imports, setImports] = useState<ImportRow[]>([]);
  // Per-row busy state: 'with' = retry with images, 'without' = retry text-only
  const [retryingId, setRetryingId] = useState<{ id: string; mode: "with" | "without" } | null>(null);

  // Animate processing bar (no real progress signal from edge function).
  useEffect(() => {
    if (stage !== 2) {
      if (procTickRef.current) window.clearInterval(procTickRef.current);
      return;
    }
    setProcessPct(5);
    procTickRef.current = window.setInterval(() => {
      setProcessPct((p) => (p < 92 ? p + Math.max(0.5, (95 - p) / 30) : p));
    }, 350) as unknown as number;
    return () => { if (procTickRef.current) window.clearInterval(procTickRef.current); };
  }, [stage]);

  const loadImports = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("word_imports")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["uploaded", "converting", "failed"])
      .order("created_at", { ascending: false })
      .limit(20);
    setImports((data as ImportRow[]) || []);
  };

  useEffect(() => { loadImports(); }, [user?.id]);

  /** Build a display name for the legacy `author` column from contributors. */
  const primaryAuthorName = (): string => {
    const names = meta.contributors.filter((c) => c.role === "author" || c.role === "coauthor")
      .map((c) => c.name.trim()).filter(Boolean);
    return names.join("، ") || (fa ? "ناشناس" : "Unknown");
  };

  /** Stage 1: resumable upload — saves file to storage and creates a word_imports row. */
  const uploadOnly = async (): Promise<{ importId: string; path: string } | null> => {
    if (!user) { nav("/auth"); return null; }
    if (!file) { toast.error(fa ? "یک فایل ورد انتخاب کنید" : "Pick a .docx file"); return null; }
    if (!meta.title.trim()) { toast.error(fa ? "عنوان لازم است" : "Title required"); return null; }

    const dot = file.name.lastIndexOf(".");
    const ext = (dot >= 0 ? file.name.slice(dot + 1) : "docx").toLowerCase().replace(/[^a-z0-9]/g, "") || "docx";
    const safeName = `book-${Date.now()}.${ext}`;
    const path = `${user.id}/${safeName}`;

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) { toast.error(fa ? "نشست شما منقضی شده است" : "Session expired"); return null; }

    setStage(1);
    setUploadPct(0);
    const handle = startResumableUpload({
      bucket: "book-uploads",
      objectName: path,
      file,
      accessToken: token,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      onProgress: (loaded, total) => {
        if (total > 0) setUploadPct(Math.round((loaded / total) * 100));
      },
      refreshToken: async () => {
        const { data } = await supabase.auth.refreshSession();
        return data.session?.access_token ?? null;
      },
    });
    try {
      await handle.done;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] resumable upload failed", e);
      throw new Error((fa ? "بارگذاری فایل ناموفق بود: " : "Upload failed: ") + msg);
    }

    const { data: imp, error: impErr } = await supabase
      .from("word_imports")
      .insert({
        user_id: user.id,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        title: meta.title.trim(),
        author: primaryAuthorName(),
        description: meta.description?.trim() || null,
        status: "uploaded",
        // Carry the full metadata payload through to the conversion step
        // so the created book inherits all the bibliographic fields.
        metadata: meta as any,
      } as any)
      .select("*")
      .single();
    if (impErr || !imp) throw impErr || new Error("could not record import");
    return { importId: imp.id, path };
  };

  /** Stage 2: convert by importId. Returns book id on success. */
  const convertById = async (importId: string, opts?: { skipImages?: boolean }) => {
    setStage(2);
    setProcessPct(5);
    const { data, error } = await supabase.functions.invoke("word-import", {
      body: { importId, skipImages: opts?.skipImages === true },
    });
    if (error) {
      // FunctionsHttpError hides the JSON body — try to read it ourselves.
      let detail = "";
      try {
        const ctx = (error as any)?.context;
        if (ctx instanceof Response) {
          const j = await ctx.clone().json().catch(() => null);
          detail = j?.error || (await ctx.clone().text().catch(() => "")) || "";
        }
      } catch { /* ignore */ }
      throw new Error(detail || error.message || (fa ? "تبدیل ناموفق بود" : "Conversion failed"));
    }
    if (data?.error) throw new Error(data.error);
    setStage(3);
    setProcessPct(100);

    if (data?.skippedImages > 0) {
      toast.warning(
        fa
          ? `${data.skippedImages} تصویر بزرگ‌تر از ۴ مگابایت رد شد.`
          : `${data.skippedImages} images >4MB were skipped.`,
      );
    }
    toast.success(
      fa
        ? `کتاب با ${data?.chapters ?? 0} فصل ساخته شد — در حال انتقال…`
        : `Imported with ${data?.chapters ?? 0} chapters — opening editor…`,
    );
    setTimeout(() => nav(`/edit/${data.book.id}`), 700);
  };

  const submitWord = async () => {
    setBusy(true);
    try {
      const res = await uploadOnly();
      if (!res) return;
      // Refresh list so the new "uploaded" row is visible while we convert.
      loadImports();
      await convertById(res.importId);
    } catch (e) {
      setStage(0);
      setUploadPct(0);
      setProcessPct(0);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      loadImports();
    }
  };

  const retryImport = async (row: ImportRow, skipImages: boolean) => {
    setRetryingId({ id: row.id, mode: skipImages ? "without" : "with" });
    try {
      const { data, error } = await supabase.functions.invoke("word-import", {
        body: { importId: row.id, skipImages },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        fa
          ? `«${row.title}» با موفقیت تبدیل شد. در حال انتقال…`
          : `“${row.title}” converted. Opening…`,
      );
      setTimeout(() => nav(`/edit/${data.book.id}`), 600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRetryingId(null);
      loadImports();
    }
  };

  const deleteImport = async (row: ImportRow) => {
    if (!confirm(fa ? `فایل «${row.file_name}» حذف شود؟` : `Delete "${row.file_name}"?`)) return;
    // Best-effort: remove from storage too.
    await supabase.storage.from("book-uploads").remove([row.file_path]).catch(() => {});
    const { error } = await supabase.from("word_imports").delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success(fa ? "حذف شد" : "Deleted");
    loadImports();
  };

  const [tab, setTab] = useState<"manual" | "word">("manual");

  if (tab === "manual") {
    return (
      <main className="min-h-[calc(100vh-4rem)]">
        <div className="container max-w-5xl pt-4 pb-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">
                {fa ? "کتاب‌ساز" : "Book Builder"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {fa ? "ادیتور بصری زنده — همان‌جا که می‌نویسی، می‌بینی" : "Live visual editor — what you see is what you publish"}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTab("word")}>
            <FileText className="w-4 h-4 me-2" />
            {fa ? "از فایل ورد" : "From Word"}
          </Button>
        </div>
        <BookEditor onCreated={(id) => nav(`/edit/${id}`)} />
      </main>
    );
  }

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)] max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold">
            {fa ? "کتاب‌ساز" : "Book Builder"}
          </h1>
        </div>
        <p className="text-muted-foreground mb-8 text-sm">
          {fa
            ? "از یک فایل ورد بساز یا با ادیتور بصری، صفحه‌به‌صفحه کتاب تعاملی خود را طراحی کن."
            : "Import from Word, or design an interactive book page-by-page with the visual editor."}
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "word")} className="w-full">
          <TabsList className="grid grid-cols-2 mb-6 w-full max-w-sm">
            <TabsTrigger value="manual">
              <Wand2 className="w-4 h-4 me-2" />
              {fa ? "ساخت دستی" : "Visual builder"}
            </TabsTrigger>
            <TabsTrigger value="word">
              <FileText className="w-4 h-4 me-2" />
              {fa ? "از فایل ورد" : "From Word"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            {/* unreachable, manual tab returned earlier */}
          </TabsContent>

          <TabsContent value="word" className="space-y-6">
            <div className="glass-strong rounded-3xl p-6 md:p-8 space-y-5">
              <div>
                <div className="text-sm font-medium mb-1.5">{fa ? "فایل ورد" : "Word file"}</div>
                <label className="mt-2 flex flex-col items-center justify-center gap-2 p-8 rounded-2xl border-2 border-dashed border-border hover:border-accent/60 cursor-pointer transition-colors bg-background/40">
                  {file ? (
                    <>
                      <FileText className="w-8 h-8 text-accent" />
                      <span className="text-sm font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </>
                  ) : (
                    <>
                      <UploadIcon className="w-8 h-8 text-muted-foreground" />
                      <span className="text-sm">{fa ? "برای انتخاب کلیک کنید (تا ۸۰ مگابایت)" : "Click to select (up to 80MB)"}</span>
                    </>
                  )}
                  <input type="file" accept=".docx" className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <div className="rounded-2xl border bg-background/40 p-4">
                <div className="text-xs text-muted-foreground mb-3">
                  {fa
                    ? "مشخصات کتاب — هرچه کامل‌تر پر شود، کتاب در فروشگاه و فهرست‌ها بهتر دیده می‌شود. می‌توانید هرکدام را بعداً در ویرایشگر هم تغییر دهید."
                    : "Book metadata — the more complete, the better the storefront listing. Everything is editable later in the editor."}
                </div>
                <BookMetadataForm value={meta} onChange={setMeta} fa={fa} />
              </div>
              <Button onClick={submitWord} disabled={busy} className="w-full bg-gradient-warm hover:opacity-90">
                {stage === 1 ? <><Loader2 className="w-4 h-4 animate-spin me-2" /> {fa ? `در حال بارگذاری فایل (${uploadPct}٪)…` : `Uploading (${uploadPct}%)…`}</>
                  : stage === 2 ? <><Loader2 className="w-4 h-4 animate-spin me-2" /> {fa ? "در حال پردازش متن…" : "Processing text…"}</>
                  : stage === 3 ? <><CheckCircle2 className="w-4 h-4 me-2" /> {fa ? "آماده شد — انتقال به ویرایشگر" : "Done — opening editor"}</>
                  : (fa ? "بساز و باز کن" : "Create & Open")}
              </Button>
              {busy && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{fa ? "۱/۲ بارگذاری فایل" : "1/2 Uploading"}</span>
                      <span className="tabular-nums">{uploadPct}٪</span>
                    </div>
                    <Progress value={uploadPct} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {stage < 2
                          ? (fa ? "۲/۲ پردازش متن (در انتظار…)" : "2/2 Processing (waiting…)")
                          : stage === 2
                            ? (fa ? "۲/۲ تحلیل و استخراج فصل‌ها" : "2/2 Parsing chapters")
                            : (fa ? "۲/۲ انجام شد" : "2/2 Done")}
                      </span>
                      <span className="tabular-nums">{Math.round(processPct)}٪</span>
                    </div>
                    <Progress value={processPct} className="h-2" />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {fa
                  ? "فایل شما در دو مرحله پردازش می‌شود: ابتدا روی فضای ابری ذخیره می‌شود (یک‌بار) و سپس به کتاب تبدیل می‌شود. اگر مرحله تبدیل با خطا متوقف شد، نیازی به آپلود مجدد نیست — می‌توانید از پایین همین صفحه دوباره تلاش کنید."
                  : "Your file is processed in two steps: first stored in the cloud (only once), then converted into a book. If conversion fails, you don't need to re-upload — retry from the list below."}
              </p>
            </div>

            {imports.length > 0 && (
              <div className="glass rounded-2xl p-4 md:p-5 space-y-3">
                <h2 className="text-sm font-display font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent" />
                  {fa ? "فایل‌های آپلودشده شما" : "Your uploaded files"}
                </h2>
                <div className="space-y-2">
                  {imports.map((row) => {
                    const sizeMb = (Number(row.file_size) / 1024 / 1024).toFixed(2);
                    const isRetrying = retryingId?.id === row.id;
                    const isDone = row.status === "done";
                    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                    const isStuckConverting = row.status === "converting" && updatedAt > 0 && Date.now() - updatedAt > STALE_CONVERSION_MS;
                    const isActivelyConverting = row.status === "converting" && !isStuckConverting;
                    const rowError = row.last_error || (isStuckConverting
                      ? (fa ? "تبدیل قبلی متوقف شده است. فایل آپلودشده باقی مانده؛ می‌توانید دوباره تلاش کنید یا بدون تصاویر تبدیل کنید." : "The previous conversion stopped. The uploaded file is still available; retry or convert without images.")
                      : null);
                    return (
                      <div key={row.id} className="rounded-xl border border-border bg-background/50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{row.title}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {row.file_name} · {sizeMb} MB
                              {row.attempt_count > 0 ? ` · ${row.attempt_count} ${fa ? "تلاش" : "attempts"}` : ""}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              row.status === "failed" ? "border-destructive/40 text-destructive"
                              : row.status === "converting" ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                              : isDone ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                              : ""
                            }
                          >
                            {row.status === "uploaded" && (fa ? "آماده تبدیل" : "Ready")}
                            {row.status === "converting" && (isStuckConverting ? (fa ? "متوقف شده" : "Stopped") : (fa ? "در حال تبدیل…" : "Converting…"))}
                            {row.status === "failed" && (fa ? "خطا" : "Failed")}
                            {row.status === "done" && (fa ? "انجام شد" : "Done")}
                          </Badge>
                        </div>
                        {rowError && (
                          <div className="flex items-start gap-2 text-[11px] text-destructive bg-destructive/10 rounded-md p-2">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="break-words">{rowError}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          {!isDone && (
                            <>
                              <Button
                                size="sm"
                                variant="default"
                                disabled={isRetrying || isActivelyConverting}
                                onClick={() => retryImport(row, false)}
                              >
                                {isRetrying && retryingId?.mode === "with"
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" />
                                  : <RefreshCw className="w-3.5 h-3.5 me-1" />}
                                {fa ? "تبدیل" : "Convert"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isRetrying || isActivelyConverting}
                                onClick={() => retryImport(row, true)}
                                title={fa ? "اگر فایل پر از تصویر است، این روش پایدارتر است" : "Use this if the file has many images and conversion fails"}
                              >
                                {isRetrying && retryingId?.mode === "without"
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" />
                                  : <ImageOff className="w-3.5 h-3.5 me-1" />}
                                {fa ? "تبدیل بدون تصاویر" : "Convert without images"}
                              </Button>
                            </>
                          )}
                          {isDone && row.book_id && (
                            <Button size="sm" variant="default" onClick={() => nav(`/edit/${row.book_id}`)}>
                              <ArrowRight className="w-3.5 h-3.5 me-1" />
                              {fa ? "باز کردن کتاب" : "Open book"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={isRetrying}
                            onClick={() => deleteImport(row)}
                          >
                            <Trash2 className="w-3.5 h-3.5 me-1" />
                            {fa ? "حذف" : "Delete"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
    </main>
  );
};

export default Upload;
