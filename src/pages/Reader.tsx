import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, ChevronDown } from "lucide-react";
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

interface Page {
  title: string;
  ambient?: string;
  blocks?: Block[];
  content?: string; // legacy
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
  const [fontSize, setFontSize] = useState(19);
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

  const [userBookId, setUserBookId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Auto-switch ambient based on page
  useEffect(() => {
    if (!book) return;
    const p = book.pages[pageIdx];
    if (p?.ambient && ambient === "off") setAmbient(p.ambient);
  }, [pageIdx, book]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ambient audio
  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (ambient === "off") return;
    const src = ambientSrc[ambient];
    if (!src) return;
    const a = new Audio(src);
    a.loop = true; a.volume = 0.25;
    a.play().catch(() => {});
    audioRef.current = a;
    return () => { a.pause(); };
  }, [ambient]);

  // Stop speech on unmount/page change
  useEffect(() => {
    return () => { speechSynthesis.cancel(); };
  }, []);
  useEffect(() => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [pageIdx]);

  const currentPage = book?.pages[pageIdx];
  const total = book?.pages.length ?? 0;

  // Extract plain text from page for AI/voice
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

  return (
    <main className={`min-h-[calc(100vh-4rem)] relative transition-colors duration-700 ${dark ? "bg-background" : "bg-gradient-hero"}`}>
      {/* Ambient backdrop */}
      <div className={`fixed inset-0 pointer-events-none transition-opacity duration-1000 ${ambientClass}`} />

      {/* Floating ambient glow */}
      <motion.div
        className="fixed top-20 left-1/3 w-96 h-96 rounded-full bg-accent/10 blur-3xl pointer-events-none"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="container py-6 md:py-10 relative">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => nav("/library")} className="gap-1.5">
            <Prev className="w-4 h-4" /> {t("back")}
          </Button>
          <div className="text-sm text-muted-foreground hidden sm:block text-center">
            <span className="font-display font-semibold text-foreground">{book.title}</span>
            <span className="mx-2">·</span>
            <span>{book.author}</span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {pageIdx + 1} / {total}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-foreground/5 rounded-full overflow-hidden mb-8 max-w-3xl mx-auto">
          <motion.div
            className="h-full bg-gradient-warm"
            animate={{ width: `${((pageIdx + 1) / total) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Book pages */}
        <div className="relative max-w-3xl mx-auto" style={{ perspective: 2200 }}>
          <AnimatePresence mode="wait" custom={flipDir}>
            <motion.article
              key={pageIdx}
              custom={flipDir}
              initial={{ rotateY: flipDir * 75, opacity: 0, x: flipDir * 30 }}
              animate={{ rotateY: 0, opacity: 1, x: 0 }}
              exit={{ rotateY: flipDir * -75, opacity: 0, x: flipDir * -30 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformStyle: "preserve-3d", transformOrigin: dir === "rtl" ? "right center" : "left center" }}
              className="paper-card rounded-3xl p-6 md:p-12 min-h-[60vh] book-shadow relative overflow-hidden"
            >
              {/* Decorative top stripe */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-gold opacity-50" />
              {/* Subtle paper texture */}
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

                <div className={`space-y-4 ${highlightMode ? "selection:bg-accent/40" : ""}`}>
                  {blocks.map((block, i) => (
                    <BlockRenderer key={i} block={block} fontSize={fontSize} index={i} />
                  ))}
                </div>
              </div>
            </motion.article>
          </AnimatePresence>
        </div>

        {/* Bottom navigation */}
        <div className="max-w-3xl mx-auto mt-8 flex items-center justify-between gap-3 pb-24">
          <Button variant="outline" onClick={goPrev} disabled={pageIdx === 0} className="gap-2 glass-strong">
            <Prev className="w-4 h-4" /> {t("prev")}
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronDown className="w-3 h-3 animate-bounce" />
            <span className="hidden sm:inline">{lang === "fa" ? "ابزارها در کنار صفحه" : "Tools on the side"}</span>
          </div>
          <Button variant="outline" onClick={goNext} disabled={pageIdx >= total - 1} className="gap-2 glass-strong">
            {t("next")} <Next className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Floating menu (FAB + side toolbar) */}
      <FloatingMenu
        onAi={runAI}
        onSpeak={speak}
        onStopSpeak={stopSpeak}
        isSpeaking={isSpeaking}
        onToggleHighlight={() => {
          setHighlightMode((v) => !v);
          toast.info(highlightMode ? (lang === "fa" ? "هایلایت خاموش" : "Highlight off") : (lang === "fa" ? "هایلایت روشن - متن را انتخاب کنید" : "Highlight on - select text"));
        }}
        onToggleSettings={() => setSettingsOpen(true)}
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

      {/* Settings sheet */}
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
