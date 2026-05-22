import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { PWA_ENABLED } from "@/lib/pwa/registerSW";

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true);

export const InstallAppButton = () => {
  const { lang } = useI18n();
  const [available, setAvailable] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!PWA_ENABLED || isStandalone()) return;

    // iOS never fires beforeinstallprompt — show the button anyway so users
    // can reach the /install guide.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    if (isIOS) setAvailable(true);

    const handler = (e: Event) => { e.preventDefault(); setAvailable(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Pulse a few times on mount to grab user's attention, then stop.
  useEffect(() => {
    if (!available) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 6000); // ~3 pulses
    return () => clearTimeout(t);
  }, [available]);

  if (!available) return null;
  return (
    <Link to="/install" className="relative inline-flex">
      {pulse && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md bg-accent/50 animate-ping"
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        className={`relative gap-1.5 ${pulse ? "ring-2 ring-accent/70 shadow-[0_0_18px_hsl(var(--accent)/0.55)] animate-pulse" : ""}`}
        title={lang === "fa" ? "نصب اپ" : "Install app"}
      >
        <Download className="w-4 h-4" />
        <span className="hidden lg:inline">{lang === "fa" ? "نصب اپ" : "Install"}</span>
      </Button>
    </Link>
  );
};
