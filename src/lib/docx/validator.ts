// Pre-upload validation for the Word wizard.
// Returns a categorized report the UI can render with green/yellow/red badges.

import type { MapResult } from "./ast-mapper";
import type { PipelineResult } from "./image-pipeline";
import type { TocNode } from "./toc-builder";
import type { BookMetadata } from "@/components/book-metadata/BookMetadataForm";

export type Severity = "ok" | "warn" | "error";

export interface ValidationItem {
  key: string;
  severity: Severity;
  title: string;
  /** Persian message shown to the user. */
  message: string;
  /** Suggested fix in plain Persian. */
  fix?: string;
}

export interface ValidationInput {
  prep: MapResult;
  images: PipelineResult;
  toc: TocNode[];
  meta: BookMetadata;
  printStartPage?: number;
  printStartPageFromDoc: boolean;
}

const EMPTY_FOOTNOTE_WARNING_LIMIT = 0;

export function validateUpload(input: ValidationInput): ValidationItem[] {
  const { prep, images, toc, meta, printStartPage, printStartPageFromDoc } = input;
  const out: ValidationItem[] = [];

  // Title
  if (!meta.title?.trim()) {
    out.push({
      key: "title", severity: "error",
      title: "عنوان کتاب",
      message: "عنوان کتاب وارد نشده است.",
      fix: "در فرم متادیتا یک عنوان معنادار وارد کنید.",
    });
  } else {
    out.push({ key: "title", severity: "ok", title: "عنوان کتاب", message: meta.title });
  }

  // Author
  const hasAuthor = (meta.contributors ?? []).some((c) => c.role === "author" && c.name?.trim());
  if (!hasAuthor) {
    out.push({
      key: "author", severity: "warn", title: "نویسنده",
      message: "هیچ نویسنده‌ای ثبت نشده است.",
      fix: "حداقل یک نویسنده در بخش «مشارکت‌کنندگان» اضافه کنید.",
    });
  } else {
    out.push({ key: "author", severity: "ok", title: "نویسنده", message: "ثبت شد" });
  }

  // Structure / headings
  const headingCount = toc.length;
  if (headingCount === 0) {
    out.push({
      key: "headings", severity: "error",
      title: "ساختار فصل‌ها",
      message: "هیچ Headingی در فایل پیدا نشد.",
      fix: "در Word از Styles → Heading 1 برای عنوان هر فصل استفاده کنید، یا نام Style سفارشی خود را در مرحلهٔ پیش‌نمایش TOC وارد کنید.",
    });
  } else if (headingCount < 2) {
    out.push({
      key: "headings", severity: "warn",
      title: "ساختار فصل‌ها",
      message: `فقط ${headingCount} فصل تشخیص داده شد.`,
      fix: "اگر کتاب چندفصلی است، مطمئن شوید تیتر هر فصل با Heading 1 (یا Style انتخابی شما) علامت‌گذاری شده باشد.",
    });
  } else {
    out.push({
      key: "headings", severity: "ok",
      title: "ساختار فصل‌ها",
      message: `${headingCount} فصل اصلی تشخیص داده شد`,
    });
  }

  // TOC
  out.push({
    key: "toc", severity: headingCount > 0 ? "ok" : "warn",
    title: "فهرست مطالب (TOC)",
    message: headingCount > 0
      ? "فهرست بر اساس Headingها ساخته می‌شود"
      : "بدون Heading، TOC قابل ساخت نیست",
  });

  // Images
  const imgCount = images.images.length;
  const totalMB = (images.totalFinalBytes / 1024 / 1024).toFixed(1);
  if (imgCount === 0) {
    out.push({
      key: "images", severity: "ok", title: "تصاویر",
      message: "بدون تصویر",
    });
  } else {
    const parts = [`${imgCount} تصویر منحصربه‌فرد (${totalMB} مگابایت)`];
    if (images.emfConverted) parts.push(`${images.emfConverted} EMF/WMF تبدیل شد`);
    if (images.optimized) parts.push(`${images.optimized} تصویر >۲MB بهینه شد`);
    if (images.duplicates) parts.push(`${images.duplicates} تکراری حذف شد`);
    out.push({
      key: "images",
      severity: images.failures.length ? "warn" : "ok",
      title: "تصاویر",
      message: parts.join(" · "),
      fix: images.failures.length
        ? `${images.failures.length} تصویر قابل پردازش نبود: ${images.failures.slice(0, 3).map((f) => f.name).join("، ")}`
        : undefined,
    });
  }

  // Footnotes
  const fnCount = prep.diagnostics.footnotesDetected;
  out.push({
    key: "footnotes",
    severity: fnCount > EMPTY_FOOTNOTE_WARNING_LIMIT ? "ok" : "ok",
    title: "پاورقی‌ها",
    message: fnCount > 0 ? `${fnCount} پاورقی شناسایی شد` : "بدون پاورقی",
  });

  // Math
  if (prep.diagnostics.formulasDetected > 0) {
    out.push({
      key: "math", severity: "ok",
      title: "فرمول‌های ریاضی",
      message: `${prep.diagnostics.formulasDetected} فرمول OMML تبدیل شد`,
    });
  }

  // Print start page
  if (printStartPageFromDoc) {
    out.push({
      key: "printStart", severity: "ok",
      title: "شمارهٔ صفحهٔ چاپی",
      message: `از فایل خوانده شد: ${printStartPage}`,
    });
  } else if (printStartPage && printStartPage > 1) {
    out.push({
      key: "printStart", severity: "ok",
      title: "شمارهٔ صفحهٔ چاپی",
      message: `توسط شما تنظیم شد: ${printStartPage}`,
    });
  } else {
    out.push({
      key: "printStart", severity: "warn",
      title: "شمارهٔ صفحهٔ چاپی",
      message: "در فایل ورد علامتی برای شمارهٔ صفحهٔ شروع پیدا نشد.",
      fix: "اگر کتاب چاپی شما از صفحه‌ای غیر از ۱ شروع می‌شود، شماره را در فرم وارد کنید؛ در غیر این صورت از ۱ شروع خواهد شد.",
    });
  }

  return out;
}

export const hasBlockingErrors = (items: ValidationItem[]): boolean =>
  items.some((i) => i.severity === "error");
