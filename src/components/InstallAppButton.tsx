import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { PWA_ENABLED } from "@/lib/pwa/registerSW";
import { toast } from "@/hooks/use-toast";

import { isLikelyInstalled, isStandaloneDisplay, markInstalled, checkInstalledViaRelatedApps } from "@/lib/pwa/installState";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

const detectPlatform = (): "ios" | "android" | "windows" | "other" => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
};

const detectBrowser = (): "chrome" | "edge" | "safari" | "firefox" | "samsung" | "other" => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//i.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/Chrome|CriOS/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return "other";
};

export const InstallAppButton = ({ forceShow = false }: { forceShow?: boolean } = {}) => {
  const { lang } = useI18n();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [visible, setVisible] = useState(forceShow);
  const [pulse, setPulse] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!PWA_ENABLED) return;
    const alreadyInstalled = isStandaloneDisplay() || isLikelyInstalled();
    setInstalled(alreadyInstalled);
    if (!forceShow && alreadyInstalled) return;

    const platform = detectPlatform();
    if (platform === "ios" || forceShow) setVisible(true);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      markInstalled();
      setInstalled(true);
      setDeferred(null);
      if (!forceShow) setVisible(false);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);

    void checkInstalledViaRelatedApps().then((yes) => {
      if (yes) {
        setInstalled(true);
        if (!forceShow) setVisible(false);
      }
    });

    const t = window.setTimeout(() => {
      if (forceShow) { setVisible(true); return; }
      if (!isStandaloneDisplay() && !isLikelyInstalled()) setVisible(true);
    }, 1500);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(t);
    };
  }, [forceShow]);

  // Pulse every refresh until the app is installed.
  useEffect(() => {
    if (!visible || installed) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 8000);
    return () => clearTimeout(t);
  }, [visible, installed]);

  const handleClick = async (e: React.MouseEvent) => {
    // If we have a native prompt, run it directly — no navigation.
    if (deferred) {
      e.preventDefault();
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") {
          markInstalled();
          setVisible(false);
        }
      } catch { /* ignore */ }
      setDeferred(null);
      return;
    }

    const platform = detectPlatform();
    const browser = detectBrowser();

    // iOS Safari — no programmatic install, send to guide page
    if (platform === "ios") return; // Link will navigate to /install

    // Browsers that cannot install PWAs — tell user to switch browser
    const cannotInstall =
      browser === "firefox" ||
      browser === "safari" || // non-iOS Safari = macOS, install not supported the same way
      browser === "other";

    if (cannotInstall) {
      e.preventDefault();
      const url = typeof window !== "undefined" ? window.location.href : "";
      try {
        await navigator.clipboard?.writeText(url);
      } catch { /* ignore */ }
      toast({
        title: lang === "fa" ? "این مرورگر از نصب پشتیبانی نمی‌کند" : "Browser cannot install apps",
        description:
          lang === "fa"
            ? `لطفاً این آدرس را در ${platform === "android" ? "Chrome" : "Edge یا Chrome"} باز کنید و مراحل نصب را دنبال کنید. لینک کپی شد.`
            : `Please open this URL in ${platform === "android" ? "Chrome" : "Edge or Chrome"} and follow the install steps. Link copied.`,
      });
      return;
    }

    // Chrome/Edge but event hasn't fired yet — go to /install guide
  };

  if (!visible) return null;

  return (
    <Link to="/install" onClick={handleClick} className="relative inline-flex">
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
