import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { resolveBookMedia, resolveBookCover } from "@/lib/book-media";

export interface TimelineStep {
  /** Short label or date (e.g. "هفته ۴" or "1969") */
  marker: string;
  /** Step title */
  title: string;
  /** Long description shown on the active card */
  description: string;
  /** Optional image */
  image?: string;
}

interface Props {
  title?: string;
  steps: TimelineStep[];
}

/** Detect direction (rtl/ltr) for a piece of text based on script majority. */
const detectDir = (text: string): "rtl" | "ltr" => {
  if (!text) return "ltr";
  const rtl = text.match(/[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/g)?.length ?? 0;
  const ltr = text.match(/[A-Za-z]/g)?.length ?? 0;
  return rtl >= ltr ? "rtl" : "ltr";
};

/** Horizontal interactive timeline — tap markers to reveal a detail card. */
export const Timeline = ({ title, steps }: Props) => {
  const [active, setActive] = useState(0);
  if (!steps?.length) return null;
  const total = steps.length;
  const cur = steps[active];
  const titleDir = detectDir(`${cur.title} ${cur.marker}`);
  const descDir = detectDir(cur.description);
  const headerDir = title ? detectDir(title) : "ltr";

  const go = (d: 1 | -1) => setActive((p) => (p + d + total) % total);

  return (
    <figure className="my-8 select-none">
      {title && (
        <header dir={headerDir} className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-accent" />
          <h4 className="font-display font-bold text-base text-foreground/90">{title}</h4>
        </header>
      )}

      {/* Track */}
      <div className="relative px-2 pb-2">
        <div className="absolute inset-x-3 top-4 h-0.5 bg-gradient-to-r from-accent/20 via-accent/60 to-accent/20 rounded-full" />
        <div className="relative flex items-start justify-between gap-2 overflow-x-auto scrollbar-thin pb-3">
          {steps.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                onClick={() => setActive(i)}
                className="group flex-1 min-w-[88px] flex flex-col items-center gap-1.5 outline-none"
                aria-label={s.title}
              >
                <span
                  className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    isActive
                      ? "bg-gradient-warm text-primary-foreground shadow-glow scale-110"
                      : "bg-background/60 text-foreground/70 border border-border group-hover:border-accent/50"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  dir={detectDir(s.marker)}
                  className={`text-[11px] leading-tight text-center max-w-[100px] truncate transition-colors ${
                    isActive ? "text-accent font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {s.marker}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active card */}
      <div className="relative mt-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl glass border border-glass-border p-4 md:p-5 book-shadow"
          >
            <div className="flex flex-col md:flex-row gap-4">
              {cur.image && (
                <div className="md:w-1/3 shrink-0 overflow-hidden rounded-xl bg-foreground/5">
                  <img
                    src={resolveBookMedia(cur.image)}
                    alt={cur.title}
                    loading="lazy"
                    className="w-full h-40 md:h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div dir={detectDir(cur.marker)} className="text-[11px] uppercase tracking-wider text-accent font-semibold mb-1">
                  {cur.marker}
                </div>
                <h5 dir={titleDir} className="font-display font-bold text-lg md:text-xl text-foreground mb-2 leading-tight">
                  {cur.title}
                </h5>
                <p dir={descDir} className="text-sm md:text-[15px] text-foreground/80 leading-relaxed whitespace-pre-line">
                  {cur.description}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {total > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => go(-1)}
              className="w-9 h-9 rounded-full glass-strong flex items-center justify-center hover:bg-accent/20 transition-colors"
              aria-label="previous step"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {active + 1} / {total}
            </span>
            <button
              onClick={() => go(1)}
              className="w-9 h-9 rounded-full glass-strong flex items-center justify-center hover:bg-accent/20 transition-colors"
              aria-label="next step"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </figure>
  );
};
