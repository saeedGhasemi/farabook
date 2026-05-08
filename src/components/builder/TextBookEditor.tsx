// New page-as-document book editor. The whole chapter is a single
// rich-text document. A sticky toolbar at the top of the editor
// exposes ALL formatting actions and stays visible while scrolling.
// Side panel hosts AI suggestions with Accept/Reject.
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3,
  Quote as QuoteIcon, Lightbulb, List, ListOrdered as OlIcon,
  Image as ImageIcon, Sparkles, Plus, Trash2, BookOpen, Loader2, Save,
  Palette, Type as TypeIcon, SplitSquareVertical, Film, GalleryHorizontal,
  ListOrdered, Layers, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Undo2, Redo2, X, ArrowLeftRight, ChevronsLeft, ChevronsRight, Scissors,
  Eraser, Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Callout, Quote, ImageBlock, ImagePlaceholderBlock, VideoBlock, GalleryBlock, TimelineBlock, ScrollyBlock,
  ImportedTable, useImageUpload,
} from "./tiptap-nodes";
import {
  dbPagesToTextPages, textPagesToDbPages, type TextPage,
} from "@/lib/tiptap-doc";
import { AiSuggestPanel } from "./AiSuggestPanel";
import { ImageAutoPlacementPanel } from "./ImageAutoPlacementPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  BookMetadataForm,
  DEFAULT_METADATA,
  normalizeMetadata,
  type BookMetadata,
} from "@/components/book-metadata/BookMetadataForm";

const TYPOGRAPHY_PRESETS = [
  { value: "editorial", label_fa: "روزنامه‌ای", label_en: "Editorial" },
  { value: "academic", label_fa: "آکادمیک", label_en: "Academic" },
  { value: "modern", label_fa: "مدرن", label_en: "Modern" },
  { value: "playful", label_fa: "صمیمی", label_en: "Playful" },
  { value: "elegant", label_fa: "نفیس", label_en: "Elegant" },
  { value: "technical", label_fa: "فنی", label_en: "Technical" },
  { value: "magazine", label_fa: "مجله‌ای", label_en: "Magazine" },
];

const TEXT_COLORS = [
  { name: "Default", value: "" },
  { name: "Primary", value: "hsl(var(--primary))" },
  { name: "Accent", value: "hsl(var(--accent))" },
  { name: "Success", value: "hsl(142 70% 38%)" },
  { name: "Warning", value: "hsl(35 95% 50%)" },
  { name: "Danger", value: "hsl(var(--destructive))" },
  { name: "Muted", value: "hsl(var(--muted-foreground))" },
];

/* ---- Custom Direction extension: add dir attr to text blocks ---- */
const TextDirection = Extension.create({
  name: "textDirection",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "quote", "callout"],
        attributes: {
          dir: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("dir"),
            renderHTML: (attrs: Record<string, any>) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
        },
      },
    ];
  },
});

interface Initial {
  id?: string;
  title: string;
  author: string;
  description: string | null;
  cover_url: string | null;
  pages: any[];
  typography_preset?: string | null;
  author_user_id?: string | null;
}

interface Props {
  initial?: Initial;
  onCreated?: (id: string) => void;
}

const newEmptyPage = (title = ""): TextPage => ({
  title,
  doc: { type: "doc", content: [{ type: "paragraph" }] },
});

/* ---------------- Toolbar button helper ---------------- */
const TbBtn = ({
  active, onClick, title, children, accent,
}: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode; accent?: boolean }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`p-1.5 rounded-md transition shrink-0 ${
      accent ? "text-accent hover:bg-accent/10" :
      active ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"
    }`}
  >
    {children}
  </button>
);

const TbSep = () => <span className="w-px h-5 bg-border mx-0.5 shrink-0" />;

export const TextBookEditor = ({ initial }: Props) => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const fa = lang === "fa";
  const isEdit = Boolean(initial?.id);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.cover_url ?? null);
  const coverFileRef = useRef<HTMLInputElement | null>(null);

  const [pages, setPages] = useState<TextPage[]>(
    initial?.pages?.length ? dbPagesToTextPages(initial.pages) : [newEmptyPage(fa ? "فصل ۱" : "Chapter 1")],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const activePage = pages[activeIdx] ?? pages[0];

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [showAutoFill, setShowAutoFill] = useState(false);
  const [importId, setImportId] = useState<string | undefined>(undefined);
  const [chaptersCollapsed, setChaptersCollapsed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [typography, setTypography] = useState<string>(initial?.typography_preset || "editorial");
  // Metadata dialog
  const [showMeta, setShowMeta] = useState(false);
  const [meta, setMeta] = useState<BookMetadata>(DEFAULT_METADATA);
  const [metaSaving, setMetaSaving] = useState(false);
  // Force re-render of toolbar on selection change to reflect active states
  const [, forceTick] = useState(0);

  const { upload } = useImageUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextDirection,
      Placeholder.configure({
        placeholder: fa ? "اینجا بنویسید… با Enter پاراگراف بعدی." : "Write here… Enter for next paragraph.",
      }),
      Callout, Quote, ImageBlock, ImagePlaceholderBlock, VideoBlock, GalleryBlock, ImportedTable, TimelineBlock, ScrollyBlock,
    ],
    content: activePage?.doc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        dir: fa ? "rtl" : "ltr",
        class: "prose prose-lg max-w-none focus:outline-none min-h-[60vh] leading-relaxed tiptap-surface",
        style: "-webkit-touch-callout: none;",
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as TextPage["doc"];
      // Mutate-in-place for the active page reference to avoid spreading
      // every page array on every keystroke (very expensive for big books).
      setPages((ps) => {
        const next = ps.slice();
        const cur = next[activeIdx];
        if (cur) next[activeIdx] = { ...cur, doc: json };
        return next;
      });
      // Only this chapter changed → mark it dirty for incremental save.
      dirtyPagesRef.current.add(activeIdx);
      setDirty(true);
    },
    // Only re-render the toolbar when the selection changes — not on every
    // transaction. Transactions fire many times per keystroke and the
    // resulting cascade was crashing the live preview on long chapters.
    onSelectionUpdate: () => forceTick((n) => (n + 1) % 1024),
  });

  // When the active chapter changes, swap content into the editor. We
  // intentionally skip the per-render JSON.stringify diff (O(n) on the
  // whole document) and rely on `activeIdx` as the trigger.
  const lastLoadedIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (!editor) return;
    if (lastLoadedIdxRef.current === activeIdx) return;
    lastLoadedIdxRef.current = activeIdx;
    const target = pages[activeIdx]?.doc;
    if (target) editor.commands.setContent(target as any, { emitUpdate: false });
    // Collapse the AI suggestions panel when the chapter changes — each
    // chapter has its own cached suggestions which are restored when the
    // user reopens the panel for that chapter.
    setShowAi(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, editor]);

  // Look up the most recent Word import for this book so the auto-fill
  // panel knows which .docx to re-extract images from.
  useEffect(() => {
    if (!isEdit || !initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("word_imports")
        .select("id")
        .eq("book_id", initial.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data?.id) setImportId(data.id);
    })();
    return () => { cancelled = true; };
  }, [isEdit, initial?.id]);

  // Load rich book metadata when editing an existing book
  useEffect(() => {
    if (!isEdit || !initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("books")
        .select("title, subtitle, description, book_type, contributors, publisher, publication_year, edition, isbn, page_count, language, original_title, original_language, categories, subjects, series_name, series_index, author, category")
        .eq("id", initial.id)
        .maybeSingle();
      if (cancelled || !data) return;
      setMeta(normalizeMetadata({
        title: data.title || initial.title,
        subtitle: (data as any).subtitle || "",
        description: data.description || "",
        book_type: ((data as any).book_type as any) || "authored",
        contributors: Array.isArray((data as any).contributors) && (data as any).contributors.length
          ? (data as any).contributors
          : (data.author ? [{ name: data.author, role: "author" }] : [{ name: "", role: "author" }]),
        publisher: data.publisher || "",
        publication_year: (data as any).publication_year ?? null,
        edition: (data as any).edition || "",
        isbn: (data as any).isbn || "",
        page_count: (data as any).page_count ?? null,
        language: data.language || "fa",
        original_title: (data as any).original_title || "",
        original_language: (data as any).original_language || "",
        categories: ((data as any).categories?.length ? (data as any).categories : (data.category ? [data.category] : [])) as string[],
        subjects: ((data as any).subjects || []) as string[],
        series_name: (data as any).series_name || "",
        series_index: (data as any).series_index ?? null,
      }));
    })();
    return () => { cancelled = true; };
  }, [isEdit, initial?.id, initial?.title]);

  const saveMetadata = async () => {
    if (!isEdit || !initial?.id) return;
    setMetaSaving(true);
    try {
      const primaryAuthor = meta.contributors?.find((c) => c.role === "author")?.name
        || meta.contributors?.[0]?.name || "";
      const { error } = await supabase
        .from("books")
        .update({
          title: meta.title || initial.title,
          subtitle: meta.subtitle || null,
          description: meta.description || null,
          book_type: meta.book_type,
          contributors: meta.contributors as any,
          author: primaryAuthor,
          publisher: meta.publisher || null,
          publication_year: meta.publication_year ?? null,
          edition: meta.edition || null,
          isbn: meta.isbn || null,
          page_count: meta.page_count ?? null,
          language: meta.language || "fa",
          original_title: meta.original_title || null,
          original_language: meta.original_language || null,
          categories: meta.categories,
          subjects: meta.subjects,
          category: meta.categories?.[0] || null,
          series_name: meta.series_name || null,
          series_index: meta.series_index ?? null,
        })
        .eq("id", initial.id);
      if (error) throw error;
      // Sync local title input
      setTitle(meta.title || title);
      setAuthor(primaryAuthor || author);
      toast.success(fa ? "مشخصات کتاب ذخیره شد" : "Book metadata saved");
      setShowMeta(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setMetaSaving(false);
    }
  };

  // Track which chapters changed since last save and whether the
  // structural shape (chapter order/count, metadata) changed. Autosave
  // sends only the dirty chapters via an RPC; manual Save (or any
  // structural change) always sends the full book.
  const dirtyPagesRef = useRef<Set<number>>(new Set());
  const structureDirtyRef = useRef(false);

  const markPageDirty = useCallback((idx: number) => {
    dirtyPagesRef.current.add(idx);
    setDirty(true);
  }, []);
  const markStructureDirty = useCallback(() => {
    structureDirtyRef.current = true;
    setDirty(true);
  }, []);

  const persist = useCallback(async (opts: { showToast?: boolean; full?: boolean } | boolean = false) => {
    const showToast = typeof opts === "boolean" ? opts : !!opts.showToast;
    const forceFull = typeof opts === "boolean" ? false : !!opts.full;
    if (!isEdit || !initial?.id || !user) return;
    setSaving(true);
    try {
      // Always sync the editor's current chapter back into local state
      const syncedPages = pages.map((p, i) => (
        i === activeIdx && editor ? { ...p, doc: editor.getJSON() as TextPage["doc"] } : p
      ));
      // Only save the dirty pages when nothing structural changed and
      // the user didn't press the Save button.
      const dirtyIdx = Array.from(dirtyPagesRef.current).filter(
        (i) => i >= 0 && i < syncedPages.length,
      );
      const doFull = forceFull || structureDirtyRef.current || dirtyIdx.length === 0;

      if (doFull) {
        const dbPages = textPagesToDbPages(syncedPages);
        const { error } = await supabase
          .from("books")
          .update({
            title: title || initial.title,
            author: author || initial.author,
            cover_url: coverUrl,
            pages: dbPages,
            typography_preset: typography,
          })
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        // Partial: send only the chapters that changed.
        const patches = dirtyIdx
          .sort((a, b) => a - b)
          .map((i) => ({ index: i, page: textPagesToDbPages([syncedPages[i]])[0] }));
        const { error } = await supabase.rpc("update_book_pages_partial", {
          _book_id: initial.id,
          _patches: patches as any,
        });
        if (error) throw error;
      }

      dirtyPagesRef.current.clear();
      structureDirtyRef.current = false;
      setSavedAt(new Date());
      setPages(syncedPages);
      setDirty(false);
      if (showToast) toast.success(fa ? "ذخیره شد" : "Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [isEdit, initial, user, pages, activeIdx, editor, title, author, typography, coverUrl, fa]);

  const skipFirst = useRef(true);
  useEffect(() => {
    if (!isEdit) return;
    if (skipFirst.current) { skipFirst.current = false; return; }
    if (!dirty) return;
    const t = window.setTimeout(() => { void persist(false); }, 3500);
    return () => window.clearTimeout(t);
  }, [pages, title, author, typography, coverUrl, dirty, isEdit, persist]);

  const addChapter = () => {
    setPages((ps) => [...ps, newEmptyPage(fa ? `فصل ${ps.length + 1}` : `Chapter ${ps.length + 1}`)]);
    setActiveIdx(pages.length);
    setDirty(true);
  };
  const removeChapter = (idx: number) => {
    if (pages.length <= 1) {
      toast.error(fa ? "حداقل یک فصل لازم است" : "At least one chapter is required");
      return;
    }
    setPages((ps) => ps.filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, cur >= idx ? cur - 1 : cur));
    setDirty(true);
  };
  const renameChapter = (idx: number, value: string) => {
    setPages((ps) => ps.map((p, i) => (i === idx ? { ...p, title: value } : p)));
    setDirty(true);
  };

  const insertImageAtCursor = async (file: File) => {
    const url = await upload(file);
    if (!url || !editor) return;
    editor.chain().focus().insertContent({
      type: "image", attrs: { src: url, caption: "", hideCaption: false },
    }).run();
  };

  const handleCoverUpload = async (file: File) => {
    const url = await upload(file);
    if (!url) return;
    setCoverUrl(url);
    setDirty(true);
    toast.success(fa ? "کاور بارگذاری شد" : "Cover uploaded");
  };

  const splitChapterAtSelection = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;

    // If the user has selected text, use that as the new chapter title and
    // remove it from the source chapter — the split happens at the selection
    // start so the new chapter begins with the content that followed it.
    let selectedTitle = "";
    if (!empty) {
      selectedTitle = editor.state.doc.textBetween(from, to, " ", " ").trim();
      if (selectedTitle) {
        editor.chain().focus().deleteRange({ from, to }).run();
      }
    }

    const splitFrom = editor.state.selection.from;
    const fullJson = editor.getJSON() as TextPage["doc"];
    const blocks = (fullJson.content ?? []) as any[];
    let pos = 1;
    let splitIdx = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const node = editor.state.doc.child(i);
      const blockSize = node.nodeSize;
      if (splitFrom < pos + blockSize) { splitIdx = i; break; }
      pos += blockSize;
    }
    if (splitIdx >= blocks.length) {
      toast.info(fa ? "ابتدا روی متن کلیک کنید تا محل شکست مشخص شود" : "Place the cursor where the new chapter should start");
      return;
    }
    const head = blocks.slice(0, splitIdx);
    const tail = blocks.slice(splitIdx);
    const fallbackTitle = fa ? `فصل ${pages.length + 1}` : `Chapter ${pages.length + 1}`;
    const newPage: TextPage = {
      title: (selectedTitle.slice(0, 120)) || fallbackTitle,
      doc: { type: "doc" as const, content: tail.length ? tail : [{ type: "paragraph" }] },
    };
    setPages((ps) => {
      const next = ps.map((p, i) =>
        i === activeIdx
          ? { ...p, doc: { type: "doc" as const, content: head.length ? head : [{ type: "paragraph" }] } }
          : p,
      );
      next.splice(activeIdx + 1, 0, newPage);
      return next;
    });
    setDirty(true);
    setTimeout(() => setActiveIdx(activeIdx + 1), 0);
    toast.success(
      selectedTitle
        ? (fa ? `فصل «${selectedTitle.slice(0, 40)}» ساخته شد` : `Chapter "${selectedTitle.slice(0, 40)}" created`)
        : (fa ? "فصل جدید ساخته شد" : "New chapter created"),
    );
  };

  const insertInteractive = (kind: "video" | "gallery" | "timeline" | "scrollytelling") => {
    if (!editor) return;
    const attrs =
      kind === "video" ? { src: "", caption: "" } :
      kind === "gallery" ? { images: [], caption: "" } :
      { title: "", steps: [] };
    editor.chain().focus().insertContent({ type: kind, attrs }).run();
  };

  /** Toggle direction on the current text block (rtl ↔ ltr). */
  const toggleBlockDirection = () => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const node = $from.node($from.depth);
    const currentDir = (node?.attrs as any)?.dir;
    const next = currentDir === "rtl" ? "ltr" : currentDir === "ltr" ? null : (fa ? "ltr" : "rtl");
    // Apply to all current text-block types
    editor.chain().focus().updateAttributes(node.type.name, { dir: next }).run();
  };

  // Reload pages from DB after the auto-fill function applied a batch.
  // We replace the local pages state and force the editor to refresh the
  // currently active chapter so newly-attached pendingSrc values appear.
  const reloadPagesFromDb = useCallback(async () => {
    if (!isEdit || !initial?.id) return;
    const { data } = await supabase.from("books").select("pages").eq("id", initial.id).maybeSingle();
    if (!data?.pages) return;
    const fresh = dbPagesToTextPages(data.pages);
    setPages(fresh);
    if (editor) {
      const tgt = fresh[activeIdx]?.doc;
      if (tgt) editor.commands.setContent(tgt as any, { emitUpdate: false });
    }
  }, [isEdit, initial?.id, editor, activeIdx]);

  if (!editor) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }

  const sidePanel = showAi || showAutoFill;
  const gridCols = chaptersCollapsed
    ? (sidePanel ? "lg:grid-cols-[44px_1fr_340px]" : "lg:grid-cols-[44px_1fr]")
    : (sidePanel ? "lg:grid-cols-[220px_1fr_340px]" : "lg:grid-cols-[260px_1fr]");

  return (
    <div
      className={`grid grid-cols-1 gap-4 px-3 md:px-4 py-3 ${gridCols}`}
      dir={fa ? "rtl" : "ltr"}
    >
      {/* ============ Chapter sidebar (collapsible) ============ */}
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-2">
        {chaptersCollapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setChaptersCollapsed(false)}
              title={fa ? "نمایش فصل‌ها" : "Show chapters"}
            >
              {fa ? <ChevronsLeft className="w-4 h-4" /> : <ChevronsRight className="w-4 h-4" />}
            </Button>
            <div className="text-[10px] text-muted-foreground writing-mode-vertical" style={{ writingMode: "vertical-rl" }}>
              {fa ? "فصل‌ها" : "Chapters"} ({pages.length})
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1 gap-1">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 min-w-0 truncate">
                <BookOpen className="w-4 h-4 text-accent shrink-0" /> {fa ? "فصل‌ها" : "Chapters"}
              </h3>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={addChapter} title={fa ? "افزودن فصل" : "Add chapter"}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setChaptersCollapsed(true)}
                  title={fa ? "جمع کردن" : "Collapse"}
                >
                  {fa ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pe-1">
              {pages.map((p, i) => (
                <div
                  key={i}
                  className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition ${
                    i === activeIdx ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className="flex-1 min-w-0 text-start text-sm truncate"
                  >
                    <span className="text-[10px] text-muted-foreground me-1">{i + 1}.</span>
                    {p.title || (fa ? "بدون عنوان" : "Untitled")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(i)}
                    className="opacity-0 group-hover:opacity-100 transition text-destructive p-1"
                    title={fa ? "حذف فصل" : "Delete chapter"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* ============ Main editor ============ */}
      <section className="min-w-0">
        {/* Book cover */}
        <div className="flex items-center gap-3 mb-3 p-2 rounded-lg border bg-card/50">
          <div className="relative w-14 h-20 rounded-md overflow-hidden border bg-muted shrink-0 flex items-center justify-center">
            {coverUrl ? (
              <img src={coverUrl} alt="cover" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold mb-0.5">{fa ? "کاور کتاب" : "Book cover"}</div>
            <div className="text-[11px] text-muted-foreground truncate mb-1.5">
              {coverUrl ? (fa ? "روی تغییر کلیک کنید" : "Click change to replace") : (fa ? "هنوز کاوری انتخاب نشده" : "No cover yet")}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={coverFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCoverUpload(f);
                  if (coverFileRef.current) coverFileRef.current.value = "";
                }}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => coverFileRef.current?.click()}>
                <ImageIcon className="w-3.5 h-3.5 me-1" />
                {coverUrl ? (fa ? "تغییر" : "Change") : (fa ? "بارگذاری" : "Upload")}
              </Button>
              {coverUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive"
                  onClick={() => { setCoverUrl(null); setDirty(true); }}
                >
                  <Trash2 className="w-3.5 h-3.5 me-1" /> {fa ? "حذف" : "Remove"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Chapter title + meta */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Input
            value={activePage?.title ?? ""}
            onChange={(e) => renameChapter(activeIdx, e.target.value)}
            placeholder={fa ? "عنوان فصل" : "Chapter title"}
            className="flex-1 min-w-[180px] text-lg font-display font-semibold border-0 border-b border-dashed rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
          />
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> {fa ? "ذخیره…" : "Saving…"}</> :
             dirty ? <span className="text-accent">●</span> :
             savedAt ? <span>✓ {savedAt.toLocaleTimeString()}</span> :
             <span>{fa ? "آماده" : "Ready"}</span>}
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={() => persist(true)}>
            <Save className="w-3.5 h-3.5 me-1" /> {fa ? "ذخیره" : "Save"}
          </Button>
          {isEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              onClick={() => setShowMeta(true)}
              title={fa ? "ویرایش شناسنامه و مشخصات کتاب" : "Edit book identity & metadata"}
            >
              <Info className="w-3.5 h-3.5" /> {fa ? "مشخصات کتاب" : "Metadata"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={showAi ? "default" : "outline"}
            className="h-8 gap-1 text-accent"
            onClick={() => setShowAi((v) => !v)}
          >
            <Sparkles className="w-3.5 h-3.5" /> {fa ? "دستیار AI" : "AI"}
          </Button>
        </div>

        {/* ============ STICKY TOOLBAR ============ */}
        <div className="sticky top-16 z-30 -mx-3 md:mx-0 px-3 md:px-0 mb-3">
          <div className="rounded-xl border bg-popover/95 backdrop-blur shadow-sm p-1.5 flex items-center gap-0.5 overflow-x-auto scrollbar-thin">
            {/* Undo / Redo */}
            <TbBtn title={fa ? "بازگردانی" : "Undo"} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "تکرار" : "Redo"} onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 className="w-4 h-4" />
            </TbBtn>
            <TbSep />

            {/* Inline marks */}
            <TbBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold className="w-4 h-4" />
            </TbBtn>
            <TbBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic className="w-4 h-4" />
            </TbBtn>
            <TbBtn title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <UnderlineIcon className="w-4 h-4" />
            </TbBtn>

            {/* Color */}
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" title={fa ? "رنگ متن" : "Text color"} className="p-1.5 rounded-md hover:bg-muted shrink-0">
                  <Palette className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" side="bottom">
                <div className="grid grid-cols-7 gap-1">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      title={c.name}
                      onClick={() => {
                        if (!c.value) editor.chain().focus().unsetColor().run();
                        else editor.chain().focus().setColor(c.value).run();
                      }}
                      className="w-6 h-6 rounded-full border hover:scale-110 transition flex items-center justify-center"
                      style={{ background: c.value || "transparent", borderColor: c.value ? "transparent" : "hsl(var(--border))" }}
                    >
                      {!c.value && <X className="w-3 h-3 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <TbSep />

            {/* Headings */}
            <TbBtn title="H1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 className="w-4 h-4" />
            </TbBtn>
            <TbBtn title="H2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="w-4 h-4" />
            </TbBtn>
            <TbBtn title="H3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 className="w-4 h-4" />
            </TbBtn>
            <TbBtn
              title={fa ? "پاک‌کردن قالب‌بندی (تیتر، نقل‌قول، بلوک، …)" : "Clear formatting (heading, quote, block, …)"}
              onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            >
              <Eraser className="w-4 h-4" />
            </TbBtn>
            <TbSep />

            {/* Lists */}
            <TbBtn title={fa ? "لیست" : "Bullet list"} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "لیست شماره‌دار" : "Ordered list"} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <OlIcon className="w-4 h-4" />
            </TbBtn>
            <TbSep />

            {/* Alignment */}
            <TbBtn title={fa ? "راست‌چین" : "Right"} active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
              <AlignRight className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "وسط‌چین" : "Center"} active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
              <AlignCenter className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "چپ‌چین" : "Left"} active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
              <AlignLeft className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "تراز کامل" : "Justify"} active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
              <AlignJustify className="w-4 h-4" />
            </TbBtn>

            {/* Direction (RTL/LTR for bilingual) */}
            <TbBtn title={fa ? "تغییر جهت متن (دوزبانه)" : "Toggle direction"} onClick={toggleBlockDirection}>
              <ArrowLeftRight className="w-4 h-4" />
            </TbBtn>
            <TbSep />

            {/* Block elements: callout variants popover */}
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" title={fa ? "بلوک نکته/تعریف/مثال" : "Callout blocks"} className="p-1.5 rounded-md hover:bg-muted flex items-center gap-1 shrink-0">
                  <Lightbulb className="w-4 h-4" />
                  <span className="text-xs hidden md:inline">{fa ? "بلوک" : "Block"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1.5">
                {[
                  { v: "info", fa: "نکته", en: "Info" },
                  { v: "tip", fa: "ایده", en: "Tip" },
                  { v: "warning", fa: "هشدار", en: "Warning" },
                  { v: "success", fa: "نکته مهم", en: "Success" },
                  { v: "danger", fa: "خطر", en: "Danger" },
                  { v: "question", fa: "سؤال", en: "Question" },
                  { v: "definition", fa: "تعریف", en: "Definition" },
                  { v: "example", fa: "مثال", en: "Example" },
                ].map((c) => (
                  <button
                    key={c.v}
                    type="button"
                    onClick={() => editor.chain().focus().setNode("callout", { variant: c.v }).run()}
                    className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start"
                  >
                    <Lightbulb className="w-4 h-4 text-accent" /> {fa ? c.fa : c.en}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <TbBtn title={fa ? "نقل‌قول" : "Quote"} active={editor.isActive("quote")} onClick={() => editor.chain().focus().setNode("quote").run()}>
              <QuoteIcon className="w-4 h-4" />
            </TbBtn>
            <TbBtn title={fa ? "تصویر" : "Image"} onClick={() => fileRef.current?.click()}>
              <ImageIcon className="w-4 h-4" />
            </TbBtn>
            <TbBtn
              title={fa ? "تبدیل به فصل جدید (شکست در محل نشانگر)" : "Split into new chapter here"}
              accent
              onClick={splitChapterAtSelection}
            >
              <Scissors className="w-4 h-4" />
            </TbBtn>
            <TbSep />

            {/* Interactive insert */}
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" title={fa ? "افزودن عنصر تعاملی" : "Interactive"} className="p-1.5 rounded-md hover:bg-muted flex items-center gap-1 shrink-0">
                  <Layers className="w-4 h-4" />
                  <span className="text-xs hidden sm:inline">{fa ? "تعاملی" : "Interactive"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1.5">
                <button type="button" onClick={() => insertInteractive("video")} className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start">
                  <Film className="w-4 h-4 text-accent" /> {fa ? "ویدئو" : "Video"}
                </button>
                <button type="button" onClick={() => insertInteractive("gallery")} className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start">
                  <GalleryHorizontal className="w-4 h-4 text-accent" /> {fa ? "گالری تصاویر" : "Gallery"}
                </button>
                <button type="button" onClick={() => insertInteractive("timeline")} className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start">
                  <ListOrdered className="w-4 h-4 text-accent" /> {fa ? "تایم‌لاین" : "Timeline"}
                </button>
                <button type="button" onClick={() => insertInteractive("scrollytelling")} className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start">
                  <Layers className="w-4 h-4 text-accent" /> {fa ? "اسکرولی‌تلینگ" : "Scrollytelling"}
                </button>
                <div className="h-px bg-border my-1" />
                <button type="button" onClick={splitChapterAtSelection} className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-start">
                  <SplitSquareVertical className="w-4 h-4 text-primary" /> {fa ? "فصل جدید از اینجا" : "New chapter here"}
                </button>
              </PopoverContent>
            </Popover>
            <TbSep />

            {/* Typography */}
            <Select value={typography} onValueChange={(v) => { setTypography(v); setDirty(true); }}>
              <SelectTrigger className="h-8 w-[130px] shrink-0" title={fa ? "تیپوگرافی" : "Typography"}>
                <TypeIcon className="w-3.5 h-3.5 me-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPOGRAPHY_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{fa ? p.label_fa : p.label_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Hidden file input for image insert */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await insertImageAtCursor(f);
            e.target.value = "";
          }}
        />

        {/* Image-placeholder banner: surfaces images that the Word importer
            had to leave out, so the user can review/insert them in place. */}
        {(() => {
          const countPlaceholders = (doc: any): { total: number; pending: number } => {
            let total = 0; let pending = 0;
            for (const node of doc?.content ?? []) {
              if (node?.type === "image_placeholder") {
                total += 1;
                if (!node.attrs?.pendingSrc) pending += 1;
              }
            }
            return { total, pending };
          };
          const here = countPlaceholders(pages[activeIdx]?.doc);
          const sum = pages.reduce((acc, p) => {
            const c = countPlaceholders(p.doc);
            return { total: acc.total + c.total, pending: acc.pending + c.pending };
          }, { total: 0, pending: 0 });
          if (!sum.total) return null;
          return (
            <div className="mb-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm flex items-start gap-3 flex-wrap">
              <ImageIcon className="w-4 h-4 mt-0.5 text-amber-700 dark:text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-amber-800 dark:text-amber-300">
                  {fa
                    ? `${here.total} تصویر در این فصل (${sum.total} در کل) — ${sum.pending} هنوز بدون تصویر.`
                    : `${here.total} image slot(s) in this chapter (${sum.total} total) — ${sum.pending} still empty.`}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {fa
                    ? "می‌توانید همه تصاویر را خودکار از فایل Word اصلی استخراج و در همان جایگاه قرار دهید، یا هر کدام را دستی آپلود کنید."
                    : "Auto-extract every image from the original Word file in place, or upload them manually."}
                </div>
              </div>
              {importId && sum.pending > 0 && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => { setShowAutoFill(true); setShowAi(false); }}
                >
                  <ImageIcon className="w-3.5 h-3.5 me-1" />
                  {fa ? "جایگذاری خودکار تصاویر" : "Auto-place images"}
                </Button>
              )}
            </div>
          );
        })()}

        {/* The actual editor */}
        <div className={`rounded-2xl border bg-card/50 px-4 md:px-8 py-6 md:py-8 shadow-paper typo-${typography}`}>
          <EditorContent editor={editor} />
        </div>
      </section>

      {/* ============ AI side panel ============ */}
      <AnimatePresence>
        {showAi && (
          <motion.aside
            initial={{ opacity: 0, x: fa ? -20 : 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: fa ? -20 : 20 }}
            className="lg:sticky lg:top-20 lg:self-start min-w-0"
          >
            <AiSuggestPanel
              editor={editor}
              lang={fa ? "fa" : "en"}
              onClose={() => setShowAi(false)}
              bookId={initial?.id}
              chapterKey={`${initial?.id ?? "new"}:${activeIdx}`}
            />
          </motion.aside>
        )}
        {showAutoFill && initial?.id && (
          <ImageAutoPlacementPanel
            bookId={initial.id}
            importId={importId}
            totalPlaceholders={pages.reduce((acc, p) => acc + (p.doc?.content?.filter((n: any) => n?.type === "image_placeholder" && !n.attrs?.pendingSrc).length || 0), 0)}
            onClose={() => setShowAutoFill(false)}
            onBatchApplied={() => { void reloadPagesFromDb(); }}
          />
        )}
      </AnimatePresence>

      {/* Confirm chapter delete */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف فصل" : "Delete chapter"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `«${pages[pendingDelete ?? 0]?.title || "بدون عنوان"}» حذف خواهد شد. این عمل قابل بازگشت نیست.`
                : `Chapter "${pages[pendingDelete ?? 0]?.title || "Untitled"}" will be deleted permanently.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingDelete !== null) removeChapter(pendingDelete); setPendingDelete(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Book metadata dialog */}
      <Dialog open={showMeta} onOpenChange={setShowMeta}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir={fa ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{fa ? "شناسنامه و مشخصات کتاب" : "Book identity & metadata"}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <BookMetadataForm value={meta} onChange={setMeta} fa={fa} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowMeta(false)} disabled={metaSaving}>
              {fa ? "انصراف" : "Cancel"}
            </Button>
            <Button onClick={saveMetadata} disabled={metaSaving || !meta.title.trim()}>
              {metaSaving && <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" />}
              {fa ? "ذخیره مشخصات" : "Save metadata"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TextBookEditor;
