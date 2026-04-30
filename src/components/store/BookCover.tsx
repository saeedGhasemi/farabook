// BookCover: smart cover image. For books missing a real cover_url, it
// triggers `book-auto-cover` (AI-generated illustration based on the
// book's first pages) and caches the result. While pending, shows a
// tasteful gradient placeholder with the title initial.
import { useAutoCover } from "@/hooks/useAutoCover";
import { resolveBookCover } from "@/lib/book-media";
import { cn } from "@/lib/utils";

interface Props {
  bookId: string;
  cover: string | null | undefined;
  title: string;
  width?: number;
  quality?: number;
  className?: string;
  loading?: "lazy" | "eager";
  sizes?: string;
}

export function BookCover({ bookId, cover, title, width = 480, quality = 70, className, loading = "lazy", sizes }: Props) {
  const url = useAutoCover(bookId, cover);
  const initial = (title || "?").trim().charAt(0).toUpperCase();
  if (!url) {
    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary via-muted to-secondary", className)} aria-label={title}>
        <span className="font-display text-5xl text-muted-foreground/60">{initial}</span>
      </div>
    );
  }
  const small = Math.round(width * 0.7);
  const large = Math.round(width * 1.5);
  return (
    <img
      src={resolveBookCover(url, { width, quality })}
      srcSet={`${resolveBookCover(url, { width: small, quality: quality - 5 })} ${small}w, ${resolveBookCover(url, { width, quality })} ${width}w, ${resolveBookCover(url, { width: large, quality: quality + 5 })} ${large}w`}
      alt={title}
      loading={loading}
      decoding="async"
      width={width}
      height={Math.round(width * 4 / 3)}
      sizes={sizes}
      className={className}
    />
  );
}
