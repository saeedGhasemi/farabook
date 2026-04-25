import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ListChecks, BrainCircuit, Lightbulb, Loader2, BookmarkPlus, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { MindMap } from "./MindMap";
import { QuizCard } from "./QuizCard";
import { Timeline, type TimelineStep } from "./Timeline";

type Mode = "summary" | "quiz" | "mindmap" | "explain" | "timeline";

interface Props {
  open: boolean;
  mode: Mode | null;
  loading: boolean;
  content: string;
  timeline?: { title?: string; steps: TimelineStep[] } | null;
  onClose: () => void;
  onRegenerate?: () => void;
  onSaveAsNote?: (text: string) => void;
}

const titles: Record<Mode, { fa: string; en: string; icon: React.ComponentType<{ className?: string }> }> = {
  summary: { fa: "خلاصهٔ هوشمند", en: "Smart Summary", icon: Sparkles },
  quiz: { fa: "آزمون مفهومی", en: "Conceptual Quiz", icon: ListChecks },
  mindmap: { fa: "نقشهٔ ذهنی", en: "Mind Map", icon: BrainCircuit },
  explain: { fa: "توضیح ساده", en: "Simple Explanation", icon: Lightbulb },
  timeline: { fa: "تایم‌لاین تعاملی", en: "Interactive Timeline", icon: Clock },
};

export const AiPanel = ({ open, mode, loading, content, timeline, onClose, onRegenerate, onSaveAsNote }: Props) => {
  const { lang } = useI18n();
  if (!mode) return null;
  const { icon: Icon } = titles[mode];
  const title = titles[mode][lang];

  const canSave = !loading && (
    (mode === "mindmap" || mode === "summary" || mode === "explain") && !!content
    || (mode === "timeline" && !!timeline?.steps?.length)
  );
  const buildNote = () => {
    if (mode === "timeline" && timeline?.steps?.length) {
      const header = `[${title}${timeline.title ? `: ${timeline.title}` : ""}]\n`;
      const body = timeline.steps.map((s, i) => `${i + 1}. ${s.marker} — ${s.title}\n${s.description}`).join("\n\n");
      return header + body;
    }
    const header = `[${title}]\n`;
    return header + content;
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 backdrop-blur-md z-40"
          />
          <motion.aside
            initial={{ x: 440, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 440, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-[440px] max-w-full glass-strong shadow-book border-l border-glass-border flex flex-col"
          >
            <header className="flex items-center justify-between p-5 border-b border-border/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-display font-bold truncate">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label="close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-5 pb-24">
              {loading && mode !== "quiz" ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <div className="relative">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-accent/30"
                      animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                  <p className="text-sm">{lang === "fa" ? "در حال تفکر..." : "Thinking..."}</p>
                </div>
              ) : mode === "quiz" ? (
                <QuizCard
                  content={content}
                  loading={loading}
                  onNext={() => onRegenerate?.()}
                />
              ) : mode === "mindmap" ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  <MindMap
                    text={content}
                    onSaveNode={onSaveAsNote ? (label, note) => onSaveAsNote(`[${title}: ${label}]\n${note}`) : undefined}
                  />
                  <details className="mt-4">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      {lang === "fa" ? "نمایش متنی" : "Show as text"}
                    </summary>
                    <pre className="mt-2 p-3 rounded-xl bg-background/40 border border-border/40 text-xs leading-relaxed whitespace-pre-wrap font-sans text-foreground/80">
                      {content}
                    </pre>
                  </details>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="prose prose-sm max-w-none"
                >
                  <p className="text-foreground/90 leading-loose whitespace-pre-line text-[15px]">
                    {content || (lang === "fa" ? "محتوایی دریافت نشد." : "No content received.")}
                  </p>
                </motion.div>
              )}
            </div>

            {canSave && (
              <footer className="p-4 border-t border-border/40 bg-background/30">
                <button
                  onClick={() => onSaveAsNote?.(buildNote())}
                  className="w-full py-2.5 rounded-xl bg-gradient-warm text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:shadow-glow transition-shadow"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  {lang === "fa" ? "افزودن به نشان‌ها" : "Save to notes"}
                </button>
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
