// Small inline button shown on each library card. Triggers an encrypted
// download into the local SQLCipher/IndexedDB store and shows live progress.
// Tapping again while downloading is a no-op (handled by single-flight in store).
// Tapping when "ready" opens a confirm to remove the local copy.

import { useState } from "react";
import { Download, Check, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { useOfflineDownload } from "@/hooks/useOfflineDownload";
import { useI18n } from "@/lib/i18n";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  bookId: string;
  userId: string | undefined;
}

export function OfflineBookButton({ bookId, userId }: Props) {
  const { lang } = useI18n();
  const { state, percent, download, remove } = useOfflineDownload(bookId, userId);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    if (state.status === "ready") { setConfirmRemove(true); return; }
    if (state.status === "downloading") return;
    try {
      await download();
      toast.success(lang === "fa" ? "برای آفلاین ذخیره شد" : "Saved for offline");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const map: Record<string, { fa: string; en: string }> = {
        device_limit_reached: {
          fa: "سقف ۲ دستگاه آفلاین پر است. ابتدا یک دستگاه را از پروفایل → دستگاه‌های آفلاین حذف کنید.",
          en: "You've reached the 2-device offline limit. Remove a device from Profile → Offline devices first.",
        },
        not_owned: { fa: "این کتاب در کتابخانه شما نیست.", en: "This book isn't in your library." },
        unauthorized: { fa: "ابتدا وارد حساب خود شوید.", en: "Please sign in first." },
        book_not_found: { fa: "کتاب پیدا نشد.", en: "Book not found." },
        missing_params: { fa: "خطای داخلی. دوباره تلاش کنید.", en: "Internal error. Please retry." },
      };
      const msg = map[raw] ? map[raw][lang] : raw;
      toast.error(msg);
    }
  };




  const onConfirmRemove = async () => {
    await remove();
    setConfirmRemove(false);
    toast.success(lang === "fa" ? "نسخه آفلاین حذف شد" : "Offline copy removed");
  };

  const label = (() => {
    if (state.status === "downloading") return lang === "fa" ? "در حال دانلود…" : "Downloading…";
    if (state.status === "ready") return lang === "fa" ? "آفلاین آماده است" : "Saved offline";
    if (state.status === "failed") return lang === "fa" ? "ناموفق - تلاش دوباره" : "Failed - retry";
    if (state.status === "stale") return lang === "fa" ? "نسخه جدید موجود است" : "Update available";
    return lang === "fa" ? "ذخیره برای آفلاین" : "Save offline";
  })();

  const Icon = state.status === "downloading" ? Loader2
    : state.status === "ready" ? Check
    : state.status === "failed" ? AlertTriangle
    : Download;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn(
              "absolute top-2 end-2 h-7 px-2 rounded-full border bg-background/90 backdrop-blur",
              "flex items-center gap-1 text-[10px] font-medium transition hover:bg-background",
              state.status === "ready" && "border-primary/40 text-primary",
              state.status === "failed" && "border-destructive/40 text-destructive",
              state.status === "stale" && "border-accent/60 text-accent",
            )}
          >
            <Icon className={cn("w-3.5 h-3.5", state.status === "downloading" && "animate-spin")} />
            {state.status === "downloading" && percent != null && (
              <span>{percent}%</span>
            )}
            {state.status === "ready" && (
              <span className="hidden sm:inline">{lang === "fa" ? "آفلاین" : "Offline"}</span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>

      {state.status === "downloading" && percent != null && (
        <Progress value={percent} className="absolute bottom-0 inset-x-0 h-0.5 rounded-none" />
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "fa" ? "حذف نسخه آفلاین" : "Remove offline copy"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "fa"
                ? "این عمل فقط نسخه ذخیره‌شده روی این دستگاه را حذف می‌کند. کتاب در کتابخانه شما باقی می‌ماند و یک اسلات آفلاین آزاد می‌شود."
                : "This only removes the copy stored on this device. The book stays in your library and one offline slot will be freed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "fa" ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Trash2 className="w-4 h-4 me-1" />
              {lang === "fa" ? "حذف" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
