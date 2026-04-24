import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, BrainCircuit, ListChecks, Lightbulb, Volume2, VolumeX,
  Settings2, Highlighter, Plus, X, Sun, Moon,
  CloudRain, Trees, Coffee, Stars, VolumeOff,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Action {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  color?: string;
}

interface Props {
  onAi: (mode: "summary" | "quiz" | "mindmap" | "explain") => void;
  onSpeak: () => void;
  onStopSpeak: () => void;
  isSpeaking: boolean;
  onToggleHighlight: () => void;
  onToggleSettings: () => void;
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
  onAi, onSpeak, onStopSpeak, isSpeaking, onToggleHighlight,
  onToggleSettings, dark, onToggleDark, ambient, onAmbient,
}: Props) => {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);

  const aiActions: Action[] = [
    { id: "summary", icon: Sparkles, label: t("ai_summary"), onClick: () => { onAi("summary"); setOpen(false); } },
    { id: "quiz", icon: ListChecks, label: t("ai_quiz"), onClick: () => { onAi("quiz"); setOpen(false); } },
    { id: "mindmap", icon: BrainCircuit, label: t("ai_mindmap"), onClick: () => { onAi("mindmap"); setOpen(false); } },
    { id: "explain", icon: Lightbulb, label: t("ai_explain"), onClick: () => { onAi("explain"); setOpen(false); } },
  ];

  const sideActions: Action[] = [
    {
      id: "voice",
      icon: isSpeaking ? VolumeX : Volume2,
      label: isSpeaking ? t("stop") : t("listen"),
      onClick: () => (isSpeaking ? onStopSpeak() : onSpeak()),
    },
    { id: "highlight", icon: Highlighter, label: t("highlight"), onClick: onToggleHighlight },
    { id: "ambient", icon: ambient === "off" ? VolumeOff : CloudRain, label: t("ambient"), onClick: () => setShowAmbient((v) => !v) },
    { id: "theme", icon: dark ? Sun : Moon, label: dark ? t("light") : t("dark"), onClick: onToggleDark },
    { id: "settings", icon: Settings2, label: t("settings"), onClick: onToggleSettings },
  ];

  const side = dir === "rtl" ? "left-6" : "right-6";

  return (
    <>
      {/* Side mini-toolbar (always visible on desktop) */}
      <div className={`fixed top-1/2 -translate-y-1/2 ${side} z-40 hidden md:flex flex-col gap-2 glass-strong rounded-2xl p-2 shadow-book`}>
        {sideActions.map(({ id, icon: Icon, label, onClick }) => (
          <button
            key={id}
            onClick={onClick}
            title={label}
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-accent/20 hover:text-accent transition-all hover:scale-110 group relative"
          >
            <Icon className="w-4 h-4" />
            <span className={`absolute ${dir === "rtl" ? "left-12" : "right-12"} top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-foreground text-background text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity`}>
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Ambient picker popover */}
      <AnimatePresence>
        {showAmbient && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className={`fixed bottom-28 ${dir === "rtl" ? "left-6" : "right-6"} z-50 glass-strong rounded-2xl p-3 shadow-book grid grid-cols-5 gap-2`}
          >
            {ambientOpts.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { onAmbient(id); setShowAmbient(false); }}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                  ambient === id ? "bg-gradient-warm text-primary-foreground shadow-glow" : "hover:bg-accent/20"
                }`}
                title={t(`amb_${id}` as never)}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Button (FAB) - AI menu */}
      <div className={`fixed bottom-6 ${dir === "rtl" ? "left-6" : "right-6"} z-50`}>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-16 end-0 flex flex-col gap-3 items-end"
            >
              {aiActions.map(({ id, icon: Icon, label, onClick }, i) => (
                <motion.button
                  key={id}
                  initial={{ opacity: 0, x: dir === "rtl" ? -20 : 20, scale: 0.7 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: dir === "rtl" ? -20 : 20, scale: 0.7 }}
                  transition={{ duration: 0.25, delay: i * 0.05 }}
                  onClick={onClick}
                  className="flex items-center gap-3 glass-strong rounded-full ps-4 pe-2 py-2 shadow-book hover:shadow-glow hover:bg-accent/20 transition-all group"
                >
                  <span className="text-sm font-medium whitespace-nowrap">{label}</span>
                  <span className="w-9 h-9 rounded-full bg-gradient-warm flex items-center justify-center text-primary-foreground group-hover:scale-110 transition-transform">
                    <Icon className="w-4 h-4" />
                  </span>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => setOpen(!open)}
          whileTap={{ scale: 0.92 }}
          animate={{ rotate: open ? 135 : 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="w-14 h-14 rounded-full bg-gradient-warm shadow-glow flex items-center justify-center text-primary-foreground relative overflow-hidden"
          aria-label="AI menu"
        >
          <motion.div
            className="absolute inset-0 bg-gradient-gold opacity-0"
            animate={{ opacity: open ? 0.5 : 0 }}
          />
          {open ? <X className="w-6 h-6 relative" /> : <Sparkles className="w-6 h-6 relative" />}
          {!open && (
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-accent"
              animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
        </motion.button>
      </div>
    </>
  );
};
