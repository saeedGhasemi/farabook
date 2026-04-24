import { motion } from "framer-motion";
import { BookOpen, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ChapterItem {
  index: number;
  title: string;
}

interface Props {
  chapters: ChapterItem[];
  current: number;
  onSelect: (i: number) => void;
  onClose?: () => void;
  variant?: "panel" | "drawer";
}

export const ChapterSidebar = ({ chapters, current, onSelect, onClose, variant = "panel" }: Props) => {
  const { t, lang } = useI18n();

  return (
    <aside
      className={
        variant === "panel"
          ? "h-full w-full glass-strong rounded-3xl p-4 shadow-paper border border-border/60 flex flex-col"
          : "h-full w-full bg-card flex flex-col"
      }
    >
      <header className="flex items-center justify-between px-2 py-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-warm flex items-center justify-center text-primary-foreground">
            <BookOpen className="w-4 h-4" />
          </div>
          <h3 className="font-display font-bold text-sm">
            {lang === "fa" ? "فهرست فصل‌ها" : "Chapters"}
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 rounded-full hover:bg-foreground/10 flex items-center justify-center"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin pe-1">
        <ul className="space-y-1">
          {chapters.map((ch) => {
            const active = ch.index === current;
            const done = ch.index < current;
            return (
              <li key={ch.index}>
                <button
                  onClick={() => onSelect(ch.index)}
                  className={`w-full text-start flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                    active
                      ? "bg-gradient-warm text-primary-foreground shadow-glow"
                      : "hover:bg-accent/15 text-foreground/85"
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 tabular-nums ${
                      active
                        ? "bg-background/20 text-primary-foreground"
                        : done
                        ? "bg-accent/30 text-accent-foreground"
                        : "bg-foreground/5 text-muted-foreground"
                    }`}
                  >
                    {done && !active ? <Check className="w-3.5 h-3.5" /> : ch.index + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">
                    {ch.title || `${t("page")} ${ch.index + 1}`}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="ch-dot"
                      className="w-1.5 h-1.5 rounded-full bg-primary-foreground"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="mt-3 pt-3 border-t border-border/60 px-2 text-xs text-muted-foreground">
        {lang === "fa"
          ? `${current + 1} از ${chapters.length} فصل`
          : `${current + 1} of ${chapters.length} chapters`}
      </footer>
    </aside>
  );
};
