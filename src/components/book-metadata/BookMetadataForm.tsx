// Shared, reusable book-metadata form. Used at:
//   • the Word-import upload page (collected before conversion),
//   • the live editor (Metadata dialog),
//   • the Publish wizard (final review).
//
// Holds rich bibliographic fields: book type, multiple contributors
// (author / co-author / translator / editor / illustrator / foreword /
// compiler), publication year, publisher, ISBN, page count, edition,
// series, original title/language, multiple categories and subjects.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Contributor = {
  name: string;
  role: ContributorRole;
  user_id?: string | null;
};

export type ContributorRole =
  | "author"
  | "coauthor"
  | "translator"
  | "editor"
  | "compiler"
  | "illustrator"
  | "foreword"
  | "narrator";

export interface BookMetadata {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  book_type: BookType;
  contributors: Contributor[];
  /** Optional publishing house (free text). */
  publisher?: string | null;
  publication_year?: number | null;
  edition?: string | null;
  isbn?: string | null;
  page_count?: number | null;
  language?: string | null;
  original_title?: string | null;
  original_language?: string | null;
  categories: string[];
  subjects: string[];
  series_name?: string | null;
  series_index?: number | null;
}

export type BookType =
  | "authored"
  | "translation"
  | "compilation"
  | "edited"
  | "adaptation"
  | "anthology"
  | "textbook";

export const DEFAULT_METADATA: BookMetadata = {
  title: "",
  subtitle: "",
  description: "",
  book_type: "authored",
  contributors: [{ name: "", role: "author" }],
  publisher: "",
  publication_year: null,
  edition: "",
  isbn: "",
  page_count: null,
  language: "fa",
  original_title: "",
  original_language: "",
  categories: [],
  subjects: [],
  series_name: "",
  series_index: null,
};

const BOOK_TYPE_LABELS: Record<BookType, { fa: string; en: string }> = {
  authored: { fa: "تألیف", en: "Authored" },
  translation: { fa: "ترجمه", en: "Translation" },
  compilation: { fa: "گردآوری", en: "Compilation" },
  edited: { fa: "ویراستاری", en: "Edited" },
  adaptation: { fa: "اقتباس", en: "Adaptation" },
  anthology: { fa: "مجموعه/گزیده", en: "Anthology" },
  textbook: { fa: "درسی", en: "Textbook" },
};

const ROLE_LABELS: Record<ContributorRole, { fa: string; en: string }> = {
  author: { fa: "نویسنده", en: "Author" },
  coauthor: { fa: "هم‌نویسنده", en: "Co-author" },
  translator: { fa: "مترجم", en: "Translator" },
  editor: { fa: "ویراستار", en: "Editor" },
  compiler: { fa: "گردآورنده", en: "Compiler" },
  illustrator: { fa: "تصویرگر", en: "Illustrator" },
  foreword: { fa: "مقدمه‌نویس", en: "Foreword by" },
  narrator: { fa: "گوینده", en: "Narrator" },
};

/** Deep-merge a partial DB shape onto defaults so optional fields render. */
export const normalizeMetadata = (raw: Partial<BookMetadata> | null | undefined): BookMetadata => {
  const merged: BookMetadata = { ...DEFAULT_METADATA, ...(raw || {}) } as BookMetadata;
  if (!Array.isArray(merged.contributors) || merged.contributors.length === 0) {
    merged.contributors = [{ name: "", role: "author" }];
  }
  if (!Array.isArray(merged.categories)) merged.categories = [];
  if (!Array.isArray(merged.subjects)) merged.subjects = [];
  return merged;
};

/** Format the contributors list as a single line, e.g. "نویسنده: ع. الف؛ مترجم: ب. ج". */
export const formatContributorsLine = (contributors: Contributor[], fa = true): string => {
  if (!contributors?.length) return "";
  const groups = new Map<ContributorRole, string[]>();
  for (const c of contributors) {
    if (!c.name?.trim()) continue;
    const arr = groups.get(c.role) ?? [];
    arr.push(c.name.trim());
    groups.set(c.role, arr);
  }
  return [...groups.entries()]
    .map(([role, names]) => `${ROLE_LABELS[role][fa ? "fa" : "en"]}: ${names.join("، ")}`)
    .join(" • ");
};

/** Light client-side ISBN validation (accepts 10 or 13 digits, dashes ok). */
export const isValidIsbn = (raw: string): boolean => {
  if (!raw) return true;
  const s = raw.replace(/[^0-9Xx]/g, "");
  return s.length === 10 || s.length === 13;
};

interface Props {
  value: BookMetadata;
  onChange: (next: BookMetadata) => void;
  fa?: boolean;
  /** Hide the description field (e.g. when shown elsewhere). */
  hideDescription?: boolean;
  /** Compact layout for small dialogs / sidebars. */
  compact?: boolean;
}

export const BookMetadataForm = ({ value, onChange, fa = true, hideDescription, compact }: Props) => {
  const m = useMemo(() => normalizeMetadata(value), [value]);
  const set = (patch: Partial<BookMetadata>) => onChange({ ...m, ...patch });

  const setContributor = (i: number, patch: Partial<Contributor>) => {
    const next = m.contributors.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    set({ contributors: next });
  };
  const addContributor = (role: ContributorRole = "author") => {
    set({ contributors: [...m.contributors, { name: "", role }] });
  };
  const removeContributor = (i: number) => {
    const next = m.contributors.filter((_, idx) => idx !== i);
    set({ contributors: next.length ? next : [{ name: "", role: "author" }] });
  };
  const moveContributor = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= m.contributors.length) return;
    const next = m.contributors.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ contributors: next });
  };

  const isbnOk = isValidIsbn(m.isbn ?? "");

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      {/* Titles */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label>{fa ? "عنوان کتاب *" : "Title *"}</Label>
          <Input value={m.title} onChange={(e) => set({ title: e.target.value })} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>{fa ? "عنوان فرعی" : "Subtitle"}</Label>
          <Input value={m.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} className="mt-1" />
        </div>
      </div>

      {/* Book type */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label>{fa ? "نوع کتاب" : "Book type"}</Label>
          <Select value={m.book_type} onValueChange={(v) => set({ book_type: v as BookType })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(BOOK_TYPE_LABELS) as BookType[]).map((t) => (
                <SelectItem key={t} value={t}>{BOOK_TYPE_LABELS[t][fa ? "fa" : "en"]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{fa ? "زبان" : "Language"}</Label>
          <Input
            value={m.language ?? ""}
            onChange={(e) => set({ language: e.target.value })}
            placeholder={fa ? "fa، en، ar…" : "fa, en, ar…"}
            className="mt-1"
          />
        </div>
        <div>
          <Label>{fa ? "سال انتشار" : "Publication year"}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={m.publication_year ?? ""}
            onChange={(e) => set({ publication_year: e.target.value ? Number(e.target.value) : null })}
            className="mt-1"
          />
        </div>
      </div>

      {/* Original (for translations / adaptations) */}
      {(m.book_type === "translation" || m.book_type === "adaptation") && (
        <div className="grid sm:grid-cols-2 gap-3 rounded-xl border p-3 bg-secondary/20">
          <div>
            <Label>{fa ? "عنوان اصلی (در زبان مبدأ)" : "Original title"}</Label>
            <Input
              value={m.original_title ?? ""}
              onChange={(e) => set({ original_title: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{fa ? "زبان اصلی" : "Original language"}</Label>
            <Input
              value={m.original_language ?? ""}
              onChange={(e) => set({ original_language: e.target.value })}
              placeholder={fa ? "en، fr، ar…" : "en, fr, ar…"}
              className="mt-1"
            />
          </div>
        </div>
      )}

      {/* Contributors */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label>{fa ? "مشارکت‌کنندگان" : "Contributors"}</Label>
          <span className="text-[11px] text-muted-foreground">
            {fa ? "نویسندگان، مترجم، ویراستار، تصویرگر…" : "Authors, translator, editor, illustrator…"}
          </span>
        </div>
        <div className="space-y-2">
          {m.contributors.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border p-2 bg-background/40">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveContributor(i, -1)}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                  title={fa ? "بالا" : "Up"}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveContributor(i, 1)}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                  title={fa ? "پایین" : "Down"}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <Input
                value={c.name}
                onChange={(e) => setContributor(i, { name: e.target.value })}
                placeholder={fa ? "نام و نام خانوادگی" : "Full name"}
                className="flex-1 h-9"
              />
              <Select value={c.role} onValueChange={(v) => setContributor(i, { role: v as ContributorRole })}>
                <SelectTrigger className="w-[140px] h-9 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as ContributorRole[]).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r][fa ? "fa" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive shrink-0"
                onClick={() => removeContributor(i)}
                title={fa ? "حذف" : "Remove"}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => addContributor("author")}>
            <Plus className="w-3.5 h-3.5 me-1" /> {fa ? "نویسنده" : "Author"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => addContributor("translator")}>
            <Plus className="w-3.5 h-3.5 me-1" /> {fa ? "مترجم" : "Translator"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => addContributor("editor")}>
            <Plus className="w-3.5 h-3.5 me-1" /> {fa ? "ویراستار" : "Editor"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => addContributor("illustrator")}>
            <Plus className="w-3.5 h-3.5 me-1" /> {fa ? "تصویرگر" : "Illustrator"}
          </Button>
        </div>
      </div>

      {/* Publishing details */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>{fa ? "ناشر / انتشارات" : "Publisher"}</Label>
          <Input value={m.publisher ?? ""} onChange={(e) => set({ publisher: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>{fa ? "نوبت چاپ / نسخه" : "Edition"}</Label>
          <Input
            value={m.edition ?? ""}
            onChange={(e) => set({ edition: e.target.value })}
            placeholder={fa ? "مثلاً چاپ سوم" : "e.g. 3rd ed."}
            className="mt-1"
          />
        </div>
        <div>
          <Label>{fa ? "شابک (ISBN)" : "ISBN"}</Label>
          <Input
            value={m.isbn ?? ""}
            onChange={(e) => set({ isbn: e.target.value })}
            className={`mt-1 ${!isbnOk ? "border-destructive" : ""}`}
            placeholder="978-..."
          />
          {!isbnOk && (
            <p className="text-[11px] text-destructive mt-1">
              {fa ? "شابک باید ۱۰ یا ۱۳ رقمی باشد" : "ISBN must be 10 or 13 digits"}
            </p>
          )}
        </div>
        <div>
          <Label>{fa ? "تعداد صفحات (نسخه چاپی)" : "Page count"}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={m.page_count ?? ""}
            onChange={(e) => set({ page_count: e.target.value ? Number(e.target.value) : null })}
            className="mt-1"
          />
        </div>
      </div>

      {/* Series */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <Label>{fa ? "نام مجموعه" : "Series name"}</Label>
          <Input value={m.series_name ?? ""} onChange={(e) => set({ series_name: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>{fa ? "شماره در مجموعه" : "Volume #"}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={m.series_index ?? ""}
            onChange={(e) => set({ series_index: e.target.value ? Number(e.target.value) : null })}
            className="mt-1"
          />
        </div>
      </div>

      {/* Categories + subjects */}
      <ChipsField
        label={fa ? "دسته‌بندی‌ها" : "Categories"}
        placeholder={fa ? "Enter بزنید برای افزودن (مثال: داستان، تاریخ)" : "Press Enter to add"}
        value={m.categories}
        onChange={(v) => set({ categories: v })}
      />
      <ChipsField
        label={fa ? "موضوعات / کلیدواژه‌ها" : "Subjects / keywords"}
        placeholder={fa ? "Enter بزنید برای افزودن" : "Press Enter to add"}
        value={m.subjects}
        onChange={(v) => set({ subjects: v })}
      />

      {!hideDescription && (
        <div>
          <Label>{fa ? "توضیحات / معرفی کوتاه" : "Description"}</Label>
          <Textarea
            value={m.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            rows={4}
            className="mt-1"
          />
        </div>
      )}
    </div>
  );
};

/* ---------- Inline tag chips input ---------- */
const ChipsField = ({
  label, value, onChange, placeholder,
}: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) => {
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(""); }, [value.length]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(""); return; }
    onChange([...value, v]);
    setDraft("");
  };
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 rounded-md border bg-background px-2 py-1.5 flex flex-wrap items-center gap-1.5 min-h-10">
        {value.map((v, i) => (
          <Badge key={`${v}-${i}`} variant="secondary" className="gap-1 pe-1">
            {v}
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded-full hover:bg-background/60 p-0.5"
              title="Remove"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value.length - 1);
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-1"
        />
      </div>
    </div>
  );
};
