import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ListChecks, BrainCircuit, Lightbulb, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Mode = "summary" | "quiz" | "mindmap" | "explain";

interface Props {
  open: boolean;
  mode: Mode | null;
  loading: boolean;
  content: string;
  onClose: () => void;
}

const titles: Record<Mode, { fa: string; en: string; icon: React.ComponentType<{ className?: string }> }> = {
  summary: { fa: "خلاصهٔ هوشمند", en: "Smart Summary", icon: Sparkles },
  quiz: { fa: "آزمون مفهومی", en: "Conceptual Quiz", icon: ListChecks },
  mindmap: { fa: "نقشهٔ ذهنی", en: "Mind Map", icon: BrainCircuit },
  explain: { fa: "توضیح ساده", en: "Simple Explanation", icon: Lightbulb },
};

export const AiPanel = ({ open, mode, loading, content, onClose }: Props) => {
  const { lang, dir } = useI18n();
  if (!mode) return null;
  const { icon: Icon } = titles[mode];
  const title = titles[mode][lang];

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
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-50 left-1/2 -translate-x-1/2 bottom-24 md:bottom-28 w-[calc(100vw-1.5rem)] sm:w-[min(560px,90vw)] glass-strong rounded-3xl p-5 sm:p-6 shadow-book border border-accent/20 overflow-y-auto"
            style={{ maxHeight: "min(70vh, calc(100dvh - 8rem))" }}
            dir={dir}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-display font-bold">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading ? (
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
