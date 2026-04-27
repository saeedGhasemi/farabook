// New page-as-document book editor. The whole chapter is a single
// rich-text document. A floating bubble menu appears on text
// selection with the 5 main tools + AI button. Side panel hosts AI
// suggestions with Accept/Reject.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, Quote as QuoteIcon, Lightbulb,
  Image as ImageIcon, Sparkles, Plus, Trash2, BookOpen, Loader2, Save, Check, X,
  Palette, Type as TypeIcon, SplitSquareVertical, Film, GalleryHorizontal, ListOrdered, Layers,
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
  Callout, Quote, ImageBlock, VideoBlock, GalleryBlock, TimelineBlock, ScrollyBlock,
  useImageUpload,
} from "./tiptap-nodes";
import {
  dbPagesToTextPages, textPagesToDbPages, type TextPage,
} from "@/lib/tiptap-doc";
import { AiSuggestPanel } from "./AiSuggestPanel";

const TYPOGRAPHY_PRESETS = [
  { value: "editorial", label_fa: "روزنامه‌ای", label_en: "Editorial" },
  { value: "academic", label_fa: "آکادمیک", label_en: "Academic" },
  { value: "modern", label_fa: "مدرن", label_en: "Modern" },
  { value: "playful", label_fa: "صمیمی", label_en: "Playful" },
  { value: "elegant", label_fa: "نفیس", label_en: "Elegant" },
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

export const TextBookEditor = ({ initial }: Props) => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const fa = lang === "fa";
  const isEdit = Boolean(initial?.id);

  // Top-level book metadata
  const [title, setTitle] = useState(initial?.title ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");

  // Pages (chapters) — each has its own title + Tiptap doc
  const [pages, setPages] = useState<TextPage[]>(
    initial?.pages?.length ? dbPagesToTextPages(initial.pages) : [newEmptyPage(fa ? "فصل ۱" : "Chapter 1")],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const activePage = pages[activeIdx] ?? pages[0];

  // Save / dirty
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [typography, setTypography] = useState<string>(initial?.typography_preset || "editorial");

  const { upload } = useImageUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ---------------- Editor instance ---------------- */
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false, // we use custom Quote
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: fa ? "اینجا بنویسید… با Enter پاراگراف بعدی." : "Write here… Enter for next paragraph.",
      }),
      Callout, Quote, ImageBlock, VideoBlock, GalleryBlock, TimelineBlock, ScrollyBlock,
    ],
    content: activePage?.doc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        dir: fa ? "rtl" : "ltr",
        class: "prose prose-lg max-w-none focus:outline-none min-h-[60vh] leading-relaxed tiptap-surface",
        // Disable iOS/Android native text-selection callout so it doesn't
        // overlap our BubbleMenu. Users still get our custom toolbar.
        style: "-webkit-touch-callout: none;",
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as TextPage["doc"];
      setPages((ps) => ps.map((p, i) => (i === activeIdx ? { ...p, doc: json } : p)));
      setDirty(true);
    },
  });

  // Swap content when active chapter changes
  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    const target = pages[activeIdx]?.doc;
    if (target && JSON.stringify(current) !== JSON.stringify(target)) {
      editor.commands.setContent(target as any, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, editor]);

  /* ---------------- Persist ---------------- */
  const persist = useCallback(async (showToast = false) => {
    if (!isEdit || !initial?.id || !user) return;
    setSaving(true);
    try {
      const dbPages = textPagesToDbPages(pages);
      const { error } = await supabase
        .from("books")
        .update({
          title: title || initial.title,
          author: author || initial.author,
          pages: dbPages,
        })
        .eq("id", initial.id);
      if (error) throw error;
      setSavedAt(new Date());
      setDirty(false);
      if (showToast) toast.success(fa ? "ذخیره شد" : "Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [isEdit, initial, user, pages, title, author, fa]);

  // Autosave
  const skipFirst = useRef(true);
  useEffect(() => {
    if (!isEdit) return;
    if (skipFirst.current) { skipFirst.current = false; return; }
    if (!dirty) return;
    const t = window.setTimeout(() => { void persist(false); }, 3500);
    return () => window.clearTimeout(t);
  }, [pages, title, author, dirty, isEdit, persist]);

  /* ---------------- Chapter actions ---------------- */
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

  /* ---------------- Toolbar actions ---------------- */
  const insertImageAtCursor = async (file: File) => {
    const url = await upload(file);
    if (!url || !editor) return;
    editor.chain().focus().insertContent({
      type: "image", attrs: { src: url, caption: "", hideCaption: false },
    }).run();
  };

  if (!editor) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 px-3 md:px-4 py-3" dir={fa ? "rtl" : "ltr"}>
      {/* ============ Chapter sidebar ============ */}
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><BookOpen className="w-4 h-4 text-accent" /> {fa ? "فصل‌ها" : "Chapters"}</h3>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={addChapter}>
            <Plus className="w-3.5 h-3.5 me-1" /> {fa ? "افزودن" : "Add"}
          </Button>
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
      </aside>

      {/* ============ Main editor ============ */}
      <section className="min-w-0">
        {/* Top bar: chapter title + save status + AI */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Input
            value={activePage?.title ?? ""}
            onChange={(e) => renameChapter(activeIdx, e.target.value)}
            placeholder={fa ? "عنوان فصل" : "Chapter title"}
            className="flex-1 min-w-[200px] text-lg font-display font-semibold border-0 border-b border-dashed rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
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
          <Button
            size="sm"
            className="h-8 bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => setShowAi((v) => !v)}
          >
            <Sparkles className="w-3.5 h-3.5 me-1" /> {fa ? "دستیار هوشمند" : "AI assistant"}
          </Button>
        </div>

        {/* Floating bubble toolbar (5 tools + AI) */}
        <BubbleMenu
          editor={editor}
          options={{
            // On mobile, the native selection callout sits above the
            // selection — push our toolbar BELOW so they don't overlap.
            placement: typeof window !== "undefined" && window.innerWidth < 768 ? "bottom" : "top",
            offset: 12,
          }}
          className="rounded-xl border bg-popover shadow-lg p-1 flex items-center gap-0.5 max-w-[95vw] overflow-x-auto"
        >
          <button type="button" title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("bold") ? "bg-muted" : ""}`}>
            <Bold className="w-4 h-4" />
          </button>
          <button type="button" title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("italic") ? "bg-muted" : ""}`}>
            <Italic className="w-4 h-4" />
          </button>
          <button type="button" title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("underline") ? "bg-muted" : ""}`}>
            <UnderlineIcon className="w-4 h-4" />
          </button>
          <span className="w-px h-5 bg-border mx-1" />
          <button type="button" title={fa ? "تیتر" : "Heading"} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("heading", { level: 2 }) ? "bg-muted" : ""}`}>
            <Heading2 className="w-4 h-4" />
          </button>
          <button type="button" title={fa ? "نکته" : "Callout"} onClick={() => editor.chain().focus().setNode("callout", { variant: "info" }).run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("callout") ? "bg-muted" : ""}`}>
            <Lightbulb className="w-4 h-4" />
          </button>
          <button type="button" title={fa ? "نقل‌قول" : "Quote"} onClick={() => editor.chain().focus().setNode("quote").run()} className={`p-1.5 rounded hover:bg-muted ${editor.isActive("quote") ? "bg-muted" : ""}`}>
            <QuoteIcon className="w-4 h-4" />
          </button>
          <button type="button" title={fa ? "تصویر" : "Image"} onClick={() => fileRef.current?.click()} className="p-1.5 rounded hover:bg-muted">
            <ImageIcon className="w-4 h-4" />
          </button>
          <span className="w-px h-5 bg-border mx-1" />
          <button
            type="button"
            title={fa ? "پیشنهاد AI" : "AI suggest"}
            onClick={() => setShowAi(true)}
            className="p-1.5 rounded hover:bg-accent/10 text-accent flex items-center gap-1"
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">AI</span>
          </button>
        </BubbleMenu>

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

        {/* The actual editor */}
        <div className="rounded-2xl border bg-card/50 px-4 md:px-8 py-6 md:py-8 shadow-paper">
          <EditorContent editor={editor} />
        </div>

        {/* AI suggestions panel (slides in) */}
        <AnimatePresence>
          {showAi && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mt-4"
            >
              <AiSuggestPanel
                editor={editor}
                lang={fa ? "fa" : "en"}
                onClose={() => setShowAi(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>

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
    </div>
  );
};

export default TextBookEditor;
