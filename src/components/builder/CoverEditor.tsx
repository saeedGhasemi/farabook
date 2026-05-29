// Compact cover editor.
//
// • Thumbnail row for front + back covers.
// • Click an empty thumbnail (or the small upload icon on a filled one) →
//   pick a file → crop dialog (2:3 aspect, draggable + zoomable frame) →
//   the cropped image is uploaded and stored as `coverUrl` /
//   `backCoverUrl`. No focal-point handling needed; the stored image is
//   already cropped to cover ratio.
// • Click a filled thumbnail (via the eye icon) opens a large preview.
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Eye, Upload, Loader2, Check, X, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n";
import { useImageUpload } from "./tiptap-nodes";
import { CoverImage, type CoverCrop } from "@/components/reader/CoverImage";
import { toast } from "sonner";

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

const COVER_ASPECT = 2 / 3;

/* ---- Crop helper: produce a cropped JPEG blob from an image ---- */
async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas empty"))), "image/jpeg", 0.92)!,
  );
}

/* ---------------------------- Thumbnail row -------------------------- */
export function CoverEditor({ value, onChange }: Props) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [previewSide, setPreviewSide] = useState<"front" | "back" | null>(null);
  const [cropSide, setCropSide] = useState<"front" | "back" | null>(null);
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);

  const frontInputRef = useRef<HTMLInputElement | null>(null);
  const backInputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = (side: "front" | "back") =>
    (side === "front" ? frontInputRef : backInputRef).current?.click();

  const onFile = (side: "front" | "back", file: File) => {
    const url = URL.createObjectURL(file);
    setPickedSrc(url);
    setCropSide(side);
  };

  const Thumb = ({ side }: { side: "front" | "back" }) => {
    const hasImage =
      side === "front"
        ? Boolean(value.coverUrl || (value.spreadUrl && value.crop?.mode === "half"))
        : Boolean(value.backCoverUrl || (value.spreadUrl && value.crop?.mode === "half"));
    return (
      <div className="relative shrink-0 group">
        <button
          type="button"
          onClick={() => openPicker(side)}
          className="relative w-14 h-20 rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-accent/40 transition"
          title={hasImage ? (fa ? "تغییر تصویر" : "Replace image") : (fa ? "بارگذاری تصویر" : "Upload image")}
        >
          {hasImage ? (
            <CoverImage
              side={side}
              coverUrl={value.coverUrl}
              backCoverUrl={value.backCoverUrl}
              spreadUrl={value.spreadUrl}
              crop={value.crop}
              focus={value.coverFocus}
              backFocus={value.backCoverFocus}
              title={side === "front" ? "Front" : "Back"}
              width={200}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-muted-foreground/70">
              <Upload className="w-4 h-4" />
            </div>
          )}
          <span className="absolute bottom-0 inset-x-0 text-[9px] py-0.5 text-center bg-background/80 backdrop-blur-sm border-t">
            {side === "front" ? (fa ? "جلو" : "Front") : (fa ? "پشت" : "Back")}
          </span>
        </button>
        {hasImage && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreviewSide(side); }}
            className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-background border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
            title={fa ? "نمایش بزرگ" : "Preview"}
          >
            <Eye className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border bg-card/50 p-2.5 mb-3 flex items-center gap-3">
      <div className="text-xs font-semibold flex items-center gap-1.5 me-1">
        <ImageIcon className="w-3.5 h-3.5 text-accent" />
        {fa ? "جلد" : "Cover"}
      </div>
      <Thumb side="front" />
      <Thumb side="back" />
      <div className="flex-1" />
      <span className="text-[10px] text-muted-foreground hidden sm:inline">
        {fa ? "برای بارگذاری/تغییر روی هر تصویر کلیک کنید" : "Click a tile to upload or replace"}
      </span>

      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile("front", f);
          if (frontInputRef.current) frontInputRef.current.value = "";
        }}
      />
      <input
        ref={backInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile("back", f);
          if (backInputRef.current) backInputRef.current.value = "";
        }}
      />

      {/* Preview lightbox */}
      <Dialog open={previewSide !== null} onOpenChange={(o) => !o && setPreviewSide(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-4 py-2 border-b flex-row items-center justify-between">
            <DialogTitle className="text-sm">
              {previewSide === "front" ? (fa ? "روی جلد" : "Front cover") : (fa ? "پشت جلد" : "Back cover")}
            </DialogTitle>
            {previewSide && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-destructive"
                onClick={() => {
                  if (previewSide === "front") onChange({ coverUrl: null });
                  else onChange({ backCoverUrl: null });
                  setPreviewSide(null);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> {fa ? "حذف" : "Remove"}
              </Button>
            )}
          </DialogHeader>
          {previewSide && (
            <div className="aspect-[2/3] bg-muted">
              <CoverImage
                side={previewSide}
                coverUrl={value.coverUrl}
                backCoverUrl={value.backCoverUrl}
                spreadUrl={value.spreadUrl}
                crop={value.crop}
                focus={value.coverFocus}
                backFocus={value.backCoverFocus}
                title={previewSide}
                width={900}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Crop dialog */}
      {cropSide && pickedSrc && (
        <CropDialog
          side={cropSide}
          src={pickedSrc}
          onCancel={() => { URL.revokeObjectURL(pickedSrc); setPickedSrc(null); setCropSide(null); }}
          onDone={(blob) => {
            URL.revokeObjectURL(pickedSrc);
            setPickedSrc(null);
            const side = cropSide;
            setCropSide(null);
            return { blob, side };
          }}
          onChange={onChange}
          spreadUrl={value.spreadUrl}
          crop={value.crop}
        />
      )}
    </div>
  );
}

/* ----------------------------- Crop dialog --------------------------- */
function CropDialog({
  side, src, onCancel, onChange, spreadUrl, crop,
}: {
  side: "front" | "back";
  src: string;
  onCancel: () => void;
  onDone: (b: Blob) => void;
  onChange: (next: Partial<CoverState>) => void;
  spreadUrl: string | null;
  crop: CoverCrop;
}) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const { upload, busy } = useImageUpload();

  const [crop2, setCrop2] = useState({ x: 0, y: 0 });
  const [pixels, setPixels] = useState<Area | null>(null);
  const onComplete = useCallback((_a: Area, p: Area) => setPixels(p), []);

  // Resizable crop box: size is a percentage (20-100) of the maximum crop
  // box that fits the container while keeping 2:3 aspect.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [sizePct, setSizePct] = useState(100);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cropSize = (() => {
    if (!containerSize.w || !containerSize.h) return undefined;
    // Largest 2:3 box that fits the container.
    const maxH = Math.min(containerSize.h, containerSize.w / COVER_ASPECT);
    const maxW = maxH * COVER_ASPECT;
    const f = Math.max(0.2, Math.min(1, sizePct / 100));
    return { width: maxW * f, height: maxH * f };
  })();

  const save = async () => {
    if (!pixels) return;
    try {
      const blob = await getCroppedBlob(src, pixels);
      const file = new File([blob], `cover-${side}-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = await upload(file);
      if (!url) return;
      const patch: Partial<CoverState> = {
        ...(spreadUrl && crop?.mode === "half" ? { spreadUrl: null, crop: null } : {}),
      };
      if (side === "front") {
        patch.coverUrl = url;
        patch.coverFocus = { x: 50, y: 50 };
      } else {
        patch.backCoverUrl = url;
        patch.backCoverFocus = { x: 50, y: 50 };
      }
      onChange(patch);
      toast.success(fa ? "ذخیره شد" : "Saved");
      onCancel();
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطا در برش" : "Crop failed"));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm">
            {fa
              ? side === "front" ? "برش روی جلد" : "برش پشت جلد"
              : side === "front" ? "Crop front cover" : "Crop back cover"}
          </DialogTitle>
        </DialogHeader>

        <div ref={containerRef} className="relative w-full h-[60vh] bg-black/90">
          <Cropper
            image={src}
            crop={crop2}
            zoom={1}
            aspect={COVER_ASPECT}
            cropSize={cropSize}
            onCropChange={setCrop2}
            onCropComplete={onComplete}
            showGrid
            objectFit="contain"
            zoomWithScroll={false}
          />
        </div>

        <div className="px-4 py-3 border-t space-y-3 bg-muted/30">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-20">{fa ? "اندازه قاب" : "Frame size"}</span>
            <Slider
              value={[sizePct]}
              min={20}
              max={100}
              step={1}
              onValueChange={(v) => setSizePct(v[0])}
              className="flex-1"
            />
            <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-end">{sizePct}%</span>
          </div>
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1">
              <X className="w-3.5 h-3.5" /> {fa ? "انصراف" : "Cancel"}
            </Button>
            <Button
              size="sm"
              className="gap-1 bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={save}
              disabled={busy || !pixels}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {fa ? "ذخیره" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
