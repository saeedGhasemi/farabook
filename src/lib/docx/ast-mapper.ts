// Maps OOXML (parsed by ooxml-reader) into the project's TiptapDoc AST,
// applying all the cleanup the long-term plan requires:
//   • ZWNJ preserved; Word/legacy half-space variants are converted to ZWNJ
//   • Custom heading detection (font-size / bold clustering → H1/H2/H3)
//   • Standard Heading 1/2/3 from styles.xml respected
//   • <w:vertAlign> → superscript / subscript marks (not unicode)
//   • bold / italic / underline marks
//   • Paragraph dir (rtl/ltr) from <w:bidi> + Unicode script heuristic
//   • Lang via <w:lang> (kept in attrs.lang)
//   • Numbered + bullet lists flattened into paragraphs prefixed by marker
//     (until the AST gets a real list node — same approach as word-import)
//   • Images mapped to data: URLs (small) or kept as media[] for upload
//   • OMML formulas detected and stringified to a "[math]…[/math]" placeholder
//     (LaTeX conversion happens in a follow-up pass; the node type is reserved)
//
// The output AST matches src/lib/tiptap-doc.ts exactly — same shape the
// publisher editor and the reader already understand. No parallel pipeline.

import type {
  TiptapDoc,
  ParagraphNode,
  HeadingNode,
  TextNode,
  Mark,
  ImageNode,
} from "@/lib/tiptap-doc";
import type { OoxmlBundle, OoxmlMedia } from "./ooxml-reader";
import { attr } from "./ooxml-reader";

/* ------------------------------------------------------------------ */
/* preserveOrder helpers                                              */
/* ------------------------------------------------------------------ */

type PNode = any;

function tagOf(n: PNode): string | null {
  if (!n || typeof n !== "object") return null;
  for (const k of Object.keys(n)) {
    if (k !== ":@" && k !== "#text") return k;
  }
  return null;
}

function kidsOf(n: PNode, tag?: string): PNode[] {
  if (!n) return [];
  const t = tag ?? tagOf(n);
  if (!t) return [];
  const arr = n[t];
  return Array.isArray(arr) ? arr : [];
}

function findFirst(nodes: PNode[], tag: string): PNode | null {
  for (const n of nodes ?? []) {
    if (n && typeof n === "object" && Array.isArray(n[tag])) return n;
  }
  return null;
}

function getText(nodes: PNode[]): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (!n) continue;
    if (typeof n["#text"] === "string") {
      out += n["#text"];
    }
    const t = tagOf(n);
    if (!t) continue;
    if (t === "w:t" || t === "w:delText") {
      // text content is in children as { "#text": "..." }
      const ch = n[t];
      if (Array.isArray(ch)) {
        for (const c of ch) {
          if (typeof c?.["#text"] === "string") out += c["#text"];
        }
      }
    } else if (t === "w:tab") {
      out += "\t";
    } else if (t === "w:br") {
      out += "\n";
    } else if (t === "w:softHyphen") {
      out += "\u00AD";
    } else if (t === "w:noBreakHyphen") {
      out += "\u2011";
    } else if (Array.isArray(n[t])) {
      out += getText(n[t]);
    }
  }
  return normalizePersianHalfSpaces(out);
}

const PERSIAN_ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PERSIAN_ARABIC_CLASS = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";

function normalizePersianHalfSpaces(value: string): string {
  if (!value) return value;
  const betweenPersian = new RegExp(
    `([${PERSIAN_ARABIC_CLASS}])[ \\t\\u00A0]*[\\u00AD\\u200B\\u200C\\u2011]+[ \\t\\u00A0]*([${PERSIAN_ARABIC_CLASS}])`,
    "g",
  );
  const commonSuffixes = new RegExp(
    `([${PERSIAN_ARABIC_CLASS}])([ \\t\\u00A0]+)(ها(?:ی|يي|ئی|یی)?|تر(?:ین)?|گر|وار|خوار|پذیر|ساز|زا|مند|گونه)(?=\\s|$|[،؛,.!?؟])`,
    "g",
  );
  return value
    .replace(betweenPersian, "$1\u200C$2")
    .replace(new RegExp(`(^|[^${PERSIAN_ARABIC_CLASS}])(می|نمی)[ \\t\\u00A0]+(?=[${PERSIAN_ARABIC_CLASS}])`, "g"), "$1$2\u200C")
    .replace(commonSuffixes, "$1\u200C$3");
}

function normalizeTextNodes(nodes: TextNode[]): TextNode[] {
  const raw = nodes.map((n) => n.text ?? "").join("");
  const normalized = normalizePersianHalfSpaces(raw);
  if (normalized === raw) return nodes;
  // When Word splits a half-space sequence across multiple runs, preserving
  // exact run marks while replacing/removing separator characters is unsafe.
  // Prefer textual correctness for Persian import and keep a clean paragraph.
  return normalized ? [{ type: "text", text: normalized }] : [];
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

interface StyleInfo {
  id: string;
  name?: string;
  basedOn?: string;
  outlineLevel?: number;     // 0..8
  fontSizeHalfPt?: number;   // <w:sz w:val="..."/> in half-points
  bold?: boolean;
  isHeading?: boolean;       // explicit "Heading N"
  headingLevel?: 1 | 2 | 3;
}

function parseStyles(stylesXml: any | null): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!stylesXml) return map;
  const root = findFirst(stylesXml, "w:styles");
  if (!root) return map;
  for (const child of kidsOf(root, "w:styles")) {
    if (tagOf(child) !== "w:style") continue;
    const id = attr(child, "w:styleId") ?? "";
    if (!id) continue;
    const info: StyleInfo = { id };
    for (const sc of kidsOf(child, "w:style")) {
      const t = tagOf(sc);
      if (t === "w:name") info.name = attr(sc, "w:val");
      else if (t === "w:basedOn") info.basedOn = attr(sc, "w:val");
      else if (t === "w:pPr") {
        for (const pp of kidsOf(sc, "w:pPr")) {
          const tt = tagOf(pp);
          if (tt === "w:outlineLvl") {
            const v = Number(attr(pp, "w:val"));
            if (Number.isFinite(v)) info.outlineLevel = v;
          }
        }
      } else if (t === "w:rPr") {
        for (const rp of kidsOf(sc, "w:rPr")) {
          const tt = tagOf(rp);
          if (tt === "w:sz") {
            const v = Number(attr(rp, "w:val"));
            if (Number.isFinite(v)) info.fontSizeHalfPt = v;
          } else if (tt === "w:b") {
            info.bold = attr(rp, "w:val") !== "0" && attr(rp, "w:val") !== "false";
          }
        }
      }
    }
    // Detect "Heading 1/2/3" by name or styleId
    const n = (info.name ?? id).toLowerCase();
    const m = n.match(/^heading\s*([1-9])$/) ?? id.match(/^Heading([1-9])$/);
    if (m) {
      const lv = Math.min(3, Math.max(1, Number(m[1]))) as 1 | 2 | 3;
      info.isHeading = true;
      info.headingLevel = lv;
    }
    map.set(id, info);
  }
  // Resolve basedOn outline/size inheritance one level deep
  for (const s of map.values()) {
    if (s.basedOn && (s.outlineLevel === undefined || s.fontSizeHalfPt === undefined)) {
      const p = map.get(s.basedOn);
      if (p) {
        if (s.outlineLevel === undefined) s.outlineLevel = p.outlineLevel;
        if (s.fontSizeHalfPt === undefined) s.fontSizeHalfPt = p.fontSizeHalfPt;
        if (s.bold === undefined) s.bold = p.bold;
        if (!s.isHeading && p.isHeading) {
          s.isHeading = true;
          s.headingLevel = p.headingLevel;
        }
      }
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Direction heuristic                                                 */
/* ------------------------------------------------------------------ */

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

function detectDir(text: string, bidi: boolean | undefined): "rtl" | "ltr" {
  if (bidi === true) return "rtl";
  if (bidi === false) return "ltr";
  let r = 0;
  let l = 0;
  for (const ch of text) {
    if (RTL_RE.test(ch)) r++;
    else if (LTR_RE.test(ch)) l++;
  }
  return r >= l ? "rtl" : "ltr";
}

/* ------------------------------------------------------------------ */
/* Run → TextNode[]                                                    */
/* ------------------------------------------------------------------ */

interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  vertAlign?: "superscript" | "subscript";
  color?: string;
  fontSizeHalfPt?: number;
}

function parseRunProps(rPr: PNode | null): RunFormat {
  const out: RunFormat = {};
  if (!rPr) return out;
  for (const p of kidsOf(rPr, "w:rPr")) {
    const t = tagOf(p);
    if (!t) continue;
    if (t === "w:b") {
      const v = attr(p, "w:val");
      out.bold = v !== "0" && v !== "false";
    } else if (t === "w:i") {
      const v = attr(p, "w:val");
      out.italic = v !== "0" && v !== "false";
    } else if (t === "w:u") {
      const v = attr(p, "w:val");
      out.underline = !!v && v !== "none";
    } else if (t === "w:vertAlign") {
      const v = attr(p, "w:val");
      if (v === "superscript") out.vertAlign = "superscript";
      else if (v === "subscript") out.vertAlign = "subscript";
    } else if (t === "w:color") {
      const v = attr(p, "w:val");
      if (v && v !== "auto") out.color = "#" + v;
    } else if (t === "w:sz") {
      const v = Number(attr(p, "w:val"));
      if (Number.isFinite(v)) out.fontSizeHalfPt = v;
    }
  }
  return out;
}

function marksFromFormat(f: RunFormat): Mark[] {
  const m: Mark[] = [];
  if (f.bold) m.push({ type: "bold" });
  if (f.italic) m.push({ type: "italic" });
  if (f.underline) m.push({ type: "underline" });
  if (f.vertAlign === "superscript") m.push({ type: "superscript" });
  if (f.vertAlign === "subscript") m.push({ type: "subscript" });
  if (f.color) m.push({ type: "textStyle", attrs: { color: f.color } });
  return m;
}

function runToTextNodes(run: PNode): TextNode[] {
  // run is { "w:r": [child, ...], ":@": {...} }
  const children = kidsOf(run, "w:r");
  let format: RunFormat = {};
  const out: TextNode[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const marks = marksFromFormat(format);
    out.push(marks.length ? { type: "text", text: buf, marks } : { type: "text", text: buf });
    buf = "";
  };
  for (const c of children) {
    const t = tagOf(c);
    if (!t) continue;
    if (t === "w:rPr") {
      flush();
      format = parseRunProps(c);
    } else if (t === "w:t") {
      // text payload — keep ZWNJ / ZWSP / whitespace verbatim
      const inner = kidsOf(c, "w:t");
      for (const x of inner) {
        if (typeof x?.["#text"] === "string") buf += x["#text"];
      }
    } else if (t === "w:tab") {
      buf += "\t";
    } else if (t === "w:br") {
      buf += "\n";
    } else if (t === "w:softHyphen") {
      buf += "\u00AD";
    } else if (t === "w:noBreakHyphen") {
      buf += "\u2011";
    } else if (t === "w:sym") {
      // symbol char — fallback to its char attr if present
      const ch = attr(c, "w:char");
      if (ch) {
        const code = parseInt(ch, 16);
        if (Number.isFinite(code)) buf += String.fromCodePoint(code);
      }
    }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Paragraph parsing                                                   */
/* ------------------------------------------------------------------ */

interface ParaInfo {
  text: string;
  textNodes: TextNode[];
  styleId?: string;
  outlineLevel?: number;
  bidi?: boolean;
  lang?: string;
  numId?: number;
  ilvl?: number;
  /** Dominant font size of this paragraph's runs (half-points). */
  dominantSizeHalfPt?: number;
  /** True if any run is bold. */
  anyBold?: boolean;
  /** Image rels referenced by this paragraph (rId list). */
  imageRels?: string[];
  /** True if this paragraph contains an OMML math element. */
  hasMath?: boolean;
  align?: "left" | "center" | "right" | "justify";
}

function parsePPr(pPr: PNode | null): {
  styleId?: string; outlineLevel?: number; bidi?: boolean;
  numId?: number; ilvl?: number; lang?: string;
  align?: ParaInfo["align"];
} {
  const out: any = {};
  if (!pPr) return out;
  for (const p of kidsOf(pPr, "w:pPr")) {
    const t = tagOf(p);
    if (!t) continue;
    if (t === "w:pStyle") out.styleId = attr(p, "w:val");
    else if (t === "w:outlineLvl") {
      const v = Number(attr(p, "w:val"));
      if (Number.isFinite(v)) out.outlineLevel = v;
    } else if (t === "w:bidi") {
      const v = attr(p, "w:val");
      out.bidi = v !== "0" && v !== "false";
    } else if (t === "w:jc") {
      const v = attr(p, "w:val");
      if (v === "left" || v === "right" || v === "center" || v === "both" || v === "justify") {
        out.align = v === "both" ? "justify" : v;
      }
    } else if (t === "w:numPr") {
      for (const np of kidsOf(p, "w:numPr")) {
        const tt = tagOf(np);
        if (tt === "w:numId") {
          const v = Number(attr(np, "w:val"));
          if (Number.isFinite(v)) out.numId = v;
        } else if (tt === "w:ilvl") {
          const v = Number(attr(np, "w:val"));
          if (Number.isFinite(v)) out.ilvl = v;
        }
      }
    } else if (t === "w:rPr") {
      for (const rp of kidsOf(p, "w:rPr")) {
        if (tagOf(rp) === "w:lang") {
          out.lang = attr(rp, "w:val") ?? attr(rp, "w:bidi");
        }
      }
    }
  }
  return out;
}

function parseParagraph(p: PNode, rels: Map<string, string>): ParaInfo {
  const children = kidsOf(p, "w:p");
  const pPr = findFirst(children, "w:pPr");
  const meta = parsePPr(pPr);
  const textNodes: TextNode[] = [];
  let sumSize = 0;
  let sizeCount = 0;
  let anyBold = false;
  const imageRels: string[] = [];
  let hasMath = false;

  for (const c of children) {
    const t = tagOf(c);
    if (!t || t === "w:pPr") continue;
    if (t === "w:r") {
      // Inspect run properties for size / bold stats and image
      const rChildren = kidsOf(c, "w:r");
      const rPr = findFirst(rChildren, "w:rPr");
      const fmt = parseRunProps(rPr);
      if (fmt.fontSizeHalfPt) {
        sumSize += fmt.fontSizeHalfPt;
        sizeCount++;
      }
      if (fmt.bold) anyBold = true;
      // images via w:drawing > … > a:blip r:embed
      collectImageRels(rChildren, imageRels);
      textNodes.push(...runToTextNodes(c));
    } else if (t === "w:hyperlink") {
      // unwrap hyperlink runs; record href
      const hChildren = kidsOf(c, "w:hyperlink");
      const ridAttr = attr(c, "r:id");
      const href = ridAttr ? rels.get(ridAttr) : undefined;
      for (const hc of hChildren) {
        if (tagOf(hc) === "w:r") {
          const nodes = runToTextNodes(hc);
          if (href) {
            for (const n of nodes) {
              n.marks = [...(n.marks ?? []), { type: "link", attrs: { href } }];
            }
          }
          textNodes.push(...nodes);
        }
      }
    } else if (t === "w:ins" || t === "w:smartTag") {
      // tracked-insertions / smart tags: unwrap runs
      const inner = kidsOf(c, t);
      for (const ic of inner) {
        if (tagOf(ic) === "w:r") textNodes.push(...runToTextNodes(ic));
      }
    } else if (t === "m:oMath" || t === "m:oMathPara") {
      hasMath = true;
      const tex = ommlToLatex(c);
      textNodes.push({ type: "text", text: `$${tex}$` });
    }
  }

  const normalizedTextNodes = normalizeTextNodes(textNodes);
  const text = normalizedTextNodes.map((n) => n.text).join("");
  return {
    text,
    textNodes: normalizedTextNodes,
    ...meta,
    dominantSizeHalfPt: sizeCount ? sumSize / sizeCount : undefined,
    anyBold,
    imageRels: imageRels.length ? imageRels : undefined,
    hasMath: hasMath || undefined,
  };
}

function collectImageRels(nodes: PNode[], out: string[]) {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    const t = tagOf(n);
    if (!t) continue;
    if (t === "a:blip") {
      const rid = attr(n, "r:embed") ?? attr(n, "r:link");
      if (rid) out.push(rid);
    } else if (Array.isArray(n[t])) {
      collectImageRels(n[t], out);
    }
  }
}

/* ------------------------------------------------------------------ */
/* OMML → LaTeX (very small subset; good enough for common formulas)  */
/* ------------------------------------------------------------------ */

function ommlToLatex(node: PNode): string {
  const t = tagOf(node);
  if (!t) return "";
  const kids = kidsOf(node, t);
  // m:t → text
  if (t === "m:t") {
    let s = "";
    for (const c of kids) if (typeof c?.["#text"] === "string") s += c["#text"];
    return s;
  }
  // m:r → run; concat children
  if (t === "m:r") return kids.map(ommlToLatex).join("");
  // m:f → fraction: \frac{num}{den}
  if (t === "m:f") {
    const num = findFirst(kids, "m:num");
    const den = findFirst(kids, "m:den");
    return `\\frac{${num ? kidsOf(num, "m:num").map(ommlToLatex).join("") : ""}}{${
      den ? kidsOf(den, "m:den").map(ommlToLatex).join("") : ""
    }}`;
  }
  // m:sSup → superscript
  if (t === "m:sSup") {
    const base = findFirst(kids, "m:e");
    const sup = findFirst(kids, "m:sup");
    return `{${base ? kidsOf(base, "m:e").map(ommlToLatex).join("") : ""}}^{${
      sup ? kidsOf(sup, "m:sup").map(ommlToLatex).join("") : ""
    }}`;
  }
  if (t === "m:sSub") {
    const base = findFirst(kids, "m:e");
    const sub = findFirst(kids, "m:sub");
    return `{${base ? kidsOf(base, "m:e").map(ommlToLatex).join("") : ""}}_{${
      sub ? kidsOf(sub, "m:sub").map(ommlToLatex).join("") : ""
    }}`;
  }
  if (t === "m:rad") {
    const deg = findFirst(kids, "m:deg");
    const e = findFirst(kids, "m:e");
    const eTex = e ? kidsOf(e, "m:e").map(ommlToLatex).join("") : "";
    const dTex = deg ? kidsOf(deg, "m:deg").map(ommlToLatex).join("") : "";
    return dTex ? `\\sqrt[${dTex}]{${eTex}}` : `\\sqrt{${eTex}}`;
  }
  // m:nary (sum/integral)
  if (t === "m:nary") {
    const chrAttr = findFirst(kids, "m:naryPr");
    let op = "\\sum";
    if (chrAttr) {
      for (const cp of kidsOf(chrAttr, "m:naryPr")) {
        if (tagOf(cp) === "m:chr") {
          const v = attr(cp, "m:val");
          if (v === "∫") op = "\\int";
          else if (v === "∏") op = "\\prod";
        }
      }
    }
    const sub = findFirst(kids, "m:sub");
    const sup = findFirst(kids, "m:sup");
    const e = findFirst(kids, "m:e");
    return `${op}${sub ? "_{" + kidsOf(sub, "m:sub").map(ommlToLatex).join("") + "}" : ""}${
      sup ? "^{" + kidsOf(sup, "m:sup").map(ommlToLatex).join("") + "}" : ""
    } ${e ? kidsOf(e, "m:e").map(ommlToLatex).join("") : ""}`;
  }
  // Default: concat all children
  return kids.map(ommlToLatex).join("");
}

/* ------------------------------------------------------------------ */
/* Custom heading detection                                            */
/* ------------------------------------------------------------------ */

function inferHeadings(paras: ParaInfo[], styles: Map<string, StyleInfo>): {
  promotedCount: number; levelDistribution: Record<number, number>;
} {
  // First, mark paragraphs that already resolve to a heading via style
  for (const p of paras) {
    if (p.styleId) {
      const s = styles.get(p.styleId);
      if (s?.isHeading && s.headingLevel) {
        p.outlineLevel = s.headingLevel - 1; // store as outline-level 0..
      } else if (s?.outlineLevel !== undefined && p.outlineLevel === undefined) {
        p.outlineLevel = s.outlineLevel;
      }
    }
  }

  // Compute body median font size from paragraphs that are NOT already headings
  const bodySizes: number[] = [];
  for (const p of paras) {
    if (p.outlineLevel !== undefined) continue;
    if (p.dominantSizeHalfPt && p.text.trim().length > 30) {
      bodySizes.push(p.dominantSizeHalfPt);
    }
  }
  if (bodySizes.length === 0) {
    const dist: Record<number, number> = {};
    for (const p of paras) {
      if (p.outlineLevel !== undefined) {
        const lv = Math.min(3, p.outlineLevel + 1);
        dist[lv] = (dist[lv] ?? 0) + 1;
      }
    }
    return { promotedCount: 0, levelDistribution: dist };
  }
  bodySizes.sort((a, b) => a - b);
  const median = bodySizes[Math.floor(bodySizes.length / 2)];

  // Candidate headings: short, bold or larger, not already heading
  type Cand = { p: ParaInfo; size: number };
  const cands: Cand[] = [];
  for (const p of paras) {
    if (p.outlineLevel !== undefined) continue;
    const t = p.text.trim();
    if (!t || t.length > 200) continue;
    const size = p.dominantSizeHalfPt ?? median;
    const sizeRatio = size / median;
    const looksHeading =
      sizeRatio >= 1.15 ||
      (p.anyBold && t.length <= 120 && sizeRatio >= 1.0) ||
      /^(فصل|بخش|پیوست|chapter|part|appendix)\s+/i.test(t);
    if (looksHeading) cands.push({ p, size });
  }

  // Cluster candidate sizes into up to 3 levels (largest = H1)
  const uniqueSizes = Array.from(new Set(cands.map((c) => Math.round(c.size)))).sort(
    (a, b) => b - a,
  );
  const levelBySize = new Map<number, 1 | 2 | 3>();
  uniqueSizes.slice(0, 3).forEach((s, i) => levelBySize.set(s, (i + 1) as 1 | 2 | 3));

  let promoted = 0;
  for (const c of cands) {
    const lv = levelBySize.get(Math.round(c.size)) ?? 3;
    c.p.outlineLevel = lv - 1;
    promoted++;
  }

  const dist: Record<number, number> = {};
  for (const p of paras) {
    if (p.outlineLevel !== undefined) {
      const lv = Math.min(3, p.outlineLevel + 1);
      dist[lv] = (dist[lv] ?? 0) + 1;
    }
  }
  return { promotedCount: promoted, levelDistribution: dist };
}

/* ------------------------------------------------------------------ */
/* Rels                                                                */
/* ------------------------------------------------------------------ */

function parseRels(relsXml: any | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const root = findFirst(relsXml, "Relationships");
  if (!root) return map;
  for (const r of kidsOf(root, "Relationships")) {
    if (tagOf(r) !== "Relationship") continue;
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Numbering (word/numbering.xml)                                      */
/* ------------------------------------------------------------------ */

interface NumLevelFmt { numFmt?: string; lvlText?: string; }
interface NumInfo {
  /** numId → abstractNumId */
  numToAbstract: Map<number, number>;
  /** abstractNumId → ilvl → fmt */
  abstractLevels: Map<number, Map<number, NumLevelFmt>>;
}

function parseNumbering(xml: any | null): NumInfo {
  const info: NumInfo = { numToAbstract: new Map(), abstractLevels: new Map() };
  if (!xml) return info;
  const root = findFirst(xml, "w:numbering");
  if (!root) return info;
  for (const c of kidsOf(root, "w:numbering")) {
    const t = tagOf(c);
    if (t === "w:num") {
      const numId = Number(attr(c, "w:numId"));
      for (const cc of kidsOf(c, "w:num")) {
        if (tagOf(cc) === "w:abstractNumId") {
          const aid = Number(attr(cc, "w:val"));
          if (Number.isFinite(numId) && Number.isFinite(aid)) info.numToAbstract.set(numId, aid);
        }
      }
    } else if (t === "w:abstractNum") {
      const aid = Number(attr(c, "w:abstractNumId"));
      if (!Number.isFinite(aid)) continue;
      const levels = new Map<number, NumLevelFmt>();
      for (const lvl of kidsOf(c, "w:abstractNum")) {
        if (tagOf(lvl) !== "w:lvl") continue;
        const ilvl = Number(attr(lvl, "w:ilvl"));
        const fmt: NumLevelFmt = {};
        for (const lp of kidsOf(lvl, "w:lvl")) {
          const lt = tagOf(lp);
          if (lt === "w:numFmt") fmt.numFmt = attr(lp, "w:val");
          else if (lt === "w:lvlText") fmt.lvlText = attr(lp, "w:val");
        }
        if (Number.isFinite(ilvl)) levels.set(ilvl, fmt);
      }
      info.abstractLevels.set(aid, levels);
    }
  }
  return info;
}

function numFmtFor(info: NumInfo, numId?: number, ilvl?: number): NumLevelFmt | null {
  if (numId === undefined) return null;
  const aid = info.numToAbstract.get(numId);
  if (aid === undefined) return null;
  const lv = info.abstractLevels.get(aid);
  if (!lv) return null;
  return lv.get(ilvl ?? 0) ?? null;
}

function romanize(n: number): string {
  const m: [number, string][] = [[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]];
  let s = "";
  for (const [v, r] of m) { while (n >= v) { s += r; n -= v; } }
  return s;
}

function renderListMarker(fmt: NumLevelFmt | null, counter: number, _ilvl: number): string {
  const f = fmt?.numFmt ?? "bullet";
  if (f === "bullet" || f === "none") return "• ";
  let token = String(counter);
  if (f === "lowerLetter") token = String.fromCharCode(96 + ((counter - 1) % 26) + 1);
  else if (f === "upperLetter") token = String.fromCharCode(64 + ((counter - 1) % 26) + 1);
  else if (f === "lowerRoman") token = romanize(counter);
  else if (f === "upperRoman") token = romanize(counter).toUpperCase();
  return `${token}. `;
}

export interface MapResult {
  doc: TiptapDoc;
  media: OoxmlMedia[];
  diagnostics: {
    promotedHeadings: number;
    headingLevels: Record<number, number>;
    paragraphsTotal: number;
    imagesEmbedded: number;
    formulasDetected: number;
    cleanedMarker: boolean;
  };
}


export function mapOoxmlToDoc(bundle: OoxmlBundle): MapResult {
  const stylesMap = parseStyles(bundle.styles);
  const rels = parseRels(bundle.rels);
  const numInfo = parseNumbering(bundle.numbering);
  const root = findFirst(bundle.doc, "w:document");
  if (!root) throw new Error("ساختار XML سند نامعتبر است (w:document یافت نشد).");
  const body = findFirst(kidsOf(root, "w:document"), "w:body");
  if (!body) throw new Error("ساختار XML سند نامعتبر است (w:body یافت نشد).");

  // First pass: collect ParaInfo for every <w:p> at top level.
  // Recursively unwrap <w:sdt>/<w:sdtContent> (content controls) so wrapped
  // paragraphs (TOC, structured fields, etc.) aren't silently dropped.
  const paras: ParaInfo[] = [];
  const topBlocks: Array<{ kind: "para"; info: ParaInfo } | { kind: "table"; node: PNode }> = [];

  const walkBody = (nodes: PNode[]) => {
    for (const c of nodes ?? []) {
      const t = tagOf(c);
      if (t === "w:p") {
        const info = parseParagraph(c, rels);
        paras.push(info);
        topBlocks.push({ kind: "para", info });
      } else if (t === "w:tbl") {
        topBlocks.push({ kind: "table", node: c });
      } else if (t === "w:sdt") {
        for (const sc of kidsOf(c, "w:sdt")) {
          if (tagOf(sc) === "w:sdtContent") walkBody(kidsOf(sc, "w:sdtContent"));
        }
      }
    }
  };
  walkBody(kidsOf(body, "w:body"));

  // Heading detection (custom-style aware)
  const headingDiag = inferHeadings(paras, stylesMap);

  // Second pass: build TiptapDoc
  const content: TiptapDoc["content"] = [];
  const usedMediaNames = new Set<string>();
  let formulasDetected = 0;
  let imagesEmbedded = 0;
  // Counters for numbered lists: key = `${numId}:${ilvl}`
  const listCounters = new Map<string, number>();

  const mediaByRid = new Map<string, OoxmlMedia>();
  for (const [rid, target] of rels.entries()) {
    const file = target.replace(/^.*\//, "");
    const m = bundle.media.find((x) => x.name === file);
    if (m) mediaByRid.set(rid, m);
  }

  for (const b of topBlocks) {
    if (b.kind === "table") {
      const rows = collectTableText(b.node);
      for (const row of rows) {
        content.push({
          type: "paragraph",
          attrs: { dir: detectDir(row, undefined) },
          content: row ? [{ type: "text", text: row }] : [],
        } as ParagraphNode);
      }
      continue;
    }
    const info = b.info;

    if (info.hasMath) formulasDetected++;

    // Image-only paragraph → emit ImageNode(s)
    if (info.imageRels && info.imageRels.length && !info.text.trim()) {
      for (const rid of info.imageRels) {
        const m = mediaByRid.get(rid);
        if (!m) continue;
        usedMediaNames.add(m.name);
        imagesEmbedded++;
        content.push({
          type: "image",
          attrs: { src: `media://${m.name}` },
        } as ImageNode);
      }
      continue;
    }

    // List item → prefix with proper marker (numbered or bullet)
    if (info.numId !== undefined) {
      const ilvl = info.ilvl ?? 0;
      const fmt = numFmtFor(numInfo, info.numId, ilvl);
      const isNumbered = !!fmt && fmt.numFmt && fmt.numFmt !== "bullet" && fmt.numFmt !== "none";
      const key = `${info.numId}:${ilvl}`;
      let prefix: string;
      if (isNumbered) {
        const next = (listCounters.get(key) ?? 0) + 1;
        listCounters.set(key, next);
        prefix = "  ".repeat(ilvl) + renderListMarker(fmt, next, ilvl);
      } else {
        prefix = "  ".repeat(ilvl) + "• ";
      }
      const nodes = [...info.textNodes];
      nodes.unshift({ type: "text", text: prefix });
      content.push({
        type: "paragraph",
        attrs: {
          dir: detectDir(info.text, info.bidi),
          textAlign: info.align ?? null,
        },
        content: nodes,
      } as ParagraphNode);
      continue;
    }


    // Heading?
    if (info.outlineLevel !== undefined) {
      const level = Math.min(3, Math.max(1, (info.outlineLevel ?? 0) + 1)) as 1 | 2 | 3;
      content.push({
        type: "heading",
        attrs: {
          level,
          dir: detectDir(info.text, info.bidi),
          textAlign: info.align ?? null,
        },
        content: info.textNodes,
      } as HeadingNode);
      continue;
    }

    // Normal paragraph
    content.push({
      type: "paragraph",
      attrs: {
        dir: detectDir(info.text, info.bidi),
        textAlign: info.align ?? null,
      },
      content: info.textNodes,
    } as ParagraphNode);

    // Inline images embedded WITH text: emit after paragraph
    if (info.imageRels && info.imageRels.length) {
      for (const rid of info.imageRels) {
        const m = mediaByRid.get(rid);
        if (!m) continue;
        usedMediaNames.add(m.name);
        imagesEmbedded++;
        content.push({
          type: "image",
          attrs: { src: `media://${m.name}` },
        } as ImageNode);
      }
    }
  }

  const doc: TiptapDoc = { type: "doc", content };
  const media = bundle.media.filter((m) => usedMediaNames.has(m.name));

  return {
    doc,
    media,
    diagnostics: {
      promotedHeadings: headingDiag.promotedCount,
      headingLevels: headingDiag.levelDistribution,
      paragraphsTotal: paras.length,
      imagesEmbedded,
      formulasDetected,
      cleanedMarker: bundle.hasCleanedMarker,
    },
  };
}

function collectTableText(tbl: PNode): string[] {
  const rows: string[] = [];
  for (const r of kidsOf(tbl, "w:tbl")) {
    if (tagOf(r) !== "w:tr") continue;
    const cells: string[] = [];
    for (const c of kidsOf(r, "w:tr")) {
      if (tagOf(c) !== "w:tc") continue;
      let cellText = "";
      for (const p of kidsOf(c, "w:tc")) {
        if (tagOf(p) === "w:p") cellText += getText(kidsOf(p, "w:p")) + " ";
      }
      cells.push(cellText.trim());
    }
    rows.push(cells.join(" | "));
  }
  return rows;
}
