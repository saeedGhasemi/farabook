import { useEffect, useState } from "react";

interface Props {
  /** Watermark label (usually user email or ID). */
  watermark: string;
  /** When true, blur the reader content while window/tab is not focused. */
  blurOnBlur?: boolean;
}

/**
 * Phase 1 copyright protection for the Reader.
 * - Blocks copy / cut / drag / Ctrl+S / Ctrl+P / Ctrl+C / Ctrl+X
 * - Allows native text selection (so notes & highlights still work)
 * - Disables right-click and image dragging
 * - Blurs the page when the tab/window loses focus
 * - Renders a tiled translucent watermark with the user's identity
 *
 * NOTE: This is a deterrent for casual users — not a hard DRM layer.
 */
export const CopyProtection = ({ watermark, blurOnBlur = true }: Props) => {
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    const blockCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      try { e.clipboardData?.setData("text/plain", ""); } catch { /* noop */ }
    };
    const blockKeys = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // Block copy, cut, save, print, "view source", select-all-then-copy isn't blockable but copy itself is
      if (["c", "x", "s", "p", "u"].includes(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const blockDrag = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "IMG" || t.closest("img"))) e.preventDefault();
    };
    const blockCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "IMG" || t.closest("img"))) e.preventDefault();
    };

    document.addEventListener("copy", blockCopy);
    document.addEventListener("cut", blockCopy);
    document.addEventListener("keydown", blockKeys);
    document.addEventListener("dragstart", blockDrag);
    document.addEventListener("contextmenu", blockCtx);
    return () => {
      document.removeEventListener("copy", blockCopy);
      document.removeEventListener("cut", blockCopy);
      document.removeEventListener("keydown", blockKeys);
      document.removeEventListener("dragstart", blockDrag);
      document.removeEventListener("contextmenu", blockCtx);
    };
  }, []);

  useEffect(() => {
    if (!blurOnBlur) return;
    const onBlur = () => setBlurred(true);
    const onFocus = () => setBlurred(false);
    const onVis = () => setBlurred(document.visibilityState !== "visible");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [blurOnBlur]);

  return (
    <>
      {/* Tiled watermark */}
      <div
        aria-hidden
        className="fixed inset-0 z-40 pointer-events-none select-none print:opacity-100"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-30deg, transparent 0 140px, rgba(0,0,0,0.0001) 140px 141px)",
        }}
      >
        <div
          className="absolute inset-0 flex flex-wrap content-start gap-x-24 gap-y-16 p-8 opacity-[0.07] dark:opacity-[0.12]"
          style={{ transform: "rotate(-24deg) scale(1.4)", transformOrigin: "center" }}
        >
          {Array.from({ length: 80 }).map((_, i) => (
            <span
              key={i}
              className="text-[11px] font-mono text-foreground whitespace-nowrap"
            >
              {watermark}
            </span>
          ))}
        </div>
      </div>

      {/* Blur overlay when tab/window not focused */}
      {blurred && (
        <div className="fixed inset-0 z-[70] backdrop-blur-2xl bg-background/70 flex items-center justify-center text-center p-6">
          <div className="max-w-sm">
            <p className="text-sm text-muted-foreground">
              {watermark}
            </p>
            <p className="mt-2 text-xs text-muted-foreground/70">
              محتوا برای حفاظت از کپی‌رایت در حالت غیرفعال محو شد. برای ادامه، به صفحه بازگردید.
            </p>
          </div>
        </div>
      )}

      {/* Print blocking style */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          body::after {
            content: "این کتاب برای چاپ در دسترس نیست.";
            visibility: visible;
            position: fixed; inset: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; color: #444;
          }
        }
        img { -webkit-user-drag: none; user-drag: none; }
      `}</style>
    </>
  );
};
