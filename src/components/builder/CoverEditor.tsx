// Compact editor for the book cover. Supports two modes:
//   • "separate" — independent front + back images, each with a focal point
//   • "spread"   — single wide image containing both covers; pick which
//                  half is the front (left/right) and the other becomes the back
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Trash2, BookOpen, LayoutGrid } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useImageUpload } from "@/hooks/useImageUpload";
import { toast } from "sonner";
import type { CoverCrop } from "@/components/reader/CoverImage";

export type CoverState = {
  coverUrl: string | null;
  coverFocus: { x: number; y: number };
  backCoverUrl: string | null;
  backCoverFocus: { x: number; y: number };
  spreadUrl: string | null;
  crop: CoverCrop;
};

interface Props {
  value: CoverState;
  onChange: (next: Partial<CoverState>) => void;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function CoverEditor({ value, onChange }: Props) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const { upload } = useImageUpload();

  const frontRef = useRef<HTMLInputElement | null>(null);
  const backRef = useRef<HTMLInputElement | null>(null);
  const spreadRef = useRef<HTMLInputElement | null>(null);

  const mode: "separate" | "spread" = value.spreadUrl ? "spread" : "separate";

  const handleUpload = async (
    file: File,
    field: "coverUrl" | "backCoverUrl" | "spreadUrl",
  ) => {
    const url = await upload(file);
    if (!url) return;
    if (field === "spreadUrl") {
      onChange({
        spreadUrl: url,
        crop: value.crop?.mode === "half" ? value.crop : { mode: "half", front_side: fa ? "right" : "left" },
      });
    } else {
      onChange({ [field]: url, spreadUrl: null, crop: null } as Partial<CoverState>);
    }
    toast.success(fa ? "بارگذاری شد" : "Uploaded");
  };

  // Click anywhere on a thumbnail → set focal point for that side
  const onFocusClick = (
    e: React.MouseEvent<HTMLDivElement>,
    side: "front" | "back",
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp(Math.round(((e.clientX - rect.left) / rect.width) * 100));
    const y = clamp(Math.round(((e.clientY - rect.top) / rect.height) * 100));
    if (side === "front") onChange({ coverFocus: { x, y } });
    else onChange({ backCoverFocus: { x, y } });
  };

  return (
    <div className="rounded-lg border bg-card/50 p-3 mb-3 space-y-3">
      {/* Header + mode switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-accent" />
          {fa ? "جلد کتاب" : "Book cover"}
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
          <button
            type="button"
            onClick={() => onChange({ spreadUrl: null, crop: null })}
            className={`text-[11px] px-2 py-0.5 rounded ${mode === "separate" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {fa ? "دو تصویر" : "Two images"}
          </button>
          <button
            type="button"
            onClick={() => spreadRef.current?.click()}
            className={`text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${mode === "spread" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="w-3 h-3" />
            {fa ? "تصویر گستره" : "Spread"}
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={frontRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, "coverUrl"); if (frontRef.current) frontRef.current.value = ""; }} />
      <input ref={backRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, "backCoverUrl"); if (backRef.current) backRef.current.value = ""; }} />
      <input ref={spreadRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, "spreadUrl"); if (spreadRef.current) spreadRef.current.value = ""; }} />

      {mode === "separate" ? (
        <div className="grid grid-cols-2 gap-3">
          {(["front", "back"] as const).map((side) => {
            const url = side === "front" ? value.coverUrl : value.backCoverUrl;
            const focus = side === "front" ? value.coverFocus : value.backCoverFocus;
            const ref = side === "front" ? frontRef : backRef;
            return (
              <div key={side} className="space-y-1.5">
                <div className="text-[11px] text-muted-foreground">
                  {side === "front" ? (fa ? "روی جلد" : "Front cover") : (fa ? "پشت جلد" : "Back cover")}
                </div>
                <div
                  className={`relative w-full aspect-[2/3] rounded-md overflow-hidden border bg-muted flex items-center justify-center ${url ? "cursor-crosshair" : ""}`}
                  onClick={(e) => url && onFocusClick(e, side)}
                  title={url ? (fa ? "برای تنظیم نقطه مرکزی کلیک کنید" : "Click to set focal point") : ""}
                >
                  {url ? (
                    <>
                      <img src={url} alt={side} className="w-full h-full object-cover" style={{ objectPosition: `${focus.x}% ${focus.y}%` }} />
                      <div className="absolute w-3 h-3 rounded-full border-2 border-white shadow bg-accent pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: `${focus.x}%`, top: `${focus.y}%` }} />
                    </>
                  ) : (
                    <ImageIcon className="w-6 h-6 text-muted-foreground/60" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1" onClick={() => ref.current?.click()}>
                    {url ? (fa ? "تغییر" : "Change") : (fa ? "بارگذاری" : "Upload")}
                  </Button>
                  {url && (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive" onClick={() => onChange(side === "front" ? { coverUrl: null } : { backCoverUrl: null })}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Spread mode — show the image with a vertical divider + front-side toggle
        <div className="space-y-2">
          <div className="relative w-full aspect-[3/2] rounded-md overflow-hidden border bg-muted">
            {value.spreadUrl ? (
              <>
                <img src={value.spreadUrl} alt="spread" className="w-full h-full object-cover" />
                {/* Divider in the middle */}
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none" />
                {/* Side labels */}
                {(["left", "right"] as const).map((sidePos) => {
                  const isFront = value.crop?.mode === "half" && value.crop.front_side === sidePos;
                  return (
                    <button
                      key={sidePos}
                      type="button"
                      onClick={() => onChange({ crop: { mode: "half", front_side: sidePos } })}
                      className={`absolute top-2 ${sidePos === "left" ? "left-2" : "right-2"} text-[10px] px-2 py-0.5 rounded-full backdrop-blur-md border transition ${isFront ? "bg-accent text-accent-foreground border-accent" : "bg-background/70 text-foreground border-border hover:bg-background"}`}
                    >
                      {isFront ? (fa ? "روی جلد" : "Front") : (fa ? "پشت جلد" : "Back")}
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                {fa ? "تصویر گستره را بارگذاری کنید" : "Upload a spread image"}
              </div>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {fa
              ? "روی برچسب «روی جلد» / «پشت جلد» بزنید تا مشخص کنید کدام نیمه، روی کتاب است."
              : "Tap the Front / Back labels to choose which half is the front cover."}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => spreadRef.current?.click()}>
              {value.spreadUrl ? (fa ? "تغییر تصویر" : "Change image") : (fa ? "بارگذاری" : "Upload")}
            </Button>
            {value.spreadUrl && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive" onClick={() => onChange({ spreadUrl: null, crop: null })}>
                <Trash2 className="w-3 h-3 me-1" />
                {fa ? "حذف" : "Remove"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
