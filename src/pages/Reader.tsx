import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Menu, Highlighter as HlIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { BlockRenderer, type Block } from "@/components/reader/BlockRenderer";
import { FloatingMenu } from "@/components/reader/FloatingMenu";
import { AiPanel } from "@/components/reader/AiPanel";
import { ChapterSidebar } from "@/components/reader/ChapterSidebar";
import { HighlightsPanel, type HighlightItem } from "@/components/reader/HighlightsPanel";

interface Page {
  title: string;
  ambient?: string;
  blocks?: Block[];
  content?: string;
}
interface Book {
  id: string; title: string; author: string;
  ambient_theme: string | null;
  pages: Page[];
}

const ambientSrc: Record<string, string> = {
  rain: "https://cdn.pixabay.com/audio/2022/03/15/audio_e1bf6db78f.mp3",
  forest: "https://cdn.pixabay.com/audio/2022/02/07/audio_5cab6f9395.mp3",
  cafe: "https://cdn.pixabay.com/audio/2022/03/09/audio_d8c80cd3e8.mp3",
  night: "https://cdn.pixabay.com/audio/2022/10/30/audio_347111d662.mp3",
};

type AiMode = "summary" | "quiz" | "mindmap" | "explain";

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
  const [highlightMode, setHighlightMode] = useState(false);

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [savePopover, setSavePopover] = useState<{ x: number; y: number; text: string } | null>(null);

  const [userBookId, setUserBookId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const Prev = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Next = dir === "rtl" ? ArrowLeft : ArrowRight;

  // Load book
  useEffect(() => {
    if (!id) return;
    supabase.from("books").select("*").eq("id", id).maybeSingle()
      .then(({ data }) => {
        if (!data) { nav("/library"); return; }
        const pages = Array.isArray(data.pages) ? data.pages : [];
        setBook({ ...data, pages: pages as unknown as Page[] });
        if (data.ambient_theme && data.ambient_theme !== "paper") setAmbient(data.ambient_theme);
      });
  }, [id, nav]);

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
      .select("id, text, page_index, color, created_at")
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

  useEffect(() => () => { speechSynthesis.cancel(); }, []);
  useEffect(() => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
    setSavePopover(null);
  }, [pageIdx]);

  const currentPage = book?.pages[pageIdx];
  const total = book?.pages.length ?? 0;

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

  const speak = () => {
    if (!pageText) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(pageText);
    u.lang = lang === "fa" ? "fa-IR" : "en-US";
    u.rate = voiceSpeed;
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    speechSynthesis.speak(u);
    setIsSpeaking(true);
  };
  const stopSpeak = () => { speechSynthesis.cancel(); setIsSpeaking(false); };

  // Selection-based highlighting
  useEffect(() => {
    const handler = () => {
      if (!highlightMode) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2) { setSavePopover(null); return; }
      if (!articleRef.current || !sel?.anchorNode) return;
      if (!articleRef.current.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSavePopover({
        x: rect.left + rect.width / 2,
        y: rect.top - 8 + window.scrollY,
        text,
      });
    };
    document.addEventListener("mouseup", handler);
    document.addEventListener("touchend", handler);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("touchend", handler);
    };
  }, [highlightMode]);

  const saveHighlight = async (color: string) => {
    if (!savePopover || !user || !id) return;
    const { data, error } = await supabase
      .from("highlights")
      .insert({
        user_id: user.id,
        book_id: id,
        page_index: pageIdx,
        text: savePopover.text,
        color,
      })
      .select("id, text, page_index, color, created_at")
      .single();
    if (error) { toast.error(error.message); return; }
    if (data) {
      setHighlights((prev) => [data as HighlightItem, ...prev]);
      toast.success(lang === "fa" ? "هایلایت ذخیره شد" : "Highlight saved");
    }
    setSavePopover(null);
    window.getSelection()?.removeAllRanges();
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
            {/* Mobile chapters trigger */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChaptersOpen(true)}
              className="md:hidden gap-1.5"
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

        {/* Two-column layout: sidebar + content */}
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          {/* Desktop sidebar */}
          <div className="hidden md:block sticky top-24 self-start max-h-[calc(100vh-8rem)]">
            <ChapterSidebar
              chapters={chapters}
              current={pageIdx}
              onSelect={(i) => goTo(i)}
            />
          </div>

          {/* Page */}
          <div className="relative" style={{ perspective: 2200 }}>
            <AnimatePresence mode="wait" custom={flipDir}>
              <motion.article
                ref={articleRef}
                key={pageIdx}
                custom={flipDir}
                initial={{ rotateY: flipDir * 60, opacity: 0, x: flipDir * 30 }}
                animate={{ rotateY: 0, opacity: 1, x: 0 }}
                exit={{ rotateY: flipDir * -60, opacity: 0, x: flipDir * -30 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformStyle: "preserve-3d", transformOrigin: dir === "rtl" ? "right center" : "left center" }}
                className="paper-card rounded-3xl p-6 md:p-12 min-h-[60vh] book-shadow relative overflow-hidden no-native-callout"
              >
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-gold opacity-50" />
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
                  backgroundImage: "radial-gradient(circle at 20% 30%, hsl(var(--primary)) 1px, transparent 1px), radial-gradient(circle at 70% 60%, hsl(var(--accent)) 1px, transparent 1px)",
                  backgroundSize: "60px 60px, 80px 80px",
                }} />

                <div className="relative">
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

                  <div className={`space-y-4 ${highlightMode ? "selection:bg-[hsl(var(--hl-yellow)/0.6)] cursor-text" : ""}`}>
                    {blocks.map((block, i) => (
                      <BlockRenderer
                        key={i}
                        block={block}
                        fontSize={fontSize}
                        index={i}
                        savedHighlights={pageHighlights.map((h) => ({ id: h.id, text: h.text, color: h.color || "yellow" }))}
                        onHighlightClick={() => setHighlightsOpen(true)}
                      />
                    ))}
                  </div>
                </div>
              </motion.article>
            </AnimatePresence>

            {/* Bottom navigation */}
            <div className="mt-8 flex items-center justify-between gap-3 pb-32">
              <Button variant="outline" onClick={goPrev} disabled={pageIdx === 0} className="gap-2 glass-strong">
                <Prev className="w-4 h-4" /> {t("prev")}
              </Button>
              <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-2">
                <HlIcon className="w-3 h-3" />
                <span>
                  {highlightMode
                    ? (lang === "fa" ? "متن را انتخاب کنید" : "Select text to save")
                    : (lang === "fa" ? "از منوی پایین استفاده کنید" : "Use the dock below")}
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
        onToggleHighlight={() => {
          setHighlightMode((v) => !v);
          toast.info(highlightMode
            ? (lang === "fa" ? "حالت هایلایت خاموش شد" : "Highlight off")
            : (lang === "fa" ? "متن دلخواه را انتخاب کنید" : "Select any text"));
        }}
        highlightMode={highlightMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenChapters={() => setChaptersOpen(true)}
        onOpenHighlights={() => setHighlightsOpen(true)}
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
        onClose={() => setAiOpen(false)}
      />

      {/* Highlights panel */}
      <HighlightsPanel
        open={highlightsOpen}
        highlights={highlights}
        onClose={() => setHighlightsOpen(false)}
        onJump={(i) => goTo(i)}
        onDelete={deleteHighlight}
      />

      {/* Mobile chapters drawer with blur backdrop */}
      <Sheet open={chaptersOpen} onOpenChange={setChaptersOpen}>
        <SheetContent
          side={dir === "rtl" ? "right" : "left"}
          className="p-0 w-[88vw] sm:w-[360px] glass-strong border-s border-border/40"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{lang === "fa" ? "فصل‌ها" : "Chapters"}</SheetTitle>
          </SheetHeader>
          <ChapterSidebar
            chapters={chapters}
            current={pageIdx}
            variant="drawer"
            onSelect={(i) => { goTo(i); setChaptersOpen(false); }}
            onClose={() => setChaptersOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Settings */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side={dir === "rtl" ? "left" : "right"} className="glass-strong">
          <SheetHeader><SheetTitle>{t("settings")}</SheetTitle></SheetHeader>
          <div className="space-y-8 mt-8">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{t("font_size")}</span>
                <span className="text-muted-foreground tabular-nums">{fontSize}px</span>
              </div>
              <Slider value={[fontSize]} onValueChange={(v) => setFontSize(v[0])} min={14} max={32} step={1} />
              <p className="text-foreground/80 leading-loose text-balance" style={{ fontSize: `${fontSize}px` }}>
                {lang === "fa" ? "نمونه‌ای از اندازه فونت انتخابی شما." : "Sample of your selected font size."}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{t("reading_speed")}</span>
                <span className="text-muted-foreground tabular-nums">{voiceSpeed.toFixed(1)}x</span>
              </div>
              <Slider value={[voiceSpeed * 10]} onValueChange={(v) => setVoiceSpeed(v[0] / 10)} min={5} max={20} step={1} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
};

export default Reader;
