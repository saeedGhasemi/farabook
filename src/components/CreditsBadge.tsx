import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useI18n } from "@/lib/i18n";
import { CREDITS_PULSE_EVENT, type CreditsPulseDetail } from "@/lib/credits-bus";

/**
 * Navbar credits chip. Pulses + shows a floating delta on `credits:pulse`.
 */
export const CreditsBadge = () => {
  const { user } = useAuth();
  const { credits } = useCredits();
  const { lang } = useI18n();
  const nav = useNavigate();
  const [pulse, setPulse] = useState(0);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CreditsPulseDetail>).detail;
      if (!detail) return;
      setPulse((n) => n + 1);
      setDelta(detail.delta);
      const t = setTimeout(() => setDelta(null), 1800);
      return () => clearTimeout(t);
    };
    window.addEventListener(CREDITS_PULSE_EVENT, handler);
    return () => window.removeEventListener(CREDITS_PULSE_EVENT, handler);
  }, []);

  if (!user) return null;

  const fmt = (n: number) => Number(n).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
  const label = lang === "fa" ? "اعتبار" : "Credits";

  return (
    <button
      onClick={() => nav("/credits")}
      title={label}
      aria-label={label}
      className="relative hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl glass border border-border/40 hover:bg-secondary/60 transition-colors"
    >
      <motion.span
        key={pulse}
        initial={{ scale: 1 }}
        animate={{ scale: pulse ? [1, 1.4, 1] : 1, rotate: pulse ? [0, -12, 12, 0] : 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-warm text-primary-foreground"
      >
        <Coins className="w-3 h-3" />
      </motion.span>
      <motion.span
        key={`v-${pulse}`}
        initial={{ scale: 1 }}
        animate={{ scale: pulse ? [1, 1.15, 1] : 1 }}
        transition={{ duration: 0.5 }}
        className="text-sm font-semibold tabular-nums gold-text"
      >
        {fmt(credits)}
      </motion.span>

      <AnimatePresence>
        {delta != null && (
          <motion.span
            key={`d-${pulse}`}
            initial={{ opacity: 0, y: 4, scale: 0.85 }}
            animate={{ opacity: 1, y: -22, scale: 1 }}
            exit={{ opacity: 0, y: -32 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            className={`pointer-events-none absolute -top-1 ${
              lang === "fa" ? "left-1" : "right-1"
            } text-xs font-bold ${delta < 0 ? "text-destructive" : "text-emerald-500"}`}
          >
            {delta > 0 ? "+" : ""}
            {fmt(delta)}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
};
