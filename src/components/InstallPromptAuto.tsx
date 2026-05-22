import { useEffect, useState } from "react";
import { Download, X, Smartphone, Apple, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { PWA_ENABLED } from "@/lib/pwa/registerSW";

import { isLikelyInstalled, isStandaloneDisplay, markInstalled, checkInstalledViaRelatedApps } from "@/lib/pwa/installState";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

const STORAGE_KEY = "farabook.installPrompt.dismissedAt";
const REPROMPT_DAYS = 7;

const detectPlatform = (): "ios" | "android" | "windows" | "other" => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
};

const wasRecentlyDismissed = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return false;
    const ts = Number(v);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < REPROMPT_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

export const InstallPromptAuto = () => {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "windows" | "other">("other");

  useEffect(() => {
    if (!PWA_ENABLED) return;
    if (isStandaloneDisplay() || isLikelyInstalled()) return;
    if (wasRecentlyDismissed()) return;

    const plat = detectPlatform();
    setPlatform(plat);

    // Probe for sibling installed PWA before showing anything.
    void checkInstalledViaRelatedApps().then((yes) => { if (yes) setOpen(false); });

    // Android / Desktop Chrome / Edge — wait for the native event
    const bipHandler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setTimeout(() => { if (!isLikelyInstalled()) setOpen(true); }, 1200);
    };
    window.addEventListener("beforeinstallprompt", bipHandler);

    // iOS never fires beforeinstallprompt → show manual guide after a short delay
    let iosTimer: number | undefined;
    if (plat === "ios") {
      iosTimer = window.setTimeout(() => setOpen(true), 1500);
    }

    const installedHandler = () => {
      markInstalled();
      setOpen(false);
      setDeferred(null);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", bipHandler);
      window.removeEventListener("appinstalled", installedHandler);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
  };

  const triggerNativeInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") markInstalled();
    } catch { /* ignore */ }
    setDeferred(null);
    setOpen(false);
  };

  const Icon = platform === "ios" ? Apple : platform === "windows" ? Monitor : Smartphone;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow">
              <Download className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="font-display">
                {lang === "fa" ? "فرابوک را نصب کنید" : "Install Farabook"}
              </DialogTitle>
              <DialogDescription>
                {lang === "fa"
                  ? "برای خواندن آفلاین کتاب‌ها، فرابوک را روی دستگاه نصب کنید."
                  : "Install Farabook to read your books offline on this device."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed">
          {platform === "ios" && (
            <div className="glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Apple className="w-4 h-4" /> iOS — Safari
              </div>
              <p>۱. {lang === "fa" ? "روی دکمهٔ Share ⎘ پایین صفحه بزنید." : "Tap the Share ⎘ button at the bottom."}</p>
              <p>۲. {lang === "fa" ? "گزینهٔ «Add to Home Screen» را انتخاب کنید." : "Choose \"Add to Home Screen\"."}</p>
              <p>۳. {lang === "fa" ? "روی Add بزنید تا اپ به صفحهٔ اصلی اضافه شود." : "Tap Add to place the app on your Home Screen."}</p>
            </div>
          )}

          {platform === "android" && (
            <div className="glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Smartphone className="w-4 h-4" /> Android — Chrome
              </div>
              {deferred ? (
                <p>{lang === "fa" ? "روی دکمهٔ «نصب اپ» بزنید تا فرابوک نصب شود." : "Tap \"Install App\" to install Farabook."}</p>
              ) : (
                <>
                  <p>۱. {lang === "fa" ? "از منوی ⋮ گزینهٔ «Install app» را بزنید." : "Open the ⋮ menu and pick \"Install app\"."}</p>
                  <p>۲. {lang === "fa" ? "یا «Add to Home screen» را انتخاب کنید." : "Or choose \"Add to Home screen\"."}</p>
                </>
              )}
            </div>
          )}

          {platform === "windows" && (
            <div className="glass rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Monitor className="w-4 h-4" /> Windows — Edge / Chrome
              </div>
              {deferred ? (
                <p>{lang === "fa" ? "روی «نصب اپ» بزنید تا فرابوک به ویندوز اضافه شود." : "Click \"Install App\" to add Farabook to Windows."}</p>
              ) : (
                <>
                  <p>۱. {lang === "fa" ? "آیکن «نصب» در نوار آدرس را بزنید." : "Click the install icon in the address bar."}</p>
                  <p>۲. {lang === "fa" ? "یا از منو → Apps → Install Farabook." : "Or Menu → Apps → Install Farabook."}</p>
                </>
              )}
            </div>
          )}

          {platform === "other" && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Icon className="w-4 h-4" /> {lang === "fa" ? "نصب اپ" : "Install App"}
              </div>
              <p>{lang === "fa" ? "از منوی مرورگر گزینهٔ «Install» یا «Add to Home Screen» را انتخاب کنید." : "From your browser menu pick \"Install\" or \"Add to Home Screen\"."}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-2">
          <Button variant="ghost" onClick={dismiss} className="sm:flex-1">
            <X className="w-4 h-4 me-1" />
            {lang === "fa" ? "بعداً" : "Later"}
          </Button>
          {deferred && (
            <Button onClick={triggerNativeInstall} className="sm:flex-1 bg-gradient-warm">
              <Download className="w-4 h-4 me-1" />
              {lang === "fa" ? "نصب اپ" : "Install App"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
