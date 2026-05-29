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
import { isAutoPageTitle } from "@/lib/page-title";
import { HighlightsPanel, type HighlightItem } from "@/components/reader/HighlightsPanel";
import { resolveBookMedia } from "@/lib/book-media";
import { speakSmart, stopSpeak as stopSpeakSmart } from "@/lib/tts";
import { docToLegacyBlocks } from "@/lib/tiptap-doc";
import { BookComments } from "@/components/BookComments";
import { CopyProtection } from "@/components/reader/CopyProtection";
import { ReadingLockOverlay } from "@/components/reader/ReadingLockOverlay";
import { useReadingLock } from "@/hooks/useReadingLock";
import { CoverPage } from "@/components/reader/CoverPage";
import type { CoverCrop } from "@/components/reader/CoverImage";
import {
  loadOfflineBook,
  listOfflineHighlights,
  saveHighlightOfflineFirst,
  updateHighlightOfflineFirst,
  deleteHighlightOfflineFirst,
  persistProgressOfflineFirst,
} from "@/lib/offline/readerBridge";

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
  cover_url?: string | null;
  cover_focus?: { x?: number; y?: number } | null;
  back_cover_url?: string | null;
  back_cover_focus?: { x?: number; y?: number } | null;
  cover_spread_url?: string | null;
  cover_crop?: CoverCrop;
  publication_year?: number | null;
  content_version?: number | string | null;
  publisher_logo_url?: string | null;
}

// Built-in ambient tracks (hosted on our own origin → no CORS issues).
// Files live in /public/ambient/*.mp3 and ship with the app.
const ambientSrc: Record<string, string> = {
  rain: "/ambient/rain.mp3",
  forest: "/ambient/forest.mp3",
  cafe: "/ambient/cafe.mp3",
  night: "/ambient/night.mp3",
  ocean: "/ambient/ocean.mp3",
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
  /** Set when this card represents a print-page marker hit. */
  printPage?: string;
}

/** Convert Latin/Persian/Arabic-Indic digits to plain ASCII for matching. */
const normalizeDigits = (s: string): string =>
  s.replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));

const pageToBlocks = (page?: Page): Block[] => {
  if (!page) return [];
  if (page.doc?.type === "doc") return docToLegacyBlocks(page.doc) as Block[];
  return page.blocks ?? (page.content ? [{ type: "paragraph", text: page.content }] : []);
};

const Reader = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, dir, lang } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const { state: lockState, reclaim: reclaimLock } = useReadingLock(user?.id, id);

  const [book, setBook] = useState<Book | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  /** When non-null, show the cover page overlay instead of regular content. */
  const [coverView, setCoverView] = useState<"front" | "back" | null>("front");
  const coverDismissedRef = useRef(false);
  const [flipDir, setFlipDir] = useState<1 | -1>(1);
  const [fontSize, setFontSize] = useState(16);
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [dark, setDark] = useState(false);
  const [ambient, setAmbient] = useState<string>("off");
  /** User-uploaded ambient tracks: { id: storage-path, label: display-name, url }. */
  const [userAmbient, setUserAmbient] = useState<Array<{ id: string; label: string; url: string }>>([]);
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
  const [currentPrintPage, setCurrentPrintPage] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [timelineData, setTimelineData] = useState<{ title?: string; steps: Array<{ marker: string; title: string; description: string }> } | null>(null);

  const [userBookId, setUserBookId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  // Reading mode (persisted): scroll = traditional, paginated = liquid pages.
  const [readingMode, setReadingMode] = useState<"scroll" | "paginated">(() => {
    if (typeof window === "undefined") return "scroll";
    return (window.localStorage.getItem("farabook:reading-mode") as "scroll" | "paginated") || "scroll";
  });
  useEffect(() => {
    try { window.localStorage.setItem("farabook:reading-mode", readingMode); } catch { /* ignore */ }
  }, [readingMode]);

  // Fullscreen reading: uses the browser Fullscreen API so the whole device
  // is taken over (status bar, browser chrome, etc.). ESC exits as usual.
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      // Some browsers (e.g. iOS Safari) don't support requestFullscreen —
      // fall back to the CSS-only focus mode so the user still gets a clean view.
      setFullscreen((v) => !v);
      void e;
    }
  }, []);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Publisher logo (for chapter-menu watermark). Falls back to book.publisher_logo_url override.
  const [publisherLogoUrl, setPublisherLogoUrl] = useState<string | null>(null);

  // Paginated-mode state
  const [colIdx, setColIdx] = useState(0);
  const [colCount, setColCount] = useState(1);
  const [colWidthPx, setColWidthPx] = useState(0);
  const paginatedHostRef = useRef<HTMLDivElement | null>(null);
  const paginatedTrackRef = useRef<HTMLDivElement | null>(null);

  // Prev/Next icons follow the *book's* reading direction (assigned after
  // bookDir is computed below). An LTR book always pages left→right even
  // when the UI is in Persian, and vice-versa.

  // Load book — offline-first when a local encrypted copy exists, so the
  // reader opens instantly even with flaky/no internet. Then we refresh from
  // the server in the background to pick up new edits.
  useEffect(() => {
    if (!id) return;
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      // 1) Fast path: encrypted local copy → render immediately.
      let renderedOffline = false;
      if (user) {
        const off = await loadOfflineBook(id, user.id);
        if (off && !cancelled) {
          setBook({ ...(off as unknown as Book) });
          if (off.ambient_theme && off.ambient_theme !== "paper") setAmbient(off.ambient_theme);
          renderedOffline = true;
        }
      }

      // 2) Server fetch — fresh content + ownership checks. If offline already
      //    rendered, treat network failure silently.
      // `pages` is column-restricted; fetch metadata without it, then load
      // page content through the ownership-checked RPC.
      const { data, error } = await supabase
        .from("books")
        .select("id, title, author, cover_url, cover_focus, back_cover_url, back_cover_focus, cover_spread_url, cover_crop, description, price, publisher_id, status, review_status, typography_preset, ambient_theme, preview_pages, language, isbn, publication_year, edition, page_count, subtitle, book_type, original_title, original_language, series_name, series_index, categories, subjects, contributors, content_version, content_updated_at, comments_enabled, ai_summary, publisher_logo_url")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        if (renderedOffline) return; // offline copy is enough
        toast.error(lang === "fa" ? "کتاب یافت نشد" : "Book not found");
        nav("/store");
        void error;
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
      const { data: pagesData } = await (supabase.rpc as any)("get_book_content", { _book_id: id });
      const pages = Array.isArray(pagesData) ? pagesData : [];
      // Only replace the offline-rendered copy if we actually have newer pages
      // (server returned non-empty pages).
      if (!renderedOffline || pages.length > 0) {
        setBook({ ...(data as any), pages: pages as unknown as Page[] });
        if (data.ambient_theme && data.ambient_theme !== "paper") setAmbient(data.ambient_theme);
      }
    })();
    return () => { cancelled = true; };
  }, [id, nav, user, authLoading, lang]);

  // Load progress — also ensure a user_books row exists so progress for free
  // books is tracked too (otherwise Library always shows 0%).
  useEffect(() => {
    if (!user || !id) return;
    (async () => {
      const { data } = await supabase
        .from("user_books")
        .select("id, current_page")
        .eq("user_id", user.id).eq("book_id", id).maybeSingle();
      if (data) {
        setUserBookId(data.id);
        const savedIdx = data.current_page ?? 0;
        setPageIdx(savedIdx);
        // If the reader is resuming past page 0, skip the front cover.
        if (savedIdx > 0) {
          coverDismissedRef.current = true;
          setCoverView(null);
        }
        return;
      }
      // No row yet — create one so progress is tracked. Best-effort: ignore
      // failures (e.g. RLS on paid unowned books, which we wouldn't reach).
      const { data: created } = await supabase
        .from("user_books")
        .insert({ user_id: user.id, book_id: id, status: "reading", current_page: 0, progress: 0, acquired_via: "free" })
        .select("id, current_page")
        .maybeSingle();
      if (created) {
        setUserBookId(created.id);
        setPageIdx(created.current_page ?? 0);
      }
    })();
  }, [user, id]);

  // Load highlights (server first; merge local pending). Falls back to local-only when offline.
  const loadHighlights = useCallback(async () => {
    if (!user || !id) return;
    const local = await listOfflineHighlights(id);
    const localById = new Map(local.map((r) => [r.id, r]));
    const { data, error } = await supabase
      .from("highlights")
      .select("id, text, page_index, color, created_at, note, block_index, occurrence")
      .eq("user_id", user.id).eq("book_id", id)
      .order("created_at", { ascending: false });
    if (error || !data) {
      // Offline path — show whatever we have locally.
      setHighlights(local.map((r) => ({ id: r.id, text: r.text, page_index: r.page_index, color: r.color, created_at: r.created_at, note: r.note, block_index: (r as any).block_index ?? null, occurrence: (r as any).occurrence ?? null })) as HighlightItem[]);
      return;
    }
    const serverIds = new Set(data.map((d) => d.id as string));
    const localOnly = local.filter((r) => !serverIds.has(r.id))
      .map((r) => ({ id: r.id, text: r.text, page_index: r.page_index, color: r.color, created_at: r.created_at, note: r.note, block_index: (r as any).block_index ?? null, occurrence: (r as any).occurrence ?? null })) as HighlightItem[];
    setHighlights([...localOnly, ...(data as HighlightItem[])]);
    // touch unused var to satisfy linter
    void localById;
  }, [user, id]);
  useEffect(() => { loadHighlights(); }, [loadHighlights]);

  // Persist progress — local-first (offline safe), then server update if logged-purchased.
  useEffect(() => {
    if (!book) return;
    const total = book.pages.length || 1;
    const progress = ((pageIdx + 1) / total) * 100;
    if (user && id) {
      void persistProgressOfflineFirst(id, user.id, pageIdx, progress / 100);
    }
    if (userBookId) {
      const status = pageIdx >= total - 1 ? "finished" : "reading";
      supabase.from("user_books").update({ current_page: pageIdx, progress, status }).eq("id", userBookId).then();
    }
  }, [pageIdx, userBookId, book, user, id]);

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

  // Resolve the publisher's brand logo so the chapter menu can show it as
  // a faint background watermark. The per-book `publisher_logo_url` always
  // wins so authors can override the default.
  useEffect(() => {
    if (!book?.publisher_id) { setPublisherLogoUrl(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("publisher_profiles")
        .select("logo_url")
        .eq("user_id", book.publisher_id as string)
        .maybeSingle();
      if (!cancelled) setPublisherLogoUrl((data?.logo_url as string | undefined) ?? null);
    })();
    return () => { cancelled = true; };
  }, [book?.publisher_id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (ambient === "off") return;
    const src = ambientSrc[ambient] || userAmbient.find((t) => t.id === ambient)?.url;
    if (!src) return;
    const a = new Audio();
    // NOTE: do NOT set crossOrigin — the Pixabay CDN does not return
    // CORS headers and the audio element silently refuses to load when
    // crossOrigin is set. Plain playback (no Web Audio API) works fine.
    a.loop = true;
    a.volume = 0;
    a.preload = "auto";
    a.src = src;
    audioRef.current = a;

    let cancelled = false;
    let fadeTimer: number | null = null;
    const fadeIn = () => {
      const target = 0.28;
      const steps = 20;
      let n = 0;
      fadeTimer = window.setInterval(() => {
        n++;
        if (audioRef.current === a) a.volume = Math.min(target, (target * n) / steps);
        if (n >= steps && fadeTimer) { window.clearInterval(fadeTimer); fadeTimer = null; }
      }, 60);
    };

    const armResume = () => {
      const resume = () => {
        a.play().then(fadeIn).catch((err) => {
          console.warn("[ambient] resume play failed", err);
        });
      };
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
      window.addEventListener("touchstart", resume, { once: true });
    };

    a.addEventListener("error", () => {
      console.error("[ambient] audio error", a.error, "src=", src);
      if (!cancelled) {
        toast.error(lang === "fa" ? "پخش صدای محیطی ممکن نشد" : "Couldn't load ambient sound");
      }
    });

    a.play().then(fadeIn).catch((err) => {
      console.warn("[ambient] autoplay blocked, waiting for tap:", err);
      armResume();
      toast.info(lang === "fa" ? "برای پخش صدای محیطی روی صفحه بزنید" : "Tap the page to start ambient sound");
    });

    return () => {
      cancelled = true;
      if (fadeTimer) window.clearInterval(fadeTimer);
      a.pause();
      a.src = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient, userAmbient]);

  // Load the current user's personal ambient playlist from storage.
  useEffect(() => {
    if (!user?.id) { setUserAmbient([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.storage
        .from("user-ambient")
        .list(user.id, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      if (error || cancelled || !data) return;
      const items = data
        .filter((f) => f.name && !f.name.endsWith("/"))
        .map((f) => {
          const path = `${user.id}/${f.name}`;
          const { data: pub } = supabase.storage.from("user-ambient").getPublicUrl(path);
          return {
            id: `user:${path}`,
            label: f.name.replace(/\.[^.]+$/, ""),
            url: pub.publicUrl,
          };
        });
      if (!cancelled) setUserAmbient(items);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

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
    setCurrentPrintPage(null);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, [pageIdx]);

  // Track which print-page marker is closest to the top of the viewport.
  useEffect(() => {
    if (coverView) return;
    const root = articleRef.current;
    if (!root) return;
    const markers = Array.from(root.querySelectorAll<HTMLElement>("[data-print-page]"));
    if (!markers.length) return;
    const update = () => {
      let best: { num: string; top: number } | null = null;
      for (const m of markers) {
        const r = m.getBoundingClientRect();
        if (r.top <= 120) {
          if (!best || r.top > best.top) best = { num: m.dataset.printPage || "", top: r.top };
        }
      }
      setCurrentPrintPage(best?.num ?? null);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pageIdx, coverView, book]);


  const pageText = useMemo(() => {
    if (!currentPage) return "";
    const pageBlocks = pageToBlocks(currentPage);
    if (pageBlocks.length) {
      return pageBlocks
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

  // In paginated (liquid) mode, advance one column at a time and only flip
  // to the next page when the user reaches the last column. Uses transform
  // (not native scroll) so transitions stay smooth even with overflow:hidden.
  const scrollPaginated = (direction: 1 | -1): boolean => {
    if (readingMode !== "paginated") return false;
    if (direction === 1) {
      if (colIdx < colCount - 1) { setColIdx((v) => v + 1); return true; }
      return false;
    }
    if (colIdx > 0) { setColIdx((v) => v - 1); return true; }
    return false;
  };

  // Reset column index whenever we change page or leave paginated mode.
  useEffect(() => { setColIdx(0); }, [pageIdx, readingMode]);

  // Measure how many columns the current chapter laid out into.
  useEffect(() => {
    if (readingMode !== "paginated") { setColCount(1); return; }
    const host = paginatedHostRef.current;
    const track = paginatedTrackRef.current;
    if (!host || !track) return;
    const measure = () => {
      const cw = host.clientWidth;
      if (cw <= 0) return;
      const gap = 40; // 2.5rem column-gap
      setColWidthPx(cw);
      const total = track.scrollWidth;
      const n = Math.max(1, Math.round((total + gap) / (cw + gap)));
      setColCount(n);
      setColIdx((idx) => Math.min(idx, n - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(track);
    const t = window.setTimeout(measure, 250);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [readingMode, pageIdx, fontSize, fullscreen, book]);

  const goNext = () => {
    if (coverView === "front") { coverDismissedRef.current = true; setCoverView(null); setFlipDir(1); return; }
    if (coverView === "back") return;
    if (scrollPaginated(1)) return;
    if (pageIdx < total - 1) { setFlipDir(1); setPageIdx(pageIdx + 1); }
    else { setFlipDir(1); setCoverView("back"); }
  };
  const goPrev = () => {
    if (coverView === "front") return;
    if (coverView === "back") { setCoverView(null); setFlipDir(-1); return; }
    if (scrollPaginated(-1)) return;
    if (pageIdx > 0) { setFlipDir(-1); setPageIdx(pageIdx - 1); }
    else { setFlipDir(-1); setCoverView("front"); }
  };
  const goTo = (i: number) => {
    if (coverView !== null) setCoverView(null);
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
    try {
      const row = await saveHighlightOfflineFirst({
        bookId: id, userId: user.id, pageIndex: pageIdx,
        text: snippet || (lang === "fa" ? "یادداشت هوش مصنوعی" : "AI note"),
        color: "blue", note: text,
      });
      setHighlights((prev) => [{ id: row.id, text: row.text, page_index: row.page_index, color: row.color, created_at: row.created_at, note: row.note } as HighlightItem, ...prev]);
      toast.success(lang === "fa" ? "به نشان‌ها اضافه شد" : "Saved to notes");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
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

  // Compute the block_index + occurrence of the current selection so we
  // can save a highlight that targets the exact block + Nth match — this
  // prevents the same phrase from highlighting elsewhere on the page.
  const computeSelectionPosition = useCallback((): { blockIndex: number | null; occurrence: number | null } => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { blockIndex: null, occurrence: null };
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest?.("[id^='book-block-']") as HTMLElement | null;
      if (!el) return { blockIndex: null, occurrence: null };
      // id format: book-block-{pageIndex}-{blockIndex}
      const m = /book-block-\d+-(\d+)$/.exec(el.id);
      const blockIndex = m ? Number(m[1]) : null;
      const selText = sel.toString();
      if (!selText) return { blockIndex, occurrence: null };
      const blockText = el.textContent || "";
      // Walk from start of block, count how many matches of selText come
      // before the selection start.
      const startOffsetInBlock = (() => {
        const pre = range.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        return pre.toString().length;
      })();
      let occurrence = 1;
      let from = 0;
      while (true) {
        const idx = blockText.indexOf(selText, from);
        if (idx < 0 || idx >= startOffsetInBlock) break;
        occurrence += 1;
        from = idx + 1;
      }
      return { blockIndex, occurrence };
    } catch {
      return { blockIndex: null, occurrence: null };
    }
  }, []);

  const saveHighlight = async (color: string, note?: string) => {
    if (!savePopover || !user || !id) return;
    const pos = computeSelectionPosition();
    try {
      const row = await saveHighlightOfflineFirst({
        bookId: id, userId: user.id, pageIndex: pageIdx,
        text: savePopover.text, color, note: note ?? null,
        blockIndex: pos.blockIndex, occurrence: pos.occurrence,
      });
      setHighlights((prev) => [{
        id: row.id, text: row.text, page_index: row.page_index,
        color: row.color, created_at: row.created_at, note: row.note,
        block_index: row.block_index ?? null, occurrence: row.occurrence ?? null,
      } as HighlightItem, ...prev]);
      toast.success(lang === "fa" ? "هایلایت ذخیره شد" : "Highlight saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
    }
    setSavePopover(null);
    window.getSelection()?.removeAllRanges();
  };


  const updateHighlightNote = async (hid: string, note: string) => {
    const { getLocalHighlights } = await import("@/lib/offline/OfflineStore");
    const all = id ? await getLocalHighlights(id) : [];
    const existing = all.find((r) => r.id === hid);
    if (existing) {
      await updateHighlightOfflineFirst(existing, { note });
    } else if (user && id) {
      // Server-only row (pre-Phase 6) — fall back to direct update.
      const { error } = await supabase.from("highlights").update({ note }).eq("id", hid);
      if (error) { toast.error(error.message); return; }
    }
    setHighlights((prev) => prev.map((h) => (h.id === hid ? { ...h, note } : h)));
    toast.success(lang === "fa" ? "یادداشت ذخیره شد" : "Note saved");
  };

  const deleteHighlight = async (hid: string) => {
    const { getLocalHighlights } = await import("@/lib/offline/OfflineStore");
    const all = id ? await getLocalHighlights(id) : [];
    const existing = all.find((r) => r.id === hid);
    if (existing) {
      await deleteHighlightOfflineFirst(existing);
    } else {
      const { error } = await supabase.from("highlights").delete().eq("id", hid);
      if (error) { toast.error(error.message); return; }
    }
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

  const blocks: Block[] = pageToBlocks(currentPage);

  // Only real (titled) headings show in the chapter sidebar. Auto-titled
  // pages like "صفحه 12" stay folded under their preceding chapter and
  // keep that chapter highlighted while the reader flips through them.
  const chapters = book.pages
    .map((p, i) => ({ index: i, title: p.title, level: (p as any).level ?? 0 }))
    .filter((c) => !isAutoPageTitle(c.title));
  // Nearest preceding titled chapter is "current" for the sidebar highlight.
  const currentChapterIndex = (() => {
    let last = chapters[0]?.index ?? 0;
    for (const c of chapters) {
      if (c.index <= pageIdx) last = c.index; else break;
    }
    return last;
  })();
  // Detect book content direction independently of UI language
  const sampleText = (book.pages.slice(0, 3).map((p) => p.title + " " + (pageToBlocks(p).map((b) => "text" in b ? b.text : "").join(" ") || p.content || "")).join(" ")).slice(0, 2000);
  const rtlChars = (sampleText.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const ltrChars = (sampleText.match(/[A-Za-z]/g) || []).length;
  const bookDir: "rtl" | "ltr" = rtlChars >= ltrChars ? "rtl" : "ltr";
  const Prev = bookDir === "rtl" ? ArrowRight : ArrowLeft;
  const Next = bookDir === "rtl" ? ArrowLeft : ArrowRight;
  // Chapter & search drawers always slide from the RIGHT edge of the screen
  const allOverlaysOpen = chaptersOpen || searchOpen || settingsOpen || highlightsOpen || aiOpen || chatOpen;
  const goToPageNumber = () => {
    const next = Math.min(total, Math.max(1, Number(jumpValue) || 1)) - 1;
    goTo(next);
  };
  const searchResults: SearchResult[] = (() => {
    if (!book) return [];
    const rawTerm = searchTerm.trim();
    const term = rawTerm.toLowerCase();
    if (!term) return [];
    const normTerm = normalizeDigits(rawTerm);
    const isNumericQuery = /^\d+$/.test(normTerm);

    // 1) Print-page hits — match the digits typed against `print_page` markers.
    const printPageHits: SearchResult[] = [];
    if (normTerm.length > 0) {
      book.pages.forEach((page, pIndex) => {
        const blocks = pageToBlocks(page);
        blocks.forEach((block, bIndex) => {
          if (block.type !== "print_page") return;
          const num = normalizeDigits(String((block as any).number ?? "").trim());
          if (!num) return;
          const match = isNumericQuery ? num === normTerm : num.includes(normTerm);
          if (!match) return;
          // Build a short excerpt from the next text block on the same page.
          const next = blocks.slice(bIndex + 1).find((bb) =>
            bb.type === "paragraph" || bb.type === "heading" || bb.type === "quote" || bb.type === "callout"
          ) as any;
          const excerpt = next?.text ? String(next.text).slice(0, 140) : (page.title || "");
          printPageHits.push({
            pageIndex: pIndex,
            blockIndex: bIndex,
            title: `${lang === "fa" ? "صفحه چاپی" : "Print page"} ${num}`,
            excerpt,
            printPage: num,
            mediaKey: `print-page-${num}`,
          });
        });
      });
    }

    // 2) Regular text / chapter / media hits.
    const textHits = book.pages.flatMap((page, pIndex) => {
      const pageBlocks = pageToBlocks(page);
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
    });

    return [...printPageHits, ...textHits].slice(0, 60);
  })();
  const openSearchResult = (result: SearchResult) => {
    goTo(result.pageIndex);
    setSearchOpen(false);
    if (result.printPage) {
      window.setTimeout(() => {
        document.getElementById(`print-page-${result.printPage}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 500);
      return;
    }
    if (result.mediaKey) {
      window.setTimeout(() => {
        document.getElementById(result.mediaKey || "")?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.dispatchEvent(new CustomEvent("open-book-media", { detail: { key: result.mediaKey } }));
      }, 700);
    }
  };


  const watermarkLabel = (user?.email || user?.id || (lang === "fa" ? "کاربر مهمان" : "Guest user")) + " · " + (book?.title || "");

  return (
    <main className={`min-h-[calc(100vh-4rem)] relative transition-colors duration-700 ${dark ? "bg-background" : "bg-gradient-hero"}`}>
      <CopyProtection watermark={watermarkLabel} />
      <ReadingLockOverlay state={lockState} onReclaim={reclaimLock} />
      <div className={`fixed inset-0 pointer-events-none transition-opacity duration-1000 ${ambientClass}`} />

      <motion.div
        className="fixed top-20 left-1/3 w-96 h-96 rounded-full bg-accent/10 blur-3xl pointer-events-none"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className={`container relative ${fullscreen ? "py-2 md:py-3 max-w-none px-2 md:px-6" : "py-6 md:py-10"}`}>
        {/* Top bar — hidden in fullscreen reading mode */}
        {!fullscreen && (
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
              {currentPrintPage ? (
                <span title={lang === "fa" ? "صفحه چاپی" : "Print page"}>
                  <span className="opacity-60">{lang === "fa" ? "ص." : "p."}</span> {currentPrintPage}
                  <span className="opacity-40 mx-1.5">·</span>
                </span>
              ) : null}
              {pageIdx + 1} / {total}
            </div>
          </div>
        )}


        {/* Progress — hidden in fullscreen */}
        {!fullscreen && (
          <div className="h-1 bg-foreground/5 rounded-full overflow-hidden mb-8 max-w-5xl mx-auto">
            <motion.div
              className="h-full bg-gradient-warm"
              animate={{ width: `${((pageIdx + 1) / total) * 100}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        )}

        {/* Single-column layout — chapter sidebar is now always opened via drawer */}
        <div className={`${fullscreen ? "max-w-5xl" : "max-w-4xl"} mx-auto transition-all duration-300 ${allOverlaysOpen ? "blur-[2px] opacity-55" : ""}`}>


          {/* Page */}
          <div className="relative">
            <AnimatePresence mode="wait">
              {coverView ? (
                <motion.div
                  key={`cover-${coverView}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="min-h-[60vh] flex items-center justify-center py-6"
                >
                  <CoverPage
                    side={coverView}
                    title={book.title}
                    author={book.author}
                    coverUrl={book.cover_url}
                    backCoverUrl={book.back_cover_url}
                    spreadUrl={book.cover_spread_url}
                    crop={book.cover_crop}
                    focus={book.cover_focus}
                    backFocus={book.back_cover_focus}
                  />
                </motion.div>
              ) : (
              <motion.article
                ref={articleRef}
                key={pageIdx}
                dir={bookDir}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`paper-card rounded-3xl ${fullscreen ? "p-4 md:p-10" : "p-6 md:p-12"} ${readingMode === "scroll" ? "min-h-[60vh]" : ""} book-shadow relative overflow-hidden no-native-callout typo-${book.typography_preset || "editorial"}`}
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

                  {pageIdx === 0 && (
                    <div className="mb-6 p-4 rounded-2xl border border-accent/30 bg-accent/5 text-xs leading-relaxed text-muted-foreground">
                      {lang === "fa" ? (
                        <>
                          <strong className="text-foreground">© کپی‌رایت محفوظ.</strong>{" "}
                          این نسخه برای{" "}
                          <span className="text-accent font-semibold">{user?.email || (lang === "fa" ? "کاربر مهمان" : "Guest user")}</span>{" "}
                          صادر شده است. کپی، اسکرین‌شات، چاپ یا توزیع غیرمجاز این محتوا پیگرد قانونی دارد.
                        </>
                      ) : (
                        <>
                          <strong className="text-foreground">© All rights reserved.</strong>{" "}
                          This copy is licensed to{" "}
                          <span className="text-accent font-semibold">{user?.email || "Guest user"}</span>.{" "}
                          Unauthorized copying, screenshots, printing or redistribution is prohibited.
                        </>
                      )}
                    </div>
                  )}

                  <div
                    ref={paginatedHostRef}
                    className={`selectable selection:bg-[hsl(var(--hl-yellow)/0.6)] cursor-text ${
                      readingMode === "paginated"
                        ? "relative overflow-hidden"
                        : "space-y-4"
                    }`}
                    style={readingMode === "paginated"
                      ? ({ height: fullscreen ? "82vh" : "70vh" } as React.CSSProperties)
                      : undefined}
                  >
                    <div
                      ref={paginatedTrackRef}
                      className={readingMode === "paginated" ? "reader-paginated" : ""}
                      style={readingMode === "paginated"
                        ? ({
                            columnWidth: colWidthPx > 0 ? `${colWidthPx}px` : "100%",
                            columnGap: "2.5rem",
                            columnFill: "auto",
                            height: "100%",
                            transform: `translateX(calc(${(bookDir === "rtl" ? colIdx : -colIdx)} * (100% + 2.5rem)))`,
                            transition: "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
                            willChange: "transform",
                          } as React.CSSProperties)
                        : undefined}
                    >
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
                </div>
              </motion.article>
              )}
            </AnimatePresence>

            {/* Floating side arrows — positioned by the book's reading direction
                so an LTR book always has Prev on the left and Next on the right,
                regardless of UI language. */}
            <button
              onClick={goPrev}
              disabled={pageIdx === 0}
              aria-label={t("prev")}
              className={`fixed top-1/2 ${bookDir === "rtl" ? "right-2 sm:right-4" : "left-2 sm:left-4"} -translate-y-1/2 z-30 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-accent text-accent-foreground shadow-book border-2 border-background/70 flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed hover:scale-110 active:scale-95 transition-transform`}
            >
              <Prev className="w-6 h-6" />
            </button>
            <button
              onClick={goNext}
              disabled={pageIdx >= total - 1}
              aria-label={t("next")}
              className={`fixed top-1/2 ${bookDir === "rtl" ? "left-2 sm:left-4" : "right-2 sm:right-4"} -translate-y-1/2 z-30 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-accent text-accent-foreground shadow-book border-2 border-background/70 flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed hover:scale-110 active:scale-95 transition-transform`}
            >
              <Next className="w-6 h-6" />
            </button>


            {/* Word page number footer */}
            {!fullscreen && (
              <div className="mt-10 flex items-center justify-center gap-3 text-[11px] text-muted-foreground tabular-nums select-none">
                <span className="h-px w-12 bg-border" />
                <span>
                  {lang === "fa" ? "صفحه" : "Page"} {pageIdx + 1} / {total}
                  {currentPrintPage ? (
                    <span className="opacity-60 mx-2">· {lang === "fa" ? "چاپی" : "print"} {currentPrintPage}</span>
                  ) : null}
                </span>
                <span className="h-px w-12 bg-border" />
              </div>
            )}

            {/* Bottom navigation — hidden in fullscreen mode */}
            {!fullscreen && (
              <div dir={bookDir} className="mt-4 flex items-stretch justify-between gap-3 pb-32">
                <div className="flex flex-col items-start gap-1 min-w-0">
                  <Button variant="outline" onClick={goPrev} disabled={pageIdx === 0} className="gap-2 glass-strong">
                    <Prev className="w-4 h-4" /> {t("prev")}
                  </Button>
                  <span className="text-[10px] text-muted-foreground tabular-nums ps-1 leading-none">
                    {pageIdx === 0 ? "—" : `${lang === "fa" ? "ص." : "p."} ${pageIdx}`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-2 self-center">
                  <HlIcon className="w-3 h-3" />
                  <span>
                    {lang === "fa" ? "متن را انتخاب کنید تا رنگ هایلایت ظاهر شود" : "Select text to highlight"}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 min-w-0">
                  <Button variant="outline" onClick={goNext} disabled={pageIdx >= total - 1} className="gap-2 glass-strong">
                    {t("next")} <Next className="w-4 h-4" />
                  </Button>
                  <span className="text-[10px] text-muted-foreground tabular-nums pe-1 leading-none">
                    {pageIdx >= total - 1 ? "—" : `${lang === "fa" ? "ص." : "p."} ${pageIdx + 2}`}
                  </span>
                </div>
              </div>
            )}
            {!fullscreen && id && pageIdx >= total - 1 && (
              <section className="pb-32">
                <div className="paper-card rounded-2xl p-4 md:p-6">
                  <BookComments bookId={id} />
                </div>
              </section>
            )}
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
        userAmbient={userAmbient}
        readingMode={readingMode}
        onToggleReadingMode={() => setReadingMode((m) => (m === "scroll" ? "paginated" : "scroll"))}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
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
        onJump={(i, hl) => {
          goTo(i);
          // After the page renders, try to find the exact <mark> and flash it.
          window.setTimeout(() => {
            const id = hl?.id;
            let el: HTMLElement | null = null;
            if (id) el = document.querySelector(`mark[data-hl-id="${id}"]`) as HTMLElement | null;
            if (!el && typeof hl?.block_index === "number") {
              const block = document.getElementById(`book-block-${i}-${hl.block_index}`);
              el = block?.querySelector("mark") as HTMLElement | null;
            }
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-accent", "ring-offset-2", "transition");
              window.setTimeout(() => el?.classList.remove("ring-2", "ring-accent", "ring-offset-2"), 1800);
            }
          }, 400);
        }}
        onDelete={deleteHighlight}
        onUpdateNote={updateHighlightNote}
      />

      <AnimatePresence>
        {chaptersOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChaptersOpen(false)} className="fixed inset-0 backdrop-blur-md z-40" />
            <motion.aside initial={{ x: 440, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 440, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-[440px] glass-strong shadow-book border-l border-glass-border flex flex-col">
              <ChapterSidebar
                chapters={chapters}
                current={currentChapterIndex}
                variant="drawer"
                onSelect={(i) => { goTo(i); setChaptersOpen(false); }}
                onClose={() => setChaptersOpen(false)}
                bookTitle={book.title}
                onTitleClick={() => {
                  setPageIdx(0);
                  setCoverView("front");
                  coverDismissedRef.current = false;
                  setChaptersOpen(false);
                }}
                logoUrl={book.publisher_logo_url || publisherLogoUrl}
                publicationYear={book.publication_year ?? null}
                bookVersion={book.content_version ?? null}
              />
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
              <div className="p-4 border-b border-border/30"><Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={lang === "fa" ? "جستجو در متن، فصل، مدیا یا شمارهٔ صفحهٔ چاپی…" : "Search text, chapters, media, or print page #…"} className="glass h-11" /></div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                {searchResults.map((result) => result.printPage ? (
                  <button key={`pp-${result.pageIndex}-${result.blockIndex}`} onClick={() => openSearchResult(result)} className="w-full text-start p-3 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 to-transparent hover:border-accent hover:shadow-glow transition-all flex gap-3 items-center">
                    <div className="w-16 h-16 rounded-xl bg-gradient-warm flex flex-col items-center justify-center text-primary-foreground shrink-0 shadow-glow">
                      <span className="text-[9px] font-medium leading-none opacity-90">{lang === "fa" ? "چاپی" : "Print"}</span>
                      <span className="text-xl font-bold tabular-nums leading-tight mt-0.5">{result.printPage}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-accent mb-1">{lang === "fa" ? "صفحهٔ کتاب" : "Book page"} {result.pageIndex + 1}</p>
                      <h4 className="font-semibold text-sm line-clamp-1">{result.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-1">{result.excerpt}</p>
                    </div>
                  </button>
                ) : (
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
