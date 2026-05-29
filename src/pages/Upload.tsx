// Word → Book wizard (single canonical create path).
//
// Step 1: drop .docx
// Step 2: local processing (parse, EMF/WMF, image-optimize, dedupe) + preview
// Step 3: validation report + TOC preview + metadata form
// Step 4: resumable upload (media → book-media, source.docx → book-uploads,
//         AST → word-addin-ingest), then redirect to /edit/:bookId
//
// Reconvert mode: ?reconvert=<bookId> downloads the stored source.docx,
// re-runs the local pipeline, and replaces the existing book's content.
// All blob URLs are revoked and in-memory media is cleared after success.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Upload as UploadIcon, Loader2, FileText, CheckCircle2,
  ArrowRight, ArrowLeft, Sparkles,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { readDocx } from "@/lib/docx/ooxml-reader";
import { mapOoxmlToDoc, type MapResult } from "@/lib/docx/ast-mapper";
import { extractPrintStartPage, shiftPrintPages } from "@/lib/docx/print-pages";
import { processImagesLocally, rewriteMediaPlaceholders, type PipelineResult } from "@/lib/docx/image-pipeline";
import { buildTocLive } from "@/lib/docx/toc-builder";
import { validateUpload, hasBlockingErrors, type ValidationItem } from "@/lib/docx/validator";
import { TocPreview } from "@/components/upload/TocPreview";
import { ValidationReport } from "@/components/upload/ValidationReport";
import { WebPreview } from "@/components/upload/WebPreview";
import {
  BookMetadataForm, DEFAULT_METADATA, normalizeMetadata,
  type BookMetadata,
} from "@/components/book-metadata/BookMetadataForm";
import { startResumableUpload } from "@/lib/resumable-upload";

type WizardStage = "drop" | "processing" | "review" | "uploading" | "done";

interface LocalState {
  file: File;
  fileBuffer: ArrayBuffer;
  prep: MapResult;
  images: PipelineResult;
  printStartPageFromDoc: boolean;
}

const Upload = () => {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const reconvertBookId = params.get("reconvert") || null;
  const fa = lang === "fa";

  const [stage, setStage] = useState<WizardStage>("drop");
  const [local, setLocal] = useState<LocalState | null>(null);
  const [meta, setMeta] = useState<BookMetadata>({ ...DEFAULT_METADATA });
  const [customHeadings, setCustomHeadings] = useState<Array<{ name: string; level: number }>>([]);
  const [excludedStyles, setExcludedStyles] = useState<string[]>([]);
  const [printStartPage, setPrintStartPage] = useState<number | "">("");
  const [validation, setValidation] = useState<ValidationItem[]>([]);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdBookId, setCreatedBookId] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const blobUrlsRef = useRef<string[]>([]);

  /* -------- auth gate -------- */
  useEffect(() => {
    if (!authLoading && !user) nav("/auth");
  }, [user, authLoading, nav]);

  /* -------- cleanup blobs on unmount or new file -------- */
  const releaseBlobs = () => {
    for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
    blobUrlsRef.current = [];
  };
  useEffect(() => () => releaseBlobs(), []);

  /* -------- beforeunload guard during sensitive stages -------- */
  useEffect(() => {
    if (stage !== "uploading" && stage !== "review") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [stage]);

  /* -------- reconvert: auto-load source docx -------- */
  useEffect(() => {
    if (!reconvertBookId || !user || local) return;
    (async () => {
      setStage("processing");
      setUploadPhase("در حال یافتن جدیدترین فایل اصلی…");

      // Build candidate paths from every place a source.docx may live.
      // We then probe each, read its last-modified time, and pick the
      // freshest — so if the user uploaded multiple times, the newest
      // file always wins regardless of which folder convention was used.
      type Cand = { path: string; fileName?: string };
      const candidates: Cand[] = [];

      const { data: imps } = await supabase
        .from("word_imports")
        .select("file_path,file_name,created_at")
        .eq("book_id", reconvertBookId)
        .order("created_at", { ascending: false })
        .limit(10);
      (imps ?? []).forEach((row) => {
        if (row.file_path) candidates.push({ path: row.file_path, fileName: row.file_name ?? undefined });
      });

      candidates.push({ path: `${user.id}/${reconvertBookId}/source.docx`, fileName: "source.docx" });

      const { data: bookRow } = await supabase
        .from("books")
        .select("publisher_id")
        .eq("id", reconvertBookId)
        .maybeSingle();
      if (bookRow?.publisher_id && bookRow.publisher_id !== user.id) {
        candidates.push({
          path: `${bookRow.publisher_id}/${reconvertBookId}/source.docx`,
          fileName: "source.docx",
        });
      }

      // Probe each candidate's last-modified time (via list on its parent folder).
      // Pick the one with the most recent `updated_at`. Skip non-existent paths.
      const probed: { cand: Cand; updatedAt: number }[] = [];
      for (const cand of candidates) {
        const slash = cand.path.lastIndexOf("/");
        const folder = slash >= 0 ? cand.path.slice(0, slash) : "";
        const name = slash >= 0 ? cand.path.slice(slash + 1) : cand.path;
        const { data: listing } = await supabase.storage.from("book-uploads").list(folder, {
          limit: 100, search: name,
        });
        const entry = (listing ?? []).find((o) => o.name === name);
        if (!entry) continue;
        const ts = new Date(entry.updated_at || entry.created_at || 0).getTime();
        probed.push({ cand, updatedAt: isNaN(ts) ? 0 : ts });
      }

      probed.sort((a, b) => b.updatedAt - a.updatedAt);

      let blob: Blob | null = null;
      let chosenName = "source.docx";
      for (const p of probed) {
        const { data, error } = await supabase.storage.from("book-uploads").download(p.cand.path);
        if (!error && data) {
          blob = data;
          chosenName = p.cand.fileName || "source.docx";
          console.log("[reconvert] picked newest source", { path: p.cand.path, updatedAt: new Date(p.updatedAt).toISOString() });
          break;
        }
      }

      if (!blob) {
        console.warn("[reconvert] source not found", candidates.map((c) => c.path));
        toast.error("فایل اصلی این کتاب برای تبدیل مجدد در دسترس نیست. لطفاً دوباره از صفحهٔ آپلود بارگذاری کنید.");
        setStage("drop");
        return;
      }
      const buf = await blob.arrayBuffer();
      const file = new File([buf], chosenName, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      await processFile(file, buf);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconvertBookId, user]);

  /* -------- core local processing -------- */
  const processFile = async (file: File, buf?: ArrayBuffer, customHeadingMap?: Map<string, number>) => {
    setError(null);
    setStage("processing");
    setUploadPhase("در حال تحلیل ساختار فایل…");
    try {
      const buffer = buf ?? await file.arrayBuffer();
      const bundle = await readDocx(buffer);
      const prep = mapOoxmlToDoc(bundle, customHeadingMap?.size ? { customHeadings: customHeadingMap } : undefined);

      setUploadPhase("در حال بهینه‌سازی تصاویر…");
      const images = await processImagesLocally(bundle.media);
      rewriteMediaPlaceholders(prep.doc, images.nameToStorage);

      const docStart = extractPrintStartPage(bundle);
      if (docStart && docStart > 1) shiftPrintPages(prep.doc, docStart);

      // Auto-fill metadata
      setMeta((prev) => normalizeMetadata({
        ...prev,
        title: prev.title || prep.metadata.title || file.name.replace(/\.docx$/i, ""),
        subtitle: prev.subtitle || prep.metadata.subtitle || "",
      }));
      setPrintStartPage(docStart ?? "");

      setLocal({
        file, fileBuffer: buffer, prep, images,
        printStartPageFromDoc: !!docStart,
      });
      setStage("review");
    } catch (e: any) {
      console.error("[upload-wizard] processing failed", e);
      setError(e?.message ?? String(e));
      toast.error(`خطا در تحلیل فایل: ${e?.message ?? e}`);
      setStage("drop");
    }
  };

  /* -------- promote paragraphs whose Word style matches the user's
   *           custom-heading rules. Mutates a shallow copy of doc.content. */
  const promoteCustomHeadings = (doc: any) => {
    if (!customHeadings.length) return doc;
    const norm = (s: string) => (s || "").trim().toLowerCase();
    const map = new Map<string, number>();
    for (const c of customHeadings) {
      const k = norm(c.name);
      if (k) map.set(k, Math.min(8, Math.max(1, Math.floor(c.level || 1))));
    }
    if (!map.size) return doc;
    const next = [...(doc.content ?? [])];
    for (let i = 0; i < next.length; i += 1) {
      const n: any = next[i];
      if (!n || n.type !== "paragraph") continue;
      const sid = norm(n.attrs?.srcStyleId ?? "");
      const sname = norm(n.attrs?.srcStyleName ?? "");
      const lv = map.get(sid) ?? map.get(sname);
      if (!lv) continue;
      const title = (n.content ?? []).map((c: any) => c?.text ?? "").join("").trim();
      if (!title) continue;
      next[i] = {
        type: "heading",
        attrs: { ...n.attrs, level: lv },
        content: n.content,
      };
    }
    return { ...doc, content: next };
  };


  /* -------- validation re-runs whenever inputs change -------- */
  const toc = useMemo(
    () => (local ? buildTocLive(local.prep.doc, customHeadings) : []),
    [local, customHeadings],
  );

  useEffect(() => {
    if (!local) return;
    const effectiveStart = typeof printStartPage === "number" ? printStartPage : 1;
    setValidation(validateUpload({
      prep: local.prep,
      images: local.images,
      toc,
      meta,
      printStartPage: effectiveStart,
      printStartPageFromDoc: local.printStartPageFromDoc,
    }));
  }, [local, meta, toc, printStartPage]);

  /* -------- TOC edit / delete (mutate AST locally) -------- */
  const editHeading = (index: number, level: 1|2|3|4|5|6|7|8, title: string) => {
    if (!local) return;
    const doc = local.prep.doc;
    const node: any = doc.content?.[index];
    if (!node || node.type !== "heading") return;
    node.attrs = { ...(node.attrs ?? {}), level };
    node.content = [{ type: "text", text: title }];
    setLocal({ ...local, prep: { ...local.prep, doc: { ...doc, content: [...(doc.content ?? [])] } } });
  };

  const deleteHeading = (index: number) => {
    if (!local) return;
    const doc = local.prep.doc;
    const node: any = doc.content?.[index];
    if (!node || node.type !== "heading") return;
    // Demote to a normal paragraph so the underlying text is preserved.
    const newNode: any = {
      type: "paragraph",
      attrs: { dir: node.attrs?.dir ?? null, textAlign: node.attrs?.textAlign ?? null },
      content: node.content,
    };
    const next = [...(doc.content ?? [])];
    next[index] = newNode;
    setLocal({ ...local, prep: { ...local.prep, doc: { ...doc, content: next } } });
  };


  /* -------- blob URLs for preview images -------- */
  const mediaUrls = useMemo(() => {
    releaseBlobs();
    const map = new Map<string, string>();
    if (!local) return map;
    for (const img of local.images.images) {
      const url = URL.createObjectURL(img.blob);
      blobUrlsRef.current.push(url);
      map.set(img.storageName, url);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  /* -------- upload phase -------- */
  const doUpload = async () => {
    if (!user || !local) return;
    if (hasBlockingErrors(validation)) {
      toast.error("ابتدا خطاهای قرمز را برطرف کنید.");
      return;
    }
    setStage("uploading");
    setUploadPct(0);
    setUploadPhase("در حال آمادهٔ آپلود…");
    setError(null);

    try {
      // 1) Upload optimized media to book-media bucket (parallel ≤3)
      const total = local.images.images.length;
      let done = 0;
      const nameToUrl = new Map<string, string>();
      const limit = 3;
      const queue = [...local.images.images];
      setUploadPhase(`در حال آپلود ${total} تصویر…`);
      await Promise.all(
        Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
          while (queue.length) {
            const img = queue.shift()!;
            const key = `${user.id}/pending/${img.storageName}`;
            const up = await supabase.storage.from("book-media").upload(key, img.blob, {
              contentType: img.contentType, upsert: true,
            });
            if (!up.error) {
              const url = supabase.storage.from("book-media").getPublicUrl(key).data.publicUrl;
              nameToUrl.set(img.storageName, url);
            }
            done += 1;
            setUploadPct(Math.round((done / Math.max(1, total)) * 40));
          }
        }),
      );

      // 2) Call word-addin-ingest with AST + map + metadata
      setUploadPhase("در حال ایجاد کتاب در حساب شما…");
      setUploadPct(50);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("توکن احراز هویت یافت نشد.");

      const ingestResp = await supabase.functions.invoke("word-addin-ingest", {
        body: {
          ast: promoteCustomHeadings(local.prep.doc),
          mediaUrlMap: Object.fromEntries(nameToUrl),
          replaceBookId: reconvertBookId,
          meta: {
            sourceFileName: local.file.name,
            diagnostics: local.prep.diagnostics,
            metadata: meta,
            printStartPage: typeof printStartPage === "number" ? printStartPage : 1,
          },
        },
      });

      if (ingestResp.error) throw new Error(ingestResp.error.message);
      const bookId = (ingestResp.data as any)?.bookId;
      if (!bookId) throw new Error("شناسهٔ کتاب از سرور بازنگشت.");
      setUploadPct(70);

      // 3) Resumable upload source.docx (so re-convert later works)
      if (!reconvertBookId) {
        setUploadPhase("در حال ذخیرهٔ فایل اصلی برای امکان تبدیل مجدد…");
        try {
          await startResumableUpload({
            bucket: "book-uploads",
            objectName: `${user.id}/${bookId}/source.docx`,
            file: local.file,
            accessToken,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: true,
            onProgress: (loaded, totalB) => {
              setUploadPct(70 + Math.round((loaded / totalB) * 25));
            },
            refreshToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
          }).done;
        } catch (e) {
          console.warn("[upload-wizard] source.docx upload failed (non-fatal)", e);
          // Not fatal — book is already created.
        }
      }

      setUploadPct(100);
      setUploadPhase("انجام شد");
      setCreatedBookId(bookId);
      setStage("done");

      // Cleanup all in-memory data
      releaseBlobs();
      toast.success(reconvertBookId
        ? "تبدیل مجدد انجام شد. می‌توانید اطلاعات کتابشناختی را تکمیل کنید."
        : "کتاب ایجاد شد. اکنون اطلاعات کتابشناختی را تکمیل کنید.");
    } catch (e: any) {
      console.error("[upload-wizard] upload failed", e);
      setError(e?.message ?? String(e));
      toast.error(`آپلود ناموفق بود: ${e?.message ?? e}`);
      setStage("review");
    }
  };

  /* -------- save bibliographic metadata after upload -------- */
  const saveMetadataAndContinue = async () => {
    if (!createdBookId) return;
    setSavingMeta(true);
    try {
      const normalized = normalizeMetadata(meta);
      const firstAuthor = (normalized.contributors ?? [])
        .find((c) => (c.role === "author" || c.role === "coauthor") && c.name?.trim());
      const { error: upErr } = await supabase.from("books").update({
        title: normalized.title || undefined,
        subtitle: normalized.subtitle || null,
        description: normalized.description || null,
        author: firstAuthor?.name?.trim() || undefined,
        publisher: normalized.publisher || null,
        isbn: normalized.isbn || null,
        edition: normalized.edition || null,
        publication_year: normalized.publication_year ?? null,
        page_count: normalized.page_count ?? null,
        language: normalized.language || null,
        original_title: normalized.original_title || null,
        original_language: normalized.original_language || null,
        categories: normalized.categories ?? [],
        subjects: normalized.subjects ?? [],
        series_name: normalized.series_name || null,
        series_index: normalized.series_index ?? null,
        book_type: normalized.book_type || null,
        contributors: normalized.contributors as any,
        metadata: normalized as any,
      }).eq("id", createdBookId);
      if (upErr) throw upErr;
      toast.success("مشخصات کتاب ذخیره شد.");
      nav(`/edit/${createdBookId}`);
    } catch (e: any) {
      console.error("[upload-wizard] save metadata failed", e);
      toast.error(`ذخیرهٔ مشخصات ناموفق بود: ${e?.message ?? e}`);
    } finally {
      setSavingMeta(false);
    }
  };

  const skipMetadata = () => {
    if (!createdBookId) return;
    nav(`/edit/${createdBookId}`);
  };

  const reset = () => {
    releaseBlobs();
    setLocal(null);
    setMeta({ ...DEFAULT_METADATA });
    setCustomHeadings([]);
    setPrintStartPage("");
    setValidation([]);
    setStage("drop");
    setError(null);
    setCreatedBookId(null);
  };

  /* -------- render -------- */
  return (
    <main className="container mx-auto max-w-4xl py-6 space-y-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2"
      >
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">
          {reconvertBookId ? "تبدیل مجدد کتاب از فایل Word" : "ساخت کتاب جدید از فایل Word"}
        </h1>
      </motion.div>

      <StepIndicator stage={stage} />

      {stage === "drop" && (
        <DropZone
          disabled={!user || authLoading}
          onFile={(f) => processFile(f)}
        />
      )}

      {stage === "processing" && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">{uploadPhase || "در حال پردازش…"}</p>
            <p className="text-[11px] text-muted-foreground">
              تمام پردازش‌ها در مرورگر شما انجام می‌شود؛ هیچ داده‌ای هنوز آپلود نشده است.
            </p>
          </CardContent>
        </Card>
      )}

      {stage === "review" && local && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                خلاصهٔ تحلیل
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm grid sm:grid-cols-2 gap-2">
              <Stat label="نام فایل" value={local.file.name} />
              <Stat label="حجم" value={`${(local.file.size / 1024 / 1024).toFixed(2)} MB`} />
              <Stat label="پاراگراف‌ها" value={String(local.prep.diagnostics.paragraphsTotal)} />
              <Stat label="تصاویر منحصربه‌فرد" value={String(local.images.images.length)} />
              <Stat label="پاورقی‌ها" value={String(local.prep.diagnostics.footnotesDetected)} />
              <Stat label="فرمول‌ها" value={String(local.prep.diagnostics.formulasDetected)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">گزارش اعتبارسنجی</CardTitle>
            </CardHeader>
            <CardContent>
              <ValidationReport items={validation} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">فهرست فصل‌ها (TOC)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <TocPreview
                toc={toc}
                customHeadings={customHeadings}
                onCustomHeadingsChange={setCustomHeadings}
                availableStyleNames={local.prep.diagnostics.paragraphStyles
                  .map((s) => s.name || s.id)
                  .filter(Boolean) as string[]}
                onEditHeading={editHeading}
                onDeleteHeading={deleteHeading}
              />
              <p className="text-[11px] text-muted-foreground">
                فهرست بالا با تغییر Styleهای سفارشی به‌صورت زنده به‌روزرسانی می‌شود؛ نیازی به تبدیل دوباره نیست.
              </p>

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">پیش‌نمایش وب کتاب</CardTitle>
            </CardHeader>
            <CardContent>
              <WebPreview doc={local.prep.doc} mediaUrls={mediaUrls} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">شمارهٔ صفحهٔ چاپی شروع</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <div className="sm:col-span-1">
                  <Label className="text-xs">صفحهٔ شروع</Label>
                  <Input
                    type="number" inputMode="numeric" min={1}
                    value={printStartPage}
                    onChange={(e) => setPrintStartPage(e.target.value ? Number(e.target.value) : "")}
                    placeholder="۱"
                    disabled={local.printStartPageFromDoc}
                    className="mt-1"
                  />
                </div>
                <p className="sm:col-span-2 text-[11px] text-muted-foreground leading-relaxed">
                  {local.printStartPageFromDoc
                    ? `این مقدار از فایل ورد خوانده شد (w:pgNumType) و نیاز به تغییر ندارد.`
                    : `اگر کتاب چاپی شما از صفحه‌ای غیر از ۱ شروع می‌شود، شماره را وارد کنید. در غیر این صورت از ۱ شروع خواهد شد.`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">عنوان کتاب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label className="text-xs">عنوان<span className="text-destructive ms-1">*</span></Label>
              <Input
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                placeholder="عنوان کتاب"
              />
              <p className="text-[11px] text-muted-foreground">
                باقی مشخصات کتابشناختی (نویسندگان، شابک، ناشر، سال انتشار و …) را می‌توانید
                هم‌زمان با شروع آپلود و در پسِ‌زمینه تکمیل کنید.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={reset}>
              <ArrowLeft className="h-4 w-4 me-1" />
              بازگشت به مرحلهٔ قبل
            </Button>
            <Button
              className="flex-1 sm:flex-initial"
              onClick={doUpload}
              disabled={hasBlockingErrors(validation)}
            >
              <UploadIcon className="h-4 w-4 me-1.5" />
              {reconvertBookId ? "اعمال تبدیل مجدد" : "آپلود و ساخت کتاب"}
              <ArrowRight className="h-4 w-4 ms-1" />
            </Button>
          </div>
        </div>
      )}

      {(stage === "uploading" || stage === "done") && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="text-center space-y-2">
                {stage === "done" ? (
                  <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                ) : (
                  <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
                )}
                <p className="text-sm font-medium">
                  {stage === "done" ? "آپلود کامل شد" : uploadPhase}
                </p>
              </div>
              <Progress value={uploadPct} />
              <p className="text-center text-xs text-muted-foreground tabular-nums">{uploadPct}٪</p>
              {stage === "uploading" && (
                <p className="text-center text-[11px] text-muted-foreground">
                  می‌توانید هم‌زمان فرم اطلاعات کتابشناختی زیر را تکمیل کنید؛ پس از پایان آپلود، ذخیره می‌شود.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">اطلاعات کتابشناختی</CardTitle>
            </CardHeader>
            <CardContent>
              <BookMetadataForm value={meta} onChange={setMeta} fa={fa} />
            </CardContent>
          </Card>

          {stage === "done" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveMetadataAndContinue} disabled={savingMeta} className="flex-1 sm:flex-initial">
                {savingMeta ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 me-1" />}
                ذخیرهٔ مشخصات و رفتن به ادیتور
              </Button>
              <Button variant="outline" onClick={skipMetadata} disabled={savingMeta}>
                فعلاً رد شو (در ادیتور تکمیل می‌کنم)
              </Button>
            </div>
          )}
        </div>
      )}

      {error && stage !== "uploading" && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}
    </main>
  );
};

/* -------- subcomponents -------- */

const StepIndicator = ({ stage }: { stage: WizardStage }) => {
  const steps: Array<{ key: WizardStage[]; label: string }> = [
    { key: ["drop"], label: "۱) انتخاب فایل" },
    { key: ["processing"], label: "۲) پردازش لوکال" },
    { key: ["review"], label: "۳) بررسی و اعتبارسنجی" },
    { key: ["uploading", "done"], label: "۴) آپلود و ساخت" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((s, i) => (
        <Badge
          key={i}
          variant={s.key.includes(stage) ? "default" : "outline"}
          className="text-[11px]"
        >
          {s.label}
        </Badge>
      ))}
    </div>
  );
};

const DropZone = ({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        dragging ? "border-primary bg-primary/5" : "border-border"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && /\.docx$/i.test(f.name)) onFile(f);
        else toast.error("فقط فایل .docx پشتیبانی می‌شود.");
      }}
    >
      <CardContent className="py-14 text-center space-y-3">
        <UploadIcon className="h-10 w-10 text-primary mx-auto" />
        <div>
          <p className="font-medium">فایل Word خود را اینجا رها کنید</p>
          <p className="text-xs text-muted-foreground mt-1">یا روی دکمه کلیک کنید</p>
        </div>
        <Input
          ref={ref} type="file" accept=".docx" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button onClick={() => ref.current?.click()} disabled={disabled}>
          <UploadIcon className="h-4 w-4 me-1" /> انتخاب فایل
        </Button>
        <p className="text-[11px] text-muted-foreground mt-2 max-w-md mx-auto">
          هیچ فایلی تا قبل از زدن دکمهٔ آپلود به سرور ارسال نمی‌شود. تمام تحلیل،
          بهینه‌سازی تصاویر و حذف موارد تکراری در مرورگر شما انجام می‌شود.
        </p>
      </CardContent>
    </Card>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 bg-card/50">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className="font-medium text-xs truncate" title={value}>{value}</span>
  </div>
);

export default Upload;
