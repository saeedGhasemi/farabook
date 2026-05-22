import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useI18n } from "@/lib/i18n";

export const OfflineBanner = () => {
  const { offline } = useNetworkStatus();
  const { lang } = useI18n();
  if (!offline) return null;
  return (
    <div className="sticky top-16 z-40 w-full bg-amber-500/15 border-b border-amber-500/30 backdrop-blur-sm">
      <div className="container py-2 flex items-center justify-center gap-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          {lang === "fa"
            ? "حالت آفلاین — فقط کتاب‌های دانلودشده و قابلیت‌های آفلاین در دسترس‌اند."
            : "Offline mode — only downloaded books and offline features are available."}
        </span>
      </div>
    </div>
  );
};
