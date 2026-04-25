import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { resolveBookMedia } from "@/lib/book-media";
import { Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface ScrollyStep {
  marker?: string;
  title: string;
  description: string;
  image?: string;
  video?: string;
}

interface Props {
  title?: string;
  steps: ScrollyStep[];
}

/**
 * Click-driven multi-step explainer. Users navigate between steps with the
 * Prev / Next buttons, the numbered dots, or by clicking any step in the
 * side rail. Replaces the previous scroll-driven layout that was awkward
 * inside a paginated reader on desktop.
 */
export const Scrollytelling = ({ title, steps }: Props) => {
  const { dir } = useI18n();
  const [active, setActive] = useState(0);

  if (!steps?.length) return null;
  const cur = steps[active];
  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  const goPrev = () => setActive((i) => Math.max(0, i - 1));
  const goNext = () => setActive((i) => Math.min(steps.length - 1, i + 1));

  return (
    <figure className="my-10">
      {title && (
        <header className="flex items-center gap-2 mb-5">
          <Layers className="w-4 h-4 text-accent" />
          <h4 className="font-display font-bold text-base text-foreground/90">{title}</h4>
        </header>
      )}

      <div className="grid md:grid-cols-[220px_1fr] gap-5 md:gap-7 items-start">
        {/* Step rail (clickable) */}
        <nav
          aria-label="Steps"
          className="flex md:flex-col gap-2 md:gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1 snap-x"
        >
          {steps.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-current={isActive ? "step" : undefined}
                className={`snap-start text-start shrink-0 md:w-full rounded-xl px-3 py-2.5 transition-all border ${
                  isActive
                    ? "glass-strong border-accent/50 shadow-glow"
                    : "bg-foreground/[0.03] border-glass-border hover:border-accent/30 hover:bg-foreground/[0.06] opacity-80 hover:opacity-100"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isActive
                        ? "bg-gradient-warm text-primary-foreground shadow-glow"
                        : "bg-foreground/10 text-foreground/70"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {s.marker && (
                      <div className="text-[10px] uppercase tracking-wider text-accent font-semibold leading-tight">
                        {s.marker}
                      </div>
                    )}
                    <div className="text-xs md:text-[13px] font-medium leading-tight line-clamp-2">
                      {s.title}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Active step panel */}
        <div className="min-w-0">
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden book-shadow bg-foreground/5 mb-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                {renderMedia(cur)}
              </motion.div>
            </AnimatePresence>
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

          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="glass-strong rounded-2xl p-5 border border-glass-border"
            >
              {cur.marker && (
                <div className="text-[11px] uppercase tracking-wider text-accent font-semibold mb-1">
                  {cur.marker}
                </div>
              )}
              <h5 className="font-display font-bold text-lg md:text-xl text-foreground mb-2 leading-tight">
                {cur.title}
              </h5>
              <p className="text-sm md:text-[15px] text-foreground/85 leading-relaxed whitespace-pre-line">
                {cur.description}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Controls */}
          <div className="flex items-center justify-between gap-3 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={active === 0}
              className="gap-1.5"
            >
              <Prev className="w-4 h-4" />
              {dir === "rtl" ? "قبلی" : "Prev"}
            </Button>

            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Go to step ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    i === active ? "w-6 bg-gradient-warm" : "w-2 bg-foreground/20 hover:bg-foreground/40"
                  }`}
                />
              ))}
            </div>

            <Button
              size="sm"
              onClick={goNext}
              disabled={active === steps.length - 1}
              className="gap-1.5 bg-gradient-warm hover:opacity-90"
            >
              {dir === "rtl" ? "بعدی" : "Next"}
              <Next className="w-4 h-4" />
            </Button>
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
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
};
