import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Check, X, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ChapterItem {
  index: number;
  title: string;
  level?: number;
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

  // Collapsed parents (by chapter index). Children of a collapsed parent
  // are hidden until the user expands it again.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const subtreeEnd = (idx: number) => {
    const lvl = chapters[idx]?.level ?? 0;
    let j = idx + 1;
    while (j < chapters.length && (chapters[j]?.level ?? 0) > lvl) j += 1;
    return j;
  };

  const hidden = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < chapters.length; i += 1) {
      if (!collapsed.has(i)) continue;
      const end = subtreeEnd(i);
      for (let k = i + 1; k < end; k += 1) set.add(k);
    }
    // Always keep the current chapter visible (auto-expand its ancestors).
    let c = current;
    while (set.has(c)) {
      set.delete(c);
      // Find parent: the nearest earlier chapter with a lower level.
      const curLvl = chapters[c]?.level ?? 0;
      let p = c - 1;
      while (p >= 0 && (chapters[p]?.level ?? 0) >= curLvl) p -= 1;
      if (p < 0) break;
      c = p;
    }
    return set;
  }, [chapters, collapsed, current]);

  const toggle = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const hasChildren = (i: number) => subtreeEnd(i) > i + 1;

  return (
    <aside
      className={
        variant === "panel"
          ? "h-full w-full glass-strong rounded-3xl p-4 flex flex-col"
          : "h-full w-full p-4 flex flex-col bg-transparent"
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
            if (hidden.has(ch.index)) return null;
            const active = ch.index === current;
            const done = ch.index < current;
            const lvl = Math.max(0, Math.min(5, ch.level ?? 0));
            const parent = hasChildren(ch.index);
            const isCollapsed = collapsed.has(ch.index);
            return (
              <li key={ch.index} style={{ paddingInlineStart: lvl * 14 }}>
                <div className="flex items-center gap-1">
                  {parent ? (
                    <button
                      onClick={() => toggle(ch.index)}
                      className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={isCollapsed ? "expand" : "collapse"}
                    >
                      {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <button
                    onClick={() => onSelect(ch.index)}
                    className={`flex-1 min-w-0 text-start flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
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
                    <span className={`flex-1 truncate text-sm ${lvl === 0 ? "font-semibold" : "font-medium"}`}>
                      {ch.title || `${t("page")} ${ch.index + 1}`}
                    </span>
                    {active && (
                      <motion.span
                        layoutId="ch-dot"
                        className="w-1.5 h-1.5 rounded-full bg-primary-foreground"
                      />
                    )}
                  </button>
                </div>
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
