// Floating panel that shows the live state of background image uploads.
// Mounted once at the app root so it persists across route changes.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader2, X, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { uploadManager, type UploadJob } from "@/lib/upload-manager";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

const fmtKB = (b: number) => b < 1024 * 1024
  ? `${Math.round(b / 1024)} KB`
  : `${(b / 1024 / 1024).toFixed(1)} MB`;

export const UploadProgressPanel = () => {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => uploadManager.subscribe(setJobs), []);

  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.status !== "done" && j.status !== "error").length;
  const done = jobs.filter((j) => j.status === "done").length;
  const errored = jobs.filter((j) => j.status === "error").length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        className="fixed bottom-4 end-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border bg-card/95 backdrop-blur-md shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              {active > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">
                {active > 0
                  ? `در حال آپلود (${active})`
                  : errored > 0
                    ? `${done} موفق · ${errored} ناموفق`
                    : `${done} تصویر آپلود شد`}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {jobs.length} مورد
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "نمایش" : "بستن"}
            >
              {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => uploadManager.clearFinished()}
              title="پاک‌کردن موارد تمام‌شده"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {!collapsed && (
          <div className="max-h-72 overflow-auto p-2 space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="rounded-lg border bg-background/60 px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">
                    {j.status === "done" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : j.status === "error" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium truncate" title={j.fileName}>
                        {j.fileName}
                      </div>
                      <button
                        type="button"
                        onClick={() => uploadManager.dismiss(j.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="حذف"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="mt-1">
                      <Progress value={j.progress} className="h-1" />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {j.status === "queued" && "در صف"}
                        {j.status === "compressing" && "در حال بهینه‌سازی"}
                        {j.status === "uploading" && "در حال بارگذاری"}
                        {j.status === "done" && "آماده"}
                        {j.status === "error" && (j.error || "ناموفق")}
                      </span>
                      <span className="tabular-nums">{fmtKB(j.bytes)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
