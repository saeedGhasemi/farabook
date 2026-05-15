import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { LockState } from "@/lib/offline/ReadingLockManager";

interface Props {
  state: LockState;
  onReclaim: () => void;
}

/**
 * Full-screen overlay shown when this device's reading session was taken
 * over by another device. Allows the user to reclaim the session here
 * (which will lock out the other device on its next heartbeat / realtime
 * update).
 */
export function ReadingLockOverlay({ state, onReclaim }: Props) {
  const { lang } = useI18n();
  if (state.kind !== "stolen") return null;

  const fa = lang === "fa";
  const where = state.byDeviceLabel
    ? (fa ? `«${state.byDeviceLabel}»` : `"${state.byDeviceLabel}"`)
    : (fa ? "دستگاه دیگری" : "another device");

  return (
    <div className="fixed inset-0 z-[120] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
      <div className="paper-card rounded-3xl p-8 max-w-md text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center">
          <Lock className="w-7 h-7 text-destructive" />
        </div>
        <h2 className="text-2xl font-display font-bold">
          {fa ? "این کتاب در دستگاه دیگری باز شد" : "Opened on another device"}
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          {fa
            ? `این حساب همین لحظه روی ${where} مشغول خواندن این کتاب است. در هر لحظه فقط یک دستگاه می‌تواند یک کتاب را بخواند.`
            : `Your account is currently reading this book on ${where}. Only one device may read a book at a time.`}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={onReclaim} className="bg-gradient-warm hover:opacity-90">
            <RefreshCw className="w-4 h-4 me-2" />
            {fa ? "ادامه خواندن در این دستگاه" : "Continue here"}
          </Button>
          <Button variant="outline" onClick={() => window.history.back()}>
            {fa ? "بازگشت" : "Go back"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {fa
            ? "هایلایت‌ها و پیشرفت شما همگام‌سازی می‌شوند."
            : "Your highlights and progress stay in sync."}
        </p>
      </div>
    </div>
  );
}
