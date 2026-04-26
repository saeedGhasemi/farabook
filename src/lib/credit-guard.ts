// Credit balance guard. Shows a friendly toast with a CTA to the credits
// page when the user does not have enough credits to perform an action.
import { toast } from "sonner";
import { Coins } from "lucide-react";

export const showInsufficientCreditsToast = (
  lang: "fa" | "en",
  cost: number,
  navigate: (to: string) => void,
) => {
  toast.error(
    lang === "fa" ? "اعتبار شما کافی نیست" : "Insufficient credits",
    {
      description:
        lang === "fa"
          ? `این عملیات به ${cost.toLocaleString("fa-IR")} اعتبار نیاز دارد. لطفاً اعتبار خریداری کنید.`
          : `This action needs ${cost.toLocaleString()} credits. Please top up.`,
      action: {
        label: lang === "fa" ? "خرید اعتبار" : "Buy credits",
        onClick: () => navigate("/credits"),
      },
      duration: 7000,
    },
  );
};

/** Estimate complexity factor (1..10) from book pages array. */
export const estimateComplexity = (pages: any[]): number => {
  if (!Array.isArray(pages) || pages.length === 0) return 1;
  let chars = 0;
  let mediaWeight = 0;
  for (const p of pages) {
    if (typeof p?.title === "string") chars += p.title.length;
    if (Array.isArray(p?.blocks)) {
      for (const b of p.blocks) {
        if (typeof b?.text === "string") chars += b.text.length;
        if (typeof b?.caption === "string") chars += b.caption.length;
        if (b?.type === "image" || b?.kind === "image") mediaWeight += 2;
        if (b?.type === "video" || b?.kind === "video") mediaWeight += 5;
        if (b?.type === "slideshow" || b?.kind === "slideshow") {
          mediaWeight += (b.images?.length || 0) * 1.5;
        }
        if (b?.type === "gallery" || b?.kind === "gallery") {
          mediaWeight += (b.images?.length || 0);
        }
        if (b?.steps?.length) mediaWeight += b.steps.length;
      }
    }
  }
  // Score: 1 point per ~2k chars, plus media weight, plus per-page bonus.
  const score = Math.round(chars / 2000) + Math.round(mediaWeight) + Math.round(pages.length / 5);
  return Math.max(1, Math.min(10, score));
};
