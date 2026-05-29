// Tree preview of the TOC the wizard would produce, plus a control to
// promote a custom Word style to H1, and inline edit/delete of each
// detected heading (up to 8 levels). Edits mutate the AST via callbacks.

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle, Pencil, Trash2, Check, X } from "lucide-react";
import { flattenToc, type TocNode } from "@/lib/docx/toc-builder";

interface Props {
  toc: TocNode[];
  customStyleName: string;
  onCustomStyleNameChange: (v: string) => void;
  availableStyleNames: string[];
  /** Update the heading at AST index with new title/level. */
  onEditHeading?: (index: number, level: 1|2|3|4|5|6|7|8, title: string) => void;
  /** Remove the heading at AST index (demoted to paragraph or removed). */
  onDeleteHeading?: (index: number) => void;
}

const LEVEL_BG: Record<number, string> = {
  1: "bg-primary/15 text-primary",
  2: "bg-secondary text-secondary-foreground",
  3: "bg-muted text-muted-foreground",
  4: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  5: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  6: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  7: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  8: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export const TocPreview = ({
  toc, customStyleName, onCustomStyleNameChange, availableStyleNames,
  onEditHeading, onDeleteHeading,
}: Props) => {
  const flat = useMemo(() => flattenToc(toc), [toc]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editLevel, setEditLevel] = useState<number>(1);

  const startEdit = (n: { index: number; title: string; level: number }) => {
    setEditIdx(n.index);
    setEditTitle(n.title);
    setEditLevel(n.level);
  };
  const cancelEdit = () => { setEditIdx(null); setEditTitle(""); };
  const commitEdit = () => {
    if (editIdx === null) return;
    const lv = Math.min(8, Math.max(1, Math.floor(editLevel))) as 1|2|3|4|5|6|7|8;
    onEditHeading?.(editIdx, lv, editTitle.trim() || "—");
    cancelEdit();
  };

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
          نام دقیق آن را اینجا وارد کنید. در غیر این صورت Heading 1 تا 8 پیش‌فرض استفاده می‌شود.
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
        <div className="rounded-md border bg-card max-h-[420px] overflow-auto p-2 text-sm">
          {flat.map((n) => {
            const isEditing = editIdx === n.index;
            return (
              <div
                key={n.id}
                className="group flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/40"
                style={{ paddingInlineStart: `${n.depth * 14 + 4}px` }}
              >
                {n.children.length > 0
                  ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}

                {isEditing ? (
                  <>
                    <select
                      value={editLevel}
                      onChange={(e) => setEditLevel(Number(e.target.value))}
                      className="h-7 rounded border bg-background px-1 text-[11px]"
                    >
                      {[1,2,3,4,5,6,7,8].map((lv) => <option key={lv} value={lv}>H{lv}</option>)}
                    </select>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-7 flex-1 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        else if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitEdit} title="ذخیره">
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit} title="انصراف">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={`text-[10px] tabular-nums px-1 rounded ${LEVEL_BG[n.level] ?? LEVEL_BG[3]}`}>
                      H{n.level}
                    </span>
                    <span className="truncate flex-1" dir="auto">{n.title}</span>
                    {n.contentNodes < 2 && n.children.length === 0 && (
                      <span className="text-[10px] text-amber-600">فصل کوچک</span>
                    )}
                    {onEditHeading && (
                      <Button
                        size="icon" variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => startEdit(n)}
                        title="ویرایش"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    {onDeleteHeading && (
                      <Button
                        size="icon" variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                        onClick={() => onDeleteHeading(n.index)}
                        title="حذف (تبدیل به پاراگراف)"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
