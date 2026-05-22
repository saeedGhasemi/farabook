import { useEffect, useState } from "react";
import { Smartphone, Monitor, Apple, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { PWA_ENABLED } from "@/lib/pwa/registerSW";

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

const Install = () => {
  const { lang } = useI18n();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const triggerInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const r = await deferred.userChoice;
    if (r.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)] max-w-3xl">
      <h1 className="text-3xl md:text-4xl font-display font-bold mb-3">
        {lang === "fa" ? "نصب فرابوک" : "Install Farabook"}
      </h1>
      <p className="text-muted-foreground mb-8">
        {lang === "fa"
          ? "فرابوک را روی موبایل، تبلت یا ویندوز نصب کنید تا کتاب‌های آفلاین خود را حتی بدون اینترنت بخوانید."
          : "Install Farabook on mobile, tablet or Windows to read your offline books without internet."}
      </p>

      {deferred && !installed && (
        <div className="glass-strong rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Download className="w-8 h-8 text-accent shrink-0" />
          <div className="flex-1">
            <h3 className="font-display font-semibold mb-1">
              {lang === "fa" ? "اپ آماده نصب است" : "App ready to install"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {lang === "fa" ? "روی دکمه بزنید تا فرابوک به دستگاه شما اضافه شود." : "Tap the button to add Farabook to your device."}
            </p>
          </div>
          <Button onClick={triggerInstall} className="bg-gradient-warm">
            {lang === "fa" ? "نصب اپ" : "Install App"}
          </Button>
        </div>
      )}

      {installed && (
        <div className="glass rounded-2xl p-6 mb-8 text-center text-green-700 dark:text-green-300">
          ✓ {lang === "fa" ? "فرابوک با موفقیت نصب شد." : "Farabook installed successfully."}
        </div>
      )}

      {!PWA_ENABLED && (
        <div className="glass rounded-2xl p-4 mb-8 text-sm text-amber-700 dark:text-amber-300">
          {lang === "fa"
            ? "نصب فقط روی نسخهٔ منتشرشده (farabook.lovable.app) فعال است؛ در پیش‌نمایش غیرفعال است."
            : "Install is only available on the published site (farabook.lovable.app); disabled in preview."}
        </div>
      )}

      <Tabs defaultValue="android" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="android" className="gap-2"><Smartphone className="w-4 h-4" /> Android</TabsTrigger>
          <TabsTrigger value="ios" className="gap-2"><Apple className="w-4 h-4" /> iOS</TabsTrigger>
          <TabsTrigger value="windows" className="gap-2"><Monitor className="w-4 h-4" /> Windows</TabsTrigger>
        </TabsList>
        <TabsContent value="android" className="glass rounded-2xl p-6 mt-4 space-y-2 text-sm leading-relaxed">
          <p>۱. {lang === "fa" ? "سایت را در Chrome باز کنید." : "Open this site in Chrome."}</p>
          <p>۲. {lang === "fa" ? "از منوی سه‌نقطه ⋮ گزینهٔ «Install app» یا «افزودن به صفحهٔ اصلی» را بزنید." : "From the ⋮ menu pick \"Install app\" or \"Add to Home screen\"."}</p>
          <p>۳. {lang === "fa" ? "اپ از روی صفحهٔ اصلی مانند یک اپ بومی باز می‌شود و آفلاین کار می‌کند." : "The app opens from the home screen like a native app and works offline."}</p>
        </TabsContent>
        <TabsContent value="ios" className="glass rounded-2xl p-6 mt-4 space-y-2 text-sm leading-relaxed">
          <p>۱. {lang === "fa" ? "سایت را در Safari باز کنید (Chrome iOS پشتیبانی نمی‌کند)." : "Open in Safari (Chrome iOS not supported)."}</p>
          <p>۲. {lang === "fa" ? "روی دکمهٔ Share ⎘ بزنید." : "Tap the Share ⎘ button."}</p>
          <p>۳. {lang === "fa" ? "«Add to Home Screen» را انتخاب کنید." : "Choose \"Add to Home Screen\"."}</p>
        </TabsContent>
        <TabsContent value="windows" className="glass rounded-2xl p-6 mt-4 space-y-2 text-sm leading-relaxed">
          <p>۱. {lang === "fa" ? "سایت را در Edge یا Chrome باز کنید." : "Open in Edge or Chrome."}</p>
          <p>۲. {lang === "fa" ? "آیکن «نصب اپ» در نوار آدرس (سمت راست) را بزنید، یا از منو → Apps → Install Farabook." : "Click the install icon in the address bar, or Menu → Apps → Install Farabook."}</p>
          <p>۳. {lang === "fa" ? "اپ مانند یک نرم‌افزار ویندوز در Start menu قرار می‌گیرد." : "The app appears in the Start menu like a native Windows app."}</p>
        </TabsContent>
      </Tabs>
    </main>
  );
};

export default Install;
