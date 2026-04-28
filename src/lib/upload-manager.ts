// Background image upload manager.
//
// • Compresses images via image-optim (downscale + WebP), uploads to
//   Supabase storage in parallel (default 3 at a time).
// • Exposes a tiny pub/sub so the global UploadProgressPanel can
//   render live job state, and so callers (Gallery node, etc.) can
//   await the final URL of any single job.
// • Survives editor unmounts: jobs run on a singleton, so navigating
//   between pages will not abort in-flight uploads.

import { compressImage } from "@/lib/image-optim";
import { supabase } from "@/integrations/supabase/client";

export type UploadStatus = "queued" | "compressing" | "uploading" | "done" | "error";

export interface UploadJob {
  id: string;
  fileName: string;
  bytes: number;
  status: UploadStatus;
  /** 0-100 — combined compress + upload progress. */
  progress: number;
  /** Final OPTIMIZED public URL (when status === "done"). */
  url?: string;
  error?: string;
  /** Free-text label (e.g. "گالری فصل ۱"). */
  label?: string;
  startedAt: number;
  finishedAt?: number;
}

type Listener = (jobs: UploadJob[]) => void;

const MAX_PARALLEL = 3;

class Manager {
  private jobs: Map<string, UploadJob> = new Map();
  private queue: { job: UploadJob; file: File; userId: string; prefix: string; resolve: (url: string | null) => void }[] = [];
  private active = 0;
  private listeners = new Set<Listener>();

  /** Snapshot of all jobs, newest first. */
  list(): UploadJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    const snap = this.list();
    this.listeners.forEach((l) => l(snap));
  }

  private update(id: string, patch: Partial<UploadJob>) {
    const j = this.jobs.get(id);
    if (!j) return;
    Object.assign(j, patch);
    this.emit();
  }

  /** Remove a finished/errored job from the panel. */
  dismiss(id: string) {
    this.jobs.delete(id);
    this.emit();
  }

  /** Clear all done/errored jobs. */
  clearFinished() {
    for (const [id, j] of this.jobs) {
      if (j.status === "done" || j.status === "error") this.jobs.delete(id);
    }
    this.emit();
  }

  /**
   * Queue a single file for upload. Returns a promise that resolves to the
   * public URL of the optimized variant (or null on error) so the caller
   * can wire it into editor state when ready.
   */
  enqueue(opts: { userId: string; file: File; prefix?: string; label?: string }): Promise<string | null> {
    const { userId, file, prefix = "edit", label } = opts;
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: UploadJob = {
      id,
      fileName: file.name,
      bytes: file.size,
      status: "queued",
      progress: 0,
      label,
      startedAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.emit();

    return new Promise<string | null>((resolve) => {
      this.queue.push({ job, file, userId, prefix, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.active < MAX_PARALLEL && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active++;
      this.run(next).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(item: { job: UploadJob; file: File; userId: string; prefix: string; resolve: (url: string | null) => void }) {
    const { job, file, userId, prefix, resolve } = item;
    try {
      // 1) Compress (raster only — compressImage no-ops for svg/etc.)
      this.update(job.id, { status: "compressing", progress: 5 });
      const { blob, ext, mime } = await compressImage(file, { maxEdge: 1600, quality: 0.82 });
      this.update(job.id, { progress: 35 });

      // 2) Upload optimized
      this.update(job.id, { status: "uploading", progress: 45 });
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const base = `${userId}/${prefix}/${stamp}`;
      const optKey = `${base}.${ext}`;
      const up = await supabase.storage.from("book-media").upload(optKey, blob, {
        contentType: mime, upsert: false,
      });
      if (up.error) throw up.error;
      this.update(job.id, { progress: 80 });
      const optUrl = supabase.storage.from("book-media").getPublicUrl(optKey).data.publicUrl;

      // 3) Best-effort original (only if compression actually happened)
      if (blob !== file) {
        const origExt = file.name.split(".").pop() || "jpg";
        const origKey = `${base}__orig.${origExt}`;
        await supabase.storage.from("book-media").upload(origKey, file, {
          contentType: file.type, upsert: false,
        }).catch(() => {});
      }

      this.update(job.id, {
        status: "done",
        progress: 100,
        url: optUrl,
        finishedAt: Date.now(),
      });
      resolve(optUrl);

      // Auto-dismiss successful jobs after a short delay so the panel
      // doesn't pile up.
      setTimeout(() => this.dismiss(job.id), 4000);
    } catch (e) {
      this.update(job.id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: Date.now(),
      });
      resolve(null);
    }
  }
}

export const uploadManager = new Manager();
