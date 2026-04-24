import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Sparkles, Quote as QuoteIcon, ChevronLeft, ChevronRight, Play, Pause, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import tehranImg from "@/assets/scene-tehran.jpg";
import princeImg from "@/assets/scene-prince.jpg";
import desertImg from "@/assets/scene-desert.jpg";
import farmImg from "@/assets/scene-farm.jpg";
import heroImg from "@/assets/hero-book.jpg";
import medHeart from "@/assets/med-heart.jpg";
import medBrain from "@/assets/med-brain.jpg";
import medCell from "@/assets/med-cell.jpg";
import medDna from "@/assets/med-dna.jpg";
import medSkeleton from "@/assets/med-skeleton.jpg";
import medLungs from "@/assets/med-lungs.jpg";
import medNeuron from "@/assets/med-neuron.jpg";
import medBlood from "@/assets/med-blood.jpg";
import medCoverAnatomy from "@/assets/med-cover-anatomy.jpg";
import medCoverNeuro from "@/assets/med-cover-neuro.jpg";

const imageMap: Record<string, string> = {
  tehran: tehranImg,
  prince: princeImg,
  desert: desertImg,
  farm: farmImg,
  hero: heroImg,
  "med-heart": medHeart,
  "med-brain": medBrain,
  "med-cell": medCell,
  "med-dna": medDna,
  "med-skeleton": medSkeleton,
  "med-lungs": medLungs,
  "med-neuron": medNeuron,
  "med-blood": medBlood,
  "med-cover-anatomy": medCoverAnatomy,
  "med-cover-neuro": medCoverNeuro,
};

const resolveImg = (src: string) => imageMap[src] || src;

export interface Hotspot {
  x: number; // 0-100 percent
  y: number; // 0-100 percent
  label: string;
  description: string;
}

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; author?: string }
  | { type: "highlight"; text: string }
  | { type: "image"; src: string; caption?: string; hotspots?: Hotspot[] }
  | { type: "gallery"; images: string[]; caption?: string }
  | { type: "slideshow"; images: { src: string; caption?: string }[]; autoplay?: boolean; interval?: number }
  | { type: "video"; src: string; poster?: string; caption?: string }
  | { type: "callout"; icon?: "info" | "sparkle"; text: string };

interface SavedHL { text: string; color: string }

interface Props {
  block: Block;
  fontSize: number;
  index: number;
  savedHighlights?: SavedHL[];
}

/* Render text with inline yellow/colored highlight spans for saved highlights */
const renderWithHighlights = (text: string, hls?: SavedHL[]): React.ReactNode => {
  if (!hls || hls.length === 0) return text;
  // Sort by length desc to match longest first
  const sorted = [...hls].sort((a, b) => b.text.length - a.text.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${sorted.map((h) => escape(h.text)).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((p, i) => {
    const match = sorted.find((h) => h.text === p);
    if (!match) return <span key={i}>{p}</span>;
    return (
      <mark
        key={i}
        className="rounded px-0.5 -mx-0.5 text-foreground"
        style={{ background: `hsl(var(--hl-${match.color}) / 0.55)`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" } as React.CSSProperties}
      >
        {p}
      </mark>
    );
  });
};

/* ---------- Sub-components ---------- */

const InteractiveImage = ({
  src, caption, hotspots,
}: { src: string; caption?: string; hotspots?: Hotspot[] }) => {
  return (
    <figure className="my-6 group">
      <div className="relative overflow-hidden rounded-2xl book-shadow">
        <img
          src={resolveImg(src)}
          alt={caption || ""}
          loading="lazy"
          width={1280}
          height={768}
          className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.02]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/40 via-transparent to-transparent pointer-events-none" />

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

        {hotspots && hotspots.length > 0 && (
          <div className="absolute bottom-3 start-3 glass rounded-full px-3 py-1 text-xs flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-accent" />
            <span>{hotspots.length} نکتهٔ تعاملی</span>
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
};

const Slideshow = ({
  images, autoplay = false, interval = 4000,
}: { images: { src: string; caption?: string }[]; autoplay?: boolean; interval?: number }) => {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const timer = useRef<number | null>(null);
  const total = images.length;

  useEffect(() => {
    if (!playing || total < 2) return;
    timer.current = window.setTimeout(() => setI((p) => (p + 1) % total), interval);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [i, playing, interval, total]);

  const go = (d: 1 | -1) => setI((p) => (p + d + total) % total);
  const cur = images[i];

  return (
    <figure className="my-6">
      <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5 aspect-[16/10]">
        <AnimatePresence mode="wait">
          <motion.img
            key={i}
            src={resolveImg(cur.src)}
            alt={cur.caption || ""}
            loading="lazy"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </AnimatePresence>

        <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 via-foreground/10 to-transparent pointer-events-none" />

        {/* Caption overlay */}
        {cur.caption && (
          <motion.div
            key={`cap-${i}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="absolute bottom-0 inset-x-0 p-5 text-background"
          >
            <p className="font-display text-base md:text-lg leading-snug text-balance drop-shadow">
              {cur.caption}
            </p>
          </motion.div>
        )}

        {/* Controls */}
        <button
          onClick={() => go(-1)}
          className="absolute start-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong flex items-center justify-center hover:bg-accent/30 transition-colors"
          aria-label="previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => go(1)}
          className="absolute end-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong flex items-center justify-center hover:bg-accent/30 transition-colors"
          aria-label="next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Play / pause */}
        <button
          onClick={() => setPlaying((v) => !v)}
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
              onClick={() => setI(idx)}
              className={`pointer-events-auto h-1.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-accent" : "w-1.5 bg-background/50 hover:bg-background/80"
              }`}
              aria-label={`slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center tabular-nums">
        {i + 1} / {total}
      </figcaption>
    </figure>
  );
};

/* ---------- Main renderer ---------- */

export const BlockRenderer = ({ block, fontSize, index, savedHighlights }: Props) => {
  const delay = Math.min(index * 0.05, 0.3);
  const fade = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  };

  switch (block.type) {
    case "heading":
      return (
        <motion.h3 {...fade} className="text-2xl md:text-3xl font-display font-bold gold-text mt-2 mb-4">
          {block.text}
        </motion.h3>
      );

    case "paragraph":
      return (
        <motion.p
          {...fade}
          className="text-foreground/90 leading-loose whitespace-pre-line text-balance"
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.95 }}
        >
          {renderWithHighlights(block.text, savedHighlights)}
        </motion.p>
      );

    case "quote":
      return (
        <motion.figure {...fade} className="my-6 relative pl-6 rtl:pl-0 rtl:pr-6">
          <div className="absolute top-0 start-0 w-1 h-full bg-gradient-warm rounded-full" />
          <QuoteIcon className="w-6 h-6 text-accent mb-2 opacity-70" />
          <blockquote
            className="font-display italic text-foreground/95 leading-relaxed text-balance"
            style={{ fontSize: `${fontSize + 2}px` }}
          >
            "{block.text}"
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
        <motion.div {...fade}>
          <InteractiveImage src={block.src} caption={block.caption} hotspots={block.hotspots} />
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
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "video":
      return (
        <motion.figure {...fade} className="my-6">
          <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5">
            <video
              src={block.src}
              poster={block.poster ? resolveImg(block.poster) : undefined}
              controls
              preload="metadata"
              className="w-full h-auto"
            />
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "callout": {
      const Icon = block.icon === "sparkle" ? Sparkles : Info;
      return (
        <motion.aside
          {...fade}
          className="my-6 flex gap-3 p-4 rounded-xl glass border border-accent/30"
        >
          <Icon className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/85 leading-relaxed">{block.text}</p>
        </motion.aside>
      );
    }

    default:
      return null;
  }
};
