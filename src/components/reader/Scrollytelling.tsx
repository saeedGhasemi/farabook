import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { resolveBookMedia } from "@/lib/book-media";
import { Layers } from "lucide-react";

export interface ScrollyStep {
  /** Optional small label / step number, e.g. "مرحله ۱" */
  marker?: string;
  /** Step title */
  title: string;
  /** Long description */
  description: string;
  /** Optional image (asset key or full URL) */
  image?: string;
  /** Optional video URL (mp4 or YouTube/Vimeo) — alternative to image */
  video?: string;
}

interface Props {
  title?: string;
  steps: ScrollyStep[];
}

/**
 * Scroll-driven multi-step explainer.
 * The right column is sticky and shows the active step's media; the left
 * column is a vertical stack of step cards. As the user scrolls, the card
 * closest to the viewport center becomes active and the media swaps.
 *
 * Layout collapses to a single column on mobile.
 */
export const Scrollytelling = ({ title, steps }: Props) => {
  const [active, setActive] = useState(0);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!steps?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // pick the entry with the largest intersection ratio that's currently intersecting
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const idx = Number((visible[0].target as HTMLElement).dataset.idx);
          if (!Number.isNaN(idx)) setActive(idx);
        }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    cardRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [steps]);

  if (!steps?.length) return null;
  const cur = steps[active];

  return (
    <figure className="my-10">
      {title && (
        <header className="flex items-center gap-2 mb-5">
          <Layers className="w-4 h-4 text-accent" />
          <h4 className="font-display font-bold text-base text-foreground/90">{title}</h4>
        </header>
      )}

      <div className="grid md:grid-cols-2 gap-6 md:gap-8 items-start">
        {/* Step cards (scrolling column) */}
        <div className="space-y-6 md:space-y-[28vh] order-2 md:order-1">
          {steps.map((s, i) => (
            <div
              key={i}
              data-idx={i}
              ref={(el) => (cardRefs.current[i] = el)}
              className={`rounded-2xl p-5 transition-all duration-500 ${
                i === active
                  ? "glass-strong border border-accent/40 shadow-glow"
                  : "bg-foreground/[0.03] border border-glass-border opacity-70"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    i === active
                      ? "bg-gradient-warm text-primary-foreground shadow-glow scale-110"
                      : "bg-foreground/10 text-foreground/60"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  {s.marker && (
                    <div className="text-[11px] uppercase tracking-wider text-accent font-semibold mb-1">
                      {s.marker}
                    </div>
                  )}
                  <h5 className="font-display font-bold text-base md:text-lg text-foreground mb-2 leading-tight">
                    {s.title}
                  </h5>
                  <p className="text-sm md:text-[15px] text-foreground/80 leading-relaxed whitespace-pre-line">
                    {s.description}
                  </p>
                </div>
              </div>

              {/* On mobile, render the media inline under each card */}
              {(s.image || s.video) && (
                <div className="mt-4 md:hidden overflow-hidden rounded-xl bg-foreground/5">
                  {renderMedia(s)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Sticky media column (desktop) */}
        <div className="hidden md:block sticky top-24 order-1 md:order-2">
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden book-shadow bg-foreground/5">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                {renderMedia(cur)}
              </motion.div>
            </AnimatePresence>
            {/* progress bar */}
            <div className="absolute bottom-0 inset-x-0 h-1 bg-foreground/10">
              <motion.div
                className="h-full bg-gradient-warm"
                animate={{ width: `${((active + 1) / steps.length) * 100}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <div className="absolute top-3 end-3 glass rounded-full px-3 py-1 text-xs font-medium tabular-nums">
              {active + 1} / {steps.length}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
};

const renderMedia = (s: ScrollyStep) => {
  if (s.video) {
    const embed = toEmbedUrl(s.video);
    if (embed) {
      return (
        <iframe
          src={embed}
          title={s.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full border-0"
        />
      );
    }
    return (
      <video
        src={s.video}
        controls
        playsInline
        className="w-full h-full object-cover"
      />
    );
  }
  if (s.image) {
    return (
      <img
        src={resolveBookMedia(s.image)}
        alt={s.title}
        loading="lazy"
        className="w-full h-full object-cover"
      />
    );
  }
  return <div className="w-full h-full bg-foreground/5" />;
};

const toEmbedUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    // YouTube
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    // Vimeo
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
};
