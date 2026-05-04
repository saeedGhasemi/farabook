// Resumable upload to Supabase Storage using the TUS protocol.
// Survives network drops, tab reloads (URL persisted in localStorage),
// and reports byte-level progress for a real progress bar.
//
// Supabase Storage exposes a TUS-compatible endpoint at
//   ${SUPABASE_URL}/storage/v1/upload/resumable

import * as tus from "tus-js-client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export interface ResumableUploadOptions {
  bucket: string;
  objectName: string;
  file: File;
  /** Caller's session JWT. */
  accessToken: string;
  contentType?: string;
  upsert?: boolean;
  onProgress?: (loaded: number, total: number) => void;
  /** Called when the JWT might be stale; should return a fresh access token. */
  refreshToken?: () => Promise<string | null>;
}

export interface ResumableUploadHandle {
  done: Promise<void>;
  abort: (shouldTerminate?: boolean) => Promise<void>;
}

/** Pull a useful description out of a tus-js-client error. */
const describeTusError = (err: unknown): string => {
  if (!err) return "آپلود ناموفق (خطای نامشخص)";
  const anyErr = err as any;
  const res = anyErr?.originalResponse;
  let bodyText = "";
  try { bodyText = res?.getBody?.() || ""; } catch { /* ignore */ }
  const status = res?.getStatus?.();
  const baseMsg = anyErr?.message || String(err);
  // Common Supabase storage messages
  if (status === 413) return `حجم فایل بیشتر از حد مجاز سرور است (${status}). ${bodyText}`.trim();
  if (status === 401 || status === 403) return `دسترسی منقضی شده یا مجاز نیست (${status}). ${bodyText}`.trim();
  if (status === 409) return `نسخه‌ی دیگری از این فایل از قبل وجود دارد (${status}).`;
  if (status) return `خطای سرور ${status}: ${bodyText || baseMsg}`.trim();
  return baseMsg || "آپلود ناموفق";
};

export const startResumableUpload = (opts: ResumableUploadOptions): ResumableUploadHandle => {
  const {
    bucket, objectName, file, accessToken,
    contentType = file.type || "application/octet-stream",
    upsert = true, onProgress, refreshToken,
  } = opts;

  let upload: tus.Upload;
  let currentToken = accessToken;

  const done = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1500, 3000, 6000, 12000, 25000, 60000],
      headers: {
        authorization: `Bearer ${currentToken}`,
        "x-upsert": upsert ? "true" : "false",
        apikey: ANON_KEY,
      },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: bucket,
        objectName,
        contentType,
        cacheControl: "3600",
      },
      // Bind the resume fingerprint to the exact destination object name.
      // Without this, tus would resume a previous upload that targeted a
      // *different* objectName (e.g. the previous timestamp) which leaves the
      // bytes saved at the old path while the DB row points to the new one,
      // and the conversion step then fails with "Object not found".
      fingerprint: (file, options) =>
        Promise.resolve(
          `tus-${bucket}-${objectName}-${file.name}-${file.size}-${(file as any).lastModified ?? 0}`,
        ),
      // Try to refresh JWT on auth errors before tus retries the chunk.
      onShouldRetry: (err: any, _retryAttempt, _options) => {
        const status = err?.originalResponse?.getStatus?.();
        if (status === 401 || status === 403) {
          if (refreshToken) {
            // fire-and-forget; updated header will be picked up on next attempt
            refreshToken().then((tok) => {
              if (tok && upload) {
                currentToken = tok;
                (upload as any).options.headers.authorization = `Bearer ${tok}`;
              }
            }).catch(() => {});
          }
          return true;
        }
        // Don't retry on 4xx other than 408/429
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          return false;
        }
        return true;
      },
      onError: (err: any) => {
        // Surface full HTTP context so the UI toast is meaningful.
        try {
          const res = err?.originalResponse;
          console.error("[resumable-upload] error", {
            message: err?.message,
            status: res?.getStatus?.(),
            body: res?.getBody?.(),
            headers: res?.getAllResponseHeaders?.(),
          });
        } catch { /* ignore */ }
        const description = describeTusError(err);
        const wrapped = new Error(description);
        (wrapped as any).cause = err;
        reject(wrapped);
      },
      onProgress: (loaded, total) => onProgress?.(loaded, total),
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch((err) => {
      console.warn("[resumable-upload] fingerprint lookup failed", err);
      upload.start();
    });
  });

  return {
    done,
    abort: (shouldTerminate?: boolean) => upload.abort(shouldTerminate),
  };
};
