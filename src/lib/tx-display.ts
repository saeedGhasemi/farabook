// Shared helpers for displaying credit transactions consistently across
// all user-facing reports (profile earnings, credits page, admin user dialog).
//
// Rules requested by product:
//  - Withdrawals (amount < 0): RED, shown with a "−" sign in the «برداشت» column.
//  - Deposits (amount > 0): GREEN, shown with a "+" sign in the «واریز» column.
//  - EXCEPT: credits the user purchased / was granted by an admin / starter
//    credits, which appear in the «واریز» column but in ORANGE.

export const REASON_FA: Record<string, string> = {
  book_purchase: "خرید کتاب",
  revenue_share_publisher: "سهم ناشر از فروش",
  revenue_share_author: "سهم نویسنده از فروش",
  revenue_share_editor: "سهم ادیتور از فروش",
  publisher_signup_fee: "هزینه درخواست ناشر",
  publisher_upgrade_fee: "هزینه ارتقا به ناشر",
  book_publish_fee: "هزینه انتشار کتاب",
  editor_order_fee: "هزینه سفارش ادیت",
  ai_text_suggest: "هوش مصنوعی - متن",
  ai_image_gen: "هوش مصنوعی - تصویر",
  credit_purchase_approved: "خرید اعتبار",
  admin_grant: "اعطای ادمین",
  admin_deduct: "کسر ادمین",
  admin_adjust: "تنظیم دستی ادمین",
  bulk_grant: "اعطای گروهی ادمین",
  bulk_deduct: "کسر گروهی ادمین",
  seed_starter_credits: "اعتبار اولیه",
  revenue_received: "درآمد",
  fee_charged: "هزینه پلتفرم",
};

// Reasons that should be highlighted in ORANGE in the «واریز» column.
// These represent credit being added to the user's wallet from outside
// (purchase, admin grant, starter top-up) rather than earned via sales.
export const ORANGE_DEPOSIT_REASONS = new Set<string>([
  "credit_purchase_approved",
  "admin_grant",
  "admin_adjust", // only when amount > 0
  "bulk_grant",
  "seed_starter_credits",
]);

export type TxKind = "deposit" | "deposit_topup" | "withdrawal";

export const classifyTx = (amount: number, reason: string): TxKind => {
  if (amount > 0) {
    if (ORANGE_DEPOSIT_REASONS.has(reason)) return "deposit_topup";
    return "deposit";
  }
  return "withdrawal";
};

export const reasonLabel = (reason: string) => REASON_FA[reason] || reason;

// Tailwind text classes per kind, used on the amount cell.
export const txAmountClass: Record<TxKind, string> = {
  deposit: "text-emerald-600 dark:text-emerald-400",
  deposit_topup: "text-orange-500 dark:text-orange-400",
  withdrawal: "text-destructive",
};

// Badge classes for the reason label.
export const txBadgeClass: Record<TxKind, string> = {
  deposit: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  deposit_topup: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  withdrawal: "bg-destructive/15 text-destructive",
};

export interface TxTotals {
  income: number;     // sum of deposits (both green + orange)
  topUp: number;      // sum of orange deposits only
  earned: number;     // sum of green deposits only
  spent: number;      // sum of withdrawals (positive number)
  balance: number;    // income - spent
}

export const computeTotals = (txs: { amount: number | string; reason: string }[]): TxTotals => {
  let income = 0;
  let topUp = 0;
  let earned = 0;
  let spent = 0;
  for (const t of txs) {
    const amt = Number(t.amount || 0);
    const kind = classifyTx(amt, t.reason);
    if (kind === "withdrawal") {
      spent += Math.abs(amt);
    } else {
      income += amt;
      if (kind === "deposit_topup") topUp += amt;
      else earned += amt;
    }
  }
  return { income, topUp, earned, spent, balance: income - spent };
};

export const formatFa = (n: number) => n.toLocaleString("fa-IR");

// Build a human-readable Persian sentence describing what a transaction was for.
// `bookTitle` is optional — pass it when you've resolved book_id → title from the
// books table; otherwise we fall back to a short id reference.
export const describeTx = (
  reason: string,
  amount: number | string,
  metadata: any,
  bookTitle?: string | null,
): string => {
  const meta = (metadata || {}) as Record<string, any>;
  const amt = Math.abs(Number(amount || 0));
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const bookRef = bookTitle
    ? `«${bookTitle}»`
    : meta.book_title
      ? `«${meta.book_title}»`
      : meta.book_id
        ? `#${String(meta.book_id).slice(0, 6)}`
        : "";
  const pct = meta.percent ? `${fa(Number(meta.percent))}٪ ` : "";

  switch (reason) {
    case "book_purchase":
      return bookRef ? `خرید کتاب ${bookRef}` : "خرید کتاب";
    case "revenue_share_publisher":
      return bookRef
        ? `${pct || ""}سهم ناشر از فروش یک نسخه از کتاب ${bookRef}`
        : "سهم ناشر از فروش کتاب";
    case "revenue_share_author":
      return bookRef
        ? `${pct}سهم نویسنده از فروش یک نسخه از کتاب ${bookRef}`
        : "سهم نویسنده از فروش کتاب";
    case "revenue_share_editor":
      return bookRef
        ? `${pct}سهم ادیتور از فروش یک نسخه از کتاب ${bookRef}`
        : "سهم ادیتور از فروش کتاب";
    case "book_publish_fee": {
      const cx = meta.complexity ? ` (ضریب پیچیدگی ${fa(Number(meta.complexity))}×)` : "";
      return bookRef ? `هزینه انتشار کتاب ${bookRef}${cx}` : `هزینه انتشار کتاب${cx}`;
    }
    case "publisher_signup_fee":
      return "هزینه ثبت درخواست ناشر";
    case "publisher_upgrade_fee":
      return "هزینه ارتقا حساب به ناشر";
    case "editor_order_fee":
      return bookRef ? `هزینه سفارش ادیت برای کتاب ${bookRef}` : "هزینه سفارش ادیت";
    case "ai_text_suggest": {
      const chars = meta.chars ? ` (${fa(Number(meta.chars))} کاراکتر)` : "";
      return bookRef
        ? `استفاده از هوش مصنوعی برای پیشنهاد متن در کتاب ${bookRef}${chars}`
        : `استفاده از هوش مصنوعی برای پیشنهاد متن${chars}`;
    }
    case "ai_text_suggest_refund":
      return bookRef
        ? `بازگشت اعتبار هوش مصنوعی متن در کتاب ${bookRef}`
        : "بازگشت اعتبار هوش مصنوعی متن";
    case "ai_image_gen":
      return bookRef
        ? `ساخت تصویر با هوش مصنوعی برای کتاب ${bookRef}`
        : "ساخت تصویر با هوش مصنوعی";
    case "credit_purchase_approved":
      return `خرید اعتبار (${fa(amt)} اعتبار، تأییدشده توسط ادمین)`;
    case "admin_grant":
      return meta.note ? `اعطای ادمین — ${meta.note}` : "اعطای اعتبار توسط ادمین";
    case "admin_deduct":
      return meta.note ? `کسر توسط ادمین — ${meta.note}` : "کسر اعتبار توسط ادمین";
    case "admin_adjust":
      return meta.note ? `تنظیم دستی ادمین — ${meta.note}` : "تنظیم دستی اعتبار توسط ادمین";
    case "bulk_grant":
      return "اعطای گروهی اعتبار توسط ادمین";
    case "bulk_deduct":
      return "کسر گروهی اعتبار توسط ادمین";
    case "seed_starter_credits":
      return "اعتبار اولیه هدیه به حساب جدید";
    case "revenue_received":
      return bookRef ? `دریافت درآمد از کتاب ${bookRef}` : "دریافت درآمد";
    case "fee_charged":
      return meta.note ? `هزینه پلتفرم — ${meta.note}` : "هزینه پلتفرم";
    default:
      return reasonLabel(reason);
  }
};

// Helper: collect unique book_ids referenced in a list of transactions so the
// caller can fetch their titles in one query.
export const collectBookIds = (txs: { metadata?: any }[]): string[] => {
  const ids = new Set<string>();
  for (const t of txs) {
    const id = (t.metadata as any)?.book_id;
    if (id && typeof id === "string") ids.add(id);
  }
  return Array.from(ids);
};
