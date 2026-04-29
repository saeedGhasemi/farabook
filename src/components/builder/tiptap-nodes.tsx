// Custom Tiptap nodes used by the new TextBookEditor. Text-bearing
// blocks (callout, quote) are editable. Media blocks (image / video /
// gallery / timeline / scrollytelling) are atom node-views with full
// inline editing UIs (upload images, paste URLs, add steps, etc.).
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { resolveBookMedia, resolveBookCover } from "@/lib/book-media";
import { uploadOptimizedImage } from "@/lib/image-optim";
import {
  Trash2, Image as ImageIcon, Film, GalleryHorizontal, ListOrdered,
  Lightbulb, AlertTriangle, Info, CheckCircle2, ShieldAlert, Pencil,
  HelpCircle, Quote as QuoteIcon, Plus, X, Upload, Layers,
  BookMarked, Sparkles,
} from "lucide-react";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ImportedTableAttrs = { headers: string[]; rows: string[][]; caption?: string; tableNumber?: string };

/* ------------------------------------------------------------------ */
/* Shared upload helper                                                */
/* ------------------------------------------------------------------ */

const uploadToBookMedia = async (userId: string, file: File): Promise<string | null> => {
  // Images go through the optimizer (downscale + WebP/JPEG re-encode, keeps original).
  if (/^image\//i.test(file.type)) {
    const url = await uploadOptimizedImage(userId, file, "edit", { maxEdge: 1600, quality: 0.82 });
    if (!url) toast.error("بارگذاری ناموفق بود");
    return url;
  }
  const ext = file.name.split(".").pop() || "bin";
  const key = `${userId}/edit/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("book-media").upload(key, file, { contentType: file.type });
  if (error) { toast.error(error.message); return null; }
  const { data } = supabase.storage.from("book-media").getPublicUrl(key);
  return data.publicUrl;
};

/* ------------------------------------------------------------------ */
/* Callout                                                            */
/* ------------------------------------------------------------------ */

const calloutMeta: Record<string, { Icon: any; cls: string; label: string }> = {
  info:    { Icon: Info,           cls: "border-primary/40 bg-primary/5",        label: "نکته" },
  tip:     { Icon: Lightbulb,      cls: "border-amber-500/40 bg-amber-500/5",    label: "ایده" },
  note:    { Icon: Pencil,         cls: "border-muted-foreground/30 bg-muted/30",label: "یادداشت" },
  warning: { Icon: AlertTriangle,  cls: "border-amber-600/50 bg-amber-500/10",   label: "هشدار" },
  success: { Icon: CheckCircle2,   cls: "border-emerald-500/40 bg-emerald-500/5",label: "نکته مهم" },
  danger:  { Icon: ShieldAlert,    cls: "border-destructive/50 bg-destructive/10",label: "خطر" },
  question:{ Icon: HelpCircle,     cls: "border-sky-500/40 bg-sky-500/5",        label: "سؤال" },
  quote:   { Icon: QuoteIcon,      cls: "border-accent/40 bg-accent/5",          label: "نقل‌قول" },
  definition: { Icon: BookMarked,  cls: "border-violet-500/40 bg-violet-500/5",  label: "تعریف" },
  example:    { Icon: Sparkles,    cls: "border-teal-500/40 bg-teal-500/5",      label: "مثال" },
};

const CalloutView = (props: NodeViewProps) => {
  const variant = (props.node.attrs.variant as string) || "info";
  const meta = calloutMeta[variant] ?? calloutMeta.info;
  const Icon = meta.Icon;
  return (
    <NodeViewWrapper
      className={`my-3 rounded-xl border-r-4 px-4 py-3 ${meta.cls}`}
      data-callout={variant}
    >
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-1 shrink-0 opacity-70" />
        <NodeViewContent className="flex-1 min-w-0 text-[0.95em] leading-relaxed [&_p]:my-0" />
      </div>
    </NodeViewWrapper>
  );
};

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() { return { variant: { default: "info" } }; },
  parseHTML() {
    return [{ tag: "div[data-callout]", getAttrs: (el) => ({ variant: (el as HTMLElement).getAttribute("data-callout") || "info" }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": HTMLAttributes.variant }), 0];
  },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

/* ------------------------------------------------------------------ */
/* Quote                                                              */
/* ------------------------------------------------------------------ */

export const Quote = Node.create({
  name: "quote",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() { return { author: { default: null } }; },
  parseHTML() { return [{ tag: "blockquote[data-quote]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["blockquote", mergeAttributes(HTMLAttributes, { "data-quote": "true", class: "border-r-4 border-accent/50 ps-4 my-3 italic text-foreground/90" }), 0];
  },
});

/* ------------------------------------------------------------------ */
/* Editable shell for atom blocks                                      */
/* ------------------------------------------------------------------ */

const BlockShell = ({
  Icon, label, onDelete, children,
}: { Icon: any; label: string; onDelete: () => void; children: React.ReactNode }) => (
  <NodeViewWrapper className="my-4 group/blk relative">
    <div className="rounded-xl border bg-card/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 text-sm">
        <Icon className="w-4 h-4 text-accent" />
        <span className="font-medium">{label}</span>
        <button
          type="button"
          onClick={onDelete}
          className="ms-auto text-destructive opacity-60 hover:opacity-100 p-1"
          title="حذف"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  </NodeViewWrapper>
);

/* ------------------------------------------------------------------ */
/* Image (editable)                                                    */
/* ------------------------------------------------------------------ */

const ImageView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const { src, caption, hideCaption } = props.node.attrs;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File) => {
    if (!user) { toast.error("لطفاً وارد شوید"); return; }
    setBusy(true);
    const url = await uploadToBookMedia(user.id, f);
    setBusy(false);
    if (url) props.updateAttributes({ src: url });
  };

  return (
    <NodeViewWrapper className="my-4 group/img relative">
      <figure className="overflow-hidden rounded-xl border bg-secondary">
        {src ? (
          <img src={resolveBookMedia(src)} alt={caption || ""} className="w-full max-h-[420px] object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full aspect-video flex flex-col items-center justify-center text-muted-foreground text-sm hover:bg-muted/40 transition"
          >
            <Upload className="w-5 h-5 mb-1" />
            {busy ? "در حال بارگذاری…" : "انتخاب تصویر"}
          </button>
        )}
        {!hideCaption && caption && (
          <figcaption className="text-xs text-muted-foreground p-2 text-center">{caption}</figcaption>
        )}
      </figure>
      <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover/img:opacity-100 transition">
        {src && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="bg-background/90 border rounded-md p-1.5 shadow"
            title="تعویض"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => props.deleteNode()}
          className="bg-destructive text-destructive-foreground rounded-md p-1.5 shadow"
          title="حذف"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        type="text"
        defaultValue={caption || ""}
        placeholder="کپشن (اختیاری)…"
        onBlur={(e) => props.updateAttributes({ caption: e.target.value })}
        className="mt-1 w-full bg-transparent text-xs text-center text-muted-foreground border-b border-dashed border-transparent focus:border-border outline-none px-2 py-1"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onFile(f); e.target.value = ""; }}
      />
    </NodeViewWrapper>
  );
};

export const ImageBlock = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, caption: { default: "" }, hideCaption: { default: false } };
  },
  parseHTML() { return [{ tag: "img[src]" }]; },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

/* ------------------------------------------------------------------ */
/* Image placeholder (large/oversize/failed images from Word import)   */
/* ------------------------------------------------------------------ */

const formatBytes = (b: number) => {
  if (!b) return "—";
  const mb = b / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} مگابایت`;
  return `${Math.round(b / 1024)} کیلوبایت`;
};

const ImagePlaceholderView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const { pendingSrc, bytes, contentType, reason, caption, figureNumber, originalPath, slot } =
    props.node.attrs as {
      pendingSrc?: string;
      bytes?: number;
      contentType?: string;
      reason?: string;
      caption?: string;
      figureNumber?: string;
      originalPath?: string;
      slot?: number;
    };
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const reasonLabel =
    reason === "oversize" ? "تصویر بزرگ‌تر از حد توصیه‌شده برای متن کتاب"
    : reason === "too_large" ? "تصویر بسیار حجیم — برای جلوگیری از خطا کنار گذاشته شد"
    : reason === "upload_failed" ? "بارگذاری خودکار این تصویر ناموفق بود"
    : reason === "text_only" ? "جایگاه تصویر از فایل Word حفظ شد، اما خود تصویر هنوز وارد متن نشده است"
    : "تصویر در زمان وارد کردن کتاب درج نشد";

  const replaceWithImage = (src: string) => {
    props.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: props.getPos(), to: props.getPos() + props.node.nodeSize },
        { type: "image", attrs: { src, caption: caption || "", hideCaption: false } },
      )
      .run();
  };

  const acceptPending = () => {
    if (!pendingSrc) return;
    replaceWithImage(pendingSrc);
    toast.success("تصویر در همین محل درج شد");
  };

  const onFile = async (f: File) => {
    if (!user) { toast.error("لطفاً وارد شوید"); return; }
    setBusy(true);
    const url = await uploadToBookMedia(user.id, f);
    setBusy(false);
    if (url) {
      replaceWithImage(url);
      toast.success("تصویر جدید جای پلیس‌هولدر نشست");
    }
  };

  return (
    <NodeViewWrapper className="my-4">
      <figure className="rounded-xl border border-dashed border-amber-500/60 bg-amber-500/5 overflow-hidden">
        <div className="grid sm:grid-cols-[160px_1fr] gap-3 p-3">
          <div className="relative rounded-md overflow-hidden bg-muted/40 aspect-[4/3] flex items-center justify-center">
            {pendingSrc ? (
              <img
                src={resolveBookMedia(pendingSrc)}
                alt={caption || ""}
                className="w-full h-full object-cover opacity-90"
                loading="lazy"
              />
            ) : (
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            )}
            <div className="absolute inset-x-0 bottom-0 text-[10px] text-center bg-background/80 py-0.5">
              {formatBytes(bytes || 0)}{contentType ? ` · ${contentType}` : ""}
            </div>
          </div>
          <div className="min-w-0 flex flex-col gap-2">
            <div className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              {figureNumber ? <span className="font-semibold me-1">{figureNumber}.</span> : null}
              {!figureNumber && slot ? <span className="font-semibold me-1">تصویر {slot}.</span> : null}
              {reasonLabel}. می‌توانید همین تصویر را در محل دقیق آن درج کنید یا تصویر جدیدی جایگزین کنید.
              {originalPath ? <div className="mt-1 opacity-80 break-all">{originalPath}</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingSrc && (
                <Button type="button" size="sm" onClick={acceptPending}>
                  درج همین تصویر
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="w-3.5 h-3.5 me-1" />
                {busy ? "در حال بارگذاری…" : "آپلود جایگزین"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => props.deleteNode()}>
                <Trash2 className="w-3.5 h-3.5 me-1" /> حذف
              </Button>
            </div>
            <Input
              defaultValue={caption || ""}
              placeholder="کپشن (اختیاری)…"
              className="h-8 text-xs"
              onBlur={(e) => props.updateAttributes({ caption: e.target.value })}
            />
          </div>
        </div>
      </figure>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onFile(f); e.target.value = ""; }}
      />
    </NodeViewWrapper>
  );
};

export const ImagePlaceholderBlock = Node.create({
  name: "image_placeholder",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      pendingSrc: { default: "" },
      bytes: { default: 0 },
      contentType: { default: "" },
      reason: { default: "" },
      caption: { default: "" },
      figureNumber: { default: "" },
      originalPath: { default: "" },
      slot: { default: 0 },
    };
  },
  parseHTML() { return [{ tag: "div[data-image-placeholder]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-image-placeholder": "true" })];
  },
  addNodeView() { return ReactNodeViewRenderer(ImagePlaceholderView); },
});

/* ------------------------------------------------------------------ */
/* Video (editable: URL or upload)                                     */
/* ------------------------------------------------------------------ */

const VideoView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const { src, caption } = props.node.attrs;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File) => {
    if (!user) return;
    setBusy(true);
    const url = await uploadToBookMedia(user.id, f);
    setBusy(false);
    if (url) props.updateAttributes({ src: url });
  };

  return (
    <BlockShell Icon={Film} label="ویدئو" onDelete={() => props.deleteNode()}>
      {src ? (
        <video src={resolveBookMedia(src)} controls className="w-full rounded-lg max-h-[360px] bg-black" />
      ) : (
        <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground text-sm">
          <Film className="w-6 h-6" />
          <span>{busy ? "در حال بارگذاری…" : "بدون ویدئو"}</span>
        </div>
      )}
      <div className="grid sm:grid-cols-[1fr_auto] gap-2 mt-3">
        <Input
          defaultValue={src || ""}
          placeholder="آدرس ویدئو (URL) یا فایل آپلود کنید"
          onBlur={(e) => props.updateAttributes({ src: e.target.value })}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4 me-1" /> آپلود
        </Button>
      </div>
      <Input
        defaultValue={caption || ""}
        placeholder="کپشن (اختیاری)"
        className="mt-2"
        onBlur={(e) => props.updateAttributes({ caption: e.target.value })}
      />
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onFile(f); e.target.value = ""; }}
      />
    </BlockShell>
  );
};

export const VideoBlock = Node.create({
  name: "video",
  group: "block",
  atom: true,
  addAttributes() { return { src: { default: "" }, caption: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-video]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-video": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(VideoView); },
});

/* ------------------------------------------------------------------ */
/* Imported table (readable in the editor, preserved on save)          */
/* ------------------------------------------------------------------ */

const ImportedTableView = (props: NodeViewProps) => {
  const attrs = props.node.attrs as ImportedTableAttrs;
  const headers = Array.isArray(attrs.headers) ? attrs.headers : [];
  const rows = Array.isArray(attrs.rows) ? attrs.rows : [];

  return (
    <NodeViewWrapper className="my-4 overflow-x-auto rounded-lg border bg-card/70" data-imported-table="true">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        {headers.length > 0 && (
          <thead className="bg-muted/60">
            <tr>{headers.map((h, i) => <th key={i} className="border px-3 py-2 text-start font-semibold align-top">{h}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="odd:bg-background/35">
              {row.map((cell, c) => <td key={c} className="border px-3 py-2 align-top whitespace-pre-line">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {(attrs.caption || attrs.tableNumber) && (
        <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t">
          {attrs.tableNumber && <span className="font-semibold text-foreground/75 me-1">{attrs.tableNumber}</span>}
          {attrs.caption}
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const ImportedTable = Node.create({
  name: "table",
  group: "block",
  atom: true,
  addAttributes() {
    return { headers: { default: [] }, rows: { default: [] }, caption: { default: "" }, tableNumber: { default: "" } };
  },
  parseHTML() { return [{ tag: "div[data-imported-table]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-imported-table": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(ImportedTableView); },
});

/* ------------------------------------------------------------------ */
/* Gallery (editable: add/remove images)                               */
/* ------------------------------------------------------------------ */

const GalleryView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const images: string[] = Array.isArray(props.node.attrs.images) ? props.node.attrs.images : [];
  const caption: string = props.node.attrs.caption || "";
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: FileList) => {
    if (!user || !files.length) return;
    setBusy(true);
    // Enqueue every file in parallel via the global upload manager —
    // each one shows independent progress in the floating panel and
    // the user can keep editing while uploads continue in background.
    const { uploadManager } = await import("@/lib/upload-manager");
    const promises = Array.from(files).map((f) =>
      uploadManager.enqueue({ userId: user.id, file: f, prefix: "edit", label: "گالری" }),
    );
    // As each upload finishes, append its URL to the gallery so users
    // see thumbnails arrive incrementally instead of in a single batch.
    let appended = images.slice();
    await Promise.all(
      promises.map(async (p) => {
        const url = await p;
        if (url) {
          appended = [...appended, url];
          props.updateAttributes({ images: appended });
        }
      }),
    );
    setBusy(false);
  };

  const removeAt = (i: number) => {
    const next = images.filter((_, idx) => idx !== i);
    props.updateAttributes({ images: next });
  };

  return (
    <BlockShell Icon={GalleryHorizontal} label="گالری تصاویر" onDelete={() => props.deleteNode()}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((u, i) => (
          <div key={i} className="relative group/g rounded-lg overflow-hidden border bg-secondary aspect-square">
            <img src={resolveBookMedia(u)} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded p-1 opacity-0 group-hover/g:opacity-100 transition"
              title="حذف"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground text-xs hover:bg-muted/40 transition"
        >
          <Plus className="w-5 h-5 mb-1" />
          {busy ? "..." : "افزودن"}
        </button>
      </div>
      <Input
        defaultValue={caption}
        placeholder="کپشن گالری (اختیاری)"
        className="mt-2"
        onBlur={(e) => props.updateAttributes({ caption: e.target.value })}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => { if (e.target.files) await addFiles(e.target.files); e.target.value = ""; }}
      />
    </BlockShell>
  );
};

export const GalleryBlock = Node.create({
  name: "gallery",
  group: "block",
  atom: true,
  addAttributes() { return { images: { default: [] }, caption: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-gallery]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-gallery": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(GalleryView); },
});

/* ------------------------------------------------------------------ */
/* Timeline (editable steps)                                           */
/* ------------------------------------------------------------------ */

interface StepLike { title?: string; date?: string; description?: string; image?: string }

const TimelineView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const title: string = props.node.attrs.title || "";
  const steps: StepLike[] = Array.isArray(props.node.attrs.steps) ? props.node.attrs.steps : [];
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const update = (i: number, patch: Partial<StepLike>) => {
    const next = steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    props.updateAttributes({ steps: next });
  };
  const add = () => props.updateAttributes({ steps: [...steps, { title: "", date: "", description: "", image: "" }] });
  const remove = (i: number) => props.updateAttributes({ steps: steps.filter((_, idx) => idx !== i) });
  const onFile = async (i: number, f: File) => {
    if (!user) return;
    const url = await uploadToBookMedia(user.id, f);
    if (url) update(i, { image: url });
  };

  return (
    <BlockShell Icon={ListOrdered} label="تایم‌لاین" onDelete={() => props.deleteNode()}>
      <Input
        defaultValue={title}
        placeholder="عنوان تایم‌لاین"
        className="mb-3"
        onBlur={(e) => props.updateAttributes({ title: e.target.value })}
      />
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="rounded-lg border p-2 space-y-2 bg-background/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">گام {i + 1}</span>
              <button type="button" onClick={() => remove(i)} className="ms-auto text-destructive p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-[80px_1fr] gap-2">
              <button
                type="button"
                onClick={() => fileRefs.current[i]?.click()}
                className="aspect-square rounded-md border bg-secondary overflow-hidden relative"
                title="تصویر گام"
              >
                {s.image ? (
                  <img src={resolveBookCover(s.image, { width: 160, height: 160, quality: 70 })} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Upload className="w-4 h-4" />
                  </div>
                )}
                <input
                  ref={(el) => (fileRefs.current[i] = el)}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onFile(i, f); e.target.value = ""; }}
                />
              </button>
              <div className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  <Input defaultValue={s.title || ""} placeholder="عنوان"
                    onBlur={(e) => update(i, { title: e.target.value })} />
                  <Input defaultValue={s.date || ""} placeholder="تاریخ / دوره"
                    onBlur={(e) => update(i, { date: e.target.value })} />
                </div>
                <Textarea defaultValue={s.description || ""} placeholder="توضیح"
                  onBlur={(e) => update(i, { description: e.target.value })} rows={2} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={add}>
        <Plus className="w-4 h-4 me-1" /> افزودن گام
      </Button>
    </BlockShell>
  );
};

export const TimelineBlock = Node.create({
  name: "timeline",
  group: "block",
  atom: true,
  addAttributes() { return { title: { default: "" }, steps: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-timeline]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-timeline": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(TimelineView); },
});

/* ------------------------------------------------------------------ */
/* Scrollytelling (editable steps with image)                          */
/* ------------------------------------------------------------------ */

const ScrollyView = (props: NodeViewProps) => {
  const { user } = useAuth();
  const title: string = props.node.attrs.title || "";
  const steps: StepLike[] = Array.isArray(props.node.attrs.steps) ? props.node.attrs.steps : [];
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const update = (i: number, patch: Partial<StepLike>) => {
    const next = steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    props.updateAttributes({ steps: next });
  };
  const add = () => props.updateAttributes({ steps: [...steps, { title: "", description: "", image: "" }] });
  const remove = (i: number) => props.updateAttributes({ steps: steps.filter((_, idx) => idx !== i) });
  const onFile = async (i: number, f: File) => {
    if (!user) return;
    const url = await uploadToBookMedia(user.id, f);
    if (url) update(i, { image: url });
  };

  return (
    <BlockShell Icon={Layers} label="اسکرولی‌تلینگ" onDelete={() => props.deleteNode()}>
      <Input
        defaultValue={title}
        placeholder="عنوان"
        className="mb-3"
        onBlur={(e) => props.updateAttributes({ title: e.target.value })}
      />
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="rounded-lg border p-2 bg-background/50 grid sm:grid-cols-[120px_1fr] gap-2">
            <button
              type="button"
              onClick={() => fileRefs.current[i]?.click()}
              className="aspect-square rounded-md border bg-secondary overflow-hidden relative group/sc"
            >
              {s.image ? (
                <img src={resolveBookCover(s.image, { width: 240, height: 240, quality: 72 })} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  <Upload className="w-4 h-4 me-1" /> تصویر
                </div>
              )}
              <input
                ref={(el) => (fileRefs.current[i] = el)}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onFile(i, f); e.target.value = ""; }}
              />
            </button>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">گام {i + 1}</span>
                <button type="button" onClick={() => remove(i)} className="ms-auto text-destructive p-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <Input defaultValue={s.title || ""} placeholder="عنوان"
                onBlur={(e) => update(i, { title: e.target.value })} />
              <Textarea defaultValue={s.description || ""} placeholder="توضیح"
                onBlur={(e) => update(i, { description: e.target.value })} rows={2} />
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={add}>
        <Plus className="w-4 h-4 me-1" /> افزودن گام
      </Button>
    </BlockShell>
  );
};

export const ScrollyBlock = Node.create({
  name: "scrollytelling",
  group: "block",
  atom: true,
  addAttributes() { return { title: { default: "" }, steps: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-scrolly]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-scrolly": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(ScrollyView); },
});

/* ------------------------------------------------------------------ */
/* Image upload helper — used by the toolbar                          */
/* ------------------------------------------------------------------ */

export const useImageUpload = () => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File): Promise<string | null> => {
    if (!user) { toast.error("لطفاً وارد شوید"); return null; }
    setBusy(true);
    try {
      return await uploadToBookMedia(user.id, file);
    } finally { setBusy(false); }
  };

  return { busy, upload, inputRef };
};
