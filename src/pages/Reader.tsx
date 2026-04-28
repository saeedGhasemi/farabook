import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Menu, Highlighter as HlIcon, X, Search, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BlockRenderer, type Block } from "@/components/reader/BlockRenderer";
import { FloatingMenu } from "@/components/reader/FloatingMenu";
import { AiPanel } from "@/components/reader/AiPanel";
import { ChatPanel } from "@/components/reader/ChatPanel";
import { ChapterSidebar } from "@/components/reader/ChapterSidebar";
import { HighlightsPanel, type HighlightItem } from "@/components/reader/HighlightsPanel";
import { resolveBookMedia } from "@/lib/book-media";
import { speakSmart, stopSpeak as stopSpeakSmart } from "@/lib/tts";
import { docToLegacyBlocks } from "@/lib/tiptap-doc";

interface Page {
  title: string;
  ambient?: string;
  doc?: any;
  blocks?: Block[];
  content?: string;
}
interface Book {
  id: string; title: string; author: string;
  ambient_theme: string | null;
  typography_preset?: string | null;
  pages: Page[];
  price?: number;
  publisher_id?: string | null;
}

const ambientSrc: Record<string, string> = {
  rain: "https://cdn.pixabay.com/audio/2022/03/15/audio_e1bf6db78f.mp3",
  forest: "https://cdn.pixabay.com/audio/2022/02/07/audio_5cab6f9395.mp3",
  cafe: "https://cdn.pixabay.com/audio/2022/03/09/audio_d8c80cd3e8.mp3",
  night: "https://cdn.pixabay.com/audio/2022/10/30/audio_347111d662.mp3",
};

type AiMode = "summary" | "quiz" | "mindmap" | "explain" | "timeline";

interface SearchResult {
  pageIndex: number;
  blockIndex: number;
  title: string;
  excerpt: string;
  mediaSrc?: string;
  mediaKey?: string;
  mediaCaption?: string;
}

const pageToBlocks = (page?: Page): Block[] => {
  if (!page) return [];
  if (page.doc?.type === "doc") return docToLegacyBlocks(page.doc) as Block[];
  return page.blocks ?? (page.content ? [{ type: "paragraph", text: page.content }] : []);
};

const Reader = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, dir, lang } = useI18n();
  const { user } = useAuth();

  const [book, setBook] = useState<Book | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [flipDir, setFlipDir] = useState<1 | -1>(1);
  const [fontSize, setFontSize] = useState(16);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [dark, setDark] = useState(false);
  const [ambient, setAmbient] = useState<string>("off");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [aiContent, setAiContent] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [savePopover, setSavePopover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [jumpValue, setJumpValue] = useState("1");
  const [chatOpen, setChatOpen] = useState(false);
  const [timelineData, setTimelineData] = useState<{ title?: string; steps: Array<{ marker: string; title: string; description: string }> } | null>(null);

  const [userBookId, setUserBookId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const Prev = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Next = dir === "rtl" ? ArrowLeft : ArrowRight;

  // Load book
  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("books").select("*").eq("id", id).maybeSingle();
      if (!data) {
        toast.error(lang === "fa" ? "کتاب یافت نشد" : "Book not found");
        nav("/store");
        return;
      }
      // Gate paid books: require login & ownership (publisher/editor/owner)
      const isPaid = Number(data.price ?? 0) > 0;
      if (isPaid) {
        if (!user) {
          toast.error(lang === "fa" ? "برای مطالعه این کتاب وارد شوید" : "Please sign in to read this book");
          nav("/auth");
          return;
        }
        const isOwner = data.publisher_id === user.id;
        if (!isOwner) {
          const { data: ub } = await supabase
            .from("user_books").select("id")
            .eq("user_id", user.id).eq("book_id", id).maybeSingle();
          if (!ub) {
            toast.error(lang === "fa" ? "ابتدا این کتاب را خریداری کنید" : "Please purchase this book first");
            nav("/store");
            return;
          }
        }
      }
      const pages = Array.isArray(data.pages) ? data.pages : [];
      setBook({ ...data, pages: pages as unknown as Page[] });
      if (data.ambient_theme && data.ambient_theme !== "paper") setAmbient(data.ambient_theme);
    })();
  }, [id, nav, user, lang]);

  // Load progress
  useEffect(() => {
    if (!user || !id) return;
    supabase.from("user_books").select("id, current_page").eq("user_id", user.id).eq("book_id", id).maybeSingle()
      .then(({ data }) => {
        if (data) { setUserBookId(data.id); setPageIdx(data.current_page ?? 0); }
      });
  }, [user, id]);

  // Load highlights
  const loadHighlights = useCallback(async () => {
    if (!user || !id) return;
    const { data } = await supabase
      .from("highlights")
      .select("id, text, page_index, color, created_at, note")
      .eq("user_id", user.id).eq("book_id", id)
      .order("created_at", { ascending: false });
    if (data) setHighlights(data as HighlightItem[]);
  }, [user, id]);
  useEffect(() => { loadHighlights(); }, [loadHighlights]);

  // Persist progress
  useEffect(() => {
    if (!userBookId || !book) return;
    const total = book.pages.length || 1;
    const progress = ((pageIdx + 1) / total) * 100;
    const status = pageIdx >= total - 1 ? "finished" : "reading";
    supabase.from("user_books").update({ current_page: pageIdx, progress, status }).eq("id", userBookId).then();
  }, [pageIdx, userBookId, book]);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);

  useEffect(() => {
    if (!book) return;
    const p = book.pages[pageIdx];
    if (p?.ambient && ambient === "off") setAmbient(p.ambient);
  }, [pageIdx, book]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (ambient === "off") return;
    const src = ambientSrc[ambient];
    if (!src) return;
    const a = new Audio(src);
    a.crossOrigin = "anonymous";
    a.loop = true;
    a.volume = 0;
    a.preload = "auto";
    audioRef.current = a;

    const playPromise = a.play();
    if (playPromise) {
      playPromise.then(() => {
        // fade-in over 1.2s
        const target = 0.28;
        const steps = 20;
        let n = 0;
        const fade = window.setInterval(() => {
          n++;
          if (audioRef.current === a) a.volume = Math.min(target, (target * n) / steps);
          if (n >= steps) window.clearInterval(fade);
        }, 60);
      }).catch(() => {
        // Autoplay blocked — wait for first user interaction
        const resume = () => {
          a.play().then(() => { a.volume = 0.28; }).catch(() => {});
          window.removeEventListener("pointerdown", resume);
          window.removeEventListener("keydown", resume);
        };
        window.addEventListener("pointerdown", resume, { once: true });
        window.addEventListener("keydown", resume, { once: true });
        toast.info(lang === "fa" ? "برای پخش صدای محیطی روی صفحه کلیک کنید" : "Tap the page to start ambient sound");
      });
    }
    return () => {
      a.pause();
      a.src = "";
    };
  }, [ambient, lang]);

  useEffect(() => () => { stopSpeakSmart(); }, []);
  useEffect(() => {
    stopSpeakSmart();
    setIsSpeaking(false);
    setSavePopover(null);
  }, [pageIdx]);

  const currentPage = book?.pages[pageIdx];
  const total = book?.pages.length ?? 0;

  useEffect(() => {
    setJumpValue(String(pageIdx + 1));
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, [pageIdx]);

  const pageText = useMemo(() => {
    if (!currentPage) return "";
    if (currentPage.blocks) {
      return currentPage.blocks
        .map((b) => {
          if (b.type === "paragraph" || b.type === "heading" || b.type === "highlight") return b.text;
          if (b.type === "quote") return `"${b.text}"${b.author ? ` — ${b.author}` : ""}`;
          if (b.type === "callout") return b.text;
          if (b.type === "image" || b.type === "gallery" || b.type === "video") return b.caption || "";
          return "";
        })
        .filter(Boolean)
        .join("\n\n");
    }
    return currentPage.content || "";
  }, [currentPage]);

  const goNext = () => { if (pageIdx < total - 1) { setFlipDir(1); setPageIdx(pageIdx + 1); } };
  const goPrev = () => { if (pageIdx > 0) { setFlipDir(-1); setPageIdx(pageIdx - 1); } };
  const goTo = (i: number) => {
    if (i === pageIdx) return;
    setFlipDir(i > pageIdx ? 1 : -1);
    setPageIdx(i);
  };

  const runAI = async (mode: AiMode) => {
    if (!pageText) return;

    // Timeline → structured output, render as preview + offer to insert as note
    if (mode === "timeline") {
      setTimelineData(null);
      setAiMode("timeline");
      setAiOpen(true);
      setAiLoading(true);
      setAiContent("");
      try {
        const { data, error } = await supabase.functions.invoke("book-ai", {
          body: { text: pageText, mode: "timeline", lang },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const tl = data?.timeline ?? { steps: [] };
        setTimelineData(tl);
        if (!tl.steps?.length) {
          setAiContent(lang === "fa"
            ? "این متن قابل تبدیل به تایم‌لاین نیست."
            : "This text isn't timeline-shaped.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "AI error");
      } finally { setAiLoading(false); }
      return;
    }

    setAiMode(mode); setAiOpen(true); setAiLoading(true); setAiContent("");
    try {
      const { data, error } = await supabase.functions.invoke("book-ai", {
        body: { text: pageText, mode, lang },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAiContent(data?.content ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI error");
      setAiContent("");
    } finally { setAiLoading(false); }
  };

  const regenerateAI = () => { if (aiMode) runAI(aiMode); };

  const saveAiAsNote = async (text: string) => {
    if (!user || !id) { toast.error(lang === "fa" ? "ابتدا وارد شوید" : "Please sign in first"); return; }
    const snippet = pageText.slice(0, 80) + (pageText.length > 80 ? "…" : "");
    const { data, error } = await supabase
      .from("highlights")
      .insert({
        user_id: user.id,
        book_id: id,
        page_index: pageIdx,
        text: snippet || (lang === "fa" ? "یادداشت هوش مصنوعی" : "AI note"),
        color: "blue",
        note: text,
      })
      .select("id, text, page_index, color, created_at, note")
      .single();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setHighlights((prev) => [data as HighlightItem, ...prev]);
      toast.success(lang === "fa" ? "به نشان‌ها اضافه شد" : "Saved to notes");
    }
  };

  const speak = () => {
    if (!pageText) return;
    setIsSpeaking(true);
    speakSmart({
      text: pageText,
      rate: voiceSpeed,
      fallbackLang: lang,
      onEnd: () => setIsSpeaking(false),
      onError: () => {
        setIsSpeaking(false);
        toast.error(lang === "fa" ? "پخش صدا با خطا روبرو شد" : "Voice playback failed");
      },
    });
  };
  const stopSpeak = () => { stopSpeakSmart(); setIsSpeaking(false); };

  // Selection-based highlighting — always active, no toolbar toggle needed
  useEffect(() => {
    const handler = () => window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2) { setSavePopover(null); return; }
      if (!articleRef.current || !sel?.anchorNode) return;
      if (!articleRef.current.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      setSavePopover({
        x: Math.min(window.innerWidth - 64, Math.max(64, rect.left + rect.width / 2)),
        y: Math.max(72, rect.top - 10),
        text,
      });
    }, 80);
    document.addEventListener("mouseup", handler);
    document.addEventListener("touchend", handler);
    document.addEventListener("selectionchange", handler);
    // Aggressively block native context/share menus inside the reader
    const blockCtx = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && articleRef.current?.contains(target)) e.preventDefault();
    };
    document.addEventListener("contextmenu", blockCtx);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("touchend", handler);
      document.removeEventListener("selectionchange", handler);
      document.removeEventListener("contextmenu", blockCtx);
    };
  }, []);

  const saveHighlight = async (color: string, note?: string) => {
    if (!savePopover || !user || !id) return;
    const { data, error } = await supabase
      .from("highlights")
      .insert({
        user_id: user.id,
        book_id: id,
        page_index: pageIdx,
        text: savePopover.text,
        color,
        note: note || null,
      })
      .select("id, text, page_index, color, created_at, note")
      .single();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setHighlights((prev) => [data as HighlightItem, ...prev]);
      toast.success(lang === "fa" ? "هایلایت ذخیره شد" : "Highlight saved");
    }
    setSavePopover(null);
    window.getSelection()?.removeAllRanges();
  };

  const updateHighlightNote = async (hid: string, note: string) => {
    const { error } = await supabase
      .from("highlights")
      .update({ note })
      .eq("id", hid);
    if (error) { toast.error(error.message); return; }
    setHighlights((prev) =>
      prev.map((h) => (h.id === hid ? { ...h, note } : h)),
    );
    toast.success(lang === "fa" ? "یادداشت ذخیره شد" : "Note saved");
  };

  const deleteHighlight = async (hid: string) => {
    const { error } = await supabase.from("highlights").delete().eq("id", hid);
    if (error) { toast.error(error.message); return; }
    setHighlights((prev) => prev.filter((h) => h.id !== hid));
  };

  // Wrap matched highlight texts on current page
  const pageHighlights = highlights.filter((h) => h.page_index === pageIdx);

  const ambientClass = ambient === "off" ? "" : `ambient-${ambient}`;

  if (!book || !currentPage) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  const blocks: Block[] = currentPage.blocks ?? (currentPage.content
    ? [{ type: "paragraph", text: currentPage.content }]
    : []);

  const chapters = book.pages.map((p, i) => ({ index: i, title: p.title }));
  // Detect book content direction independently of UI language
  const sampleText = (book.pages.slice(0, 3).map((p) => p.title + " " + (p.blocks?.map((b) => "text" in b ? b.text : "").join(" ") ?? p.content ?? "")).join(" ")).slice(0, 2000);
  const rtlChars = (sampleText.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const ltrChars = (sampleText.match(/[A-Za-z]/g) || []).length;
  const bookDir: "rtl" | "ltr" = rtlChars >= ltrChars ? "rtl" : "ltr";
  // Chapter & search drawers always slide from the RIGHT edge of the screen
  const allOverlaysOpen = chaptersOpen || searchOpen || settingsOpen || highlightsOpen || aiOpen || chatOpen;
  const goToPageNumber = () => {
    const next = Math.min(total, Math.max(1, Number(jumpValue) || 1)) - 1;
    goTo(next);
  };
  const searchResults: SearchResult[] = (() => {
    if (!book) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return book.pages.flatMap((page, pIndex) => {
      const pageBlocks = page.blocks ?? (page.content ? [{ type: "paragraph", text: page.content } as Block] : []);
      const firstMedia = pageBlocks.map((candidate, candidateIndex) => {
        const src = candidate.type === "image" ? candidate.src : candidate.type === "gallery" ? candidate.images[0] : candidate.type === "slideshow" ? candidate.images[0]?.src : undefined;
        const caption = candidate.type === "image" ? candidate.caption : candidate.type === "gallery" ? candidate.caption : candidate.type === "slideshow" ? candidate.images[0]?.caption : undefined;
        return src ? { src, caption, key: `book-block-${pIndex}-${candidateIndex}` } : null;
      }).find(Boolean);
      return pageBlocks.flatMap((block, bIndex) => {
        const text = block.type === "paragraph" || block.type === "heading" || block.type === "highlight" || block.type === "callout"
          ? block.text
          : block.type === "quote"
          ? block.text
          : block.type === "image"
          ? block.caption || ""
          : block.type === "gallery"
          ? block.caption || ""
          : block.type === "slideshow"
          ? block.images.map((img) => img.caption || "").join(" ")
          : "";
        if (!`${page.title} ${text}`.toLowerCase().includes(term)) return [];
        const mediaSrc = block.type === "image" ? block.src : block.type === "gallery" ? block.images[0] : block.type === "slideshow" ? block.images[0]?.src : undefined;
        const blockMediaKey = mediaSrc ? `book-block-${pIndex}-${bIndex}` : undefined;
        return [{
          pageIndex: pIndex,
          blockIndex: bIndex,
          title: page.title || `${t("page")} ${pIndex + 1}`,
          excerpt: text || page.title,
          mediaSrc: mediaSrc || firstMedia?.src,
          mediaCaption: block.type === "image" ? block.caption : block.type === "gallery" ? block.caption : block.type === "slideshow" ? block.images[0]?.caption : undefined,
          mediaKey: blockMediaKey || firstMedia?.key,
        }];
      });
    }).slice(0, 30);
  })();
  const openSearchResult = (result: SearchResult) => {
    goTo(result.pageIndex);
    setSearchOpen(false);
    if (result.mediaKey) {
      window.setTimeout(() => {
        document.getElementById(result.mediaKey || "")?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.dispatchEvent(new CustomEvent("open-book-media", { detail: { key: result.mediaKey } }));
      }, 700);
    }
  };

  return (
    <main className={`min-h-[calc(100vh-4rem)] relative transition-colors duration-700 ${dark ? "bg-background" : "bg-gradient-hero"}`}>
      <div className={`fixed inset-0 pointer-events-none transition-opacity duration-1000 ${ambientClass}`} />

      <motion.div
        className="fixed top-20 left-1/3 w-96 h-96 rounded-full bg-accent/10 blur-3xl pointer-events-none"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="container py-6 md:py-10 relative">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => nav("/library")} className="gap-1.5">
              <Prev className="w-4 h-4" /> {t("back")}
            </Button>
            {/* Chapters trigger — collapsible drawer on all viewports */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChaptersOpen(true)}
              className="gap-1.5"
            >
              <Menu className="w-4 h-4" />
              {lang === "fa" ? "فصل‌ها" : "Chapters"}
            </Button>
          </div>
          <div className="text-sm text-muted-foreground hidden sm:block text-center">
            <span className="font-display font-semibold text-foreground">{book.title}</span>
            <span className="mx-2">·</span>
            <span>{book.author}</span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {pageIdx + 1} / {total}
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 bg-foreground/5 rounded-full overflow-hidden mb-8 max-w-5xl mx-auto">
          <motion.div
            className="h-full bg-gradient-warm"
            animate={{ width: `${((pageIdx + 1) / total) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Single-column layout — chapter sidebar is now always opened via drawer */}
        <div className={`max-w-4xl mx-auto transition-all duration-300 ${allOverlaysOpen ? "blur-[2px] opacity-55" : ""}`}>

          {/* Page */}
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.article
                ref={articleRef}
                key={pageIdx}
                dir={bookDir}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`paper-card rounded-3xl p-6 md:p-12 min-h-[60vh] book-shadow relative overflow-hidden no-native-callout typo-${book.typography_preset || "editorial"}`}
              >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-gold opacity-50" />
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
                  backgroundImage: "radial-gradient(circle at 20% 30%, hsl(var(--primary)) 1px, transparent 1px), radial-gradient(circle at 70% 60%, hsl(var(--accent)) 1px, transparent 1px)",
                  backgroundSize: "60px 60px, 80px 80px",
                }} />

                <div className="relative hl-mode">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {t("page")} {pageIdx + 1}
                    </div>
                    <div className="h-px flex-1 mx-4 bg-gradient-to-r from-transparent via-border to-transparent" />
                    <div className="text-xs text-accent font-medium">✦</div>
                  </div>

                  <h2 className="text-3xl md:text-5xl font-display font-bold mb-8 gold-text leading-tight">
                    {currentPage.title}
                  </h2>

                  <div className="space-y-4 selectable selection:bg-[hsl(var(--hl-yellow)/0.6)] cursor-text">
                    {blocks.map((block, i) => (
                      <BlockRenderer
                        key={i}
                        block={block}
                        fontSize={fontSize}
                        index={i}
                        pageIndex={pageIdx}
                        savedHighlights={pageHighlights.map((h) => ({ id: h.id, text: h.text, color: h.color || "yellow" }))}
                        onHighlightClick={() => setHighlightsOpen(true)}
                      />
                    ))}
                  </div>
                </div>
              </motion.article>
            </AnimatePresence>

            {/* Floating side arrows — always reachable without scrolling */}
            <button
              onClick={goPrev}
              disabled={pageIdx === 0}
              aria-label={t("prev")}
              className="fixed top-1/2 start-2 sm:start-4 -translate-y-1/2 z-30 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-accent text-accent-foreground shadow-book border-2 border-background/70 flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed hover:scale-110 active:scale-95 transition-transform"
            >
              <Prev className="w-6 h-6" />
            </button>
            <button
              onClick={goNext}
              disabled={pageIdx >= total - 1}
              aria-label={t("next")}
              className="fixed top-1/2 end-2 sm:end-4 -translate-y-1/2 z-30 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-accent text-accent-foreground shadow-book border-2 border-background/70 flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed hover:scale-110 active:scale-95 transition-transform"
            >
              <Next className="w-6 h-6" />
            </button>


            {/* Bottom navigation */}
            <div className="mt-8 flex items-center justify-between gap-3 pb-32">
              <Button variant="outline" onClick={goPrev} disabled={pageIdx === 0} className="gap-2 glass-strong">
                <Prev className="w-4 h-4" /> {t("prev")}
              </Button>
              <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-2">
                <HlIcon className="w-3 h-3" />
                <span>
                  {lang === "fa" ? "متن را انتخاب کنید تا رنگ هایلایت ظاهر شود" : "Select text to highlight"}
                </span>
              </div>
              <Button variant="outline" onClick={goNext} disabled={pageIdx >= total - 1} className="gap-2 glass-strong">
                {t("next")} <Next className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Selection save popover */}
      <AnimatePresence>
        {savePopover && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-[60] -translate-x-1/2 -translate-y-full glass-strong rounded-full p-1.5 shadow-book border border-accent/30 flex items-center gap-1"
            style={{ left: savePopover.x, top: savePopover.y }}
          >
            {(["yellow", "pink", "green", "blue"] as const).map((c) => (
              <button
                key={c}
                onClick={() => saveHighlight(c)}
                className="w-7 h-7 rounded-full hover:scale-110 transition-transform border border-foreground/10"
                style={{ background: `hsl(var(--hl-${c}))` }}
                aria-label={`highlight ${c}`}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bottom dock */}
      <FloatingMenu
        onAi={runAI}
        onSpeak={speak}
        onStopSpeak={stopSpeak}
        isSpeaking={isSpeaking}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenChapters={() => setChaptersOpen(true)}
        onOpenHighlights={() => setHighlightsOpen(true)}
        onOpenChat={() => setChatOpen(true)}
        highlightCount={highlights.length}
        dark={dark}
        onToggleDark={() => setDark(!dark)}
        ambient={ambient}
        onAmbient={setAmbient}
      />

      {/* AI panel */}
      <AiPanel
        open={aiOpen}
        mode={aiMode}
        loading={aiLoading}
        content={aiContent}
        timeline={timelineData}
        onClose={() => setAiOpen(false)}
        onRegenerate={regenerateAI}
        onSaveAsNote={saveAiAsNote}
      />

      {/* Chat with book */}
      <ChatPanel
        open={chatOpen}
        bookId={id ?? ""}
        bookTitle={book?.title}
        onClose={() => setChatOpen(false)}
      />

      {/* Highlights panel */}
      <HighlightsPanel
        open={highlightsOpen}
        highlights={highlights}
        onClose={() => setHighlightsOpen(false)}
        onJump={(i) => goTo(i)}
        onDelete={deleteHighlight}
        onUpdateNote={updateHighlightNote}
      />

      <AnimatePresence>
        {chaptersOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChaptersOpen(false)} className="fixed inset-0 backdrop-blur-md z-40" />
            <motion.aside initial={{ x: 440, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 440, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-[440px] glass-strong shadow-book border-l border-glass-border flex flex-col">
              <ChapterSidebar chapters={chapters} current={pageIdx} variant="drawer" onSelect={(i) => { goTo(i); setChaptersOpen(false); }} onClose={() => setChaptersOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSearchOpen(false)} className="fixed inset-0 backdrop-blur-md z-40" />
            <motion.aside initial={{ x: 440, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 440, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-[440px] glass-strong shadow-book border-l border-glass-border flex flex-col">
              <header className="flex items-center justify-between p-5 border-b border-border/40">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow"><Search className="w-5 h-5" /></div><h3 className="font-display font-bold">{lang === "fa" ? "جستجوی قوی" : "Power search"}</h3></div>
                <button onClick={() => setSearchOpen(false)} className="w-9 h-9 rounded-full hover:bg-foreground/10 flex items-center justify-center" aria-label="close"><X className="w-4 h-4" /></button>
              </header>
              <div className="p-4 border-b border-border/30"><Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={lang === "fa" ? "جستجو در متن، فصل و مدیا..." : "Search text, chapters, media..."} className="glass h-11" /></div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                {searchResults.map((result) => (
                  <button key={`${result.pageIndex}-${result.blockIndex}`} onClick={() => openSearchResult(result)} className="w-full text-start p-3 rounded-2xl glass border border-glass-border hover:border-accent/50 hover:shadow-paper transition-all flex gap-3">
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-foreground/5 shrink-0 flex items-center justify-center">
                      {result.mediaSrc ? <img src={resolveBookMedia(result.mediaSrc)} alt={result.mediaCaption || result.title} className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1"><p className="text-xs text-accent mb-1">{lang === "fa" ? "صفحهٔ" : "Page"} {result.pageIndex + 1}</p><h4 className="font-semibold text-sm line-clamp-1">{result.title}</h4><p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mt-1">{result.excerpt}</p></div>
                  </button>
                ))}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSettingsOpen(false)} className="fixed inset-0 backdrop-blur-md z-40" />
            <motion.aside initial={{ x: -440, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -440, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="fixed top-0 bottom-0 left-0 z-50 w-full sm:w-[440px] glass-strong shadow-book border-r border-glass-border flex flex-col">
              <header className="flex items-center justify-between p-5 border-b border-border/40"><h3 className="font-display font-bold">{t("settings")}</h3><button onClick={() => setSettingsOpen(false)} className="w-9 h-9 rounded-full hover:bg-foreground/10 flex items-center justify-center" aria-label="close"><X className="w-4 h-4" /></button></header>
              <div className="space-y-8 p-5 overflow-y-auto scrollbar-thin">
                <div className="space-y-3"><div className="flex justify-between text-sm"><span className="font-medium">{t("font_size")}</span><span className="text-muted-foreground tabular-nums">{fontSize}px</span></div><Slider value={[fontSize]} onValueChange={(v) => setFontSize(v[0])} min={14} max={32} step={1} /></div>
                <div className="space-y-3"><div className="flex justify-between text-sm"><span className="font-medium">{t("reading_speed")}</span><span className="text-muted-foreground tabular-nums">{voiceSpeed.toFixed(1)}x</span></div><Slider value={[voiceSpeed * 10]} onValueChange={(v) => setVoiceSpeed(v[0] / 10)} min={5} max={20} step={1} /></div>
                <div className="space-y-3"><label className="text-sm font-medium">{lang === "fa" ? "پرش به صفحه" : "Jump to page"}</label><div className="flex gap-2"><Input value={jumpValue} onChange={(e) => setJumpValue(e.target.value)} type="number" min={1} max={total} className="glass h-11" /><Button onClick={goToPageNumber} className="bg-gradient-warm">{lang === "fa" ? "برو" : "Go"}</Button></div></div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </main>
  );
};

export default Reader;
