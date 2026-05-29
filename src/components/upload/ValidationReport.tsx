// Renders the wizard's pre-upload validation report — one row per check
// with a colored badge and an optional fix-hint.

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { ValidationItem } from "@/lib/docx/validator";

const ICON = {
  ok: { Icon: CheckCircle2, cls: "text-emerald-600" },
  warn: { Icon: AlertTriangle, cls: "text-amber-600" },
  error: { Icon: XCircle, cls: "text-destructive" },
} as const;

export const ValidationReport = ({ items }: { items: ValidationItem[] }) => (
  <div className="space-y-1.5" dir="rtl">
    {items.map((it) => {
      const { Icon, cls } = ICON[it.severity];
      return (
        <div key={it.key} className="rounded-md border p-2.5 bg-card/40 flex items-start gap-2">
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cls}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{it.title}</span>
              <span className="text-xs text-muted-foreground truncate">{it.message}</span>
            </div>
            {it.fix && (
              <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                💡 {it.fix}
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);
