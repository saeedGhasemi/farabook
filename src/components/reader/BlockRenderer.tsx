import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Sparkles, Quote as QuoteIcon, ChevronLeft, ChevronRight, Play, Pause, Plus, X, Lightbulb, AlertTriangle, CheckCircle2, ShieldAlert, Pencil, HelpCircle, BookMarked } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveBookMedia } from "@/lib/book-media";
import { normalizeImportedText } from "@/lib/tiptap-doc";
import { SmartImage } from "@/components/SmartImage";
import { Timeline, type TimelineStep } from "./Timeline";
import { Scrollytelling, type ScrollyStep } from "./Scrollytelling";

const resolveImg = (src: string) => resolveBookMedia(src);

/** Convert a YouTube/Vimeo URL to an embeddable iframe URL. Returns null for direct files. */
const toVideoEmbed = (url: string): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      // youtube.com/embed/<id> already
      if (u.pathname.startsWith("/embed/")) return url;
    }
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL — treat as direct file path */
  }
  return null;
};

export interface Hotspot {
  x: number; // 0-100 percent
  y: number; // 0-100 percent
  label: string;
  description: string;
}

export type Block =
  | { type: "heading"; text: string; textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }
  | { type: "paragraph"; text: string; textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }
  | { type: "quote"; text: string; author?: string; textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }
  | { type: "highlight"; text: string }
  | { type: "image"; src: string; caption?: string; figureNumber?: string; hotspots?: Hotspot[]; hideCaption?: boolean }
  | { type: "image_placeholder"; pendingSrc?: string; bytes?: number; contentType?: string; reason?: string; caption?: string; figureNumber?: string }
  | { type: "gallery"; images: string[]; caption?: string }
  | { type: "slideshow"; images: { src: string; caption?: string }[]; autoplay?: boolean; interval?: number; hideCaption?: boolean }
  | { type: "video"; src: string; poster?: string; caption?: string }
  | { type: "callout"; icon?: "info" | "sparkle" | "tip" | "warning" | "success" | "danger" | "note" | "question" | "quote" | "definition" | "example"; text: string; textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }
  | { type: "table"; caption?: string; tableNumber?: string; headers: string[]; rows: string[][] }
  | { type: "references"; items: { id?: string; text: string; url?: string }[] }
  | { type: "timeline"; title?: string; steps: TimelineStep[] }
  | { type: "scrollytelling"; title?: string; steps: ScrollyStep[] }
  | { type: "list"; ordered?: boolean; items: string[]; itemAttrs?: Array<{ textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }>; textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" };

interface SavedHL { id?: string; text: string; color: string }

interface Props {
  block: Block;
  fontSize: number;
  index: number;
  pageIndex?: number;
  savedHighlights?: SavedHL[];
  onHighlightClick?: (hl: SavedHL) => void;
}

/* Render light inline markdown: **bold**, *italic*, __underline__,
   [text](url), [c=COLOR]text[/c] color spans, plus bare URLs.        */
const safeInlineColor = (value: string) => value.replace(/[;{}<>]/g, "").trim();

const renderInlineMarkdown = (text: string, baseKey = ""): React.ReactNode => {
  text = normalizeImportedText(text);
  // Order matters — color spans first (they may wrap other inline marks),
  // then bold (**), italic (*), underline, links, urls.
  const re =
    /(\[c=[^\]\n]+\][\s\S]*?\[\/c\]|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;
  const parts = text.split(re);
  return parts.map((p, i) => {
    const key = `${baseKey}-${i}`;
    if (!p) return null;
    // Color span
    const colorM = /^\[c=([^\]\n]+)\]([\s\S]*?)\[\/c\]$/.exec(p);
    if (colorM) {
      return (
        <span key={key} style={{ color: safeInlineColor(colorM[1]) }}>
          {renderInlineMarkdown(colorM[2], `${key}-c`)}
        </span>
      );
    }
    // Bold
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={key}>{p.slice(2, -2)}</strong>;
    }
    // Underline
    if (p.startsWith("__") && p.endsWith("__") && p.length > 4) {
      return <u key={key}>{p.slice(2, -2)}</u>;
    }
    // Italic (single *)
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2 && !p.startsWith("**")) {
      return <em key={key}>{p.slice(1, -1)}</em>;
    }
    // Markdown link [text](url)
    const linkM = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (linkM) {
      return (
        <a
          key={key}
          href={linkM[2]}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          {renderInlineMarkdown(linkM[1], `${key}-a`)}
        </a>
      );
    }
    // Bare URL → compact ref pill (preserves old citation cleanup behavior)
    if (/^https?:\/\//.test(p)) {
      const isDummy = p.includes("dummy-citation");
      return (
        <a
          key={key}
          href={isDummy ? undefined : p}
          target="_blank"
          rel="noreferrer"
          className="ref-cite"
          onClick={isDummy ? (e) => e.preventDefault() : undefined}
        >
          ↗
        </a>
      );
    }
    return <span key={key}>{p}</span>;
  });
};

/* Strip inline citation blobs and apply inline markdown formatting. */
const cleanInlineRefs = (text: string): React.ReactNode => renderInlineMarkdown(text);

/* Render text with inline colored highlight spans — clickable & vivid */
const renderWithHighlights = (
  text: string,
  hls?: SavedHL[],
  onClick?: (hl: SavedHL) => void,
): React.ReactNode => {
  if (!hls || hls.length === 0) return cleanInlineRefs(text);
  const sorted = [...hls].sort((a, b) => b.text.length - a.text.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${sorted.map((h) => escape(h.text)).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((p, i) => {
    const match = sorted.find((h) => h.text === p);
    if (!match) return <span key={i}>{cleanInlineRefs(p)}</span>;
    const color = match.color || "yellow";
    return (
      <mark
        key={i}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick ? () => onClick(match) : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(match); } : undefined}
        className={`hl-${color} text-foreground`}
        title={onClick ? "مشاهده در نشان‌ها" : undefined}
      >
        {p}
      </mark>
    );
  });
};

/* ---------- Sub-components ---------- */

const InteractiveImage = ({
  src, caption, hotspots, mediaKey, figureNumber,
}: { src: string; caption?: string; hotspots?: Hotspot[]; mediaKey?: string; figureNumber?: string }) => {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!mediaKey) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === mediaKey) setZoomed(true);
    };
    window.addEventListener("open-book-media", open as EventListener);
    return () => window.removeEventListener("open-book-media", open as EventListener);
  }, [mediaKey]);
  const figureRef = useRef<HTMLElement | null>(null);
  // When opened externally (search result), scroll to the figure
  useEffect(() => {
    if (zoomed && figureRef.current) {
      figureRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [zoomed]);

  return (
    <figure ref={figureRef} className="my-6 group">
      <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5">
        <button
          type="button"
          onClick={() => setZoomed((v) => !v)}
          className={`block w-full ${zoomed ? "cursor-zoom-out" : "cursor-zoom-in"}`}
          aria-label={zoomed ? "close" : caption || "zoom"}
        >
          <motion.img
            layout
            src={resolveImg(src)}
            alt={caption || ""}
            loading="lazy"
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className={`w-full h-auto transition-transform duration-300 ${
              zoomed
                ? "object-contain max-h-[80vh] mx-auto"
                : "group-hover:scale-[1.02]"
            }`}
          />
        </button>

        {!zoomed && (
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/40 via-transparent to-transparent pointer-events-none" />
        )}

        {zoomed && (
          <button
            onClick={() => setZoomed(false)}
            className="absolute top-3 end-3 w-9 h-9 rounded-full glass-strong flex items-center justify-center shadow-soft"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {hotspots?.map((h, i) => (
          <Popover key={i}>
            <PopoverTrigger asChild>
              <button
                className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 group/dot"
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                aria-label={h.label}
              >
                <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping" />
                <span className="absolute inset-1 rounded-full bg-gradient-warm shadow-glow flex items-center justify-center text-primary-foreground">
                  <Plus className="w-4 h-4" />
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="glass-strong border-accent/30 w-72 p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-display font-bold text-sm mb-1">{h.label}</h4>
                  <p className="text-sm text-foreground/80 leading-relaxed">{h.description}</p>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ))}

        {hotspots && hotspots.length > 0 && !zoomed && (
          <div className="absolute bottom-3 start-3 glass rounded-full px-3 py-1 text-xs flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" />
            <span>{hotspots.length} نکتهٔ تعاملی</span>
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="book-figcaption">
          {figureNumber && <span className="figcap-label">{figureNumber}</span>}
          {caption}
        </figcaption>
      )}
    </figure>
  );
};

/* Image with hover/tap-revealed caption — for hideCaption=true */
const HiddenCaptionImage = ({
  src, caption, figureNumber,
}: { src: string; caption?: string; figureNumber?: string }) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <figure className="my-6 group">
      <div
        className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5"
        onMouseEnter={() => setRevealed(true)}
        onMouseLeave={() => setRevealed(false)}
        onClick={() => setRevealed((v) => !v)}
      >
        <SmartImage src={src} alt={caption || ""} allowOriginal className="w-full h-auto" />
        {caption && (
          <AnimatePresence>
            {revealed && (
              <motion.figcaption
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/85 via-black/55 to-transparent text-background"
              >
                {figureNumber && <span className="figcap-label me-2">{figureNumber}</span>}
                <span className="text-sm md:text-base leading-snug">{caption}</span>
              </motion.figcaption>
            )}
          </AnimatePresence>
        )}
        {caption && !revealed && (
          <div className="absolute bottom-3 end-3 glass rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-foreground/80 pointer-events-none">
            {/* small hint */}
            ⓘ
          </div>
        )}
      </div>
    </figure>
  );
};

const Slideshow = ({
  images, autoplay = true, interval = 4500,
}: { images: { src: string; caption?: string }[]; autoplay?: boolean; interval?: number }) => {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [lightbox, setLightbox] = useState(false);
  const timer = useRef<number | null>(null);
  const total = images.length;

  useEffect(() => {
    if (!playing || total < 2 || lightbox) return;
    timer.current = window.setTimeout(() => setI((p) => (p + 1) % total), interval);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [i, playing, interval, total, lightbox]);

  // Keyboard navigation in lightbox
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") setI((p) => (p + 1) % total);
      if (e.key === "ArrowLeft") setI((p) => (p - 1 + total) % total);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, total]);

  const go = (d: 1 | -1) => setI((p) => (p + d + total) % total);
  if (!total) {
    return (
      <figure className="my-6 rounded-2xl border border-dashed border-border bg-foreground/5 aspect-[16/10] flex items-center justify-center text-sm text-muted-foreground">
        No slides yet
      </figure>
    );
  }
  const cur = images[Math.min(i, total - 1)];

  return (
    <figure className="my-6">
      <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5 aspect-[16/10]">
        <AnimatePresence mode="wait">
          <motion.button
            type="button"
            key={i}
            onClick={() => setLightbox(true)}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 w-full h-full cursor-zoom-in"
            aria-label="zoom"
          >
            <img
              src={resolveImg(cur.src)}
              alt={cur.caption || ""}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </motion.button>
        </AnimatePresence>

        <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 via-foreground/10 to-transparent pointer-events-none" />

        {/* Caption overlay */}
        {cur.caption && (
          <motion.div
            key={`cap-${i}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="absolute bottom-0 inset-x-0 p-5 text-background pointer-events-none"
          >
            <p className="font-display text-base md:text-lg leading-snug text-balance drop-shadow">
              {cur.caption}
            </p>
          </motion.div>
        )}

        {/* Controls */}
        <button
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          className="absolute start-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong flex items-center justify-center hover:bg-accent/30 transition-colors"
          aria-label="previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); go(1); }}
          className="absolute end-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong flex items-center justify-center hover:bg-accent/30 transition-colors"
          aria-label="next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Play / pause */}
        <button
          onClick={(e) => { e.stopPropagation(); setPlaying((v) => !v); }}
          className="absolute top-3 end-3 w-9 h-9 rounded-full glass-strong flex items-center justify-center hover:bg-accent/30 transition-colors"
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        {/* Dots */}
        <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5 pointer-events-none">
          {images.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); setI(idx); }}
              className={`pointer-events-auto h-1.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-accent" : "w-1.5 bg-background/50 hover:bg-background/80"
              }`}
              aria-label={`slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Thumbnails strip */}
      {total > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              className={`shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                idx === i
                  ? "border-accent shadow-glow scale-105"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
              aria-label={`thumbnail ${idx + 1}`}
            >
              <img
                src={resolveImg(img.src)}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <figcaption className="mt-2 text-xs text-muted-foreground text-center tabular-nums">
        {i + 1} / {total}
      </figcaption>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setLightbox(false)}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
              className="absolute top-4 end-4 w-10 h-10 rounded-full glass-strong flex items-center justify-center"
              aria-label="close"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              className="absolute start-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full glass-strong flex items-center justify-center"
              aria-label="previous"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); go(1); }}
              className="absolute end-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full glass-strong flex items-center justify-center"
              aria-label="next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <motion.img
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              src={resolveImg(cur.src)}
              alt={cur.caption || ""}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            {cur.caption && (
              <div className="absolute bottom-6 inset-x-0 px-6 text-center pointer-events-none">
                <p className="inline-block max-w-2xl text-background bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg text-sm md:text-base">
                  {cur.caption}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </figure>
  );
};

/* ---------- Main renderer ---------- */

const textBlockStyle = (block: { textAlign?: "left" | "center" | "right" | "justify"; dir?: "rtl" | "ltr" }, extra?: React.CSSProperties): React.CSSProperties => ({
  ...extra,
  ...(block.textAlign ? { textAlign: block.textAlign } : {}),
});

export const BlockRenderer = ({ block, fontSize, index, pageIndex = 0, savedHighlights, onHighlightClick }: Props) => {
  const delay = Math.min(index * 0.05, 0.3);
  const blockId = `book-block-${pageIndex}-${index}`;
  const fade = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  };

  switch (block.type) {
    case "heading":
      return (
        <motion.h3 {...fade} dir={block.dir} className="text-xl md:text-2xl font-display font-bold gold-text mt-6 mb-3 leading-tight" style={textBlockStyle(block)}>
          {renderWithHighlights(block.text, savedHighlights, onHighlightClick)}
        </motion.h3>
      );

    case "paragraph": {
      const isFirst = index === 0;
      // Drop cap is an English typographic convention — skip for RTL/Persian
      const isRtl = block.dir === "rtl";
      return (
        <motion.p
          {...fade}
          dir={block.dir}
          className={`text-foreground/90 leading-loose whitespace-pre-line text-pretty ${isFirst && !isRtl ? "drop-cap" : ""}`}
          style={textBlockStyle(block, { fontSize: `${fontSize}px`, lineHeight: 1.85 })}
        >
          {renderWithHighlights(block.text, savedHighlights, onHighlightClick)}
        </motion.p>
      );
    }

    case "quote":
      return (
        <motion.figure {...fade} className="my-8 relative ps-6">
          <div className="absolute top-0 start-0 w-1 h-full bg-gradient-warm rounded-full" />
          <QuoteIcon className="w-6 h-6 text-accent mb-2 opacity-60" />
          <blockquote
            dir={block.dir}
            className="pull-quote text-foreground/95 leading-relaxed text-balance"
            style={textBlockStyle(block, { fontSize: `${fontSize + 2}px` })}
          >
            "{renderWithHighlights(block.text, savedHighlights, onHighlightClick)}"
          </blockquote>
          {block.author && (
            <figcaption className="mt-2 text-sm text-muted-foreground">— {block.author}</figcaption>
          )}
        </motion.figure>
      );

    case "highlight":
      return (
        <motion.div {...fade} className="my-5 p-4 rounded-xl bg-gradient-to-r from-accent/20 via-accent/10 to-transparent border-s-4 border-accent">
          <p className="font-display font-semibold text-foreground" style={{ fontSize: `${fontSize + 1}px` }}>
            ✨ {block.text}
          </p>
        </motion.div>
      );

    case "image":
      return (
        <motion.div {...fade} id={blockId}>
          {block.hideCaption && block.caption ? (
            <HiddenCaptionImage src={block.src} caption={block.caption} figureNumber={block.figureNumber} />
          ) : (
            <InteractiveImage src={block.src} caption={block.caption} hotspots={block.hotspots} mediaKey={blockId} figureNumber={block.figureNumber} />
          )}
        </motion.div>
      );

    case "slideshow":
      return (
        <motion.div {...fade}>
          <Slideshow images={block.images} autoplay={block.autoplay} interval={block.interval} />
        </motion.div>
      );

    case "gallery":
      return (
        <motion.figure {...fade} className="my-6">
          <div className="grid grid-cols-2 gap-3">
            {block.images.map((img, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: delay + i * 0.1 }}
                whileHover={{ scale: 1.02, y: -2 }}
                className="overflow-hidden rounded-xl book-shadow"
              >
                <img
                  src={resolveImg(img)}
                  alt=""
                  loading="lazy"
                  width={640}
                  height={384}
                  className="w-full h-48 object-cover"
                />
              </motion.div>
            ))}
          </div>
          {block.caption && <figcaption className="book-figcaption">{block.caption}</figcaption>}
        </motion.figure>
      );

    case "video": {
      const embed = toVideoEmbed(block.src);
      return (
        <motion.figure {...fade} className="my-6">
          <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5 aspect-video">
            {embed ? (
              <iframe
                src={embed}
                title={block.caption || "video"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            ) : (
              <video
                src={block.src}
                poster={block.poster ? resolveImg(block.poster) : undefined}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            )}
          </div>
          {block.caption && <figcaption className="book-figcaption">{block.caption}</figcaption>}
        </motion.figure>
      );
    }

    case "table":
      return (
        <motion.figure {...fade} className="my-6">
          <div className="book-table-wrap">
            <table className="book-table">
              <thead>
                <tr>{block.headers.map((h, i) => <th key={i}>{renderWithHighlights(h, savedHighlights, onHighlightClick)}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="book-table-cell">
                        {renderWithHighlights(cell, savedHighlights, onHighlightClick)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <figcaption className="book-figcaption">
              {block.tableNumber && <span className="figcap-label">{block.tableNumber}</span>}
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "references":
      return (
        <motion.section {...fade} className="my-8 p-5 rounded-2xl glass border border-glass-border">
          <h4 className="font-display font-bold text-base mb-3 text-foreground/90 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            منابع و مراجع
          </h4>
          <ol className="space-y-2 text-sm text-foreground/80 leading-relaxed list-decimal ps-5 marker:text-accent marker:font-bold">
            {block.items.map((it, i) => (
              <li key={i} className="ps-1">
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noreferrer" className="hover:text-accent underline-offset-2 hover:underline">
                    {it.text}
                  </a>
                ) : it.text}
              </li>
            ))}
          </ol>
        </motion.section>
      );

    case "callout": {
      const variants: Record<string, { Icon: any; cls: string; iconCls: string; label?: string }> = {
        info:     { Icon: Info,         cls: "bg-accent/10 border-accent/30",            iconCls: "text-accent" },
        sparkle:  { Icon: Sparkles,     cls: "bg-primary/10 border-primary/30",          iconCls: "text-primary" },
        tip:      { Icon: Lightbulb,    cls: "bg-[hsl(var(--hl-yellow)/0.18)] border-[hsl(var(--hl-yellow)/0.45)]", iconCls: "text-[hsl(var(--hl-yellow))]" },
        warning:  { Icon: AlertTriangle,cls: "bg-[hsl(var(--hl-yellow)/0.22)] border-[hsl(var(--hl-yellow)/0.55)]", iconCls: "text-[hsl(var(--hl-yellow))]" },
        success:  { Icon: CheckCircle2, cls: "bg-[hsl(var(--hl-green)/0.18)] border-[hsl(var(--hl-green)/0.45)]",  iconCls: "text-[hsl(var(--hl-green))]" },
        danger:   { Icon: ShieldAlert,  cls: "bg-destructive/10 border-destructive/30",  iconCls: "text-destructive" },
        note:     { Icon: Pencil,       cls: "bg-muted/60 border-border",                iconCls: "text-muted-foreground" },
        question: { Icon: HelpCircle,   cls: "bg-[hsl(var(--hl-blue)/0.18)] border-[hsl(var(--hl-blue)/0.45)]",   iconCls: "text-[hsl(var(--hl-blue))]" },
        quote:    { Icon: QuoteIcon,    cls: "bg-[hsl(var(--hl-pink)/0.15)] border-[hsl(var(--hl-pink)/0.4)]",    iconCls: "text-[hsl(var(--hl-pink))]" },
        definition: { Icon: BookMarked, cls: "bg-[hsl(270_60%_55%/0.12)] border-[hsl(270_60%_55%/0.4)]",          iconCls: "text-[hsl(270_60%_55%)]" },
        example:    { Icon: Sparkles,   cls: "bg-[hsl(170_60%_42%/0.12)] border-[hsl(170_60%_42%/0.4)]",          iconCls: "text-[hsl(170_60%_42%)]" },
      };
      const v = variants[block.icon || "info"] || variants.info;
      const Icon = v.Icon;
      return (
        <motion.aside
          {...fade}
          className={`my-6 flex gap-3 p-4 rounded-xl glass border ${v.cls}`}
        >
          <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${v.iconCls}`} />
          <p dir={block.dir} className="text-sm text-foreground/85 leading-relaxed" style={textBlockStyle(block)}>{renderInlineMarkdown(block.text, `cb-${index}`)}</p>
        </motion.aside>
      );
    }

    case "timeline":
      return (
        <motion.div {...fade} id={blockId}>
          <Timeline title={block.title} steps={block.steps} />
        </motion.div>
      );

    case "scrollytelling":
      return (
        <motion.div {...fade} id={blockId}>
          <Scrollytelling title={block.title} steps={block.steps} />
        </motion.div>
      );

    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <motion.div {...fade}>
          <ListTag
            dir={block.dir}
            className={`my-4 ps-6 space-y-1.5 text-foreground/90 leading-relaxed ${
              block.ordered
                ? "list-decimal marker:text-accent marker:font-bold"
                : "list-disc marker:text-accent"
            }`}
            style={textBlockStyle(block, { fontSize: `${fontSize}px`, lineHeight: 1.75 })}
          >
            {block.items.map((it, i) => (
              <li key={i} className="ps-1 whitespace-pre-line" dir={block.itemAttrs?.[i]?.dir} style={textBlockStyle(block.itemAttrs?.[i] ?? {})}>
                {renderWithHighlights(it, savedHighlights, onHighlightClick)}
              </li>
            ))}
          </ListTag>
        </motion.div>
      );
    }

    default:
      return null;
  }
};
