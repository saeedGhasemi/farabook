// Compact cover editor.
//
// • Default view: a small thumbnail row showing the front and back covers.
//   Clicking a thumbnail opens a large preview lightbox. Clicking the
//   pencil opens a 2-step wizard (front → back) where the user uploads
//   an image and sets the focal point (cropping for `object-cover`).
// • The two-image data model (`coverUrl` / `backCoverUrl` + focus) is the
//   primary path. Existing "spread" data is still rendered via
//   <CoverImage/>, but the editor itself no longer offers a spread mode —
//   editing replaces the spread with two separate images.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Pencil, Trash2, BookOpen, ChevronRight, ChevronLeft, Upload, Check, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/* ------------------------------- Thumbnail row ----------------------- */
export function CoverEditor({ value, onChange }: Props) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [previewSide, setPreviewSide] = useState<"front" | "back" | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const Thumb = ({ side }: { side: "front" | "back" }) => {
    const hasImage =
      side === "front"
        ? Boolean(value.coverUrl || (value.spreadUrl && value.crop?.mode === "half"))
        : Boolean(value.backCoverUrl || (value.spreadUrl && value.crop?.mode === "half"));
    return (
      <button
        type="button"
        onClick={() => hasImage && setPreviewSide(side)}
        className="group relative w-14 h-20 rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-accent/40 transition shrink-0"
        title={hasImage ? (fa ? "نمایش بزرگ" : "View") : ""}
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
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-muted-foreground/60" />
          </div>
        )}
        <span className="absolute bottom-0 inset-x-0 text-[9px] py-0.5 text-center bg-background/80 backdrop-blur-sm border-t">
          {side === "front" ? (fa ? "جلو" : "Front") : (fa ? "پشت" : "Back")}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-lg border bg-card/50 p-2.5 mb-3 flex items-center gap-3">
      <div className="text-xs font-semibold flex items-center gap-1.5 me-1">
        <BookOpen className="w-3.5 h-3.5 text-accent" />
        {fa ? "جلد" : "Cover"}
      </div>
      <Thumb side="front" />
      <Thumb side="back" />
      <div className="flex-1" />
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px] gap-1"
        onClick={() => setWizardOpen(true)}
      >
        <Pencil className="w-3 h-3" />
        {fa ? "ویرایش" : "Edit"}
      </Button>

      {/* ---- Preview lightbox ---- */}
      <Dialog open={previewSide !== null} onOpenChange={(o) => !o && setPreviewSide(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-4 py-2 border-b">
            <DialogTitle className="text-sm">
              {previewSide === "front" ? (fa ? "روی جلد" : "Front cover") : (fa ? "پشت جلد" : "Back cover")}
            </DialogTitle>
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

      {/* ---- Wizard ---- */}
      {wizardOpen && (
        <CoverWizard
          value={value}
          onChange={onChange}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------- Wizard ------------------------------ */
function CoverWizard({
  value, onChange, onClose,
}: { value: CoverState; onChange: (next: Partial<CoverState>) => void; onClose: () => void }) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const { upload, busy } = useImageUpload();
  const [step, setStep] = useState<0 | 1>(0); // 0 = front, 1 = back

  // Local draft (committed on Save / Next so the user can cancel)
  const [draftFrontUrl, setDraftFrontUrl] = useState<string | null>(value.coverUrl);
  const [draftFrontFocus, setDraftFrontFocus] = useState(value.coverFocus);
  const [draftBackUrl, setDraftBackUrl] = useState<string | null>(value.backCoverUrl);
  const [draftBackFocus, setDraftBackFocus] = useState(value.backCoverFocus);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const isFront = step === 0;
  const url = isFront ? draftFrontUrl : draftBackUrl;
  const focus = isFront ? draftFrontFocus : draftBackFocus;
  const setUrl = (u: string | null) => isFront ? setDraftFrontUrl(u) : setDraftBackUrl(u);
  const setFocus = (f: { x: number; y: number }) => isFront ? setDraftFrontFocus(f) : setDraftBackFocus(f);

  const handleFile = async (f: File) => {
    const u = await upload(f);
    if (u) {
      setUrl(u);
      setFocus({ x: 50, y: 50 });
      toast.success(fa ? "بارگذاری شد" : "Uploaded");
    }
  };

  const onClickArea = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!url) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocus({
      x: clamp(Math.round(((e.clientX - rect.left) / rect.width) * 100)),
      y: clamp(Math.round(((e.clientY - rect.top) / rect.height) * 100)),
    });
  };

  const commitAndClose = () => {
    onChange({
      coverUrl: draftFrontUrl,
      coverFocus: draftFrontFocus,
      backCoverUrl: draftBackUrl,
      backCoverFocus: draftBackFocus,
      // Editing in wizard always normalises to the "two images" model.
      spreadUrl: null,
      crop: null,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${isFront ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
            <span className={isFront ? "" : "text-muted-foreground"}>{fa ? "روی جلد" : "Front cover"}</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${!isFront ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
            <span className={!isFront ? "" : "text-muted-foreground"}>{fa ? "پشت جلد" : "Back cover"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />

          <div
            className={`relative w-full max-w-xs mx-auto aspect-[2/3] rounded-md overflow-hidden border bg-muted flex items-center justify-center ${url ? "cursor-crosshair" : ""}`}
            onClick={onClickArea}
            title={url ? (fa ? "برای تنظیم نقطه مرکزی کلیک کنید" : "Click to set focal point") : ""}
          >
            {url ? (
              <>
                <img src={url} alt="" className="w-full h-full object-cover" style={{ objectPosition: `${focus.x}% ${focus.y}%` }} />
                <div
                  className="absolute w-4 h-4 rounded-full border-2 border-white shadow bg-accent pointer-events-none -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
                />
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageIcon className="w-8 h-8 opacity-60" />
                <span className="text-xs">{fa ? "تصویری بارگذاری کنید" : "Upload an image"}</span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            {url
              ? (fa ? "روی تصویر کلیک کنید تا نقطهٔ مرکزی برای برش انتخاب شود." : "Click the image to set the focal point used when cropped.")
              : (fa ? "تصویری برای این صفحه از جلد انتخاب کنید." : "Choose an image for this cover side.")}
          </p>

          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {url ? (fa ? "تغییر تصویر" : "Replace") : (fa ? "بارگذاری" : "Upload")}
            </Button>
            {url && (
              <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => setUrl(null)}>
                <Trash2 className="w-3.5 h-3.5" />
                {fa ? "حذف" : "Remove"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
          <Button size="sm" variant="ghost" onClick={onClose} className="gap-1">
            <X className="w-3.5 h-3.5" />
            {fa ? "انصراف" : "Cancel"}
          </Button>
          <div className="flex items-center gap-2">
            {!isFront && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setStep(0)}>
                <ChevronRight className="w-3.5 h-3.5" />
                {fa ? "قبلی" : "Back"}
              </Button>
            )}
            {isFront ? (
              <Button size="sm" className="gap-1 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setStep(1)}>
                {fa ? "بعدی (پشت جلد)" : "Next (back cover)"}
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button size="sm" className="gap-1 bg-accent text-accent-foreground hover:bg-accent/90" onClick={commitAndClose}>
                <Check className="w-3.5 h-3.5" />
                {fa ? "ذخیره" : "Save"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
