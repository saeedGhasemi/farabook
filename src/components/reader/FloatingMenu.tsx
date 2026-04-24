import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Sparkles, BrainCircuit, ListChecks, Lightbulb,
  Volume2, VolumeX, Highlighter, Settings2, Sun, Moon,
  CloudRain, Trees, Coffee, Stars, VolumeOff, Menu, BookmarkCheck,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  onAi: (mode: "summary" | "quiz" | "mindmap" | "explain") => void;
  onSpeak: () => void;
  onStopSpeak: () => void;
  isSpeaking: boolean;
  onToggleHighlight: () => void;
  highlightMode: boolean;
  onOpenSettings: () => void;
  onOpenChapters: () => void;
  onOpenHighlights: () => void;
  highlightCount: number;
  dark: boolean;
  onToggleDark: () => void;
  ambient: string;
  onAmbient: (a: string) => void;
}

const ambientOpts = [
  { id: "off", icon: VolumeOff },
  { id: "rain", icon: CloudRain },
  { id: "forest", icon: Trees },
  { id: "cafe", icon: Coffee },
  { id: "night", icon: Stars },
];

export const FloatingMenu = ({
  onAi, onSpeak, onStopSpeak, isSpeaking, onToggleHighlight, highlightMode,
  onOpenSettings, onOpenChapters, onOpenHighlights, highlightCount,
  dark, onToggleDark, ambient, onAmbient,
}: Props) => {
  const { t, lang } = useI18n();
  const [aiOpen, setAiOpen] = useState(false);
  const [ambOpen, setAmbOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const aiActions = [
    { id: "summary", icon: Sparkles, label: t("ai_summary"), mode: "summary" as const },
    { id: "quiz", icon: ListChecks, label: t("ai_quiz"), mode: "quiz" as const },
    { id: "mindmap", icon: BrainCircuit, label: t("ai_mindmap"), mode: "mindmap" as const },
    { id: "explain", icon: Lightbulb, label: t("ai_explain"), mode: "explain" as const },
  ];

  const Item = ({
    icon: Icon, label, onClick, active, badge,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    active?: boolean;
    badge?: number;
  }) => (
    <button
      onClick={onClick}
      title={label}
      className={`relative shrink-0 flex flex-col items-center justify-center gap-1 w-14 h-14 rounded-2xl transition-all hover:scale-105 ${
        active
          ? "bg-gradient-warm text-primary-foreground shadow-glow"
          : "text-foreground/75 hover:text-foreground hover:bg-foreground/5"
      }`}
    >
      <Icon className="w-[18px] h-[18px]" />
      <span className="text-[10px] font-medium leading-none whitespace-nowrap max-w-[52px] truncate">
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-foreground text-[9px] font-bold flex items-center justify-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      {/* AI popup menu */}
      <AnimatePresence>
        {aiOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAiOpen(false)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 glass-strong rounded-2xl p-2 shadow-book border border-accent/20 grid grid-cols-2 gap-1 w-[min(340px,90vw)]"
            >
              {aiActions.map(({ id, icon: Icon, label, mode }) => (
                <button
                  key={id}
                  onClick={() => { onAi(mode); setAiOpen(false); }}
                  className="flex items-center gap-2.5 p-3 rounded-xl hover:bg-accent/15 transition-colors text-start"
                >
                  <span className="w-9 h-9 rounded-lg bg-gradient-warm flex items-center justify-center text-primary-foreground shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Ambient popup */}
      <AnimatePresence>
        {ambOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAmbOpen(false)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 glass-strong rounded-2xl p-3 shadow-book border border-accent/20 flex gap-2"
            >
              {ambientOpts.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { onAmbient(id); setAmbOpen(false); }}
                  className={`flex flex-col items-center gap-1 w-14 h-14 rounded-xl transition-all ${
                    ambient === id
                      ? "bg-gradient-warm text-primary-foreground shadow-glow"
                      : "hover:bg-accent/15"
                  }`}
                  title={t(`amb_${id}` as never)}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[10px]">{t(`amb_${id}` as never)}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* More popup (mobile overflow) */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 glass-strong rounded-2xl p-2 shadow-book border border-accent/20 flex gap-1"
            >
              <Item icon={dark ? Sun : Moon} label={dark ? t("light") : t("dark")} onClick={() => { onToggleDark(); setMoreOpen(false); }} />
              <Item icon={Settings2} label={t("settings")} onClick={() => { onOpenSettings(); setMoreOpen(false); }} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom dock */}
      <motion.nav
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 glass-strong rounded-3xl px-2 py-2 shadow-book border border-border/60 flex items-center gap-1 max-w-[calc(100vw-2rem)]"
      >
        <Item icon={Menu} label={lang === "fa" ? "فصل‌ها" : "Chapters"} onClick={onOpenChapters} />
        <Item icon={Sparkles} label={lang === "fa" ? "هوش مصنوعی" : "AI"} onClick={() => setAiOpen((v) => !v)} active={aiOpen} />
        <Item
          icon={isSpeaking ? VolumeX : Volume2}
          label={isSpeaking ? t("stop") : t("listen")}
          onClick={() => (isSpeaking ? onStopSpeak() : onSpeak())}
          active={isSpeaking}
        />
        <Item icon={Highlighter} label={t("highlight")} onClick={onToggleHighlight} active={highlightMode} />
        <Item icon={BookmarkCheck} label={lang === "fa" ? "نشان‌ها" : "Notes"} onClick={onOpenHighlights} badge={highlightCount} />
        <Item icon={ambient === "off" ? VolumeOff : CloudRain} label={t("ambient")} onClick={() => setAmbOpen((v) => !v)} active={ambient !== "off"} />
        <div className="hidden sm:flex items-center gap-1">
          <Item icon={dark ? Sun : Moon} label={dark ? t("light") : t("dark")} onClick={onToggleDark} />
          <Item icon={Settings2} label={t("settings")} onClick={onOpenSettings} />
        </div>
        <div className="sm:hidden">
          <Item icon={Search} label={lang === "fa" ? "بیشتر" : "More"} onClick={() => setMoreOpen((v) => !v)} />
        </div>
      </motion.nav>
    </>
  );
};
