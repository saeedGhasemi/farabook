// Small inline button shown on each library card. Triggers an encrypted
// download into the local SQLCipher/IndexedDB store and shows live progress.
// Tapping again while downloading is a no-op (handled by single-flight in store).
// Tapping when "ready" opens a confirm to remove the local copy.

import { useEffect, useState } from "react";
import { Download, Check, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { useOfflineDownload } from "@/hooks/useOfflineDownload";
import { useI18n } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logClientError } from "@/lib/error-logger";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, getDeviceLabel } from "@/lib/offline/deviceId";
import { BookDevicesPanel } from "@/components/profile/BookDevicesPanel";

interface Props {
  bookId: string;
  userId: string | undefined;
}

export function OfflineBookButton({ bookId, userId }: Props) {
  const { lang } = useI18n();
  const { state, percent, download, remove } = useOfflineDownload(bookId, userId);
  const [nameDialog, setNameDialog] = useState(false);
  const [devicesDialog, setDevicesDialog] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [currentDeviceName, setCurrentDeviceName] = useState("");
  const [knownNames, setKnownNames] = useState<string[]>([]);

  const hydrateDeviceName = async () => {
    if (!userId) return { names: [] as string[], primary: getDeviceLabel() };
    const did = await getDeviceId();
    const fallback = getDeviceLabel();
    const { data } = await supabase
      .from("user_offline_devices")
      .select("device_label")
      .eq("user_id", userId)
      .eq("device_id", did)
      .not("device_label", "is", null)
      .order("last_seen_at", { ascending: false });
    const names = Array.from(new Set(((data as Array<{ device_label: string | null }> | null) ?? [])
      .map((d) => d.device_label?.trim()).filter(Boolean) as string[]));
    const primary = names[0] || fallback;
    setKnownNames(names);
    setDeviceName(primary);
    setCurrentDeviceName(primary);
    return { names, primary };
  };

  useEffect(() => { void hydrateDeviceName(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    if (state.status === "ready") { setDevicesDialog(true); return; }
    if (state.status === "downloading") return;
    const { names, primary } = await hydrateDeviceName();
    if (names.length > 0) {
      await startDownload(primary);
      return;
    }
    setNameDialog(true);
  };

  const startDownload = async (preferredLabel?: string) => {
    if (!userId) return;
    const label = ((preferredLabel ?? deviceName).trim() || getDeviceLabel()).slice(0, 60);
    setCurrentDeviceName(label);
    setNameDialog(false);
    try {
      await download(label);
      toast.success(lang === "fa" ? "برای آفلاین ذخیره شد" : "Saved for offline");
      await hydrateDeviceName();
      setDevicesDialog(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : null;
      // Log failed offline download attempts so the admin can triage them.
      logClientError({
        source: "offline-download",
        message: raw,
        stack,
        context: { bookId, userId },
      });
      const map: Record<string, { fa: string; en: string }> = {
        device_limit_reached: {
          fa: "سقف ۲ دستگاه آفلاین برای این کتاب پر است. یکی از دستگاه‌های همین کتاب را حذف کنید.",
          en: "This book has reached the 2-device offline limit. Remove one of this book's devices first.",
        },
        not_owned: { fa: "این کتاب در کتابخانه شما نیست.", en: "This book isn't in your library." },
        unauthorized: { fa: "ابتدا وارد حساب خود شوید.", en: "Please sign in first." },
        book_not_found: { fa: "کتاب پیدا نشد.", en: "Book not found." },
        missing_params: { fa: "خطای داخلی. دوباره تلاش کنید.", en: "Internal error. Please retry." },
      };
      const msg = map[raw] ? map[raw][lang] : raw;
      if (raw === "device_limit_reached") {
        toast.error(msg, {
          duration: 10000,
          action: {
            label: lang === "fa" ? "دستگاه‌های این کتاب" : "Book devices",
            onClick: () => setDevicesDialog(true),
          },
        });
      } else {
        toast.error(msg);
      }
    }
  };

  const onConfirmRemove = async () => {
    if (userId) {
      const did = await getDeviceId();
      await supabase.from("user_offline_devices")
        .delete()
        .eq("user_id", userId)
        .eq("book_id", bookId)
        .eq("device_id", did);
    }
    await remove();
    setDevicesDialog(false);
    toast.success(lang === "fa" ? "نسخه آفلاین حذف شد" : "Offline copy removed");
  };

  const label = (() => {
    if (state.status === "downloading") return lang === "fa" ? "در حال دانلود…" : "Downloading…";
    if (state.status === "ready") return lang === "fa" ? "آفلاین آماده است" : "Saved offline";
    if (state.status === "failed") return lang === "fa" ? "ناموفق - تلاش دوباره" : "Failed - retry";
    if (state.status === "stale") return lang === "fa" ? "نسخه جدید موجود است" : "Update available";
    return lang === "fa" ? "ذخیره برای آفلاین" : "Save offline";
  })();

  const Icon = state.status === "ready" ? Check
    : state.status === "failed" ? AlertTriangle
    : Download;
  const displayPercent = state.status === "downloading" ? (percent ?? 0) : null;
  const ringValue = state.status === "downloading" ? Math.max(0, Math.min(100, displayPercent ?? 0)) : state.status === "ready" ? 100 : 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn(
              "absolute top-2 end-2 h-8 w-8 rounded-full p-0 border bg-background/90 backdrop-blur",
              "grid place-items-center text-[10px] font-medium transition hover:bg-background shadow-soft overflow-hidden",
              (state.status === "downloading" || state.status === "ready") && "border-stage-published text-stage-published",
              state.status === "failed" && "border-destructive/40 text-destructive",
              state.status === "stale" && "border-accent/60 text-accent",
            )}
            style={state.status === "downloading" || state.status === "ready" ? {
              background: `conic-gradient(hsl(var(--stage-published)) ${ringValue * 3.6}deg, hsl(var(--border)) 0deg)`,
            } : undefined}
          >
            <span className="absolute inset-[3px] rounded-full bg-background/95 grid place-items-center">
              {state.status === "downloading" ? (
                <span className="text-[9px] font-bold tabular-nums">{displayPercent}</span>
              ) : (
                <Icon className="w-3.5 h-3.5" />
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>

      <Dialog open={nameDialog} onOpenChange={setNameDialog}>
        <DialogContent className="max-w-md" dir={lang === "fa" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{lang === "fa" ? "نام این دستگاه" : "Name this device"}</DialogTitle>
            <DialogDescription>
              {lang === "fa"
                ? "قبل از آفلاین کردن کتاب، نامی بگذارید تا بعداً بدانید این نسخه روی کدام دستگاه است."
                : "Add a friendly name so you can recognize where this offline copy is stored."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={60}
              placeholder={lang === "fa" ? "مثلاً: آیفون من" : "e.g. My iPhone"} />
            {knownNames.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {knownNames.map((n) => (
                  <Badge key={n} variant="outline" role="button" tabIndex={0}
                    onClick={() => setDeviceName(n)} className="cursor-pointer">
                    {n}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialog(false)}>{lang === "fa" ? "انصراف" : "Cancel"}</Button>
            <Button onClick={() => startDownload()} className="gap-2">
              {state.status === "downloading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {lang === "fa" ? "شروع دانلود" : "Start download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={devicesDialog} onOpenChange={setDevicesDialog}>
        <DialogContent className="max-w-2xl" dir={lang === "fa" ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{lang === "fa" ? "وضعیت آفلاین این کتاب" : "This book's offline devices"}</DialogTitle>
            <DialogDescription>
              {state.status === "ready" && currentDeviceName
                ? (lang === "fa"
                  ? `نسخه آفلاین این کتاب روی «${currentDeviceName}» آماده است.`
                  : `This offline copy is ready on “${currentDeviceName}”.`)
                : (lang === "fa"
                  ? "اینجا فقط دستگاه‌های همین کتاب را می‌بینید؛ حذف، فقط نسخه آفلاین همین کتاب را آزاد می‌کند."
                  : "Only this book's devices are shown here; removing releases this book's offline slot.")}
            </DialogDescription>
          </DialogHeader>
          <BookDevicesPanel bookId={bookId} />
          {state.status === "ready" && (
            <DialogFooter>
              <Button variant="destructive" onClick={onConfirmRemove} className="gap-2">
                <Trash2 className="w-4 h-4" />
                {lang === "fa" ? "حذف نسخه از همین دستگاه" : "Remove from this device"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
