import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Sparkles, Volume2, VolumeX, Settings2,
  Sun, Moon, CloudRain, Trees, Coffee, Stars, Loader2, Highlighter, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

interface Page { title: string; content: string; }
interface Book {
  id: string; title: string; author: string;
  ambient_theme: string | null;
  pages: Page[];
}

const ambientOptions = [
  { id: "off", icon: VolumeX, label: "off" },
  { id: "rain", icon: CloudRain, label: "rain" },
  { id: "forest", icon: Trees, label: "forest" },
  { id: "cafe", icon: Coffee, label: "cafe" },
  { id: "night", icon: Stars, label: "night" },
] as const;

const Reader = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, dir, lang } = useI18n();
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [flipDir, setFlipDir] = useState<1 | -1>(1);
  const [fontSize, setFontSize] = useState(20);
  const [dark, setDark] = useState(false);
  const [ambient, setAmbient] = useState<string>("off");
  const [aiOutput, setAiOutput] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showAi, setShowAi] = useState(false);
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
    const status = pageIdx >= total - 1 ? "finished" : pageIdx > 0 ? "reading" : "reading";
    supabase.from("user_books").update({ current_page: pageIdx, progress, status }).eq("id", userBookId).then();
  }, [pageIdx, userBookId, book]);

  // Dark mode toggle (scoped to root for visual chrome)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);

  // Ambient audio (using free CDN samples - falls back silently if blocked)
  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (ambient === "off") return;
    const sources: Record<string, string> = {
      rain: "https://cdn.pixabay.com/audio/2022/03/15/audio_e1bf6db78f.mp3",
      forest: "https://cdn.pixabay.com/audio/2022/02/07/audio_5cab6f9395.mp3",
      cafe: "https://cdn.pixabay.com/audio/2022/03/09/audio_d8c80cd3e8.mp3",
      night: "https://cdn.pixabay.com/audio/2022/10/30/audio_347111d662.mp3",
    };
    const src = sources[ambient];
    if (!src) return;
    const a = new Audio(src);
    a.loop = true; a.volume = 0.3;
    a.play().catch(() => {});
    audioRef.current = a;
    return () => { a.pause(); };
  }, [ambient]);

  const currentPage = book?.pages[pageIdx];
  const total = book?.pages.length ?? 0;

  const goNext = () => { if (pageIdx < total - 1) { setFlipDir(1); setPageIdx(pageIdx + 1); setShowAi(false); setAiOutput(""); } };
  const goPrev = () => { if (pageIdx > 0) { setFlipDir(-1); setPageIdx(pageIdx - 1); setShowAi(false); setAiOutput(""); } };

  const runAI = async (mode: "summary" | "quiz") => {
    if (!currentPage) return;
    setAiLoading(true); setShowAi(true); setAiOutput("");
    try {
      const { data, error } = await supabase.functions.invoke("book-ai", {
        body: { text: currentPage.content, mode, lang },
      });
      if (error) throw error;
      setAiOutput(data?.content ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI error");
      setShowAi(false);
    } finally { setAiLoading(false); }
  };

  const speak = () => {
    if (!currentPage) return;
    const u = new SpeechSynthesisUtterance(currentPage.content);
    u.lang = lang === "fa" ? "fa-IR" : "en-US";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  const ambientClass = useMemo(() => {
    if (ambient === "off") return "";
    return `ambient-${ambient}`;
  }, [ambient]);

  if (!book || !currentPage) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className={`min-h-[calc(100vh-4rem)] relative transition-colors ${dark ? "bg-background" : "bg-gradient-hero"}`}>
      {/* Ambient backdrop */}
      <div className={`fixed inset-0 pointer-events-none transition-opacity duration-1000 ${ambientClass}`} />

      <div className="container py-6 md:py-10 relative">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => nav("/library")} className="gap-1.5">
            <Prev className="w-4 h-4" /> {t("back")}
          </Button>
          <div className="text-sm text-muted-foreground hidden sm:block">
            <span className="font-display font-semibold text-foreground">{book.title}</span>
            <span className="mx-2">·</span>
            <span>{book.author}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon"><Settings2 className="w-4 h-4" /></Button>
              </SheetTrigger>
              <SheetContent side={dir === "rtl" ? "left" : "right"} className="glass-strong">
                <SheetHeader><SheetTitle>{t("ambient")}</SheetTitle></SheetHeader>
                <div className="space-y-6 mt-6">
                  <div className="grid grid-cols-3 gap-2">
                    {ambientOptions.map(({ id, icon: Icon, label }) => (
                      <button key={id} onClick={() => setAmbient(id)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-all ${
                          ambient === id ? "bg-gradient-warm text-primary-foreground shadow-glow" : "bg-secondary/50 hover:bg-secondary"
                        }`}>
                        <Icon className="w-5 h-5" />
                        <span className="text-xs">{label === "off" ? t("none") : label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{t("font_size")}</span>
                      <span className="text-muted-foreground">{fontSize}px</span>
                    </div>
                    <Slider value={[fontSize]} onValueChange={(v) => setFontSize(v[0])} min={14} max={32} step={1} />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-secondary/40 rounded-full overflow-hidden mb-6">
          <motion.div
            className="h-full bg-gradient-warm"
            animate={{ width: `${((pageIdx + 1) / total) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Book pages */}
        <div className="relative max-w-3xl mx-auto" style={{ perspective: 1800 }}>
          <AnimatePresence mode="wait" custom={flipDir}>
            <motion.article
              key={pageIdx}
              custom={flipDir}
              initial={{ rotateY: flipDir * 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: flipDir * -90, opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformStyle: "preserve-3d", transformOrigin: dir === "rtl" ? "right" : "left" }}
              className="paper-card rounded-2xl p-8 md:p-14 min-h-[60vh] book-shadow relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-gold opacity-40" />
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                {t("page")} {pageIdx + 1} / {total}
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-6 gold-text">{currentPage.title}</h2>
              <p
                className="leading-loose text-foreground/90 whitespace-pre-line text-balance"
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.9 }}
              >
                {currentPage.content}
              </p>
            </motion.article>
          </AnimatePresence>
        </div>

        {/* AI Floating Output */}
        <AnimatePresence>
          {showAi && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="max-w-3xl mx-auto mt-6 glass-strong rounded-2xl p-6 relative"
            >
              <button onClick={() => setShowAi(false)} className="absolute top-3 end-3 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-accent-foreground">
                <Sparkles className="w-4 h-4 text-accent" />
                {t("ai_summary")}
              </div>
              {aiLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("ai_loading")}
                </div>
              ) : (
                <p className="text-foreground/90 leading-relaxed whitespace-pre-line">{aiOutput}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom controls */}
        <div className="max-w-3xl mx-auto mt-8 flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={goPrev} disabled={pageIdx === 0} className="gap-2 glass">
            <Prev className="w-4 h-4" /> {t("prev")}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => runAI("summary")} className="gap-1.5">
              <Sparkles className="w-4 h-4 text-accent" /> {t("ai_summary")}
            </Button>
            <Button variant="ghost" size="sm" onClick={speak} className="gap-1.5">
              <Volume2 className="w-4 h-4" />
            </Button>
          </div>

          <Button variant="outline" onClick={goNext} disabled={pageIdx >= total - 1} className="gap-2 glass">
            {t("next")} <Next className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </main>
  );
};

export default Reader;
