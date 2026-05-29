// Tree preview of the TOC the wizard would produce, plus a control to
// promote a custom Word style to H1 (for authors who didn't use the
// built-in "Heading 1" style).

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { flattenToc, type TocNode } from "@/lib/docx/toc-builder";

interface Props {
  toc: TocNode[];
  /** Free-text style name the user can supply if their headings aren't built-in. */
  customStyleName: string;
  onCustomStyleNameChange: (v: string) => void;
  /** Style ids/names actually present in the file (suggestions). */
  availableStyleNames: string[];
}

export const TocPreview = ({ toc, customStyleName, onCustomStyleNameChange, availableStyleNames }: Props) => {
  const flat = useMemo(() => flattenToc(toc), [toc]);

  return (
    <div className="space-y-3" dir="rtl">
      <div className="rounded-md border bg-secondary/30 p-3 space-y-2">
        <Label className="text-xs">نام Style سفارشی برای فصل‌ها (اختیاری)</Label>
        <Input
          value={customStyleName}
          onChange={(e) => onCustomStyleNameChange(e.target.value)}
          placeholder="مثلاً: ChapterTitle"
          className="h-9"
          list="available-styles"
        />
        <datalist id="available-styles">
          {availableStyleNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          اگر در Word به‌جای «Heading 1» از یک Style سفارشی برای عنوان فصل‌ها استفاده کرده‌اید،
          نام دقیق آن را اینجا وارد کنید. در غیر این صورت Heading 1/2/3 پیش‌فرض استفاده می‌شود.
        </p>
      </div>

      {toc.length === 0 ? (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">هیچ فصلی شناسایی نشد.</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              در Word روی هر تیتر فصل کلیک کنید و از پنل Styles، <b>Heading 1</b> را اعمال کنید،
              یا نام Style سفارشی خود را در کادر بالا وارد کنید.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-card max-h-[300px] overflow-auto p-2 text-sm">
          {flat.map((n) => (
            <div
              key={n.id}
              className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/40"
              style={{ paddingInlineStart: `${n.depth * 16 + 4}px` }}
            >
              {n.children.length > 0
                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
              <span className={`text-[10px] tabular-nums px-1 rounded ${
                n.level === 1 ? "bg-primary/15 text-primary" :
                n.level === 2 ? "bg-secondary text-secondary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>H{n.level}</span>
              <span className="truncate flex-1" dir="auto">{n.title}</span>
              {n.contentNodes < 2 && n.children.length === 0 && (
                <span className="text-[10px] text-amber-600">فصل کوچک</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
