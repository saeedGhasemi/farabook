// Full-screen image lightbox with pan + zoom (wheel, pinch, buttons, double-click).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from "lucide-react";

interface Props {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

const MIN = 1;
const MAX = 8;

export const ImageLightbox = ({ src, alt, open, onClose }: Props) => {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, src, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(MAX, s * 1.25));
      else if (e.key === "-") setScale((s) => Math.max(MIN, s / 1.25));
      else if (e.key === "0") reset();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, reset]);

  if (!open) return null;

  const zoomAt = (delta: number, cx: number, cy: number, rect: DOMRect) => {
    setScale((prev) => {
      const next = Math.min(MAX, Math.max(MIN, prev * (delta > 0 ? 1 / 1.15 : 1.15)));
      // Adjust translation so zoom focuses around cursor
      const ratio = next / prev;
      const dx = (cx - rect.left - rect.width / 2 - tx) * (ratio - 1);
      const dy = (cy - rect.top - rect.height / 2 - ty) * (ratio - 1);
      if (next === MIN) { setTx(0); setTy(0); }
      else { setTx((t) => t - dx); setTy((t) => t - dy); }
      return next;
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    zoomAt(e.deltaY, e.clientX, e.clientY, rect);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= MIN) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setTx(dragRef.current.tx + (e.clientX - dragRef.current.x));
    setTy(dragRef.current.ty + (e.clientY - dragRef.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    if (scale > 1) reset();
    else zoomAt(-1, e.clientX, e.clientY, rect); // zoom in
  };

  // Pinch support (basic)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), scale };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      const next = Math.min(MAX, Math.max(MIN, pinchRef.current.scale * (d / pinchRef.current.dist)));
      setScale(next);
      if (next === MIN) { setTx(0); setTy(0); }
    }
  };
  const onTouchEnd = () => { pinchRef.current = null; };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full h-full overflow-hidden touch-none select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : "zoom-in" }}
      >
        <div className="w-full h-full flex items-center justify-center">
          <img
            src={src}
            alt={alt || ""}
            draggable={false}
            className="max-w-[95vw] max-h-[95vh] object-contain will-change-transform"
            style={{ transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`, transition: dragRef.current || pinchRef.current ? "none" : "transform 0.15s ease-out" }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-background/90 backdrop-blur px-2 py-1.5 shadow-lg border">
        <button onClick={() => setScale((s) => Math.max(MIN, s / 1.25))} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="zoom out" title="کوچک‌نمایی (-)">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs tabular-nums w-12 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(MAX, s * 1.25))} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="zoom in" title="بزرگ‌نمایی (+)">
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-border mx-1" />
        <button onClick={reset} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="reset" title="بازنشانی (0)">
          <RotateCcw className="w-4 h-4" />
        </button>
        <a href={src} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="open original" title="باز کردن اصل تصویر">
          <Maximize2 className="w-4 h-4" />
        </a>
      </div>

      <button
        onClick={onClose}
        className="absolute top-4 end-4 w-10 h-10 rounded-full bg-background/90 backdrop-blur border shadow-lg flex items-center justify-center hover:bg-muted"
        aria-label="close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>,
    document.body,
  );
};

export default ImageLightbox;
