// Dialog that lets the user configure chapter boundaries from a Table
// of Contents. Used by the editor for both fresh imports and
// re-conversions when auto TOC detection didn't kick in. Workflow:
//   1. Pick which page(s) contain the TOC (or "Let AI decide") OR paste manually.
//   2. Extract entries (regex first, AI fallback).
//   3. Review/edit titles + nesting levels, AND see which Word page each entry
//      was matched to (with a 2-line preview). User can override the page.
//   4. Apply → re-chapter the book in-place.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Loader2, Trash2, ChevronRight, ChevronLeft, ListTree, ClipboardPaste, FileSearch, AlertTriangle, Plus, Minus, CheckSquare, Square } from "lucide-react";
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

/** First N non-empty lines of a page (title + block texts), trimmed. */
const pageFirstLines = (p: TextPage, n: number = 2): string[] => {
  const out: string[] = [];
  if (p.title) out.push(p.title.trim());
  for (const node of (p.doc?.content ?? [])) {
    if (out.length >= n) break;
    const t = nodeText(node).trim().replace(/\s+/g, " ");
    if (t) out.push(t);
  }
  return out.slice(0, n);
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

const cleanManualTocLine = (raw: string): string =>
  String(raw ?? "")
    .replace(/^[\s•●▪▫*-]+/u, "")
    .replace(/[\s.·…_\-\u2013\u2014]+[\d\u06F0-\u06F9\u0660-\u0669]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

const pageSearchLines = (p: TextPage): string[] => {
  const out: string[] = [];
  if (p.title) out.push(p.title);
  for (const node of (p.doc?.content ?? [])) {
    const t = nodeText(node);
    if (!t) continue;
    for (const line of t.split(/\r?\n+/)) {
      const s = line.trim();
      if (s) out.push(s);
    }
  }
  return out;
};

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

/** For each pasted/manual entry, suggest the first Word page where that
 *  complete line appears. TOC pages are skipped when the user selected them. */
const computeMatches = (
  pages: TextPage[],
  tocSet: Set<number>,
  entries: TocEntry[],
): Array<number | null> => {
  const sorted = [...tocSet].sort((a, b) => a - b);
  const start = sorted.length ? Math.max(...sorted) + 1 : 0;
  const matches: Array<number | null> = new Array(entries.length).fill(null);
  const index = pages.map((p) => {
    const lines = pageSearchLines(p).map(normTitle).filter(Boolean);
    return { lines, full: normTitle(pageText(p)) };
  });
  for (let i = 0; i < entries.length; i += 1) {
    const norm = normTitle(cleanManualTocLine(entries[i].title));
    if (!norm) continue;
    let found = -1;
    for (let p = start; p < pages.length; p += 1) {
      if (tocSet.has(p)) continue;
      const hit = index[p].lines.some((c) =>
        c === norm ||
        c.startsWith(norm + " ") ||
        (norm.length >= 8 && c.startsWith(norm)) ||
        (c.length >= 8 && norm.startsWith(c)),
      ) || (norm.length >= 10 && index[p].full.includes(norm));
      if (hit) { found = p; break; }
    }
    if (found >= 0) matches[i] = found;
  }
  return matches;
};

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const computeMatchesAsync = async (
  pages: TextPage[],
  tocSet: Set<number>,
  entries: TocEntry[],
  onProgress?: (done: number) => void,
): Promise<Array<number | null>> => {
  const sorted = [...tocSet].sort((a, b) => a - b);
  const start = sorted.length ? Math.max(...sorted) + 1 : 0;
  const matches: Array<number | null> = new Array(entries.length).fill(null);
  const index = pages.map((p) => {
    const lines = pageSearchLines(p).map(normTitle).filter(Boolean);
    return { lines, full: normTitle(pageText(p)) };
  });
  for (let i = 0; i < entries.length; i += 1) {
    const norm = normTitle(cleanManualTocLine(entries[i].title));
    if (norm) {
      for (let p = start; p < pages.length; p += 1) {
        if (tocSet.has(p)) continue;
        const hit = index[p].lines.some((c) =>
          c === norm ||
          c.startsWith(norm + " ") ||
          (norm.length >= 8 && c.startsWith(norm)) ||
          (c.length >= 8 && norm.startsWith(c)),
        ) || (norm.length >= 10 && index[p].full.includes(norm));
        if (hit) { matches[i] = p; break; }
      }
    }
    if (i % 8 === 7) {
      onProgress?.(i + 1);
      await yieldToBrowser();
    }
  }
  onProgress?.(entries.length);
  return matches;
};

/** Re-split pages using a TOC entry list. When `pageHints` is provided
 *  (one optional hint per entry), we slice the book at those page boundaries
 *  instead of fuzzy-matching block-by-block. Otherwise the original
 *  block-walking algorithm is used. */
export const applyTocClient = (
  pages: TextPage[],
  tocPageIdxs: Set<number>,
  entries: TocEntry[],
  pageHints?: Array<number | null>,
): TextPage[] => {
  if (!entries.length) return pages;

  /* ---------- Hint-based slicing (preferred when hints exist) ---------- */
  if (pageHints && pageHints.some((h) => typeof h === "number")) {
    const hinted = entries
      .map((e, i) => ({ e, h: pageHints[i] ?? null, pos: i }))
      .filter((x) => typeof x.h === "number") as Array<{ e: TocEntry; h: number; pos: number }>;
    hinted.sort((a, b) => a.h - b.h || a.pos - b.pos);
    const uniqueHinted = hinted.filter((x, i) => i === 0 || x.h !== hinted[i - 1].h);
    if (uniqueHinted.length >= 1) {
      const firstHint = uniqueHinted[0].h;
      const before = pages.slice(0, firstHint).filter((_, k) => !tocPageIdxs.has(k));
      const out: TextPage[] = [];
      for (let k = 0; k < uniqueHinted.length; k += 1) {
        const start = uniqueHinted[k].h;
        const end = k + 1 < uniqueHinted.length ? uniqueHinted[k + 1].h : pages.length;
        for (let p = start; p < end; p += 1) {
          if (tocPageIdxs.has(p)) continue;
          const source = pages[p];
          const title = p === start ? uniqueHinted[k].e.title.slice(0, 160) : (source.title || `Page ${p + 1}`);
          out.push({
            ...source,
            title,
            level: p === start ? uniqueHinted[k].e.level : uniqueHinted[k].e.level + 1,
            doc: { type: "doc", content: [...(source.doc?.content ?? [])] },
          });
        }
      }
      return [...before, ...out];
    }
  }

  /* ---------- Fallback: block-walking fuzzy match ---------- */
  const sorted = [...tocPageIdxs].sort((a, b) => a - b);
  const firstToc = sorted[0] ?? 0;
  const before = pages.slice(0, firstToc);
  const restPages = pages.slice(firstToc).filter((_, k) => !tocPageIdxs.has(firstToc + k));

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
  const [matches, setMatches] = useState<Array<number | null>>([]);
  // Tracks which entries the user manually re-pointed to a different page.
  const [overrides, setOverrides] = useState<Set<number>>(new Set());
  const [selectedEntryIdx, setSelectedEntryIdx] = useState<number | null>(null);
  // Multi-select state for bulk level changes / deletion.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loadingAi, setLoadingAi] = useState(false);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [loadingPaste, setLoadingPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteMode, setPasteMode] = useState<"pages" | "paste">("pages");
  const [pasteLevelMode, setPasteLevelMode] = useState<"ai" | "flat">("ai");

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setEntries([]);
    setMatches([]);
    setOverrides(new Set());
    setPicked(new Set());
    setSelectedEntryIdx(null);
    setPasted("");
    setPasteMode("pages");
    setPasteLevelMode("ai");
    const guess = new Set<number>();
    pages.slice(0, 8).forEach((p, i) => {
      if (/فهرست\s*(?:مطالب|کتاب)?|contents|table\s+of\s+contents/i.test(p.title || "")) guess.add(i);
    });
    setSelected(guess);
  }, [open, pages]);

  /** Recompute matches whenever entries or TOC-page selection change. */
  useEffect(() => {
    if (step !== "review" || entries.length === 0) return;
    setMatches((prev) => {
      // Preserve user-overridden matches; only auto-fill the rest.
      const fresh = computeMatches(pages, selected, entries);
      if (prev.length !== entries.length) return fresh;
      return fresh.map((m, i) => (overrides.has(i) && prev[i] != null ? prev[i] : m));
    });
    setSelectedEntryIdx((i) => (i != null && i < entries.length ? i : null));
  }, [step, entries, pages, selected, overrides]);

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

  const extractFromPaste = async () => {
    const lines = pasted.split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 2 && l.length <= 220);
    if (lines.length < 2) {
      toast.info(fa ? "حداقل دو خط (دو سرفصل) وارد کنید" : "Enter at least two lines");
      return;
    }
    setLoadingPaste(true);
    try {
      const regexLevel = (title: string): number => {
        const m = /^([\d\u06F0-\u06F9\u0660-\u0669]+(?:[.\-][\d\u06F0-\u06F9\u0660-\u0669]+){0,4})\b/u.exec(title);
        if (!m) return 0;
        return Math.min(4, Math.max(0, m[1].split(/[.\-]/).length - 1));
      };
      const ents: TocEntry[] = lines.map((title) => ({ title, level: regexLevel(title) }));
      if (pasteLevelMode === "ai") {
        try {
          const sample = [{ index: 0, title: fa ? "فهرست مطالب (دستی)" : "Manual TOC", text: lines.join("\n") }];
          const { data, error } = await supabase.functions.invoke("book-toc-detect", {
            body: { pages: sample, mode: "pages", lang, book_id: bookId },
          });
          if (!error) {
            const aiEntries: Array<{ title: string; level?: number }> =
              Array.isArray(data?.entries) ? data.entries : [];
            if (aiEntries.length) {
              const aiByNorm = new Map<string, number>();
              for (const a of aiEntries) {
                const n = normTitle(a.title || "");
                if (!n) continue;
                const lvl = Math.max(0, Math.min(4, Math.floor(Number(a.level) || 0)));
                if (!aiByNorm.has(n)) aiByNorm.set(n, lvl);
              }
              for (const e of ents) {
                const n = normTitle(e.title);
                if (aiByNorm.has(n)) { e.level = aiByNorm.get(n)!; continue; }
                for (const [k, v] of aiByNorm) {
                  if (k.length >= 6 && (n.startsWith(k) || k.startsWith(n))) { e.level = v; break; }
                }
              }
            }
          }
        } catch { /* fall back silently */ }
      }
      setSelected(new Set());
      setEntries(ents);
      setStep("review");
    } catch (e: any) {
      toast.error(e?.message || (fa ? "خطای پردازش" : "Processing error"));
    } finally {
      setLoadingPaste(false);
    }
  };

  const apply = () => {
    if (!entries.length) return;
    setStep("applying");
    try {
      const next = applyTocClient(pages, selected, entries, matches);
      if (next === pages) {
        // Diagnose: how many entries actually got matched to a page?
        const matchedCount = matches.filter((m) => typeof m === "number").length;
        const missing = entries.length - matchedCount;
        const msg = fa
          ? `از ${entries.length} سرفصل فقط ${matchedCount} مورد در متن کتاب پیدا شد (کمتر از ۳۰٪). برای حل این مشکل: ۱) روی سرفصل‌هایی که نشانگر «؟» قرمز دارند کلیک کنید و صفحهٔ درست را از پیش‌نمایش انتخاب کنید. ۲) عناوین فهرست را با عنوان واقعی فصل در ورد یکسان کنید. ۳) اگر چند سرفصل پشت سر هم دستی تعیین کنید، بقیه به‌صورت خودکار بین آن‌ها برش می‌خورد. (${missing} سرفصل بدون تطبیق)`
          : `Only ${matchedCount} of ${entries.length} entries were matched in the book text (under 30%). Fixes: 1) click entries marked with a red "?" and pick the right page from the preview. 2) make TOC titles match real chapter headings in Word. 3) once you manually pin 2+ entries, the rest are sliced between them automatically. (${missing} unmatched)`;
        toast.error(msg, { duration: 12000 });
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

  /* ---------- Level helpers (per-row + bulk) ---------- */
  const clampLvl = (n: number) => Math.max(0, Math.min(4, n));
  const bumpLevel = (idx: number, delta: number) => {
    setEntries((es) => es.map((x, k) => (k === idx ? { ...x, level: clampLvl(x.level + delta) } : x)));
  };
  const bulkBumpLevel = (delta: number) => {
    if (!picked.size) return;
    setEntries((es) => es.map((x, k) => (picked.has(k) ? { ...x, level: clampLvl(x.level + delta) } : x)));
  };
  const bulkDelete = () => {
    if (!picked.size) return;
    const remove = picked;
    setEntries((es) => es.filter((_, k) => !remove.has(k)));
    setMatches((ms) => ms.filter((_, k) => !remove.has(k)));
    setOverrides((ov) => {
      const sorted = [...remove].sort((a, b) => a - b);
      const n = new Set<number>();
      for (const v of ov) {
        if (remove.has(v)) continue;
        const shift = sorted.filter((s) => s < v).length;
        n.add(v - shift);
      }
      return n;
    });
    setPicked(new Set());
    setSelectedEntryIdx(null);
  };
  const toggleAllPicked = () => {
    if (picked.size === entries.length) setPicked(new Set());
    else setPicked(new Set(entries.map((_, i) => i)));
  };

  const Back = fa ? ChevronRight : ChevronLeft;
  const Fwd  = fa ? ChevronLeft : ChevronRight;
  const previewPages = useMemo(() => pages.slice(0, 12), [pages]);

  const previewBlock = useMemo(() => {
    if (selectedEntryIdx == null) return null;
    const pageIdx = matches[selectedEntryIdx];
    if (pageIdx == null) {
      return {
        pageIdx: null as number | null,
        title: entries[selectedEntryIdx]?.title || "",
        lines: [],
        notFound: true,
      };
    }
    const p = pages[pageIdx];
    return {
      pageIdx,
      title: entries[selectedEntryIdx]?.title || "",
      lines: pageFirstLines(p, 2),
      notFound: false,
    };
  }, [selectedEntryIdx, matches, pages, entries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTree className="w-4 h-4 text-accent" />
            {fa ? "فصل‌بندی از روی فهرست مطالب" : "Re-chapter from Table of Contents"}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" && (
          <Tabs value={pasteMode} onValueChange={(v) => setPasteMode(v as "pages" | "paste")} className="space-y-3">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="pages" className="gap-1.5">
                <ListTree className="w-3.5 h-3.5" />
                {fa ? "از صفحات کتاب" : "From book pages"}
              </TabsTrigger>
              <TabsTrigger value="paste" className="gap-1.5">
                <ClipboardPaste className="w-3.5 h-3.5" />
                {fa ? "وارد کردن دستی" : "Paste manually"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pages" className="space-y-3 mt-0">
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
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 mt-0">
              <p className="text-sm text-muted-foreground">
                {fa
                  ? "اگر فهرست در فایل ورد درست تشخیص داده نشد، آن را از هر منبعی کپی و اینجا بچسبانید. هر سطر = یک سرفصل."
                  : "If the Word file's TOC wasn't detected, paste it here from any source. One title per line."}
              </p>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={fa
                  ? "فصل اول: مقدمه\n۱.۱ تاریخچه\n۱.۲ اهمیت موضوع\nفصل دوم: روش‌ها\n…"
                  : "Chapter 1: Introduction\n1.1 History\n1.2 Significance\nChapter 2: Methods\n…"}
                className="min-h-[200px] text-sm font-mono"
                dir="auto"
              />
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{fa ? "تعیین سطح:" : "Levels:"}</span>
                <Select value={pasteLevelMode} onValueChange={(v) => setPasteLevelMode(v as "ai" | "flat")}>
                  <SelectTrigger className="h-8 w-48 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ai">{fa ? "هوش مصنوعی سطح‌بندی کند" : "AI infers nesting"}</SelectItem>
                    <SelectItem value="flat">{fa ? "بدون تودرتو (همه سطح ۰)" : "Flat (all level 0)"}</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground ms-auto">
                  {pasted.split(/\r?\n+/).filter((l) => l.trim().length >= 2).length} {fa ? "سطر" : "lines"}
                </span>
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {fa ? "انصراف" : "Cancel"}
                </Button>
                <Button onClick={extractFromPaste} disabled={loadingPaste || pasted.trim().length < 4} className="gap-1.5">
                  {loadingPaste
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : (pasteLevelMode === "ai" ? <Sparkles className="w-4 h-4" /> : <Fwd className="w-4 h-4" />)}
                  {fa ? "پردازش فهرست" : "Process TOC"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        )}

        {step === "review" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground flex-1">
                {fa
                  ? `${entries.length} سرفصل استخراج شد. روی هر عنوان کلیک کنید تا صفحهٔ تطبیق‌شده در ورد و دو سطر اول آن را ببینید. در صورت اشتباه می‌توانید صفحهٔ درست را انتخاب کنید.`
                  : `${entries.length} entries extracted. Click any entry to see its matched Word page and a 2-line preview. Override the page if wrong.`}
              </p>
              {overrides.size > 0 && (
                <span className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/30 shrink-0">
                  {fa ? `${overrides.size} تطبیق دستی` : `${overrides.size} manual`}
                </span>
              )}
            </div>

            {/* Bulk-action toolbar */}
            <div className="flex items-center gap-2 flex-wrap rounded-lg border bg-muted/30 px-2 py-1.5">
              <button
                type="button"
                onClick={toggleAllPicked}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title={fa ? "انتخاب همه / لغو همه" : "Select all / none"}
              >
                {picked.size === entries.length && entries.length > 0
                  ? <CheckSquare className="w-3.5 h-3.5" />
                  : <Square className="w-3.5 h-3.5" />}
                <span>{fa ? "همه" : "All"}</span>
              </button>
              <span className="text-xs text-muted-foreground">
                {picked.size > 0
                  ? (fa ? `${picked.size} انتخاب شده` : `${picked.size} selected`)
                  : (fa ? "برای تغییر گروهی، فصل‌ها را تیک بزنید" : "Tick items for bulk actions")}
              </span>
              <div className="ms-auto flex items-center gap-1">
                <Button
                  size="sm" variant="outline" className="h-7 px-2 gap-1"
                  disabled={!picked.size}
                  onClick={() => bulkBumpLevel(-1)}
                  title={fa ? "کاهش سطح (Outdent)" : "Decrease level"}
                >
                  <Minus className="w-3.5 h-3.5" />
                  {fa ? "سطح" : "Lvl"}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 px-2 gap-1"
                  disabled={!picked.size}
                  onClick={() => bulkBumpLevel(+1)}
                  title={fa ? "افزایش سطح (Indent)" : "Increase level"}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {fa ? "سطح" : "Lvl"}
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-destructive gap-1"
                  disabled={!picked.size}
                  onClick={bulkDelete}
                  title={fa ? "حذف انتخاب‌شده‌ها" : "Delete selected"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {/* Entry list */}
              <div className="md:col-span-3 border rounded-lg max-h-[22rem] overflow-y-auto divide-y bg-background">
                {entries.map((e, i) => {
                  const m = matches[i];
                  const active = selectedEntryIdx === i;
                  const isPicked = picked.has(i);
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-1.5 px-2 py-1.5 ${active ? "bg-accent/10" : isPicked ? "bg-primary/5" : "hover:bg-muted/40"}`}
                      style={{ paddingInlineStart: 6 + e.level * 12 }}
                    >
                      <Checkbox
                        checked={isPicked}
                        onCheckedChange={(v) => {
                          setPicked((prev) => {
                            const n = new Set(prev);
                            if (v) n.add(i); else n.delete(i);
                            return n;
                          });
                        }}
                        className="shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedEntryIdx(i)}
                        className="text-[10px] text-muted-foreground w-5 shrink-0 tabular-nums text-start"
                      >
                        {i + 1}
                      </button>
                      <Input
                        value={e.title}
                        onFocus={() => setSelectedEntryIdx(i)}
                        onChange={(ev) =>
                          setEntries((es) => es.map((x, k) => (k === i ? { ...x, title: ev.target.value } : x)))
                        }
                        className="h-7 text-sm min-w-0 flex-1"
                        dir="auto"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedEntryIdx(i)}
                        className={`text-[11px] font-semibold shrink-0 px-1.5 py-1 rounded-md border tabular-nums min-w-[3rem] text-center ${
                          m == null
                            ? "text-destructive border-destructive/50 bg-destructive/10"
                            : overrides.has(i)
                              ? "text-primary-foreground border-primary bg-primary"
                              : "text-accent-foreground border-accent/40 bg-accent/15 hover:bg-accent/25"
                        }`}
                        title={
                          overrides.has(i)
                            ? (fa ? "تعیین‌شده توسط شما" : "Manually set")
                            : (fa ? "شمارهٔ صفحه در ورد" : "Word page")
                        }
                      >
                        {m == null
                          ? (fa ? "؟" : "?")
                          : (fa ? `${overrides.has(i) ? "✓" : ""}ص${m + 1}` : `${overrides.has(i) ? "✓" : ""}p${m + 1}`)}
                      </button>
                      {/* Level +/- group */}
                      <div className="flex items-center rounded-md border bg-muted/30 shrink-0">
                        <button
                          type="button"
                          onClick={() => bumpLevel(i, -1)}
                          disabled={e.level === 0}
                          className="h-7 w-6 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                          title={fa ? "کاهش سطح" : "Decrease level"}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] font-semibold tabular-nums w-4 text-center text-muted-foreground">{e.level}</span>
                        <button
                          type="button"
                          onClick={() => bumpLevel(i, +1)}
                          disabled={e.level >= 4}
                          className="h-7 w-6 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                          title={fa ? "افزایش سطح" : "Increase level"}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEntries((es) => es.filter((_, k) => k !== i));
                          setMatches((ms) => ms.filter((_, k) => k !== i));
                          setOverrides((ov) => {
                            const n = new Set<number>();
                            for (const v of ov) {
                              if (v < i) n.add(v);
                              else if (v > i) n.add(v - 1);
                            }
                            return n;
                          });
                          setPicked((pk) => {
                            const n = new Set<number>();
                            for (const v of pk) {
                              if (v === i) continue;
                              n.add(v > i ? v - 1 : v);
                            }
                            return n;
                          });
                        }}
                        className="h-7 w-7 grid place-items-center text-destructive shrink-0 hover:bg-destructive/10 rounded-md"
                        title={fa ? "حذف" : "Remove"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {!entries.length && (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    {fa ? "هیچ سرفصلی باقی نمانده است." : "No entries left."}
                  </div>
                )}
              </div>

              {/* Preview panel */}
              <div className="md:col-span-2 border rounded-lg p-3 bg-muted/20 max-h-[22rem] overflow-y-auto">
                <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
                  <FileSearch className="w-3.5 h-3.5 text-accent" />
                  {fa ? "پیش‌نمایش صفحهٔ ورد" : "Word page preview"}
                </div>
                {previewBlock == null && (
                  <div className="text-[11px] text-muted-foreground">
                    {fa ? "روی یک سرفصل کلیک کنید." : "Click an entry to preview."}
                  </div>
                )}
                {previewBlock?.notFound && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {fa ? "تطبیق پیدا نشد." : "No match found."}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fa ? "صفحهٔ درست را از لیست زیر انتخاب کنید:" : "Pick the correct page:"}
                    </div>
                    <Select
                      value=""
                      onValueChange={(v) => {
                        const idx = selectedEntryIdx;
                        if (idx == null) return;
                        setMatches((ms) => ms.map((x, k) => (k === idx ? Number(v) : x)));
                        setOverrides((ov) => new Set(ov).add(idx));
                        toast.success(fa ? `سرفصل به صفحهٔ ${Number(v) + 1} منتقل شد` : `Entry moved to page ${Number(v) + 1}`);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={fa ? "انتخاب صفحه…" : "Pick a page…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {pages.map((p, k) => (
                          <SelectItem key={k} value={String(k)} disabled={selected.has(k)}>
                            {fa ? `ص ${k + 1}` : `p${k + 1}`} — {(p.title || pageFirstLines(p, 1)[0] || "").slice(0, 40)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {previewBlock && !previewBlock.notFound && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">
                      {fa ? "صفحهٔ ورد" : "Word page"}{" "}
                      <span className="font-mono text-foreground">
                        {(previewBlock.pageIdx ?? 0) + 1}
                      </span>{" "}
                      / {pages.length}
                    </div>
                    <div className="text-sm font-medium leading-snug" dir="auto">
                      {previewBlock.title}
                    </div>
                    <div className="border-t pt-2 space-y-1">
                      {previewBlock.lines.length === 0 && (
                        <div className="text-[11px] text-muted-foreground italic">
                          {fa ? "این صفحه متنی ندارد." : "This page has no text."}
                        </div>
                      )}
                      {previewBlock.lines.map((ln, k) => (
                        <div key={k} className="text-[12px] leading-relaxed text-foreground/90 line-clamp-3" dir="auto">
                          {ln}
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-2 space-y-1">
                      <div className="text-[11px] text-muted-foreground">
                        {fa ? "اگر اشتباه است، صفحهٔ درست را انتخاب کنید:" : "Wrong page? Override:"}
                      </div>
                      <Select
                        value={previewBlock.pageIdx != null ? String(previewBlock.pageIdx) : ""}
                        onValueChange={(v) => {
                          const idx = selectedEntryIdx;
                          if (idx == null) return;
                          setMatches((ms) => ms.map((x, k) => (k === idx ? Number(v) : x)));
                          setOverrides((ov) => new Set(ov).add(idx));
                          toast.success(fa ? `سرفصل به صفحهٔ ${Number(v) + 1} منتقل شد` : `Entry moved to page ${Number(v) + 1}`);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pages.map((p, k) => (
                            <SelectItem key={k} value={String(k)} disabled={selected.has(k)}>
                              {fa ? `ص ${k + 1}` : `p${k + 1}`} — {(p.title || pageFirstLines(p, 1)[0] || "").slice(0, 40)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
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
