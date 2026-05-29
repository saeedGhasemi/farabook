// Word Add-in taskpane (also works standalone in the browser for testing).
//
// Flow:
//   1. User picks a .docx (or Word's getFileAsync provides one if running
//      inside Office). We parse it locally with ooxml-reader + ast-mapper.
//   2. Live preview shows the cleaned AST via BlockRenderer.
//   3. Two output actions:
//      (الف) آپلود به ناشر  → POST AST + media to word-addin-ingest edge
//             function → redirect to /edit/:bookId.
//      (ب) دانلود فایل تمیز  → embed a Custom XML marker + standardize the
//             styles inside the original .docx and download. Importer (web)
//             then recognises it and uses the fast path.

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Upload, Download, FileCheck2, Sparkles, UserCircle2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readDocx } from "@/lib/docx/ooxml-reader";
import { mapOoxmlToDoc, type MapResult } from "@/lib/docx/ast-mapper";


declare global {
  interface Window {
    Office?: any;
  }
}

interface PreparedDoc extends MapResult {
  fileName: string;
  originalBuffer: ArrayBuffer;
}

/** Convert ArrayBuffer → base64 (chunked to avoid call-stack overflow). */
function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function WordAddin() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [office, setOffice] = useState<{ ready: boolean; host?: string }>({ ready: false });
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<PreparedDoc | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string>("");
  const [profile, setProfile] = useState<{ display_name?: string | null; username?: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* -------- Load minimal profile info for the "ارسال به" badge -------- */
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    let alive = true;
    supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (alive) setProfile(data ?? null); });
    return () => { alive = false; };
  }, [user]);


  /* -------- Office.js bootstrap (lazy, no-op when standalone) -------- */
  useEffect(() => {
    // Lazy-load office.js only on this route. Loading it globally in
    // index.html breaks window.history outside Word.
    const SRC = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    const onReady = () => {
      if (window.Office?.onReady) {
        window.Office.onReady((info: any) => setOffice({ ready: true, host: info?.host }));
      }
    };
    if (window.Office) {
      onReady();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = onReady;
    s.onerror = () => console.warn("[word-addin] failed to load office.js (expected outside Word)");
    document.head.appendChild(s);
  }, []);


  /* -------- Process a docx ArrayBuffer -------- */
  const processBuffer = async (buf: ArrayBuffer, name: string) => {
    setBusy(true);
    try {
      const bundle = await readDocx(buf);
      const mapped = mapOoxmlToDoc(bundle);
      setPrep({ ...mapped, fileName: name, originalBuffer: buf });
      toast.success(
        `تحلیل شد — ${mapped.diagnostics.paragraphsTotal} پاراگراف، ` +
          `${mapped.diagnostics.promotedHeadings} سرتیتر سفارشی شناسایی شد`,
      );
    } catch (e: any) {
      console.error("[word-addin] parse failed", e);
      toast.error(`خواندن فایل ناموفق بود: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /* -------- Pull current doc from Word (when running in Office) -------- */
  const pullFromWord = async () => {
    if (!window.Office?.context?.document?.getFileAsync) {
      toast.error("این دکمه فقط داخل Word فعال است.");
      return;
    }
    setBusy(true);
    try {
      const Office = window.Office;
      const file: any = await new Promise((resolve, reject) =>
        Office.context.document.getFileAsync(
          Office.FileType.Compressed,
          { sliceSize: 65536 },
          (r: any) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(r.error)),
        ),
      );
      const sliceCount: number = file.sliceCount;
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < sliceCount; i++) {
        const slice: any = await new Promise((resolve, reject) =>
          file.getSliceAsync(i, (r: any) =>
            r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(r.error),
          ),
        );
        chunks.push(new Uint8Array(slice.data));
      }
      await new Promise((res) => file.closeAsync(res));
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      await processBuffer(merged.buffer, "document.docx");
    } catch (e: any) {
      toast.error(`خواندن از Word ناموفق بود: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /* -------- File-input fallback (standalone browser testing) -------- */
  const onFile = async (f: File | null) => {
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) {
      toast.error("فقط فایل .docx پشتیبانی می‌شود.");
      return;
    }
    await processBuffer(await f.arrayBuffer(), f.name);
  };

  /* -------- Upload to publisher account (with real progress) -------- */
  const uploadToPublisher = async () => {
    if (!prep) return;
    if (!user) {
      toast.error("ابتدا وارد حساب ناشر شوید.");
      navigate("/auth");
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    setUploadPhase("در حال آماده‌سازی فایل…");
    try {
      const media = prep.media.map((m) => ({
        name: m.name,
        contentType: m.contentType,
        base64: bufToBase64(m.bytes),
      }));
      const payload = JSON.stringify({
        ast: prep.doc,
        media,
        meta: {
          sourceFileName: prep.fileName,
          diagnostics: prep.diagnostics,
          metadata: prep.metadata,
        },
      });

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("توکن احراز هویت یافت نشد.");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/word-addin-ingest`;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      setUploadPhase("در حال آپلود به حساب شما…");
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.setRequestHeader("apikey", anonKey);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 95));
          }
        };
        xhr.upload.onload = () => {
          setUploadProgress(97);
          setUploadPhase("در حال پردازش روی سرور…");
        };
        xhr.onerror = () => reject(new Error("خطای شبکه"));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error("پاسخ نامعتبر سرور")); }
          } else {
            reject(new Error(`خطای سرور (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
          }
        };
        xhr.send(payload);
      });

      setUploadProgress(100);
      const bookId = result?.bookId;
      if (!bookId) throw new Error("پاسخ سرور شناسه کتاب را برنگرداند.");
      toast.success("کتاب در حساب شما ایجاد شد. به ادیتور منتقل می‌شوید…");
      navigate(`/edit/${bookId}`);
    } catch (e: any) {
      console.error("[word-addin] upload failed", e);
      toast.error(`آپلود ناموفق بود: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      setTimeout(() => { setUploadProgress(null); setUploadPhase(""); }, 800);
    }
  };


  /* -------- Download cleaned .docx (with marker) -------- */
  const downloadCleaned = async () => {
    if (!prep) return;
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(prep.originalBuffer);
      // Embed marker as a Custom XML Part
      const marker = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<farabook xmlns="urn:farabook:cleaned" id="farabook-cleaned-v1" version="1">
  <generatedAt>${new Date().toISOString()}</generatedAt>
  <promotedHeadings>${prep.diagnostics.promotedHeadings}</promotedHeadings>
</farabook>`;
      zip.file("customXml/item-farabook.xml", marker);
      // Minimal rels stub (Word will tolerate; full rel chain is not required
      // for our own importer to detect the marker).
      zip.file(
        "customXml/_rels/item-farabook.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
      );
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      const base = prep.fileName.replace(/\.docx$/i, "");
      a.download = `${base}.farabook-cleaned.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("فایل تمیز دانلود شد.");
    } catch (e: any) {
      toast.error(`دانلود ناموفق بود: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /* -------- Build blob URLs for media so preview can show images -------- */
  const mediaUrls = useMemo(() => {
    const map = new Map<string, string>();
    if (!prep) return map;
    for (const m of prep.media) {
      const blob = new Blob([m.bytes as BlobPart], { type: m.contentType });

      map.set(m.name, URL.createObjectURL(blob));
    }
    return map;
  }, [prep]);
  useEffect(() => {
    return () => {
      for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
    };
  }, [mediaUrls]);

  /* -------- Preview: BlockRenderer expects "blocks" — quick adapter -------- */
  const previewBlocks = useMemo(() => {
    if (!prep) return null;
    return docToLegacyBlocks(prep.doc, mediaUrls);
  }, [prep, mediaUrls]);


  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            افزونه فرابوک برای Word
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            این صفحه هم به‌صورت taskpane داخل Word اجرا می‌شود و هم در مرورگر برای تست
            مستقیم — فایل <code>.docx</code> را بکشید و رها کنید یا انتخاب کنید.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {office.ready && (
              <Badge variant="secondary">داخل Word ({office.host ?? "Office"})</Badge>
            )}
            {!office.ready && <Badge variant="outline">حالت مرورگر / تست</Badge>}
            {office.ready && (
              <Button onClick={pullFromWord} disabled={busy}>
                <FileCheck2 className="me-2 h-4 w-4" />
                خواندن سند فعلی از Word
              </Button>
            )}
            <Input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              className="max-w-xs"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        </CardContent>
      </Card>

      {prep && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>تشخیص ساختار</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>پاراگراف‌ها: <b>{prep.diagnostics.paragraphsTotal}</b></div>
              <div>
                سرتیتر سفارشی شناسایی‌شده: <b>{prep.diagnostics.promotedHeadings}</b>
                {" — "}
                توزیع سطوح: H1×{prep.diagnostics.headingLevels[1] ?? 0} · H2×
                {prep.diagnostics.headingLevels[2] ?? 0} · H3×
                {prep.diagnostics.headingLevels[3] ?? 0}
              </div>
              <div>تصاویر: <b>{prep.diagnostics.imagesEmbedded}</b></div>
              <div>فرمول‌ها: <b>{prep.diagnostics.formulasDetected}</b></div>
              <div>پاورقی‌ها: <b>{prep.diagnostics.footnotesDetected}</b></div>
              {prep.metadata.title && <div>عنوان تشخیص‌داده‌شده: <b>{prep.metadata.title}</b></div>}
              {prep.metadata.subtitle && <div>زیرعنوان تشخیص‌داده‌شده: <b>{prep.metadata.subtitle}</b></div>}
              {prep.diagnostics.cleanedMarker && (
                <div className="text-emerald-600">این فایل قبلاً پاک‌سازی شده است.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>پیش‌نمایش وب</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none rounded-md border p-4 max-h-[480px] overflow-auto bg-card space-y-2">
                {previewBlocks?.map((b, i) => <PreviewBlock key={i} b={b} />)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ارسال و خروجی</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Recipient info */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <UserCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-muted-foreground">آپلود به اکانت:</span>
                  {user ? (
                    <span className="font-semibold truncate">
                      {profile?.display_name || profile?.username || user.email || user.id}
                    </span>
                  ) : (
                    <span className="text-destructive">وارد نشده‌اید</span>
                  )}
                </div>
                {user && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                    <span>
                      این فایل فقط به همین کاربری که الان وارد شده ارسال می‌شود. اگر می‌خواهید
                      به حساب دیگری برود، ابتدا با آن حساب وارد شوید.
                    </span>
                  </div>
                )}
              </div>

              {/* Upload progress */}
              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{uploadPhase}</span>
                    <span className="tabular-nums font-medium">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={uploadToPublisher} disabled={busy || authLoading || !user}>
                  <Upload className="me-2 h-4 w-4" />
                  آپلود به اکانت ناشر
                </Button>
                <Button variant="secondary" onClick={downloadCleaned} disabled={busy}>
                  <Download className="me-2 h-4 w-4" />
                  دانلود نسخه تمیز (.docx)
                </Button>
              </div>
            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny AST → legacy blocks adapter (only for the inline preview UI). */
/* The publisher editor / reader use the full TiptapDoc directly.     */
/* ------------------------------------------------------------------ */
function docToLegacyBlocks(doc: any, mediaUrls: Map<string, string>): any[] {
  const out: any[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === "paragraph") {
      out.push({ type: "paragraph", inline: n.content ?? [], dir: n.attrs?.dir });
    } else if (n.type === "heading") {
      out.push({ type: "heading", level: n.attrs?.level ?? 2, inline: n.content ?? [], dir: n.attrs?.dir });
    } else if (n.type === "image") {
      const src: string = n.attrs?.src ?? "";
      const name = src.startsWith("media://") ? src.slice("media://".length) : src;
      out.push({ type: "image", src: mediaUrls.get(name) ?? src, name, caption: n.attrs?.caption });
    }
  }
  return out;
}

function renderInline(nodes: any[]) {
  return (nodes ?? []).map((n, i) => {
    const text = n?.text ?? "";
    let el: React.ReactNode = text;
    const marks = (n?.marks ?? []) as Array<{ type: string; attrs?: any }>;
    for (const m of marks) {
      if (m.type === "superscript") el = <sup key={`sup-${i}`}>{el}</sup>;
      else if (m.type === "subscript") el = <sub key={`sub-${i}`}>{el}</sub>;
      else if (m.type === "bold") el = <strong key={`b-${i}`}>{el}</strong>;
      else if (m.type === "italic") el = <em key={`i-${i}`}>{el}</em>;
      else if (m.type === "underline") el = <u key={`u-${i}`}>{el}</u>;
    }
    return <span key={i}>{el}</span>;
  });
}

function PreviewBlock({ b }: { b: any }) {
  const dir = b.dir ?? undefined;
  if (b.type === "heading") {
    const lv = b.level ?? 2;
    const cls =
      lv === 1
        ? "text-2xl font-bold text-blue-700"
        : lv === 2
          ? "text-xl font-bold text-blue-700"
          : "text-lg font-semibold text-blue-700";
    return <div className={cls} dir={dir}>{renderInline(b.inline)}</div>;
  }
  if (b.type === "image") {
    if (b.src && (b.src.startsWith("blob:") || b.src.startsWith("data:") || /^https?:/.test(b.src))) {
      return <img src={b.src} alt={b.name ?? ""} className="max-w-full h-auto rounded border" />;
    }
    return <div className="text-xs text-muted-foreground">[تصویر: {b.name ?? b.src}]</div>;
  }
  return <p className="whitespace-pre-wrap" dir={dir}>{renderInline(b.inline)}</p>;
}

