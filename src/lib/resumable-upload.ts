// Resumable upload to Supabase Storage using the TUS protocol.
// Survives network drops, tab reloads (URL persisted in localStorage),
// and reports byte-level progress for a real progress bar.
//
// Supabase Storage exposes a TUS-compatible endpoint at
//   ${SUPABASE_URL}/storage/v1/upload/resumable
// which accepts a chunked upload with the same auth headers as the
// regular Storage API.

import * as tus from "tus-js-client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export interface ResumableUploadOptions {
  bucket: string;
  /** Object path inside the bucket (e.g. `userId/file.docx`). */
  objectName: string;
  file: File;
  /** Caller's session JWT. */
  accessToken: string;
  /** Content type to store; defaults to file.type or `application/octet-stream`. */
  contentType?: string;
  /** Allow overwriting an existing object. Defaults to true so retries succeed. */
  upsert?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

export interface ResumableUploadHandle {
  /** Promise that resolves when the upload finishes successfully. */
  done: Promise<void>;
  /** Pause the upload. The next call to start() resumes from the last byte. */
  abort: (shouldTerminate?: boolean) => Promise<void>;
}

export const startResumableUpload = (opts: ResumableUploadOptions): ResumableUploadHandle => {
  const {
    bucket, objectName, file, accessToken,
    contentType = file.type || "application/octet-stream",
    upsert = true, onProgress,
  } = opts;

  let upload: tus.Upload;
  const done = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      // Resume the same upload after page reloads or temporary failures.
      // tus-js-client persists the upload URL keyed by file fingerprint.
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1500, 3000, 6000, 12000, 25000, 60000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": upsert ? "true" : "false",
        apikey: ANON_KEY,
      },
      // Supabase TUS endpoint requires fixed 6 MiB chunks (except the final).
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: bucket,
        objectName,
        contentType,
        cacheControl: "3600",
      },
      onError: (err) => reject(err),
      onProgress: (loaded, total) => onProgress?.(loaded, total),
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch((err) => {
      // Fingerprint lookup failed (e.g. blocked storage). Start fresh.
      console.warn("[resumable-upload] fingerprint lookup failed", err);
      upload.start();
    });
  });

  return {
    done,
    abort: (shouldTerminate?: boolean) => upload.abort(shouldTerminate),
  };
};
