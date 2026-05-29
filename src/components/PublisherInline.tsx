// Tiny reusable "logo + publisher name" badge. Used wherever a
// publisher's identity is displayed in the UI so the brand follows the
// name consistently. Falls back to a neutral initial when no logo is set.
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Props {
  publisherId?: string | null;
  name: string;
  logoUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  withLink?: boolean;
  className?: string;
}

const sizeMap = {
  xs: { logo: "w-4 h-4", text: "text-[11px]" },
  sm: { logo: "w-5 h-5", text: "text-xs" },
  md: { logo: "w-7 h-7", text: "text-sm" },
  lg: { logo: "w-12 h-12", text: "text-base font-semibold" },
};

export function PublisherInline({
  publisherId, name, logoUrl, size = "sm", withLink = true, className,
}: Props) {
  const s = sizeMap[size];
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const inner = (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("inline-flex items-center justify-center rounded-full overflow-hidden bg-muted text-muted-foreground border shrink-0", s.logo)}>
        {logoUrl ? (
          <img src={logoUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <span className="text-[10px] font-semibold">{initial}</span>
        )}
      </span>
      <span className={cn("truncate", s.text)}>{name}</span>
    </span>
  );
  if (withLink && publisherId) {
    return (
      <Link to={`/publisher/${publisherId}`} className="hover:text-accent transition">
        {inner}
      </Link>
    );
  }
  return inner;
}
