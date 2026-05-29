// Shared "Figure N: ..." caption detector. Used by the docx importer
// (ast-mapper) and the image review panel/dialog. Covers multiple
// languages so screenshots imported from non-English Word docs can
// still be matched.
//
// Matches a line that BEGINS with one of these keywords followed by a
// number (optionally with a sub-number like "1-2" or "1.3"). Examples:
//   شکل ۱: ...
//   تصویر 2-1 — ...
//   Figure 3. ...
//   Fig. 4 ...
//   Abbildung 5: ...
//   图 6 ...
const KEYWORDS = [
  // Persian / Arabic
  "شکل", "تصویر", "نگاره", "صورة", "رسم",
  // English
  "figure", "fig\\.?", "picture", "pic\\.?", "image", "photo", "photograph",
  "illustration", "plate", "diagram", "chart",
  // German
  "abbildung", "abb\\.?", "bild",
  // Spanish / Portuguese / Italian
  "figura", "imagen", "imagem", "foto",
  // French
  "schéma", "schema",
  // Russian
  "рисунок", "рис\\.?", "фото",
  // CJK
  "图", "圖", "図", "그림",
].join("|");

// Numeric token (latin + Persian + Arabic-Indic digits)
const NUM = "[\\d\\u06F0-\\u06F9\\u0660-\\u0669]+(?:[.\\-\\u2013\\u2014][\\d\\u06F0-\\u06F9\\u0660-\\u0669]+)?";

/** A line starts with a figure/caption keyword followed by a number. */
export const FIG_RE = new RegExp(`^\\s*(?:${KEYWORDS})\\s*[:.\\-\\u2013\\u2014]?\\s*${NUM}`, "i");

/** Capturing variant: returns the bare number. */
export const FIG_NUM_RE = new RegExp(`(?:${KEYWORDS})\\s*[:.\\-\\u2013\\u2014]?\\s*(${NUM})`, "i");
