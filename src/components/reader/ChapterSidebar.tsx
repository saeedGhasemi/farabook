import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, X, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
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
  /** Book title shown in the header (in place of the generic label). */
  bookTitle?: string;
  /** Optional faint background logo (publisher or per-book override). */
  logoUrl?: string | null;
  /** Year & version shown at the bottom. */
  publicationYear?: number | null;
  bookVersion?: number | string | null;
  /** Clicking the title returns the reader to the front cover. */
  onTitleClick?: () => void;
}

export const ChapterSidebar = ({
  chapters,
  current,
  onSelect,
  onClose,
  variant = "panel",
  bookTitle,
  logoUrl,
  publicationYear,
  bookVersion,
  onTitleClick,
}: Props) => {
  const { t, lang } = useI18n();
  const fa = lang === "fa";

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

  const collapseAll = () => {
    const next = new Set<number>();
    for (let i = 0; i < chapters.length; i += 1) {
      if (subtreeEnd(i) > i + 1) next.add(i);
    }
    setCollapsed(next);
  };
  const expandAll = () => setCollapsed(new Set());

  const formattedVersion = (() => {
    if (bookVersion == null || bookVersion === "") return null;
    return String(bookVersion);
  })();

  return (
    <aside
      className={
        variant === "panel"
          ? "h-full w-full glass-strong rounded-3xl p-4 flex flex-col relative overflow-hidden"
          : "h-full w-full p-4 flex flex-col bg-transparent relative overflow-hidden"
      }
    >
      {/* Faint publisher / per-book logo as a luxurious watermark backdrop */}
      {logoUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.045] dark:opacity-[0.07]"
        >
          <img
            src={logoUrl}
            alt=""
            className="w-[78%] max-w-[320px] object-contain saturate-0"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      {/* Subtle accent halo behind the logo for depth */}
      {logoUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(60% 50% at 50% 50%, hsl(var(--accent) / 0.05), transparent 70%)",
          }}
        />
      )}

      <header className="relative flex items-start justify-between px-2 py-2 mb-3 gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground/80 mb-1">
            {fa ? "کتاب در دست مطالعه" : "Now reading"}
          </div>
          {/* Book title — single-line marquee-scroll on overflow */}
          <div
            className="relative overflow-hidden group"
            title={bookTitle || ""}
          >
            <h3 className="font-display font-bold text-base leading-snug whitespace-nowrap chapter-title-marquee">
              {bookTitle || (fa ? "فهرست فصل‌ها" : "Chapters")}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={collapseAll}
            className="w-8 h-8 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={fa ? "بستن همه" : "Collapse all"}
            title={fa ? "بستن همه" : "Collapse all"}
          >
            <ChevronsDownUp className="w-4 h-4" />
          </button>
          <button
            onClick={expandAll}
            className="w-8 h-8 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={fa ? "باز کردن همه" : "Expand all"}
            title={fa ? "باز کردن همه" : "Expand all"}
          >
            <ChevronsUpDown className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden w-8 h-8 rounded-full hover:bg-foreground/10 flex items-center justify-center"
              aria-label="close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto scrollbar-thin pe-1">
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

      <footer className="relative mt-3 pt-3 border-t border-border/60 px-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          {fa
            ? `${current + 1} از ${chapters.length} فصل`
            : `${current + 1} of ${chapters.length}`}
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          {publicationYear && <span>{publicationYear}</span>}
          {publicationYear && formattedVersion && <span className="opacity-40">·</span>}
          {formattedVersion && (
            <span title={fa ? "نسخه محتوای کتاب" : "Content version"}>
              v{formattedVersion}
            </span>
          )}
        </span>
      </footer>
    </aside>
  );
};
