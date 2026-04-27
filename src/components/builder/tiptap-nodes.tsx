// Custom Tiptap nodes used by the new TextBookEditor. We keep these
// minimal — text-bearing blocks (callout) are editable, media-style
// blocks (image/video/gallery/timeline/scrollytelling) are atom nodes
// with a small inline preview + delete button.
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { resolveBookMedia } from "@/lib/book-media";
import { Trash2, Image as ImageIcon, Film, GalleryHorizontal, ListOrdered, Lightbulb, AlertTriangle, Info, CheckCircle2, ShieldAlert, Pencil, HelpCircle, Quote as QuoteIcon } from "lucide-react";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

/* ------------------------------------------------------------------ */
/* Callout — text-bearing wrapper with a variant                      */
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
        <div className="flex-1 min-w-0 [&>p]:my-0 [&>p]:leading-relaxed text-[0.95em]" >
          {/* @ts-expect-error -- Tiptap renders children via contentEditable */}
          <span data-tiptap-content />
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      variant: { default: "info" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]", getAttrs: (el) => ({ variant: (el as HTMLElement).getAttribute("data-callout") || "info" }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": HTMLAttributes.variant }), 0];
  },
});

/* ------------------------------------------------------------------ */
/* Quote — block-level with optional author                           */
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
/* Image with caption + delete                                        */
/* ------------------------------------------------------------------ */

const ImageView = (props: NodeViewProps) => {
  const { src, caption, hideCaption } = props.node.attrs;
  return (
    <NodeViewWrapper className="my-4 group/img relative">
      <figure className="overflow-hidden rounded-xl border bg-secondary">
        {src ? (
          <img src={resolveBookMedia(src)} alt={caption || ""} className="w-full max-h-[420px] object-cover" />
        ) : (
          <div className="aspect-video flex items-center justify-center text-muted-foreground text-sm">
            <ImageIcon className="w-5 h-5 me-2" /> بدون تصویر
          </div>
        )}
        {!hideCaption && caption && (
          <figcaption className="text-xs text-muted-foreground p-2 text-center">{caption}</figcaption>
        )}
      </figure>
      <button
        type="button"
        onClick={() => props.deleteNode()}
        className="absolute top-2 left-2 opacity-0 group-hover/img:opacity-100 transition bg-destructive text-destructive-foreground rounded-md p-1.5 shadow"
        title="حذف"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <input
        type="text"
        defaultValue={caption || ""}
        placeholder="کپشن (اختیاری)…"
        onBlur={(e) => props.updateAttributes({ caption: e.target.value })}
        className="mt-1 w-full bg-transparent text-xs text-center text-muted-foreground border-b border-dashed border-transparent focus:border-border outline-none px-2 py-1"
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
    return {
      src: { default: "" },
      caption: { default: "" },
      hideCaption: { default: false },
    };
  },
  parseHTML() { return [{ tag: "img[src]" }]; },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

/* ------------------------------------------------------------------ */
/* Video / Gallery / Timeline / Scrollytelling — read-only previews   */
/* ------------------------------------------------------------------ */

const SimplePreview = (
  Icon: any,
  label: string,
) => (props: NodeViewProps) => (
  <NodeViewWrapper className="my-3 group/blk relative">
    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm">
      <Icon className="w-4 h-4 text-accent" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ms-auto text-[10px] text-muted-foreground/70">برای ویرایش پیشرفته از حالت قبلی استفاده کنید</span>
      <button type="button" onClick={() => props.deleteNode()} className="opacity-0 group-hover/blk:opacity-100 transition text-destructive p-1">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  </NodeViewWrapper>
);

export const VideoBlock = Node.create({
  name: "video",
  group: "block",
  atom: true,
  addAttributes() { return { src: { default: "" }, caption: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-video]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-video": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(SimplePreview(Film, "ویدئو")); },
});

export const GalleryBlock = Node.create({
  name: "gallery",
  group: "block",
  atom: true,
  addAttributes() { return { images: { default: [] }, caption: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-gallery]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-gallery": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(SimplePreview(GalleryHorizontal, "گالری تصاویر")); },
});

export const TimelineBlock = Node.create({
  name: "timeline",
  group: "block",
  atom: true,
  addAttributes() { return { title: { default: "" }, steps: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-timeline]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-timeline": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(SimplePreview(ListOrdered, "تایم‌لاین")); },
});

export const ScrollyBlock = Node.create({
  name: "scrollytelling",
  group: "block",
  atom: true,
  addAttributes() { return { title: { default: "" }, steps: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-scrolly]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-scrolly": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(SimplePreview(ListOrdered, "اسکرولی")); },
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
      const ext = file.name.split(".").pop() || "jpg";
      const key = `${user.id}/edit/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("book-media").upload(key, file, { contentType: file.type });
      if (error) { toast.error(error.message); return null; }
      const { data } = supabase.storage.from("book-media").getPublicUrl(key);
      return data.publicUrl;
    } finally { setBusy(false); }
  };

  return { busy, upload, inputRef };
};
