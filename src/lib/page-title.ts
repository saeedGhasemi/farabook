// Detect "auto" page titles produced by the Word importer
// (e.g. "صفحه 12", "Page 3", or just bare numbers like "12").
// These titles are not real chapter headings — they just label a
// Word page that happens to have no explicit heading in the source.
export const isAutoPageTitle = (t?: string | null): boolean => {
  const s = (t || "").trim();
  if (!s) return true;
  if (/^[\d\u06F0-\u06F9\u0660-\u0669]+$/.test(s)) return true;
  return /^(صفحه|برگه|بخش|page|section|p\.?)\s*\d+\s*$/i.test(s);
};
