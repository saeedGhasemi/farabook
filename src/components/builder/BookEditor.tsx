// Reusable book editor: powers both the create flow (no bookId) and
// the edit flow (existing bookId). Supports rich interactive blocks,
// gallery, hidden captions, autosave for edit mode.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Plus, Trash2, Image as ImageIcon, Video, Layers, Type, ArrowUp,
  ArrowDown, FileText, Quote as QuoteIcon, Lightbulb, GalleryHorizontal,
  ListOrdered, Map as MapIcon, Save, Loader2, EyeOff,
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
import { useNavigate } from "react-router-dom";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type BlockDraft =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string; author?: string }
  | { kind: "callout"; icon?: "info" | "sparkle"; text: string }
  | {
      kind: "slideshow";
      images: { src: string; caption?: string }[];
      autoplay?: boolean;
      hideCaption?: boolean;
    }
  | { kind: "gallery"; images: string[]; caption?: string }
  | {
      kind: "image";
      src: string;
      caption?: string;
      hideCaption?: boolean;
    }
  | { kind: "video"; src: string; caption?: string }
  | {
      kind: "timeline";
      title?: string;
      steps: { marker?: string; title: string; description: string }[];
    }
  | {
      kind: "scrollytelling";
      title?: string;
      steps: {
        marker?: string;
        title: string;
        description: string;
        image?: string;
        video?: string;
      }[];
    };

export interface PageDraft {
  title: string;
  blocks: BlockDraft[];
}

const newPage = (): PageDraft => ({
  title: "فصل جدید",
  blocks: [{ kind: "paragraph", text: "" }],
});

/* ------------------------------------------------------------------ */
/* Block <-> draft conversion (DB shape uses { type, ... })           */
/* ------------------------------------------------------------------ */

const blockToDraft = (b: any): BlockDraft | null => {
  if (!b || typeof b !== "object" || !b.type) return null;
  switch (b.type) {
    case "heading":
      return { kind: "heading", text: b.text || "" };
    case "paragraph":
      return { kind: "paragraph", text: b.text || "" };
    case "quote":
      return { kind: "quote", text: b.text || "", author: b.author };
    case "highlight":
      return { kind: "callout", icon: "sparkle", text: b.text || "" };
    case "callout":
      return { kind: "callout", icon: b.icon, text: b.text || "" };
    case "image":
      return {
        kind: "image",
        src: b.src || "",
        caption: b.caption || "",
        hideCaption: !!b.hideCaption,
      };
    case "gallery":
      return {
        kind: "gallery",
        images: Array.isArray(b.images) ? b.images : [],
        caption: b.caption,
      };
    case "slideshow":
      return {
        kind: "slideshow",
        images: Array.isArray(b.images) ? b.images : [],
        autoplay: b.autoplay !== false,
        hideCaption: !!b.hideCaption,
      };
    case "video":
      return { kind: "video", src: b.src || "", caption: b.caption };
    case "timeline":
      return {
        kind: "timeline",
        title: b.title,
        steps: Array.isArray(b.steps) ? b.steps : [],
      };
    case "scrollytelling":
      return {
        kind: "scrollytelling",
        title: b.title,
        steps: Array.isArray(b.steps) ? b.steps : [],
      };
    default:
      return null;
  }
};

const draftToBlock = (b: BlockDraft): any | null => {
  switch (b.kind) {
    case "heading":
      return b.text.trim() ? { type: "heading", text: b.text } : null;
    case "paragraph":
      return b.text.trim() ? { type: "paragraph", text: b.text } : null;
    case "quote":
      return b.text.trim()
        ? { type: "quote", text: b.text, author: b.author }
        : null;
    case "callout":
      return b.text.trim()
        ? { type: "callout", icon: b.icon || "info", text: b.text }
        : null;
    case "image":
      return b.src.trim()
        ? {
            type: "image",
            src: b.src,
            caption: b.caption,
            hideCaption: b.hideCaption,
          }
        : null;
    case "gallery":
      return b.images.length
        ? { type: "gallery", images: b.images, caption: b.caption }
        : null;
    case "slideshow":
      return b.images.length
        ? {
            type: "slideshow",
            images: b.images,
            autoplay: b.autoplay !== false,
            interval: 4500,
            hideCaption: b.hideCaption,
          }
        : null;
    case "video":
      return b.src.trim()
        ? { type: "video", src: b.src, caption: b.caption }
        : null;
    case "timeline":
      return b.steps.some((s) => s.title || s.description)
        ? {
            type: "timeline",
            title: b.title,
            steps: b.steps.filter((s) => s.title || s.description),
          }
        : null;
    case "scrollytelling":
      return b.steps.some((s) => s.title || s.description)
        ? {
            type: "scrollytelling",
            title: b.title,
            steps: b.steps.filter((s) => s.title || s.description),
          }
        : null;
  }
};

export const draftsFromDbPages = (pages: any[]): PageDraft[] => {
  if (!Array.isArray(pages) || !pages.length) return [newPage()];
  return pages.map((p) => ({
    title: typeof p?.title === "string" ? p.title : "فصل",
    blocks: Array.isArray(p?.blocks)
      ? (p.blocks.map(blockToDraft).filter(Boolean) as BlockDraft[])
      : [{ kind: "paragraph", text: typeof p?.content === "string" ? p.content : "" }],
  }));
};

export const draftsToDbPages = (pages: PageDraft[]): any[] =>
  pages
    .map((p) => ({
      title: p.title || "—",
      blocks: p.blocks.map(draftToBlock).filter(Boolean),
    }))
    .filter((p) => p.blocks.length > 0);

/* ------------------------------------------------------------------ */
/* Editor component                                                   */
/* ------------------------------------------------------------------ */

interface InitialBook {
  id?: string;
  title: string;
  author: string;
  description: string | null;
  cover_url: string | null;
  pages: PageDraft[];
  typography_preset?: string | null;
}

interface Props {
  /** When provided, the editor edits this book (autosave + Save). */
  initial?: InitialBook;
  /** Called when a brand-new book is created (only for create mode). */
  onCreated?: (id: string) => void;
}

export const BookEditor = ({ initial, onCreated }: Props) => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const isEdit = Boolean(initial?.id);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string>(initial?.cover_url || "");
  const [pages, setPages] = useState<PageDraft[]>(
    initial?.pages?.length ? initial.pages : [newPage()],
  );
  const [typography, setTypography] = useState<string>(
    initial?.typography_preset || "editorial",
  );
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);

  const skipFirstSave = useRef(true);

  /* ---------- mutators ---------- */
  const updatePage = (pi: number, patch: Partial<PageDraft>) => {
    setPages((ps) => ps.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
    setDirty(true);
  };
  const updateBlock = (pi: number, bi: number, patch: Partial<BlockDraft>) => {
    setPages((ps) =>
      ps.map((p, i) =>
        i === pi
          ? {
              ...p,
              blocks: p.blocks.map((b, j) =>
                j === bi ? ({ ...b, ...patch } as BlockDraft) : b,
              ),
            }
          : p,
      ),
    );
    setDirty(true);
  };
  const addBlock = (pi: number, kind: BlockDraft["kind"]) => {
    let block: BlockDraft;
    switch (kind) {
      case "heading":
        block = { kind, text: "" };
        break;
      case "paragraph":
        block = { kind, text: "" };
        break;
      case "quote":
        block = { kind, text: "", author: "" };
        break;
      case "callout":
        block = { kind, icon: "info", text: "" };
        break;
      case "image":
        block = { kind, src: "", caption: "", hideCaption: false };
        break;
      case "gallery":
        block = { kind, images: [], caption: "" };
        break;
      case "slideshow":
        block = { kind, images: [], autoplay: true, hideCaption: false };
        break;
      case "video":
        block = { kind, src: "", caption: "" };
        break;
      case "timeline":
        block = {
          kind,
          title: "",
          steps: [{ marker: "۱", title: "", description: "" }],
        };
        break;
      case "scrollytelling":
        block = {
          kind,
          title: "",
          steps: [{ marker: "مرحله ۱", title: "", description: "" }],
        };
        break;
    }
    setPages((ps) =>
      ps.map((p, i) => (i === pi ? { ...p, blocks: [...p.blocks, block] } : p)),
    );
    setDirty(true);
  };
  const removeBlock = (pi: number, bi: number) => {
    setPages((ps) =>
      ps.map((p, i) =>
        i === pi ? { ...p, blocks: p.blocks.filter((_, j) => j !== bi) } : p,
      ),
    );
    setDirty(true);
  };
  const moveBlock = (pi: number, bi: number, dir: -1 | 1) => {
    setPages((ps) =>
      ps.map((p, i) => {
        if (i !== pi) return p;
        const arr = [...p.blocks];
        const j = bi + dir;
        if (j < 0 || j >= arr.length) return p;
        [arr[bi], arr[j]] = [arr[j], arr[bi]];
        return { ...p, blocks: arr };
      }),
    );
    setDirty(true);
  };
  const movePage = (pi: number, dir: -1 | 1) => {
    setPages((ps) => {
      const arr = [...ps];
      const j = pi + dir;
      if (j < 0 || j >= arr.length) return ps;
      [arr[pi], arr[j]] = [arr[j], arr[pi]];
      return arr;
    });
    setDirty(true);
  };

  /* ---------- upload helper ---------- */
  const uploadToBucket = async (
    file: File,
    prefix = "edit",
  ): Promise<string | null> => {
    if (!user) return null;
    const ext = file.name.split(".").pop() || "jpg";
    const key = `${user.id}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("book-media")
      .upload(key, file, { contentType: file.type, upsert: false });
    if (error) {
      toast.error(error.message);
      return null;
    }
    const { data } = supabase.storage.from("book-media").getPublicUrl(key);
    return data.publicUrl;
  };

  /* ---------- autosave (edit mode) ---------- */
  const persistDraft = useCallback(
    async (showToast = false) => {
      if (!isEdit || !initial?.id || !user) return;
      setSavingDraft(true);
      try {
        const dbPages = draftsToDbPages(pages);
        let cover = coverUrl || initial.cover_url || "/placeholder.svg";
        if (coverFile) {
          const url = await uploadToBucket(coverFile, "covers");
          if (url) cover = url;
          setCoverFile(null);
          setCoverUrl(cover);
        }
        const { error } = await supabase
          .from("books")
          .update({
            title: title || initial.title,
            author: author || initial.author,
            description: description || null,
            cover_url: cover,
            pages: dbPages,
            typography_preset: typography,
          })
          .eq("id", initial.id);
        if (error) throw error;
        setLastSavedAt(new Date());
        setDirty(false);
        if (showToast) toast.success(lang === "fa" ? "ذخیره شد" : "Saved");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSavingDraft(false);
      }
    },
    [isEdit, initial, user, pages, title, author, description, coverFile, coverUrl, typography, lang],
  );

  // Autosave: debounce 4s after any change in edit mode
  useEffect(() => {
    if (!isEdit) return;
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    if (!dirty) return;
    const t = window.setTimeout(() => {
      persistDraft(false);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [pages, title, author, description, typography, dirty, isEdit, persistDraft]);

  /* ---------- create new book ---------- */
  const submitCreate = async () => {
    if (!user) {
      nav("/auth");
      return;
    }
    if (!title.trim()) {
      toast.error(lang === "fa" ? "عنوان لازم است" : "Title required");
      return;
    }
    setBusy(true);
    try {
      let cover = "/placeholder.svg";
      if (coverFile) {
        const url = await uploadToBucket(coverFile, "covers");
        if (url) cover = url;
      }

      const dbPages = draftsToDbPages(pages);
      if (!dbPages.length) {
        toast.error(
          lang === "fa"
            ? "حداقل یک بلوک با محتوا اضافه کنید"
            : "Add at least one block",
        );
        setBusy(false);
        return;
      }

      // Cover fallback from first image
      if (cover === "/placeholder.svg") {
        outer: for (const p of dbPages) {
          for (const b of p.blocks as Array<{
            type: string;
            src?: string;
            images?: any;
          }>) {
            if (b.type === "image" && b.src) {
              cover = b.src;
              break outer;
            }
            if (b.type === "slideshow" && b.images?.[0]?.src) {
              cover = b.images[0].src;
              break outer;
            }
            if (b.type === "gallery" && b.images?.[0]) {
              cover = b.images[0];
              break outer;
            }
          }
        }
      }

      const { data: book, error: insErr } = await supabase
        .from("books")
        .insert({
          title,
          author: author || (lang === "fa" ? "ناشناس" : "Unknown"),
          description,
          ambient_theme: "paper",
          category: lang === "fa" ? "کتاب کاربر" : "User book",
          cover_url: cover,
          price: 0,
          pages: dbPages,
          publisher_id: user.id,
          status: "draft",
        })
        .select("id")
        .single();
      if (insErr || !book) throw insErr || new Error("insert failed");

      await supabase.from("user_books").insert({
        user_id: user.id,
        book_id: book.id,
        acquired_via: "upload",
        status: "unread",
      });

      toast.success(lang === "fa" ? "پیش‌نویس ساخته شد" : "Draft created");
      onCreated?.(book.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- block editors (inline UI) ---------- */
  const BlockEditor = useMemo(
    () =>
      ({ b, pi, bi }: { b: BlockDraft; pi: number; bi: number }) => {
        const Header = (
          <div className="flex items-center justify-between mb-2">
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              {b.kind}
            </Badge>
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveBlock(pi, bi, -1)}
                className="p-1 rounded hover:bg-foreground/5"
                aria-label="up"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => moveBlock(pi, bi, 1)}
                className="p-1 rounded hover:bg-foreground/5"
                aria-label="down"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => removeBlock(pi, bi)}
                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                aria-label="remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );

        const wrap = "p-3 rounded-xl bg-foreground/[0.03] border border-glass-border space-y-2";

        switch (b.kind) {
          case "heading":
            return (
              <div className={wrap}>
                {Header}
                <Input
                  value={b.text}
                  onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
                  placeholder={lang === "fa" ? "عنوان زیربخش" : "Subheading"}
                />
              </div>
            );
          case "paragraph":
            return (
              <div className={wrap}>
                {Header}
                <Textarea
                  value={b.text}
                  onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
                  rows={4}
                  placeholder={lang === "fa" ? "متن پاراگراف…" : "Paragraph text…"}
                />
              </div>
            );
          case "quote":
            return (
              <div className={wrap}>
                {Header}
                <Textarea
                  value={b.text}
                  onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
                  rows={2}
                  placeholder={lang === "fa" ? "نقل قول…" : "Quote…"}
                />
                <Input
                  value={b.author || ""}
                  onChange={(e) => updateBlock(pi, bi, { author: e.target.value })}
                  placeholder={lang === "fa" ? "گوینده (اختیاری)" : "Author (optional)"}
                />
              </div>
            );
          case "callout":
            return (
              <div className={wrap}>
                {Header}
                <div className="flex gap-2">
                  <select
                    value={b.icon || "info"}
                    onChange={(e) =>
                      updateBlock(pi, bi, { icon: e.target.value as any })
                    }
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="info">{lang === "fa" ? "نکته" : "Info"}</option>
                    <option value="sparkle">{lang === "fa" ? "برجسته" : "Highlight"}</option>
                  </select>
                  <Textarea
                    value={b.text}
                    onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
                    rows={2}
                    placeholder={lang === "fa" ? "متن نکته…" : "Callout text…"}
                  />
                </div>
              </div>
            );
          case "image":
            return (
              <div className={wrap}>
                {Header}
                {b.src ? (
                  <div className="relative">
                    <img src={b.src} alt="" className="w-full max-h-48 object-cover rounded-lg" />
                    <button
                      onClick={() => updateBlock(pi, bi, { src: "" })}
                      className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await uploadToBucket(f, "img");
                      if (url) updateBlock(pi, bi, { src: url });
                      e.target.value = "";
                    }}
                    className="text-sm"
                  />
                )}
                <Input
                  value={b.caption || ""}
                  onChange={(e) => updateBlock(pi, bi, { caption: e.target.value })}
                  placeholder={lang === "fa" ? "زیرنویس" : "Caption"}
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={b.hideCaption || false}
                    onChange={(e) => updateBlock(pi, bi, { hideCaption: e.target.checked })}
                  />
                  <EyeOff className="w-3 h-3" />
                  {lang === "fa"
                    ? "زیرنویس به‌صورت پیش‌فرض مخفی، با هاور/تَپ نمایش"
                    : "Hide caption by default, reveal on hover/tap"}
                </label>
              </div>
            );
          case "gallery":
            return (
              <div className={wrap}>
                {Header}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    const uploaded: string[] = [];
                    for (const f of files) {
                      const url = await uploadToBucket(f, "gallery");
                      if (url) uploaded.push(url);
                    }
                    updateBlock(pi, bi, { images: [...b.images, ...uploaded] });
                    e.target.value = "";
                  }}
                  className="text-sm"
                />
                {b.images.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {b.images.map((src, idx) => (
                      <div key={idx} className="relative group">
                        <img src={src} alt="" className="w-full h-20 object-cover rounded-lg" />
                        <button
                          onClick={() =>
                            updateBlock(pi, bi, {
                              images: b.images.filter((_, k) => k !== idx),
                            })
                          }
                          className="absolute top-1 end-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Input
                  value={b.caption || ""}
                  onChange={(e) => updateBlock(pi, bi, { caption: e.target.value })}
                  placeholder={lang === "fa" ? "زیرنویس کلی گالری" : "Gallery caption"}
                />
              </div>
            );
          case "slideshow":
            return (
              <div className={wrap}>
                {Header}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    const uploaded: { src: string; caption?: string }[] = [];
                    for (const f of files) {
                      const url = await uploadToBucket(f, "slides");
                      if (url) uploaded.push({ src: url, caption: "" });
                    }
                    updateBlock(pi, bi, { images: [...b.images, ...uploaded] });
                    e.target.value = "";
                  }}
                  className="text-sm"
                />
                {b.images.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {b.images.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <img src={img.src} alt="" className="w-full h-20 object-cover rounded-lg" />
                        <button
                          onClick={() =>
                            updateBlock(pi, bi, {
                              images: b.images.filter((_, k) => k !== idx),
                            })
                          }
                          className="absolute top-1 end-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <Input
                          value={img.caption || ""}
                          onChange={(e) =>
                            updateBlock(pi, bi, {
                              images: b.images.map((x, k) =>
                                k === idx ? { ...x, caption: e.target.value } : x,
                              ),
                            })
                          }
                          placeholder={lang === "fa" ? "زیرنویس" : "Caption"}
                          className="mt-1 h-7 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={b.autoplay !== false}
                      onChange={(e) => updateBlock(pi, bi, { autoplay: e.target.checked })}
                    />
                    {lang === "fa" ? "پخش خودکار" : "Autoplay"}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={b.hideCaption || false}
                      onChange={(e) => updateBlock(pi, bi, { hideCaption: e.target.checked })}
                    />
                    <EyeOff className="w-3 h-3" />
                    {lang === "fa" ? "کپشن مخفی (هاور)" : "Hidden caption (reveal on hover)"}
                  </label>
                </div>
              </div>
            );
          case "video":
            return (
              <div className={wrap}>
                {Header}
                <Input
                  value={b.src}
                  onChange={(e) => updateBlock(pi, bi, { src: e.target.value })}
                  placeholder={
                    lang === "fa"
                      ? "لینک YouTube/Vimeo یا MP4"
                      : "YouTube/Vimeo URL or MP4 link"
                  }
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    {lang === "fa" ? "یا آپلود:" : "or upload:"}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await uploadToBucket(f, "videos");
                      if (url) updateBlock(pi, bi, { src: url });
                      e.target.value = "";
                    }}
                    className="text-sm flex-1"
                  />
                </div>
                <Input
                  value={b.caption || ""}
                  onChange={(e) => updateBlock(pi, bi, { caption: e.target.value })}
                  placeholder={lang === "fa" ? "زیرنویس (اختیاری)" : "Caption (optional)"}
                />
              </div>
            );
          case "timeline":
            return (
              <div className={wrap}>
                {Header}
                <Input
                  value={b.title || ""}
                  onChange={(e) => updateBlock(pi, bi, { title: e.target.value })}
                  placeholder={lang === "fa" ? "عنوان تایم‌لاین" : "Timeline title"}
                />
                {b.steps.map((s, si) => (
                  <div
                    key={si}
                    className="p-2 rounded-lg bg-background/40 border border-border space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-accent">
                        {lang === "fa" ? `نقطه ${si + 1}` : `Point ${si + 1}`}
                      </span>
                      <button
                        onClick={() =>
                          updateBlock(pi, bi, {
                            steps: b.steps.filter((_, k) => k !== si),
                          })
                        }
                        className="p-1 rounded hover:bg-destructive/10 text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <Input
                      value={s.marker || ""}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, marker: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "برچسب (مثلاً ۱۹۸۵)" : "Marker (e.g. 1985)"}
                    />
                    <Input
                      value={s.title}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, title: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "عنوان نقطه" : "Point title"}
                    />
                    <Textarea
                      value={s.description}
                      rows={2}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, description: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "توضیح نقطه" : "Point description"}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateBlock(pi, bi, {
                      steps: [
                        ...b.steps,
                        { marker: `${b.steps.length + 1}`, title: "", description: "" },
                      ],
                    })
                  }
                >
                  <Plus className="w-3 h-3 me-1" />
                  {lang === "fa" ? "افزودن نقطه" : "Add point"}
                </Button>
              </div>
            );
          case "scrollytelling":
            return (
              <div className={wrap}>
                {Header}
                <Input
                  value={b.title || ""}
                  onChange={(e) => updateBlock(pi, bi, { title: e.target.value })}
                  placeholder={lang === "fa" ? "عنوان فرآیند" : "Process title"}
                />
                {b.steps.map((s, si) => (
                  <div
                    key={si}
                    className="p-2 rounded-lg bg-background/40 border border-border space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-accent">
                        {lang === "fa" ? `مرحله ${si + 1}` : `Step ${si + 1}`}
                      </span>
                      <button
                        onClick={() =>
                          updateBlock(pi, bi, {
                            steps: b.steps.filter((_, k) => k !== si),
                          })
                        }
                        className="p-1 rounded hover:bg-destructive/10 text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <Input
                      value={s.marker || ""}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, marker: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "برچسب (مثلاً «مرحله ۱»)" : "Marker"}
                    />
                    <Input
                      value={s.title}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, title: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "عنوان مرحله" : "Step title"}
                    />
                    <Textarea
                      value={s.description}
                      rows={2}
                      onChange={(e) =>
                        updateBlock(pi, bi, {
                          steps: b.steps.map((x, k) =>
                            k === si ? { ...x, description: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder={lang === "fa" ? "توضیح مرحله" : "Step description"}
                    />
                    <div className="flex gap-2 items-center">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const url = await uploadToBucket(f, "scrolly");
                          if (url)
                            updateBlock(pi, bi, {
                              steps: b.steps.map((x, k) =>
                                k === si ? { ...x, image: url } : x,
                              ),
                            });
                          e.target.value = "";
                        }}
                        className="text-xs flex-1"
                      />
                      {s.image && (
                        <img src={s.image} alt="" className="w-12 h-9 object-cover rounded" />
                      )}
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateBlock(pi, bi, {
                      steps: [
                        ...b.steps,
                        {
                          marker: `مرحله ${b.steps.length + 1}`,
                          title: "",
                          description: "",
                        },
                      ],
                    })
                  }
                >
                  <Plus className="w-3 h-3 me-1" />
                  {lang === "fa" ? "افزودن مرحله" : "Add step"}
                </Button>
              </div>
            );
        }
      },
    [lang],
  );

  /* ---------- render ---------- */

  const blockButtons: { kind: BlockDraft["kind"]; icon: any; label: { fa: string; en: string } }[] = [
    { kind: "paragraph", icon: Type, label: { fa: "متن", en: "Text" } },
    { kind: "heading", icon: FileText, label: { fa: "عنوان", en: "Heading" } },
    { kind: "quote", icon: QuoteIcon, label: { fa: "نقل قول", en: "Quote" } },
    { kind: "callout", icon: Lightbulb, label: { fa: "نکته", en: "Callout" } },
    { kind: "image", icon: ImageIcon, label: { fa: "تصویر", en: "Image" } },
    { kind: "gallery", icon: GalleryHorizontal, label: { fa: "گالری", en: "Gallery" } },
    { kind: "slideshow", icon: ImageIcon, label: { fa: "اسلایدشو", en: "Slideshow" } },
    { kind: "video", icon: Video, label: { fa: "ویدیو", en: "Video" } },
    { kind: "timeline", icon: ListOrdered, label: { fa: "تایم‌لاین", en: "Timeline" } },
    { kind: "scrollytelling", icon: Layers, label: { fa: "اسکرول-محور", en: "Scrollytelling" } },
  ];

  return (
    <div className="space-y-6">
      {/* Book metadata */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div>
          <Label>{lang === "fa" ? "عنوان کتاب *" : "Title *"}</Label>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            className="mt-1"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>{lang === "fa" ? "نویسنده" : "Author"}</Label>
            <Input
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                setDirty(true);
              }}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{lang === "fa" ? "جلد" : "Cover"}</Label>
            {coverUrl && (
              <div className="mt-1 flex items-center gap-2">
                <img src={coverUrl} alt="" className="w-10 h-14 object-cover rounded" />
                <span className="text-xs text-muted-foreground truncate">
                  {lang === "fa" ? "جلد فعلی" : "Current cover"}
                </span>
              </div>
            )}
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setCoverFile(e.target.files?.[0] ?? null);
                setDirty(true);
              }}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label>{lang === "fa" ? "توضیحات" : "Description"}</Label>
          <Textarea
            value={description || ""}
            rows={2}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            className="mt-1"
          />
        </div>
      </div>

      {/* Pages */}
      {pages.map((page, pi) => (
        <motion.section
          key={pi}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-strong rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 flex items-center gap-2">
              <Badge variant="outline" className="shrink-0 tabular-nums">
                {pi + 1} / {pages.length}
              </Badge>
              <Input
                value={page.title}
                onChange={(e) => updatePage(pi, { title: e.target.value })}
                placeholder={lang === "fa" ? "عنوان فصل" : "Chapter title"}
                className="font-display font-bold"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => movePage(pi, -1)}
                disabled={pi === 0}
                className="p-2 rounded-lg hover:bg-foreground/5 disabled:opacity-30"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => movePage(pi, 1)}
                disabled={pi === pages.length - 1}
                className="p-2 rounded-lg hover:bg-foreground/5 disabled:opacity-30"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setPages((ps) => ps.filter((_, i) => i !== pi));
                  setDirty(true);
                }}
                disabled={pages.length === 1}
                className="p-2 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-30"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {page.blocks.map((b, bi) => (
              <BlockEditor key={bi} b={b} pi={pi} bi={bi} />
            ))}
          </div>

          {/* Add block buttons */}
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
            {blockButtons.map(({ kind, icon: Icon, label }) => (
              <Button
                key={kind}
                size="sm"
                variant="outline"
                onClick={() => addBlock(pi, kind)}
                className="h-8 text-xs"
              >
                <Icon className="w-3 h-3 me-1" />
                {label[lang]}
              </Button>
            ))}
          </div>
        </motion.section>
      ))}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setPages((ps) => [...ps, newPage()]);
          setDirty(true);
        }}
      >
        <Plus className="w-4 h-4 me-2" />
        {lang === "fa" ? "افزودن فصل" : "Add chapter"}
      </Button>

      {/* Bottom action bar */}
      {isEdit ? (
        <div className="sticky bottom-4 z-30">
          <div className="glass-strong rounded-2xl p-3 flex items-center justify-between gap-3 shadow-elegant">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {savingDraft ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {lang === "fa" ? "در حال ذخیره…" : "Saving…"}
                </>
              ) : dirty ? (
                <span>{lang === "fa" ? "تغییرات ذخیره‌نشده" : "Unsaved changes"}</span>
              ) : lastSavedAt ? (
                <span>
                  {lang === "fa" ? "آخرین ذخیره: " : "Last saved: "}
                  {lastSavedAt.toLocaleTimeString()}
                </span>
              ) : (
                <span>{lang === "fa" ? "ذخیره خودکار فعال" : "Autosave on"}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => initial?.id && nav(`/read/${initial.id}`)}
              >
                {lang === "fa" ? "پیش‌نمایش" : "Preview"}
              </Button>
              <Button
                size="sm"
                onClick={() => persistDraft(true)}
                className="bg-gradient-warm hover:opacity-90"
              >
                <Save className="w-3.5 h-3.5 me-1.5" />
                {lang === "fa" ? "ذخیره" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          onClick={submitCreate}
          disabled={busy}
          className="w-full bg-gradient-warm hover:opacity-90 h-12"
        >
          {busy
            ? lang === "fa"
              ? "در حال ذخیره…"
              : "Saving…"
            : lang === "fa"
            ? "ساخت پیش‌نویس و ادامه ویرایش"
            : "Create draft & continue"}
        </Button>
      )}
    </div>
  );
};
