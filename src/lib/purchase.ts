import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { pulseCredits, requestCreditsRefresh } from "@/lib/credits-bus";

// Test multiplier (kept in sync with the SQL `purchase_book` function).
export const CREDIT_PRICE_MULTIPLIER = 10;
// Conversion: 10 credits = 1 toman.
export const CREDITS_PER_TOMAN = 10;

export const bookCreditCost = (price: number) =>
  Math.max(0, Math.round((Number(price) || 0) * CREDIT_PRICE_MULTIPLIER));

export const creditsToToman = (credits: number) =>
  Math.round((Number(credits) || 0) / CREDITS_PER_TOMAN);

const fmt = (n: number, lang: "fa" | "en") =>
  Number(n).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

interface PurchaseArgs {
  bookId: string;
  bookTitle: string;
  lang: "fa" | "en";
}

interface PurchaseResult {
  ok: boolean;
  cost: number;
  newBalance: number;
}

/**
 * Atomically deducts credits and adds the book to the user's library
 * via the `purchase_book` RPC. Shows a rich toast and pulses the navbar
 * credits indicator on success.
 */
export const purchaseBookWithCredits = async ({
  bookId,
  bookTitle,
  lang,
}: PurchaseArgs): Promise<PurchaseResult | null> => {
  const { data, error } = await supabase.rpc("purchase_book" as any, {
    _book_id: bookId,
  });

  if (error) {
    const code = String(error.message || "");
    if (code.includes("insufficient_credits")) {
      toast.error(
        lang === "fa"
          ? "اعتبار کافی نیست. لطفاً ابتدا اعتبار خریداری کنید."
          : "Not enough credits. Please top up first.",
      );
    } else if (code.includes("already_owned")) {
      toast.message(
        lang === "fa" ? "این کتاب قبلاً در قفسه شماست." : "Book already in your library.",
      );
    } else if (code.includes("not_authenticated")) {
      toast.error(lang === "fa" ? "ابتدا وارد شوید." : "Please sign in first.");
    } else {
      toast.error(error.message);
    }
    return null;
  }

  const result = (data as any) || {};
  const cost = Number(result.cost || 0);
  const prev = Number(result.previous_balance || 0);
  const next = Number(result.new_balance || 0);

  // Animate the navbar credits chip and trigger a balance refresh.
  pulseCredits({ delta: -cost, newBalance: next });
  requestCreditsRefresh();

  if (cost === 0) {
    toast.success(
      lang === "fa"
        ? `«${bookTitle}» رایگان به قفسه اضافه شد 🎉`
        : `“${bookTitle}” added to your library for free 🎉`,
    );
  } else {
    toast.success(
      lang === "fa"
        ? `«${bookTitle}» به قفسه اضافه شد ✨`
        : `“${bookTitle}” added to your library ✨`,
      {
        description:
          lang === "fa"
            ? `اعتبار قبلی: ${fmt(prev, lang)} • کسر شد: ${fmt(cost, lang)} • مانده: ${fmt(next, lang)}`
            : `Previous: ${fmt(prev, lang)} • Spent: ${fmt(cost, lang)} • Remaining: ${fmt(next, lang)}`,
        duration: 5000,
      },
    );
  }

  return { ok: true, cost, newBalance: next };
};
