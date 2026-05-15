import { useEffect, useRef, useState } from "react";
import { ReadingLockManager, type LockState } from "@/lib/offline/ReadingLockManager";

/**
 * React hook around ReadingLockManager. Claims the session on mount,
 * releases on unmount/tab close, and exposes the live LockState.
 */
export function useReadingLock(userId: string | null | undefined, bookId: string | null | undefined) {
  const [state, setState] = useState<LockState>({ kind: "idle" });
  const mgrRef = useRef<ReadingLockManager | null>(null);

  useEffect(() => {
    if (!userId || !bookId) return;
    const mgr = new ReadingLockManager(userId, bookId);
    mgrRef.current = mgr;
    const off = mgr.subscribe(setState);
    void mgr.claim();

    const onUnload = () => mgr.releaseOnUnload();
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      off();
      void mgr.release("unmount");
      mgr.destroy();
      mgrRef.current = null;
    };
  }, [userId, bookId]);

  const reclaim = () => mgrRef.current?.claim();
  return { state, reclaim };
}
