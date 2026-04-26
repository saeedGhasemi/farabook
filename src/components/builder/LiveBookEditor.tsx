// Live WYSIWYG Book Editor
// Three-pane layout:
//   • LEFT  – page thumbnails sidebar (fast nav, add/delete/reorder)
//   • CENTER – live preview of the active page using <BlockRenderer>
//              (same components the Reader shows). Click a block to select.
//              Click the "+" between blocks to insert. Press "/" inside a
//              text block while editing to open the quick-insert menu.
//   • RIGHT – inspector panel: edits the currently-selected block with
//             rich controls (uploads, hotspots, timeline steps, …).
//
// Designed so a 100- or 500-page book stays usable: only the active page
// renders in the center; the sidebar shows lightweight thumbnails.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Image as ImageIcon, Video, Layers, Type, ChevronUp,
  ChevronDown, FileText, Quote as QuoteIcon, Lightbulb, GalleryHorizontal,
  ListOrdered, Save, Loader2, EyeOff, Rocket, Eye, X, Copy,
  PanelLeft, PanelRight, Sparkles, GripVertical, FileImage, Scissors,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { BlockRenderer, type Block } from "@/components/reader/BlockRenderer";
import {
  type BlockDraft,
  type PageDraft,
  draftsToDbPages,
} from "./BookEditor";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const newPage = (title = "فصل جدید"): PageDraft => ({
  title,
  blocks: [{ kind: "paragraph", text: "" }],
});

/** Turn a draft block into the runtime Block the reader understands. */
const draftToRuntimeBlock = (b: BlockDraft): Block | null => {
  switch (b.kind) {
    case "heading":
      return { type: "heading", text: b.text || "" };
    case "paragraph":
      return { type: "paragraph", text: b.text || "" };
    case "quote":
      return { type: "quote", text: b.text || "", author: b.author };
    case "callout":
      return b.icon === "sparkle"
        ? { type: "highlight", text: b.text || "" }
        : { type: "callout", icon: b.icon || "info", text: b.text || "" };
    case "image":
      return {
        type: "image",
        src: b.src || "",
        caption: b.caption,
        hideCaption: b.hideCaption,
      };
    case "gallery":
      return { type: "gallery", images: b.images, caption: b.caption };
    case "slideshow":
      return {
        type: "slideshow",
        images: b.images,
        autoplay: b.autoplay !== false,
        interval: 4500,
        hideCaption: b.hideCaption,
      };
    case "video":
      return { type: "video", src: b.src || "", caption: b.caption };
    case "timeline":
      return { type: "timeline", title: b.title, steps: b.steps as any };
    case "scrollytelling":
      return { type: "scrollytelling", title: b.title, steps: b.steps as any };
  }
};

const newBlock = (kind: BlockDraft["kind"]): BlockDraft => {
  switch (kind) {
    case "heading":
      return { kind, text: "" };
    case "paragraph":
      return { kind, text: "" };
    case "quote":
      return { kind, text: "", author: "" };
    case "callout":
      return { kind, icon: "info", text: "" };
    case "image":
      return { kind, src: "", caption: "", hideCaption: false };
    case "gallery":
      return { kind, images: [], caption: "" };
    case "slideshow":
      return { kind, images: [], autoplay: true, hideCaption: false };
    case "video":
      return { kind, src: "", caption: "" };
    case "timeline":
      return { kind, title: "", steps: [{ marker: "۱", title: "", description: "" }] };
    case "scrollytelling":
      return { kind, title: "", steps: [{ marker: "مرحله ۱", title: "", description: "" }] };
  }
};

/** Short single-line summary for the sidebar thumbnails. */
const blockSummary = (b: BlockDraft, lang: "fa" | "en"): string => {
  const fa = lang === "fa";
  switch (b.kind) {
    case "heading":     return b.text || (fa ? "عنوان…" : "Heading…");
    case "paragraph":   return b.text || (fa ? "متن…" : "Text…");
    case "quote":       return b.text ? `❝ ${b.text}` : (fa ? "نقل قول…" : "Quote…");
    case "callout":     return `💡 ${b.text || (fa ? "نکته…" : "Callout…")}`;
    case "image":       return b.src ? (fa ? "🖼 تصویر" : "🖼 Image") : (fa ? "🖼 (خالی)" : "🖼 (empty)");
    case "gallery":     return fa ? `🗂 گالری · ${b.images.length}` : `🗂 Gallery · ${b.images.length}`;
    case "slideshow":   return fa ? `🎞 اسلایدشو · ${b.images.length}` : `🎞 Slideshow · ${b.images.length}`;
    case "video":       return fa ? "🎬 ویدیو" : "🎬 Video";
    case "timeline":    return fa ? `📅 تایم‌لاین · ${b.steps.length}` : `📅 Timeline · ${b.steps.length}`;
    case "scrollytelling": return fa ? `📜 اسکرولی · ${b.steps.length}` : `📜 Scrolly · ${b.steps.length}`;
  }
};

const blockKindLabels = (lang: "fa" | "en") => ({
  paragraph: lang === "fa" ? "متن" : "Text",
  heading: lang === "fa" ? "عنوان" : "Heading",
  quote: lang === "fa" ? "نقل قول" : "Quote",
  callout: lang === "fa" ? "نکته" : "Callout",
  image: lang === "fa" ? "تصویر" : "Image",
  gallery: lang === "fa" ? "گالری" : "Gallery",
  slideshow: lang === "fa" ? "اسلایدشو" : "Slideshow",
  video: lang === "fa" ? "ویدیو" : "Video",
  timeline: lang === "fa" ? "تایم‌لاین" : "Timeline",
  scrollytelling: lang === "fa" ? "اسکرول-محور" : "Scrollytelling",
});

const BLOCK_PALETTE: { kind: BlockDraft["kind"]; icon: any }[] = [
  { kind: "paragraph", icon: Type },
  { kind: "heading", icon: FileText },
  { kind: "quote", icon: QuoteIcon },
  { kind: "callout", icon: Lightbulb },
  { kind: "image", icon: ImageIcon },
  { kind: "gallery", icon: GalleryHorizontal },
  { kind: "slideshow", icon: FileImage },
  { kind: "video", icon: Video },
  { kind: "timeline", icon: ListOrdered },
  { kind: "scrollytelling", icon: Layers },
];

/* ------------------------------------------------------------------ */
/*  Props                                                             */
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
  initial?: InitialBook;
  onCreated?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Quick-insert popover (used by the "+" buttons & slash command)    */
/* ------------------------------------------------------------------ */

const QuickInsert = ({
  onPick,
  onClose,
  lang,
}: {
  onPick: (k: BlockDraft["kind"]) => void;
  onClose: () => void;
  lang: "fa" | "en";
}) => {
  const labels = blockKindLabels(lang);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="absolute z-50 mt-1 glass-strong rounded-xl border border-glass-border shadow-elegant p-1.5 grid grid-cols-2 gap-1 w-64"
      onClick={(e) => e.stopPropagation()}
    >
      {BLOCK_PALETTE.map(({ kind, icon: Icon }) => (
        <button
          key={kind}
          onClick={() => { onPick(kind); onClose(); }}
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 text-sm text-start transition-colors"
        >
          <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="truncate">{labels[kind]}</span>
        </button>
      ))}
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main editor                                                       */
/* ------------------------------------------------------------------ */

export const LiveBookEditor = ({ initial, onCreated }: Props) => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const isEdit = Boolean(initial?.id);
  const labels = blockKindLabels(lang);

  /* ---------- state ---------- */
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

  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null); // shows QuickInsert at this position
  const [showLeftPane, setShowLeftPane] = useState(true);
  const [showRightPane, setShowRightPane] = useState(true);
  const [showMeta, setShowMeta] = useState(!isEdit); // always show in create mode

  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const skipFirstSave = useRef(true);

  // Clamp activePageIdx if pages shrink
  useEffect(() => {
    if (activePageIdx >= pages.length) setActivePageIdx(Math.max(0, pages.length - 1));
  }, [pages.length, activePageIdx]);

  const activePage = pages[activePageIdx];
  const selectedBlock =
    selectedBlockIdx !== null ? activePage?.blocks[selectedBlockIdx] : null;

  /* ---------- mutators ---------- */
  const markDirty = () => setDirty(true);

  const updatePage = (pi: number, patch: Partial<PageDraft>) => {
    setPages((ps) => ps.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
    markDirty();
  };

  const updateBlock = useCallback(
    (pi: number, bi: number, patch: Partial<BlockDraft>) => {
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
      markDirty();
    },
    [],
  );

  const replaceBlock = useCallback(
    (pi: number, bi: number, next: BlockDraft) => {
      setPages((ps) =>
        ps.map((p, i) =>
          i === pi
            ? { ...p, blocks: p.blocks.map((b, j) => (j === bi ? next : b)) }
            : p,
        ),
      );
      markDirty();
    },
    [],
  );

  const insertBlock = (pi: number, at: number, kind: BlockDraft["kind"]) => {
    const block = newBlock(kind);
    setPages((ps) =>
      ps.map((p, i) => {
        if (i !== pi) return p;
        const arr = [...p.blocks];
        arr.splice(at, 0, block);
        return { ...p, blocks: arr };
      }),
    );
    setSelectedBlockIdx(at);
    markDirty();
  };

  const removeBlock = (pi: number, bi: number) => {
    setPages((ps) =>
      ps.map((p, i) =>
        i === pi ? { ...p, blocks: p.blocks.filter((_, j) => j !== bi) } : p,
      ),
    );
    setSelectedBlockIdx(null);
    markDirty();
  };

  const duplicateBlock = (pi: number, bi: number) => {
    setPages((ps) =>
      ps.map((p, i) => {
        if (i !== pi) return p;
        const arr = [...p.blocks];
        arr.splice(bi + 1, 0, JSON.parse(JSON.stringify(arr[bi])));
        return { ...p, blocks: arr };
      }),
    );
    setSelectedBlockIdx(bi + 1);
    markDirty();
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
    if (selectedBlockIdx === bi) setSelectedBlockIdx(bi + dir);
    markDirty();
  };

  const addPage = () => {
    setPages((ps) => [...ps, newPage(lang === "fa" ? "فصل جدید" : "New chapter")]);
    setActivePageIdx(pages.length);
    setSelectedBlockIdx(0);
    markDirty();
  };

  const removePage = (pi: number) => {
    if (pages.length <= 1) return;
    setPages((ps) => ps.filter((_, i) => i !== pi));
    if (activePageIdx >= pi) setActivePageIdx((x) => Math.max(0, x - 1));
    setSelectedBlockIdx(null);
    markDirty();
  };

  const duplicatePage = (pi: number) => {
    setPages((ps) => {
      const arr = [...ps];
      arr.splice(pi + 1, 0, JSON.parse(JSON.stringify(arr[pi])));
      return arr;
    });
    setActivePageIdx(pi + 1);
    markDirty();
  };

  const movePage = (pi: number, dir: -1 | 1) => {
    setPages((ps) => {
      const arr = [...ps];
      const j = pi + dir;
      if (j < 0 || j >= arr.length) return ps;
      [arr[pi], arr[j]] = [arr[j], arr[pi]];
      return arr;
    });
    if (activePageIdx === pi) setActivePageIdx(pi + dir);
    markDirty();
  };

  /**
   * Split the page at block `bi` into a new chapter that follows it.
   * The selected block becomes the title of the new chapter; everything
   * after it (and the block itself, converted to a paragraph if it wasn't
   * already a heading) moves into the new page. The current page keeps
   * everything before `bi`.
   */
  const splitToNewChapter = (pi: number, bi: number) => {
    // Snapshot for undo
    const prevPages = pages;
    const prevActive = activePageIdx;
    const prevSelected = selectedBlockIdx;

    setPages((ps) => {
      const arr = [...ps];
      const src = arr[pi];
      if (!src) return ps;
      const before = src.blocks.slice(0, bi);
      const pivot = src.blocks[bi];
      const after = src.blocks.slice(bi + 1);

      const pivotText = (pivot as any)?.text?.trim?.() || "";
      const newTitle =
        pivotText || (lang === "fa" ? "فصل جدید" : "New chapter");

      const isTextPivot = pivot && isTextLike(pivot);
      const newBlocks: BlockDraft[] = [];
      if (pivot && (!isTextPivot || !pivotText)) newBlocks.push(pivot);
      newBlocks.push(...after);
      if (newBlocks.length === 0) newBlocks.push({ kind: "paragraph", text: "" });

      const newChapter: PageDraft = { title: newTitle, blocks: newBlocks };

      const updatedSrc: PageDraft = {
        ...src,
        blocks: before.length ? before : [{ kind: "paragraph", text: "" }],
      };

      arr.splice(pi, 1, updatedSrc, newChapter);
      return arr;
    });
    setActivePageIdx(pi + 1);
    setSelectedBlockIdx(null);
    markDirty();
    toast.success(
      lang === "fa" ? "فصل جدید ساخته شد" : "New chapter created",
      {
        action: {
          label: lang === "fa" ? "بازگردانی" : "Undo",
          onClick: () => {
            setPages(prevPages);
            setActivePageIdx(prevActive);
            setSelectedBlockIdx(prevSelected);
            markDirty();
            toast.message(lang === "fa" ? "بازگردانی شد" : "Reverted");
          },
        },
        duration: 8000,
      },
    );
  };
  const uploadToBucket = useCallback(
    async (file: File, prefix = "edit"): Promise<string | null> => {
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
    },
    [user],
  );

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
    [isEdit, initial, user, pages, title, author, description, coverFile, coverUrl, typography, lang, uploadToBucket],
  );

  useEffect(() => {
    if (!isEdit) return;
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    if (!dirty) return;
    const t = window.setTimeout(() => persistDraft(false), 4000);
    return () => window.clearTimeout(t);
  }, [pages, title, author, description, typography, dirty, isEdit, persistDraft]);

  /* ---------- create new book ---------- */
  const submitCreate = async () => {
    if (!user) { nav("/auth"); return; }
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
        toast.error(lang === "fa" ? "حداقل یک بلوک با محتوا اضافه کنید" : "Add at least one block");
        setBusy(false);
        return;
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
          typography_preset: typography,
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

  /* ---------- compute typography preset class ---------- */
  const typoClass = `typo-${typography}`;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar – book metadata + save status */}
      <div className="border-b border-border bg-background/60 backdrop-blur px-3 md:px-4 py-2 flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowLeftPane((v) => !v)}
          className="h-8 px-2"
          aria-label="toggle pages"
        >
          <PanelLeft className="w-4 h-4" />
        </Button>

        <Input
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          placeholder={lang === "fa" ? "عنوان کتاب" : "Book title"}
          className="h-8 text-sm font-display font-bold max-w-xs"
        />
        <Input
          value={author}
          onChange={(e) => { setAuthor(e.target.value); markDirty(); }}
          placeholder={lang === "fa" ? "نویسنده" : "Author"}
          className="h-8 text-xs max-w-[180px] hidden md:block"
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowMeta((v) => !v)}
          className="h-8 px-2 text-xs"
        >
          {lang === "fa" ? "مشخصات…" : "Details…"}
        </Button>

        <div className="flex-1" />

        {isEdit && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 me-1">
            {savingDraft ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                {lang === "fa" ? "ذخیره…" : "Saving…"}
              </>
            ) : dirty ? (
              <span className="text-accent">●</span>
            ) : lastSavedAt ? (
              <span>✓ {lastSavedAt.toLocaleTimeString()}</span>
            ) : (
              <span>{lang === "fa" ? "آماده" : "Ready"}</span>
            )}
          </div>
        )}

        {isEdit ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => initial?.id && window.open(`/read/${initial.id}`, "_blank")}
              className="h-8"
            >
              <Eye className="w-3.5 h-3.5 me-1" />
              <span className="hidden md:inline">{lang === "fa" ? "پیش‌نمایش" : "Preview"}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => persistDraft(true)} className="h-8">
              <Save className="w-3.5 h-3.5 me-1" />
              <span className="hidden md:inline">{lang === "fa" ? "ذخیره" : "Save"}</span>
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                await persistDraft(false);
                if (initial?.id) nav(`/publish/${initial.id}`);
              }}
              className="bg-gradient-warm hover:opacity-90 h-8"
            >
              <Rocket className="w-3.5 h-3.5 me-1" />
              <span className="hidden md:inline">{lang === "fa" ? "انتشار" : "Publish"}</span>
            </Button>
          </>
        ) : (
          <Button onClick={submitCreate} disabled={busy} size="sm" className="bg-gradient-warm h-8">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              (lang === "fa" ? "ساخت پیش‌نویس" : "Create draft")}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowRightPane((v) => !v)}
          className="h-8 px-2"
          aria-label="toggle inspector"
        >
          <PanelRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Optional metadata sheet */}
      <AnimatePresence>
        {showMeta && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-border overflow-hidden bg-foreground/[0.02]"
          >
            <div className="px-4 py-3 grid md:grid-cols-2 gap-3 max-w-5xl">
              <div className="md:col-span-2">
                <Label className="text-xs">{lang === "fa" ? "توضیحات" : "Description"}</Label>
                <Textarea
                  value={description || ""}
                  rows={2}
                  onChange={(e) => { setDescription(e.target.value); markDirty(); }}
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">{lang === "fa" ? "جلد" : "Cover"}</Label>
                <div className="mt-1 flex items-center gap-2">
                  {coverUrl && <img src={coverUrl} alt="" className="w-10 h-14 object-cover rounded shrink-0" />}
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => { setCoverFile(e.target.files?.[0] ?? null); markDirty(); }}
                    className="text-xs h-9"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">{lang === "fa" ? "تایپوگرافی" : "Typography"}</Label>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {[
                    { v: "editorial", fa: "ادبی", en: "Editorial" },
                    { v: "academic", fa: "علمی", en: "Academic" },
                    { v: "modern", fa: "مدرن", en: "Modern" },
                    { v: "playful", fa: "بازیگوش", en: "Playful" },
                  ].map((p) => (
                    <button
                      key={p.v}
                      type="button"
                      onClick={() => { setTypography(p.v); markDirty(); }}
                      className={`px-2 py-1.5 text-[11px] rounded-md border transition-colors ${
                        typography === p.v
                          ? "border-accent bg-accent/15 text-accent font-semibold"
                          : "border-border hover:border-accent/50"
                      }`}
                    >
                      {lang === "fa" ? p.fa : p.en}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Three-pane workspace */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT: page thumbnails */}
        {showLeftPane && (
          <aside className="w-56 md:w-64 border-e border-border bg-background/40 flex flex-col shrink-0">
            <div className="px-3 py-2 flex items-center justify-between border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground">
                {lang === "fa" ? `${pages.length} فصل` : `${pages.length} chapters`}
              </span>
              <Button size="sm" variant="ghost" onClick={addPage} className="h-7 px-2">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1.5">
                {pages.map((p, pi) => (
                  <PageThumbnail
                    key={pi}
                    page={p}
                    index={pi}
                    active={pi === activePageIdx}
                    onClick={() => { setActivePageIdx(pi); setSelectedBlockIdx(null); }}
                    onMoveUp={pi > 0 ? () => movePage(pi, -1) : undefined}
                    onMoveDown={pi < pages.length - 1 ? () => movePage(pi, 1) : undefined}
                    onDuplicate={() => duplicatePage(pi)}
                    onDelete={pages.length > 1 ? () => removePage(pi) : undefined}
                    lang={lang}
                  />
                ))}
              </div>
            </ScrollArea>
          </aside>
        )}

        {/* CENTER: live preview */}
        <main
          className="flex-1 overflow-y-auto bg-paper/30"
          onClick={() => { setSelectedBlockIdx(null); setInsertAt(null); }}
        >
          <div className={`max-w-3xl mx-auto px-4 md:px-8 py-8 ${typoClass}`}>
            {activePage && (
              <>
                {/* Chapter title – inline editable */}
                <div className="mb-8" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center mb-3 opacity-70">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {lang === "fa" ? "صفحه" : "Page"} {activePageIdx + 1}
                    </div>
                    <div className="h-px flex-1 mx-4 bg-gradient-to-r from-transparent via-border to-transparent" />
                    <div className="text-xs text-accent font-medium">✦</div>
                  </div>
                  <input
                    value={activePage.title}
                    onChange={(e) => updatePage(activePageIdx, { title: e.target.value })}
                    placeholder={lang === "fa" ? "عنوان فصل…" : "Chapter title…"}
                    className="w-full bg-transparent border-0 outline-none text-3xl md:text-5xl font-display font-bold gold-text leading-tight focus:bg-foreground/[0.03] rounded-md px-1 -mx-1"
                  />
                </div>

                {/* Insert button before first block */}
                <InsertSlot
                  visible={insertAt === 0}
                  onOpen={() => setInsertAt(insertAt === 0 ? null : 0)}
                  onClose={() => setInsertAt(null)}
                  onPick={(k) => insertBlock(activePageIdx, 0, k)}
                  lang={lang}
                />

                {/* Blocks */}
                {activePage.blocks.map((b, bi) => (
                  <div key={bi}>
                    <BlockShell
                      block={b}
                      pageIndex={activePageIdx}
                      blockIndex={bi}
                      isSelected={selectedBlockIdx === bi}
                      onSelect={() => setSelectedBlockIdx(bi)}
                      onUpdate={(patch) => updateBlock(activePageIdx, bi, patch)}
                      onReplace={(next) => replaceBlock(activePageIdx, bi, next)}
                      onDelete={() => removeBlock(activePageIdx, bi)}
                      onDuplicate={() => duplicateBlock(activePageIdx, bi)}
                      onMoveUp={bi > 0 ? () => moveBlock(activePageIdx, bi, -1) : undefined}
                      onMoveDown={
                        bi < activePage.blocks.length - 1
                          ? () => moveBlock(activePageIdx, bi, 1)
                          : undefined
                      }
                      onSlash={() => setInsertAt(bi + 1)}
                      onSplit={() => splitToNewChapter(activePageIdx, bi)}
                      lang={lang}
                    />
                    <InsertSlot
                      visible={insertAt === bi + 1}
                      onOpen={() => setInsertAt(insertAt === bi + 1 ? null : bi + 1)}
                      onClose={() => setInsertAt(null)}
                      onPick={(k) => insertBlock(activePageIdx, bi + 1, k)}
                      lang={lang}
                    />
                  </div>
                ))}

                {/* Empty-state add button */}
                {activePage.blocks.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-sm text-muted-foreground mb-3">
                      {lang === "fa" ? "این صفحه خالی است" : "This page is empty"}
                    </p>
                    <Button onClick={() => insertBlock(activePageIdx, 0, "paragraph")} size="sm" variant="outline">
                      <Plus className="w-4 h-4 me-1.5" />
                      {lang === "fa" ? "افزودن متن" : "Add text"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* RIGHT: inspector */}
        {showRightPane && (
          <aside className="w-72 md:w-80 border-s border-border bg-background/40 flex flex-col shrink-0">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-accent" />
                {selectedBlock
                  ? labels[selectedBlock.kind]
                  : lang === "fa" ? "بازرس" : "Inspector"}
              </span>
              {selectedBlock && (
                <button
                  onClick={() => setSelectedBlockIdx(null)}
                  className="p-1 rounded hover:bg-foreground/5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3">
                {selectedBlock && selectedBlockIdx !== null ? (
                  <Inspector
                    block={selectedBlock}
                    onUpdate={(patch) => updateBlock(activePageIdx, selectedBlockIdx, patch)}
                    onReplace={(next) => replaceBlock(activePageIdx, selectedBlockIdx, next)}
                    onSplit={
                      selectedBlockIdx > 0 || activePage.blocks.length > 1
                        ? () => splitToNewChapter(activePageIdx, selectedBlockIdx)
                        : undefined
                    }
                    uploadFile={uploadToBucket}
                    lang={lang}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground space-y-3">
                    <p>{lang === "fa"
                      ? "روی هر بلوک در پیش‌نمایش کلیک کنید تا تنظیمات آن باز شود."
                      : "Click any block in the preview to edit it."}</p>
                    <div>
                      <p className="font-semibold mb-1.5">{lang === "fa" ? "افزودن سریع" : "Quick add"}</p>
                      <div className="grid grid-cols-2 gap-1">
                        {BLOCK_PALETTE.map(({ kind, icon: Icon }) => (
                          <button
                            key={kind}
                            onClick={() =>
                              insertBlock(activePageIdx, activePage?.blocks.length || 0, kind)
                            }
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-foreground/5 hover:bg-accent/15 text-[11px]"
                          >
                            <Icon className="w-3 h-3 text-accent" />
                            <span className="truncate">{labels[kind]}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Page thumbnail                                                    */
/* ------------------------------------------------------------------ */

const PageThumbnail = ({
  page, index, active, onClick, onMoveUp, onMoveDown, onDuplicate, onDelete, lang,
}: {
  page: PageDraft;
  index: number;
  active: boolean;
  onClick: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
  lang: "fa" | "en";
}) => {
  const preview = page.blocks.slice(0, 3).map((b) => blockSummary(b, lang)).join(" · ");
  return (
    <div
      onClick={onClick}
      className={`group rounded-lg border p-2 cursor-pointer transition-colors ${
        active
          ? "border-accent bg-accent/10 ring-1 ring-accent/30"
          : "border-border bg-background/60 hover:border-accent/40 hover:bg-foreground/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <Badge variant="outline" className="text-[10px] tabular-nums h-5 px-1.5 shrink-0">
          {index + 1}
        </Badge>
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
          {onMoveUp && (
            <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="p-0.5 hover:bg-foreground/10 rounded" aria-label="up">
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          {onMoveDown && (
            <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="p-0.5 hover:bg-foreground/10 rounded" aria-label="down">
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-0.5 hover:bg-foreground/10 rounded" aria-label="duplicate">
            <Copy className="w-3 h-3" />
          </button>
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 hover:bg-destructive/10 text-destructive rounded" aria-label="delete">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="text-xs font-display font-semibold truncate">{page.title || (lang === "fa" ? "—" : "—")}</div>
      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
        {preview || (lang === "fa" ? "خالی" : "Empty")}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Insert slot (the "+" between blocks with QuickInsert popover)     */
/* ------------------------------------------------------------------ */

const InsertSlot = ({
  visible, onOpen, onClose, onPick, lang,
}: {
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (k: BlockDraft["kind"]) => void;
  lang: "fa" | "en";
}) => {
  return (
    <div className="relative h-3 group/insert" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={onOpen}
        className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-accent/20 hover:bg-accent text-accent hover:text-accent-foreground border border-accent/40 flex items-center justify-center transition-all z-10 ${
          visible ? "opacity-100 scale-100" : "opacity-0 group-hover/insert:opacity-100 scale-90 hover:scale-100"
        }`}
        aria-label="insert block"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <div className={`absolute left-0 right-0 top-1/2 h-px bg-accent/40 ${visible ? "opacity-100" : "opacity-0 group-hover/insert:opacity-50"} transition-opacity`} />
      <AnimatePresence>
        {visible && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full">
            <QuickInsert lang={lang} onPick={onPick} onClose={onClose} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Text-type switcher — convert paragraph ↔ heading ↔ quote ↔ callout */
/* ------------------------------------------------------------------ */

type TextStyleId = "paragraph" | "heading" | "quote" | "callout-info" | "callout-sparkle";

const isTextLike = (b: BlockDraft) =>
  b.kind === "paragraph" ||
  b.kind === "heading" ||
  b.kind === "quote" ||
  b.kind === "callout";

const currentTextStyle = (b: BlockDraft): TextStyleId | null => {
  if (b.kind === "paragraph") return "paragraph";
  if (b.kind === "heading") return "heading";
  if (b.kind === "quote") return "quote";
  if (b.kind === "callout") return b.icon === "sparkle" ? "callout-sparkle" : "callout-info";
  return null;
};

/** Convert a text-like block to another text style, preserving the text. */
const convertTextBlock = (b: BlockDraft, target: TextStyleId): BlockDraft => {
  const text = (b as any).text || "";
  const author = (b as any).author || "";
  switch (target) {
    case "paragraph":  return { kind: "paragraph", text };
    case "heading":    return { kind: "heading", text };
    case "quote":      return { kind: "quote", text, author };
    case "callout-info":     return { kind: "callout", icon: "info", text };
    case "callout-sparkle":  return { kind: "callout", icon: "sparkle", text };
  }
};

const TextTypeSwitcher = ({
  block, onConvert, lang, compact = false,
}: {
  block: BlockDraft;
  onConvert: (next: BlockDraft) => void;
  lang: "fa" | "en";
  compact?: boolean;
}) => {
  const fa = lang === "fa";
  const current = currentTextStyle(block);
  const items: { id: TextStyleId; label: string; symbol: string; title: string }[] = [
    { id: "paragraph",       symbol: "P",  label: fa ? "متن" : "Text",          title: fa ? "متن معمولی" : "Paragraph" },
    { id: "heading",         symbol: "H",  label: fa ? "عنوان" : "Heading",     title: fa ? "تبدیل به عنوان/سرفصل" : "Convert to heading" },
    { id: "quote",           symbol: "❝",  label: fa ? "نقل قول" : "Quote",     title: fa ? "تبدیل به نقل قول" : "Convert to quote" },
    { id: "callout-info",    symbol: "💡", label: fa ? "نکته" : "Note",         title: fa ? "تبدیل به نکته" : "Convert to callout" },
    { id: "callout-sparkle", symbol: "✨", label: fa ? "هایلایت" : "Highlight", title: fa ? "تبدیل به برجسته/هایلایت" : "Convert to highlight" },
  ];
  return (
    <div
      className={`flex items-center gap-0.5 ${compact ? "" : "p-1 rounded-lg bg-foreground/5 border border-border"}`}
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label={fa ? "تبدیل نوع متن" : "Convert text style"}
    >
      {items.map((it) => {
        const active = current === it.id;
        return (
          <button
            key={it.id}
            type="button"
            title={it.title}
            onClick={() => { if (!active) onConvert(convertTextBlock(block, it.id)); }}
            className={`flex items-center gap-1 px-2 ${compact ? "py-0.5 text-[11px]" : "py-1 text-xs"} rounded-md transition-colors ${
              active
                ? "bg-accent text-accent-foreground font-semibold shadow-sm"
                : "hover:bg-accent/15 text-foreground/80"
            }`}
          >
            <span className="leading-none">{it.symbol}</span>
            {!compact && <span className="hidden md:inline">{it.label}</span>}
          </button>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  BlockShell — wraps a live-preview block with selection chrome     */
/* ------------------------------------------------------------------ */

const BlockShell = ({
  block, pageIndex, blockIndex, isSelected, onSelect, onUpdate, onReplace, onDelete,
  onDuplicate, onMoveUp, onMoveDown, onSlash, onSplit, lang,
}: {
  block: BlockDraft;
  pageIndex: number;
  blockIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<BlockDraft>) => void;
  onReplace: (next: BlockDraft) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSlash: () => void;
  onSplit?: () => void;
  lang: "fa" | "en";
}) => {
  const isText = isTextLike(block);

  // For text blocks: render a real editable element styled like the live block.
  // For richer blocks: render the BlockRenderer in a non-interactive overlay.
  const runtime = useMemo(() => draftToRuntimeBlock(block), [block]);

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`relative my-2 rounded-xl transition-all ${
        isSelected
          ? "ring-2 ring-accent/60 bg-accent/[0.04]"
          : "ring-1 ring-transparent hover:ring-border hover:bg-foreground/[0.02]"
      }`}
    >
      {/* Floating type-switcher (text blocks only, when selected) */}
      {isText && isSelected && (
        <div
          className="absolute -top-4 start-2 z-30 glass-strong rounded-full border border-border shadow-elegant"
          onClick={(e) => e.stopPropagation()}
        >
          <TextTypeSwitcher block={block} onConvert={onReplace} lang={lang} compact />
        </div>
      )}

      {/* Hover/selected toolbar */}
      <div className={`absolute -top-3 end-2 z-20 flex items-center gap-0.5 glass-strong rounded-full border border-border px-1 py-0.5 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-events-none"}`}
        style={{ pointerEvents: isSelected ? "auto" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 uppercase tracking-wider">
          {block.kind}
        </Badge>
        {onMoveUp && (
          <button onClick={onMoveUp} className="p-1 hover:bg-foreground/10 rounded" aria-label="up">
            <ChevronUp className="w-3 h-3" />
          </button>
        )}
        {onMoveDown && (
          <button onClick={onMoveDown} className="p-1 hover:bg-foreground/10 rounded" aria-label="down">
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
        <button onClick={onDuplicate} className="p-1 hover:bg-foreground/10 rounded" aria-label="duplicate">
          <Copy className="w-3 h-3" />
        </button>
        {onSplit && (
          <button
            onClick={onSplit}
            className="p-1 hover:bg-accent/15 text-accent rounded"
            aria-label={lang === "fa" ? "تبدیل به فصل جدید" : "Split into new chapter"}
            title={lang === "fa" ? "از اینجا فصل جدید بساز" : "Start a new chapter here"}
          >
            <Scissors className="w-3 h-3" />
          </button>
        )}
        <button onClick={onDelete} className="p-1 hover:bg-destructive/10 text-destructive rounded" aria-label="delete">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="p-1">
        {isText ? (
          <InlineTextBlock block={block} onUpdate={onUpdate} onSlash={onSlash} lang={lang} />
        ) : (
          // Non-text rich blocks render through the real BlockRenderer
          // so what you see equals what readers see.
          runtime ? (
            <div className="pointer-events-none select-none">
              <BlockRenderer block={runtime} fontSize={18} index={blockIndex} pageIndex={pageIndex} />
            </div>
          ) : (
            <div className="p-4 text-xs text-muted-foreground italic text-center border border-dashed border-border rounded-lg">
              {lang === "fa" ? "محتوای این بلوک خالی است — از پنل سمت راست تنظیمش کنید" : "Empty block — configure it from the right panel"}
            </div>
          )
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Inline editable text block (paragraph/heading/quote/callout)      */
/* ------------------------------------------------------------------ */

const InlineTextBlock = ({
  block, onUpdate, onSlash, lang,
}: {
  block: BlockDraft;
  onUpdate: (patch: Partial<BlockDraft>) => void;
  onSlash: () => void;
  lang: "fa" | "en";
}) => {
  const placeholders: Record<string, string> = {
    paragraph: lang === "fa" ? "بنویسید… (برای منوی بلوک‌ها / بزنید)" : "Write… (type / for blocks)",
    heading: lang === "fa" ? "عنوان زیربخش…" : "Subheading…",
    quote: lang === "fa" ? "نقل قول…" : "Quote…",
    callout: lang === "fa" ? "نکته…" : "Callout…",
  };

  const onTextChange = (val: string) => {
    if (val.endsWith("/")) {
      // open insert menu instead of saving the slash
      onUpdate({ text: val.slice(0, -1) } as any);
      onSlash();
      return;
    }
    onUpdate({ text: val } as any);
  };

  if (block.kind === "heading") {
    return (
      <input
        value={block.text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholders.heading}
        className="w-full bg-transparent border-0 outline-none text-2xl md:text-3xl font-display font-bold py-2 px-3"
      />
    );
  }

  if (block.kind === "quote") {
    return (
      <div className="my-4 px-4 md:px-6 py-3 border-s-4 border-accent bg-foreground/[0.03] rounded-r-xl">
        <textarea
          value={block.text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={placeholders.quote}
          rows={2}
          className="w-full bg-transparent border-0 outline-none text-lg italic font-display resize-none leading-relaxed"
        />
        <input
          value={block.author || ""}
          onChange={(e) => onUpdate({ author: e.target.value } as any)}
          placeholder={lang === "fa" ? "— گوینده" : "— Author"}
          className="w-full bg-transparent border-0 outline-none text-sm text-muted-foreground mt-1"
        />
      </div>
    );
  }

  if (block.kind === "callout") {
    return (
      <div className={`my-4 p-4 rounded-xl flex gap-3 ${block.icon === "sparkle" ? "bg-accent/10 border border-accent/30" : "bg-primary/5 border border-primary/20"}`}>
        <div className="text-xl shrink-0">{block.icon === "sparkle" ? "✨" : "💡"}</div>
        <textarea
          value={block.text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={placeholders.callout}
          rows={2}
          className="flex-1 bg-transparent border-0 outline-none text-base leading-relaxed resize-none"
        />
      </div>
    );
  }

  // paragraph
  if (block.kind !== "paragraph") return null;
  return (
    <textarea
      value={block.text}
      onChange={(e) => onTextChange(e.target.value)}
      placeholder={placeholders.paragraph}
      rows={Math.max(2, Math.ceil((block.text || "").length / 70))}
      className="w-full bg-transparent border-0 outline-none text-lg leading-[1.9] resize-none px-3 py-2 font-serif"
    />
  );
};

/* ------------------------------------------------------------------ */
/*  Inspector — rich controls for the selected block                  */
/* ------------------------------------------------------------------ */

const Inspector = ({
  block, onUpdate, onReplace, onSplit, uploadFile, lang,
}: {
  block: BlockDraft;
  onUpdate: (patch: Partial<BlockDraft>) => void;
  onReplace: (next: BlockDraft) => void;
  onSplit?: () => void;
  uploadFile: (f: File, prefix?: string) => Promise<string | null>;
  lang: "fa" | "en";
}) => {
  const fa = lang === "fa";

  // Shared header for text-like blocks: "Convert to" type switcher +
  // a one-click "promote to new chapter" action.
  const TextStyleHeader = (
    <div className="space-y-2 pb-3 mb-3 border-b border-border">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {fa ? "تبدیل به" : "Convert to"}
      </Label>
      <TextTypeSwitcher block={block} onConvert={onReplace} lang={lang} />
      {onSplit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSplit}
          className="w-full justify-start gap-2 h-8 text-xs"
        >
          <Scissors className="w-3.5 h-3.5 text-accent" />
          {fa ? "تبدیل به سرفصل فصل جدید" : "Promote to new chapter"}
        </Button>
      )}
    </div>
  );

  switch (block.kind) {
    case "heading":
    case "paragraph":
      return (
        <div className="space-y-2">
          {TextStyleHeader}
          <Label className="text-xs">{fa ? "متن" : "Text"}</Label>
          <Textarea
            value={block.text}
            rows={6}
            onChange={(e) => onUpdate({ text: e.target.value } as any)}
          />
          <p className="text-[10px] text-muted-foreground">
            {fa ? "می‌توانید متن را مستقیم در پیش‌نمایش هم ویرایش کنید." : "You can edit text directly in the preview too."}
          </p>
        </div>
      );

    case "quote":
      return (
        <div className="space-y-2">
          {TextStyleHeader}
          <Label className="text-xs">{fa ? "متن نقل قول" : "Quote text"}</Label>
          <Textarea
            value={block.text}
            rows={4}
            onChange={(e) => onUpdate({ text: e.target.value } as any)}
          />
          <Label className="text-xs">{fa ? "گوینده" : "Author"}</Label>
          <Input
            value={block.author || ""}
            onChange={(e) => onUpdate({ author: e.target.value } as any)}
          />
        </div>
      );

    case "callout":
      return (
        <div className="space-y-2">
          {TextStyleHeader}
          <Label className="text-xs">{fa ? "نوع" : "Style"}</Label>
          <div className="flex gap-1">
            {(["info", "sparkle"] as const).map((v) => (
              <button
                key={v}
                onClick={() => onUpdate({ icon: v } as any)}
                className={`flex-1 px-2 py-1.5 text-xs rounded-md border ${
                  block.icon === v
                    ? "border-accent bg-accent/10 text-accent font-semibold"
                    : "border-border hover:border-accent/50"
                }`}
              >
                {v === "info" ? (fa ? "💡 نکته" : "💡 Info") : (fa ? "✨ برجسته" : "✨ Highlight")}
              </button>
            ))}
          </div>
          <Label className="text-xs">{fa ? "متن" : "Text"}</Label>
          <Textarea
            value={block.text}
            rows={4}
            onChange={(e) => onUpdate({ text: e.target.value } as any)}
          />
        </div>
      );

    case "image":
      return (
        <div className="space-y-2">
          {block.src ? (
            <div className="relative">
              <img src={block.src} alt="" className="w-full max-h-40 object-cover rounded-lg" />
              <button
                onClick={() => onUpdate({ src: "" } as any)}
                className="absolute top-1.5 end-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <Input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const url = await uploadFile(f, "img");
                if (url) onUpdate({ src: url } as any);
                e.target.value = "";
              }}
              className="text-xs h-9"
            />
          )}
          <Label className="text-xs">{fa ? "زیرنویس" : "Caption"}</Label>
          <Input
            value={block.caption || ""}
            onChange={(e) => onUpdate({ caption: e.target.value } as any)}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <input
              type="checkbox"
              checked={block.hideCaption || false}
              onChange={(e) => onUpdate({ hideCaption: e.target.checked } as any)}
            />
            <EyeOff className="w-3 h-3" />
            {fa ? "زیرنویس مخفی (با هاور نمایش)" : "Hide caption (reveal on hover)"}
          </label>
        </div>
      );

    case "gallery":
      return (
        <div className="space-y-2">
          <Input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              const uploaded: string[] = [];
              for (const f of files) {
                const url = await uploadFile(f, "gallery");
                if (url) uploaded.push(url);
              }
              onUpdate({ images: [...block.images, ...uploaded] } as any);
              e.target.value = "";
            }}
            className="text-xs h-9"
          />
          {block.images.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {block.images.map((src, idx) => (
                <div key={idx} className="relative group/img">
                  <img src={src} alt="" className="w-full h-16 object-cover rounded" />
                  <button
                    onClick={() => onUpdate({ images: block.images.filter((_, k) => k !== idx) } as any)}
                    className="absolute top-0.5 end-0.5 w-5 h-5 rounded-full bg-black/70 text-white opacity-0 group-hover/img:opacity-100 flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Label className="text-xs">{fa ? "زیرنویس" : "Caption"}</Label>
          <Input
            value={block.caption || ""}
            onChange={(e) => onUpdate({ caption: e.target.value } as any)}
          />
        </div>
      );

    case "slideshow":
      return (
        <div className="space-y-2">
          <Input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              const uploaded: { src: string; caption?: string }[] = [];
              for (const f of files) {
                const url = await uploadFile(f, "slides");
                if (url) uploaded.push({ src: url, caption: "" });
              }
              onUpdate({ images: [...block.images, ...uploaded] } as any);
              e.target.value = "";
            }}
            className="text-xs h-9"
          />
          {block.images.length > 0 && (
            <div className="space-y-1.5">
              {block.images.map((img, idx) => (
                <div key={idx} className="flex gap-2 items-center bg-foreground/5 rounded-md p-1.5">
                  <img src={img.src} alt="" className="w-12 h-12 object-cover rounded shrink-0" />
                  <Input
                    value={img.caption || ""}
                    placeholder={fa ? "زیرنویس" : "Caption"}
                    onChange={(e) => onUpdate({
                      images: block.images.map((x, k) => k === idx ? { ...x, caption: e.target.value } : x),
                    } as any)}
                    className="h-7 text-xs flex-1"
                  />
                  <button
                    onClick={() => onUpdate({ images: block.images.filter((_, k) => k !== idx) } as any)}
                    className="p-1 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 text-xs text-muted-foreground pt-1">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={block.autoplay !== false}
                onChange={(e) => onUpdate({ autoplay: e.target.checked } as any)}
              />
              {fa ? "پخش خودکار" : "Autoplay"}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={block.hideCaption || false}
                onChange={(e) => onUpdate({ hideCaption: e.target.checked } as any)}
              />
              {fa ? "کپشن مخفی" : "Hide caption"}
            </label>
          </div>
        </div>
      );

    case "video":
      return (
        <div className="space-y-2">
          <Label className="text-xs">{fa ? "لینک YouTube/Vimeo/MP4" : "URL"}</Label>
          <Input
            value={block.src}
            onChange={(e) => onUpdate({ src: e.target.value } as any)}
            placeholder="https://..."
          />
          <Label className="text-xs">{fa ? "یا فایل ویدیو" : "Or upload"}</Label>
          <Input
            type="file"
            accept="video/*"
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const url = await uploadFile(f, "videos");
              if (url) onUpdate({ src: url } as any);
              e.target.value = "";
            }}
            className="text-xs h-9"
          />
          <Label className="text-xs">{fa ? "زیرنویس" : "Caption"}</Label>
          <Input
            value={block.caption || ""}
            onChange={(e) => onUpdate({ caption: e.target.value } as any)}
          />
        </div>
      );

    case "timeline":
      return (
        <div className="space-y-2">
          <Label className="text-xs">{fa ? "عنوان" : "Title"}</Label>
          <Input
            value={block.title || ""}
            onChange={(e) => onUpdate({ title: e.target.value } as any)}
          />
          <div className="space-y-2">
            {block.steps.map((s, si) => (
              <div key={si} className="border border-border rounded-md p-2 space-y-1.5 bg-foreground/[0.02]">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-accent">
                    {fa ? `نقطه ${si + 1}` : `Point ${si + 1}`}
                  </span>
                  <button
                    onClick={() => onUpdate({ steps: block.steps.filter((_, k) => k !== si) } as any)}
                    className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <Input
                  value={s.marker || ""}
                  placeholder={fa ? "برچسب" : "Marker"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, marker: e.target.value } : x),
                  } as any)}
                  className="h-7 text-xs"
                />
                <Input
                  value={s.title}
                  placeholder={fa ? "عنوان" : "Title"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, title: e.target.value } : x),
                  } as any)}
                  className="h-7 text-xs"
                />
                <Textarea
                  value={s.description}
                  rows={2}
                  placeholder={fa ? "توضیح" : "Description"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, description: e.target.value } : x),
                  } as any)}
                  className="text-xs"
                />
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8"
            onClick={() => onUpdate({
              steps: [...block.steps, { marker: `${block.steps.length + 1}`, title: "", description: "" }],
            } as any)}
          >
            <Plus className="w-3 h-3 me-1" />
            {fa ? "افزودن نقطه" : "Add point"}
          </Button>
        </div>
      );

    case "scrollytelling":
      return (
        <div className="space-y-2">
          <Label className="text-xs">{fa ? "عنوان" : "Title"}</Label>
          <Input
            value={block.title || ""}
            onChange={(e) => onUpdate({ title: e.target.value } as any)}
          />
          <div className="space-y-2">
            {block.steps.map((s, si) => (
              <div key={si} className="border border-border rounded-md p-2 space-y-1.5 bg-foreground/[0.02]">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-accent">
                    {fa ? `مرحله ${si + 1}` : `Step ${si + 1}`}
                  </span>
                  <button
                    onClick={() => onUpdate({ steps: block.steps.filter((_, k) => k !== si) } as any)}
                    className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <Input
                  value={s.marker || ""}
                  placeholder={fa ? "برچسب" : "Marker"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, marker: e.target.value } : x),
                  } as any)}
                  className="h-7 text-xs"
                />
                <Input
                  value={s.title}
                  placeholder={fa ? "عنوان" : "Title"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, title: e.target.value } : x),
                  } as any)}
                  className="h-7 text-xs"
                />
                <Textarea
                  value={s.description}
                  rows={2}
                  placeholder={fa ? "توضیح" : "Description"}
                  onChange={(e) => onUpdate({
                    steps: block.steps.map((x, k) => k === si ? { ...x, description: e.target.value } : x),
                  } as any)}
                  className="text-xs"
                />
                <div className="flex gap-2 items-center">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      const url = await uploadFile(f, "scrolly");
                      if (url) onUpdate({
                        steps: block.steps.map((x, k) => k === si ? { ...x, image: url } : x),
                      } as any);
                      e.target.value = "";
                    }}
                    className="text-[10px] h-7 flex-1"
                  />
                  {s.image && <img src={s.image} alt="" className="w-10 h-7 object-cover rounded" />}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8"
            onClick={() => onUpdate({
              steps: [...block.steps, { marker: `${fa ? "مرحله" : "Step"} ${block.steps.length + 1}`, title: "", description: "" }],
            } as any)}
          >
            <Plus className="w-3 h-3 me-1" />
            {fa ? "افزودن مرحله" : "Add step"}
          </Button>
        </div>
      );
  }
};
