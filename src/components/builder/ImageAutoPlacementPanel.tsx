// Auto-fills `image_placeholder` slots in a book by re-extracting media
// from the original .docx upload (kept in book-uploads bucket). Calls the
// `docx-image-fill` edge function in batches and shows live progress + a
// per-failure retry list.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImageIcon, Loader2, RefreshCw, X, CheckCircle2, AlertTriangle, PlayCircle, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Failure {
  slot: number;
  reason: string;
  originalPath: string;
}

interface Props {
  bookId: string;
  importId?: string;
  totalPlaceholders?: number;
  onClose: () => void;
  /** Called when a batch persisted images so the editor can refresh content. */
  onBatchApplied?: () => void;
}

export const ImageAutoPlacementPanel = ({ bookId, importId, totalPlaceholders, onClose, onBatchApplied }: Props) => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(totalPlaceholders ?? 0);
  const [filled, setFilled] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [nextSlot, setNextSlot] = useState<number | null>(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [batchSize] = useState(20);
  const stopRef = useRef(false);

  // Pull initial total from the panel caller; if missing try to load fresh count.
  useEffect(() => {
    if (totalPlaceholders) setTotal(totalPlaceholders);
  }, [totalPlaceholders]);

  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;

  const runOne = async (start: number) => {
    const { data, error } = await supabase.functions.invoke("docx-image-fill", {
      body: { bookId, importId, batchSize, startSlot: start },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as {
      done: boolean;
      totalSlots: number;
      processed: number;
      filled: number;
      failures: Failure[];
      nextStartSlot: number | null;
    };
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    setDone(false);
    stopRef.current = false;
    let cur = nextSlot ?? 0;
    let totalFilled = filled;
    let totalProcessed = processed;
    let allFailures = [...failures];
    try {
      // First batch establishes the actual total
      while (true) {
        if (stopRef.current) break;
        const r = await runOne(cur);
        setTotal(r.totalSlots);
        totalFilled += r.filled;
        totalProcessed += r.processed;
        allFailures = [...allFailures, ...r.failures];
        setFilled(totalFilled);
        setProcessed(totalProcessed);
        setFailures(allFailures);
        onBatchApplied?.();
        if (r.done || r.nextStartSlot == null) {
          setNextSlot(null);
          setDone(true);
          break;
        }
        cur = r.nextStartSlot;
        setNextSlot(cur);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در جایگذاری");
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    stopRef.current = true;
    setRunning(false);
  };

  const retryFailures = async () => {
    if (!failures.length) return;
    setRunning(true);
    try {
      const slots = [...failures].sort((a, b) => a.slot - b.slot);
      const stillFailing: Failure[] = [];
      let extraFilled = 0;
      for (const f of slots) {
        if (stopRef.current) break;
        // Process a batch starting JUST BEFORE this slot, so the function
        // picks it as the first remaining slot for this book.
        const r = await runOne(Math.max(0, f.slot - 1));
        extraFilled += r.filled;
        const nextFails = r.failures.filter((nf) => nf.slot === f.slot);
        if (nextFails.length) stillFailing.push(...nextFails);
      }
      setFilled((v) => v + extraFilled);
      setFailures(stillFailing);
      onBatchApplied?.();
      if (extraFilled > 0) toast.success(`${extraFilled} تصویر در تلاش مجدد جای‌گذاری شد`);
      if (stillFailing.length) toast.warning(`${stillFailing.length} تصویر همچنان قابل جایگذاری نیست`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در تلاش مجدد");
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      className="lg:sticky lg:top-20 lg:self-start space-y-3 rounded-2xl border bg-card/80 p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-accent" />
          جایگذاری خودکار تصاویر
        </h3>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </header>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        تصاویر فایل اصلی Word شما استخراج و در همان جایگاه‌های اصلی درج می‌شوند.
        پس از پایان می‌توانید هر تصویر را تأیید یا تعویض کنید.
      </p>

      {total > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{filled} از {total}</span>
            <span className="tabular-nums font-medium">{pct}٪</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">برای شروع روی «اجرا» بزنید…</div>
      )}

      <div className="flex flex-wrap gap-2">
        {!running && !done && (
          <Button size="sm" onClick={start}>
            <PlayCircle className="w-4 h-4 me-1" />
            {filled > 0 ? "ادامه" : "اجرا"}
          </Button>
        )}
        {running && (
          <Button size="sm" variant="outline" onClick={stop}>
            <PauseCircle className="w-4 h-4 me-1" /> توقف
          </Button>
        )}
        {done && (
          <div className="text-[12px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> پایان یافت
          </div>
        )}
        {failures.length > 0 && !running && (
          <Button size="sm" variant="ghost" onClick={retryFailures}>
            <RefreshCw className="w-4 h-4 me-1" />
            تلاش مجدد ({failures.length})
          </Button>
        )}
      </div>

      {failures.length > 0 && (
        <div className="space-y-1 max-h-[40vh] overflow-y-auto pe-1 border-t pt-2">
          <div className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {failures.length} تصویر جایگذاری نشد
          </div>
          {failures.slice(0, 50).map((f) => (
            <div key={`${f.slot}-${f.originalPath}`} className="text-[10px] rounded border border-amber-500/30 bg-amber-500/5 p-1.5">
              <div className="font-mono">تصویر {f.slot}</div>
              <div className="opacity-70 break-all">{f.originalPath}</div>
              <div className="opacity-70">{f.reason}</div>
            </div>
          ))}
          {failures.length > 50 && (
            <div className="text-[10px] text-muted-foreground">…و {failures.length - 50} مورد دیگر</div>
          )}
        </div>
      )}

      {running && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          در حال پردازش گروهی (هر بار {batchSize} تصویر)…
        </div>
      )}
    </motion.aside>
  );
};
