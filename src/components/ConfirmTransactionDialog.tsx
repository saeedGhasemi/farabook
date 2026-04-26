import { ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, Wallet } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  /** اعتبار فعلی کاربر (قبل از تراکنش) */
  currentBalance: number;
  /** میزان کسر (مثبت بنویسید، نمایش با - می‌آید) */
  cost: number;
  lang: "fa" | "en";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  /** غیرفعال کردن تأیید (مثلاً اعتبار کافی نیست) */
  disabled?: boolean;
}

const fmt = (n: number, lang: "fa" | "en") =>
  Number(n).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

export const ConfirmTransactionDialog = ({
  open, onOpenChange, title, description, currentBalance, cost, lang,
  confirmLabel, cancelLabel, onConfirm, disabled,
}: Props) => {
  const after = currentBalance - cost;
  const insufficient = after < 0;
  const fa = lang === "fa";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 font-display">
            <span className="w-9 h-9 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
              <Sparkles className="w-4 h-4" />
            </span>
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-sm leading-relaxed pt-1">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              {fa ? "اعتبار فعلی" : "Current balance"}
            </span>
            <span className="font-semibold tabular-nums">{fmt(currentBalance, lang)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{fa ? "کسر می‌شود" : "Will be charged"}</span>
            <span className="font-semibold tabular-nums text-destructive">−{fmt(cost, lang)}</span>
          </div>
          <div className="h-px bg-border/60" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{fa ? "اعتبار باقی‌مانده" : "Remaining"}</span>
            <span className={`font-bold tabular-nums ${insufficient ? "text-destructive" : "text-primary"}`}>
              {fmt(after, lang)}
            </span>
          </div>
          {insufficient && (
            <p className="text-xs text-destructive pt-1">
              {fa
                ? "اعتبار کافی ندارید. ابتدا اعتبار خود را شارژ کنید."
                : "Not enough credits. Please top up first."}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel || (fa ? "انصراف" : "Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              if (insufficient || disabled) { e.preventDefault(); return; }
              onConfirm();
            }}
            className="bg-gradient-warm hover:opacity-90"
          >
            {confirmLabel || (fa ? "تأیید و پرداخت" : "Confirm & pay")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
