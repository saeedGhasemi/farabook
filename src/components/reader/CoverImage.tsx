// Renders one side (front or back) of a book cover. Three sources are
// supported, in priority order:
//   1. Spread mode (`spreadUrl` + `crop`): a single image that contains
//      both covers laid side-by-side. We show only the matching half via
//      a background-image trick (no canvas needed).
//   2. Separate image for this side (`coverUrl` / `backCoverUrl`).
//   3. Fallback: the front `coverUrl` for both sides (legacy data).
import type { CSSProperties } from "react";
import { resolveBookCover } from "@/lib/book-media";
import { cn } from "@/lib/utils";

export type CoverCrop =
  | { mode: "half"; front_side: "left" | "right" }
  | null
  | undefined;

interface Props {
  side: "front" | "back";
  coverUrl?: string | null;
  backCoverUrl?: string | null;
  spreadUrl?: string | null;
  crop?: CoverCrop;
  focus?: { x?: number; y?: number } | null;
  backFocus?: { x?: number; y?: number } | null;
  title: string;
  width?: number;
  className?: string;
}

export function CoverImage({
  side,
  coverUrl,
  backCoverUrl,
  spreadUrl,
  crop,
  focus,
  backFocus,
  title,
  width = 720,
  className,
}: Props) {
  // -- Spread mode (single image, two halves) -----------------------------
  if (spreadUrl && crop?.mode === "half") {
    const url = resolveBookCover(spreadUrl, { width: width * 2, quality: 78 });
    const sideIsFront = side === "front";
    const showLeft = sideIsFront ? crop.front_side === "left" : crop.front_side === "right";
    const style: CSSProperties = {
      backgroundImage: `url(${url})`,
      backgroundSize: "200% 100%",
      backgroundPosition: `${showLeft ? 0 : 100}% center`,
      backgroundRepeat: "no-repeat",
    };
    return <div role="img" aria-label={title} className={cn("w-full h-full", className)} style={style} />;
  }

  // -- Separate image per side --------------------------------------------
  const rawSrc = side === "back"
    ? (backCoverUrl || coverUrl)
    : coverUrl;
  if (!rawSrc) {
    const initial = (title || "?").trim().charAt(0).toUpperCase();
    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary via-muted to-secondary", className)} aria-label={title}>
        <span className="font-display text-6xl text-muted-foreground/60">{initial}</span>
      </div>
    );
  }
  const f = side === "back" ? (backFocus ?? focus) : focus;
  const fx = Math.max(0, Math.min(100, f?.x ?? 50));
  const fy = Math.max(0, Math.min(100, f?.y ?? 50));
  return (
    <img
      src={resolveBookCover(rawSrc, { width, quality: 75 })}
      alt={title}
      loading="eager"
      decoding="async"
      className={cn("w-full h-full object-cover", className)}
      style={{ objectPosition: `${fx}% ${fy}%` }}
    />
  );
}
