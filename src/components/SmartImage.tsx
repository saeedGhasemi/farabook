// SmartImage — lazy, responsive image with optional "view original" toggle.
// Uses the optimized URL by default. If the user clicks the toggle and an
// original variant exists in storage, we swap to the original transparently
// (with graceful fallback if the original is missing).

import { useEffect, useRef, useState } from "react";
import { Maximize2, Loader2 } from "lucide-react";
import { resolveBookMedia } from "@/lib/book-media";
import { candidateOriginalUrls } from "@/lib/image-optim";
import { cn } from "@/lib/utils";

interface SmartImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
  alt?: string;
  /** Show the floating "view original" button. Off for tiny thumbs. */
  allowOriginal?: boolean;
  /** Wrapper className. The img always fills the wrapper. */
  wrapperClassName?: string;
}

export const SmartImage = ({
  src, alt = "", allowOriginal = false, wrapperClassName, className, ...rest
}: SmartImageProps) => {
  const optimized = resolveBookMedia(src || "");
  const [showOrig, setShowOrig] = useState(false);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [origLoading, setOrigLoading] = useState(false);
  const triedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setShowOrig(false); setOrigUrl(null); triedRef.current.clear();
  }, [optimized]);

  const tryOriginal = () => {
    if (!optimized) return;
    const candidates = candidateOriginalUrls(optimized).filter((u) => !triedRef.current.has(u));
    if (!candidates.length) return;
    setOrigLoading(true);
    setShowOrig(true);
    // Probe each candidate sequentially via Image()
    const probe = (i: number) => {
      if (i >= candidates.length) { setOrigLoading(false); setShowOrig(false); return; }
      const url = candidates[i];
      triedRef.current.add(url);
      const test = new Image();
      test.onload = () => { setOrigUrl(url); setOrigLoading(false); };
      test.onerror = () => probe(i + 1);
      test.src = url;
    };
    probe(0);
  };

  return (
    <div className={cn("relative group/smart", wrapperClassName)}>
      <img
        src={showOrig && origUrl ? origUrl : optimized}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className}
        {...rest}
      />
      {allowOriginal && optimized && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); showOrig ? setShowOrig(false) : tryOriginal(); }}
          className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-md bg-background/80 backdrop-blur px-2 py-1 text-[11px] text-foreground border opacity-0 group-hover/smart:opacity-100 transition shadow"
          title={showOrig ? "نمایش بهینه" : "نمایش کیفیت اصلی"}
        >
          {origLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Maximize2 className="w-3 h-3" />}
          {showOrig ? "بهینه" : "اصل"}
        </button>
      )}
    </div>
  );
};

export default SmartImage;
