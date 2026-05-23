// Dialog that lets the user configure chapter boundaries from a Table
// of Contents. Used by the editor for both fresh imports and
// re-conversions when auto TOC detection didn't kick in. Workflow:
//   1. Pick which page(s) contain the TOC (or "Let AI decide").
//   2. Extract entries (regex first, AI fallback).
//   3. Review/edit titles + nesting levels.
//   4. Apply → re-chapter the book in-place.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Trash2, ChevronRight, ChevronLeft, ListTree } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import type { TextPage } from "@/lib/tiptap-doc";

/* ---------------- Helpers ---------------- */

const nodeText = (node: any): string => {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) return node.content.map(nodeText).join("");
  return "";
};

const pageText = (p: TextPage): string => {
  const parts: string[] = [];
  if (p.title) parts.push(p.title);
  for (const n of (p.doc?.content ?? [])) {
    const t = nodeText(n).trim();
    if (t) parts.push(t);
  }
  return parts.join("\n");
};

const normTitle = (s: string): string =>
  String(s ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30))
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30))
    .replace(/[.\-\u2013\u2014:،,()«»"'\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Extract entries from a page using regex heuristics (mirrors server). */
const regexExtract = (text: string): Array<{ title: string; level: number }> => {
  const lines = text.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const out: Array<{ title: string; level: number }> = [];
  for (const raw of lines) {
    if (raw.length > 220) continue;
    if (/^(فهرست\s*(?:مطالب|کتاب)?|contents|table\s+of\s+contents)\s*$/i.test(raw)) continue;
    const cleaned = raw.replace(/[\s.·…\-\u2013\u2014_]+[\d\u06F0-\u06F9\u0660-\u0669]+\s*$/u, "").trim();
    if (!cleaned || cleaned.length < 2) continue;
    if (/^[\d\u06F0-\u06F9\u0660-\u0669\s.\-]+$/.test(cleaned)) continue;
    let level = 0;
    const m = /^([\d\u06F0-\u06F9\u0660-\u0669]+(?:[.\-][\d\u06F0-\u06F9\u0660-\u0669]+){0,4})\b/u.exec(cleaned);
    if (m) level = Math.min(4, Math.max(0, m[1].split(/[.\-]/).length - 1));
    out.push({ title: cleaned, level });
  }
  return out;
};

interface TocEntry { title: string; level: number; }

/** Re-split pages using a TOC entry list. */
export const applyTocClient = (
  pages: TextPage[],
  tocPageIdxs: Set<number>,
  entries: TocEntry[],
): TextPage[] => {
  if (!entries.length) return pages;
  const sorted = [...tocPageIdxs].sort((a, b) => a - b);
  const firstToc = sorted[0] ?? 0;
  // Keep pages before the first TOC page intact (front-matter).
  const before = pages.slice(0, firstToc);
  // Skip the TOC pages, consume the rest as candidate content.
  const restPages = pages.slice(firstToc).filter((_, k) => !tocPageIdxs.has(firstToc + k));

  // Flatten into a single linear node list, prefixing each page's title
  // as a synthetic heading so titles can also anchor against the TOC.
  type FlatNode = { __pageTitle?: boolean; node?: any; text: string };
  const flat: FlatNode[] = [];
  for (const p of restPages) {
    if (p.title) flat.push({ __pageTitle: true, text: p.title });
    for (const n of (p.doc?.content ?? [])) {
      flat.push({ node: n, text: nodeText(n) });
    }
  }

  const normEntries = entries.map((e) => ({ ...e, norm: normTitle(e.title) }));
  const out: TextPage[] = [];
  let cur: TextPage | null = null;
  let tocPos = 0;
  const lookahead = 25;

  for (const b of flat) {
    const text = (b.text || "").trim();
    let matched: { entry: TocEntry; pos: number } | null = null;
    if (text && text.length <= 220) {
      const n = normTitle(text);
      if (n.length >= 2) {
        for (let k = tocPos; k < Math.min(normEntries.length, tocPos + lookahead); k += 1) {
          const e = normEntries[k];
          if (!e.norm) continue;
          const isMatch =
            n === e.norm ||
            n.startsWith(e.norm + " ") ||
            (e.norm.length >= 8 && n.startsWith(e.norm)) ||
            (n.length >= 8 && e.norm.startsWith(n));
          if (isMatch) { matched = { entry: { title: e.title, level: e.level }, pos: k }; break; }
        }
      }
    }
    if (matched) {
      if (cur && (cur.doc.content?.length ?? 0) > 0) out.push(cur);
      cur = { title: matched.entry.title.slice(0, 160), doc: { type: "doc", content: [] }, level: matched.entry.level };
      tocPos = matched.pos + 1;
      continue;
    }
    if (b.__pageTitle) continue;
    if (!cur) cur = { title: restPages[0]?.title || "مقدمه", doc: { type: "doc", content: [] }, level: 0 };
    cur.doc.content!.push(b.node);
  }
  if (cur && (cur.doc.content?.length ?? 0) > 0) out.push(cur);

  // Too few matches → keep the original chaptering to avoid making things worse.
  if (out.length < Math.max(2, Math.floor(entries.length * 0.3))) return pages;
  return [...before, ...out];
};

/* ---------------- Component ---------------- */

type Step = "pick" | "review" | "applying";

export const ChapterTocDialog = ({
  open, onOpenChange, pages, bookId, onApply,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  pages: TextPage[];
  bookId?: string | null;
  onApply: (next: TextPage[]) => void;
}) => {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [loadingAuto, setLoadingAuto] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setEntries([]);
    // Pre-select pages whose title looks like "فهرست مطالب"
    const guess = new Set<number>();
    pages.slice(0, 8).forEach((p, i) => {
      if (/فهرست\s*(?:مطالب|کتاب)?|contents|table\s+of\s+contents/i.test(p.title || "")) guess.add(i);
    });
    setSelected(guess);
  }, [open, pages]);

  /** Use AI to both find TOC pages AND extract entries. */
  const detectWithAi = async () => {
    setLoadingAi(true);
    try {
      const sample = pages.slice(0, 8).map((p, i) => ({
        index: i, title: p.title || "", text: pageText(p).slice(0, 4000),
      }));
      const { data, error } = await supabase.functions.invoke("book-toc-detect", {
        body: { pages: sample, mode: "auto", lang, book_id: bookId },
      });
      if (error) throw error;
      const idxs: number[] = Array.isArray(data?.tocPageIndexes) ? data.tocPageIndexes : [];
      const ents: TocEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      if (!ents.length) {
        toast.info(fa ? "هوش مصنوعی فهرست را پیدا نکرد. صفحات فهرست را دستی انتخاب کنید." : "AI couldn't find a TOC. Pick pages manually.");
        return;
      }
      setSelected(new Set(idxs));
      setEntries(ents);
      setStep("review");
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطای تشخیص" : "Detection error"));
    } finally {
      setLoadingAi(false);
    }
  };

  /** Extract entries from currently-selected pages (regex first, AI fallback). */
  const extractFromSelected = async () => {
    if (!selected.size) {
      toast.info(fa ? "ابتدا صفحات فهرست را انتخاب کنید" : "Select TOC pages first");
      return;
    }
    setLoadingAuto(true);
    try {
      const text = [...selected].sort((a, b) => a - b).map((i) => pageText(pages[i])).join("\n");
      let ents = regexExtract(text);
      if (ents.length < 3) {
        // Ask the AI to parse the user-picked TOC pages.
        const sample = [...selected].sort((a, b) => a - b).map((i) => ({
          index: i, title: pages[i]?.title || "", text: pageText(pages[i]).slice(0, 4000),
        }));
        const { data, error } = await supabase.functions.invoke("book-toc-detect", {
          body: { pages: sample, mode: "pages", lang, book_id: bookId },
        });
        if (error) throw error;
        const aiEntries: TocEntry[] = Array.isArray(data?.entries) ? data.entries : [];
        if (aiEntries.length) ents = aiEntries;
      }
      if (ents.length < 2) {
        toast.error(fa ? "هیچ سرفصلی استخراج نشد" : "No entries extracted");
        return;
      }
      setEntries(ents);
      setStep("review");
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطای استخراج" : "Extraction error"));
    } finally {
      setLoadingAuto(false);
    }
  };

  const apply = () => {
    if (!entries.length) return;
    setStep("applying");
    try {
      const next = applyTocClient(pages, selected, entries);
      if (next === pages) {
        toast.error(fa ? "تعداد تطبیق کافی نبود — تغییری اعمال نشد." : "Not enough matches — no changes applied.");
        setStep("review");
        return;
      }
      onApply(next);
      toast.success(fa ? `فصل‌بندی روی ${next.length} فصل اعمال شد` : `Re-chaptered into ${next.length} sections`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطا در اعمال" : "Apply error"));
      setStep("review");
    }
  };

  const Back = fa ? ChevronRight : ChevronLeft;
  const Fwd  = fa ? ChevronLeft : ChevronRight;
  const previewPages = useMemo(() => pages.slice(0, 12), [pages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTree className="w-4 h-4 text-accent" />
            {fa ? "فصل‌بندی از روی فهرست مطالب" : "Re-chapter from Table of Contents"}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {fa
                ? "صفحه‌ای که فهرست مطالب کتاب در آن قرار دارد را انتخاب کنید، یا اجازه دهید هوش مصنوعی خودش پیدا کند."
                : "Pick the page(s) that contain the TOC, or let AI find them for you."}
            </p>
            <div className="border rounded-lg max-h-72 overflow-y-auto divide-y">
              {previewPages.map((p, i) => {
                const checked = selected.has(i);
                const preview = pageText(p).slice(0, 160).replace(/\s+/g, " ");
                return (
                  <label key={i} className="flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (v) n.add(i); else n.delete(i);
                          return n;
                        });
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        <span className="text-[10px] text-muted-foreground me-1">{i + 1}.</span>
                        {p.title || (fa ? "بدون عنوان" : "Untitled")}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{preview}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {fa ? "انصراف" : "Cancel"}
              </Button>
              <Button variant="secondary" onClick={detectWithAi} disabled={loadingAi || loadingAuto} className="gap-1.5">
                {loadingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {fa ? "ادامه با هوش مصنوعی" : "Let AI decide"}
              </Button>
              <Button onClick={extractFromSelected} disabled={loadingAi || loadingAuto || selected.size === 0} className="gap-1.5">
                {loadingAuto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fwd className="w-4 h-4" />}
                {fa ? "استخراج فهرست" : "Extract TOC"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {fa
                ? `${entries.length} سرفصل استخراج شد. عنوان‌ها و سطح تودرتویی را بررسی/ویرایش کنید و اعمال کنید.`
                : `${entries.length} entries extracted. Review titles + nesting levels and apply.`}
            </p>
            <div className="border rounded-lg max-h-80 overflow-y-auto divide-y">
              {entries.map((e, i) => (
                <div key={i} className="flex items-center gap-2 p-2" style={{ paddingInlineStart: 8 + e.level * 14 }}>
                  <span className="text-[10px] text-muted-foreground w-5 shrink-0 tabular-nums">{i + 1}</span>
                  <Input
                    value={e.title}
                    onChange={(ev) =>
                      setEntries((es) => es.map((x, k) => (k === i ? { ...x, title: ev.target.value } : x)))
                    }
                    className="h-8 text-sm"
                    dir="auto"
                  />
                  <Select
                    value={String(e.level)}
                    onValueChange={(v) =>
                      setEntries((es) => es.map((x, k) => (k === i ? { ...x, level: Number(v) } : x)))
                    }
                  >
                    <SelectTrigger className="h-8 w-20 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4].map((l) => (
                        <SelectItem key={l} value={String(l)}>
                          {fa ? "سطح" : "Level"} {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}
                    title={fa ? "حذف" : "Remove"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              {!entries.length && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {fa ? "هیچ سرفصلی باقی نمانده است." : "No entries left."}
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setStep("pick")} className="gap-1.5">
                <Back className="w-4 h-4" />
                {fa ? "بازگشت" : "Back"}
              </Button>
              <Button onClick={apply} disabled={entries.length < 2} className="gap-1.5">
                {fa ? "اعمال فصل‌بندی" : "Apply chaptering"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "applying" && (
          <div className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {fa ? "در حال اعمال…" : "Applying…"}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
