import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, BrainCircuit, ListChecks, Lightbulb,
  Volume2, VolumeX, Settings2, Sun, Moon, Search,
  CloudRain, Trees, Coffee, Stars, VolumeOff, Menu, BookmarkCheck,
  ChevronUp, ChevronDown, Clock, MessageSquare,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  onAi: (mode: "summary" | "quiz" | "mindmap" | "explain" | "timeline") => void;
  onSpeak: () => void;
  onStopSpeak: () => void;
  isSpeaking: boolean;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenChapters: () => void;
  onOpenHighlights: () => void;
  onOpenChat: () => void;
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
  onAi, onSpeak, onStopSpeak, isSpeaking, onOpenSearch,
  onOpenSettings, onOpenChapters, onOpenHighlights, onOpenChat, highlightCount,
  dark, onToggleDark, ambient, onAmbient,
}: Props) => {
  const { t, lang } = useI18n();
  const [aiOpen, setAiOpen] = useState(false);
  const [ambOpen, setAmbOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Auto-collapse after 8s of inactivity
  useEffect(() => {
    if (collapsed) return;
    const t = window.setTimeout(() => setCollapsed(true), 12000);
    return () => window.clearTimeout(t);
  }, [collapsed, aiOpen, ambOpen]);

  const aiActions = [
    { id: "summary", icon: Sparkles, label: t("ai_summary"), mode: "summary" as const },
    { id: "quiz", icon: ListChecks, label: t("ai_quiz"), mode: "quiz" as const },
    { id: "mindmap", icon: BrainCircuit, label: t("ai_mindmap"), mode: "mindmap" as const },
    { id: "explain", icon: Lightbulb, label: t("ai_explain"), mode: "explain" as const },
    { id: "timeline", icon: Clock, label: lang === "fa" ? "تایم‌لاین" : "Timeline", mode: "timeline" as const },
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
      onClick={() => { setCollapsed(false); onClick(); }}
      title={label}
      aria-label={label}
      className={`relative shrink-0 flex flex-col items-center justify-center gap-0.5 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl transition-all hover:scale-105 active:scale-95 ${
        active
          ? "bg-gradient-warm text-primary-foreground shadow-glow"
          : "text-foreground/75 hover:text-foreground hover:bg-foreground/5"
      }`}
    >
      <Icon className="w-[18px] h-[18px]" />
      <span className="text-[9px] sm:text-[10px] font-medium leading-none whitespace-nowrap max-w-[48px] truncate hidden sm:block">
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-foreground text-[9px] font-bold flex items-center justify-center shadow-soft">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      {/* AI popup */}
      <AnimatePresence>
        {aiOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAiOpen(false)}
              className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-3 mx-auto z-50 glass-strong rounded-2xl p-2 flex flex-col gap-1 max-w-[320px] max-h-[55vh] overflow-y-auto"
              style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}
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
              className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed inset-x-3 mx-auto z-50 glass-strong rounded-2xl p-3 flex gap-2 max-w-[360px] overflow-x-auto scrollbar-thin"
              style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}
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

      {/* Centered floating dock */}
      <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none safe-bottom">
        <AnimatePresence mode="wait">
          {collapsed ? (
            <motion.button
              key="collapsed"
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              onClick={() => setCollapsed(false)}
              className="pointer-events-auto mb-3 glass-strong rounded-full px-4 py-2.5 flex items-center gap-2 hover:scale-105 transition-transform"
              aria-label="Expand toolbar"
            >
              <ChevronUp className="w-4 h-4 text-accent" />
              <span className="text-xs font-medium">
                {lang === "fa" ? "ابزارها" : "Tools"}
              </span>
            </motion.button>
          ) : (
            <motion.nav
              key="expanded"
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto mb-3 mx-3 glass-strong rounded-3xl px-1.5 py-1.5 sm:px-2 sm:py-2 flex items-center gap-0.5 sm:gap-1 max-w-[calc(100vw-1.5rem)] overflow-x-auto scrollbar-thin"
            >
              <Item icon={Menu} label={lang === "fa" ? "فصل‌ها" : "Chapters"} onClick={onOpenChapters} />
              <Item icon={Search} label={lang === "fa" ? "جستجو" : "Search"} onClick={onOpenSearch} />
              <Item icon={Sparkles} label={lang === "fa" ? "هوش" : "AI"} onClick={() => setAiOpen((v) => !v)} active={aiOpen} />
              <Item icon={MessageSquare} label={lang === "fa" ? "گفتگو" : "Chat"} onClick={onOpenChat} />
              <Item
                icon={isSpeaking ? VolumeX : Volume2}
                label={isSpeaking ? t("stop") : t("listen")}
                onClick={() => (isSpeaking ? onStopSpeak() : onSpeak())}
                active={isSpeaking}
              />
              <Item icon={BookmarkCheck} label={lang === "fa" ? "نشان‌ها" : "Notes"} onClick={onOpenHighlights} badge={highlightCount} />
              <Item icon={ambient === "off" ? VolumeOff : CloudRain} label={t("ambient")} onClick={() => setAmbOpen((v) => !v)} active={ambient !== "off"} />
              <Item icon={dark ? Sun : Moon} label={dark ? t("light") : t("dark")} onClick={onToggleDark} />
              <Item icon={Settings2} label={t("settings")} onClick={onOpenSettings} />
              <button
                onClick={() => setCollapsed(true)}
                className="ms-1 shrink-0 w-8 h-12 sm:h-14 rounded-xl text-foreground/40 hover:text-foreground hover:bg-foreground/5 flex items-center justify-center"
                aria-label="Collapse"
                title={lang === "fa" ? "جمع کن" : "Collapse"}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
