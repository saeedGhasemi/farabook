// Maps OOXML (parsed by ooxml-reader) into the project's TiptapDoc AST,
// applying all the cleanup the long-term plan requires:
//   • ZWNJ preserved; Word/legacy half-space variants are converted to ZWNJ
//   • Custom heading detection (font-size / bold clustering → H1/H2/H3)
//   • Standard Heading 1/2/3 from styles.xml respected
//   • <w:vertAlign> / <w:position> → superscript / subscript marks (not unicode)
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
import { FIG_RE } from "./figure-caption";

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

function attrLoose(node: PNode, name: string): string | undefined {
  const exact = attr(node, name);
  if (exact !== undefined) return exact;
  const at = node?.[":@"];
  if (!at) return undefined;
  const local = name.includes(":") ? name.split(":").pop() : name;
  return at[`@_${local}`] ?? at[`@_w:${local}`] ?? at[`@_m:${local}`];
}

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
  if (nodes.length === 0) return nodes;
  const hasMarks = nodes.some((n) => n.marks && n.marks.length > 0);
  if (hasMarks) {
    // Preserve marks: normalize each node individually. Cross-run half-space
    // joins are lost in this case, but mark fidelity (sup/sub/bold/...) wins.
    return nodes
      .map((n) => ({ ...n, text: normalizePersianHalfSpaces(n.text ?? "") }))
      .filter((n) => n.text.length > 0);
  }
  const raw = nodes.map((n) => n.text ?? "").join("");
  const normalized = normalizePersianHalfSpaces(raw);
  if (normalized === raw) return nodes;
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
  italic?: boolean;
  vertAlign?: "superscript" | "subscript";
  positionHalfPt?: number;
  isHeading?: boolean;       // explicit "Heading N"
  headingLevel?: 1 | 2 | 3;
  isTitle?: boolean;
  isSubtitle?: boolean;
}

function parseStyles(stylesXml: any | null): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!stylesXml) return map;
  const root = findFirst(stylesXml, "w:styles");
  if (!root) return map;
  for (const child of kidsOf(root, "w:styles")) {
    if (tagOf(child) !== "w:style") continue;
      const id = attrLoose(child, "w:styleId") ?? "";
    if (!id) continue;
    const info: StyleInfo = { id };
    for (const sc of kidsOf(child, "w:style")) {
      const t = tagOf(sc);
      if (t === "w:name") info.name = attrLoose(sc, "w:val");
      else if (t === "w:basedOn") info.basedOn = attrLoose(sc, "w:val");
      else if (t === "w:pPr") {
        for (const pp of kidsOf(sc, "w:pPr")) {
          const tt = tagOf(pp);
          if (tt === "w:outlineLvl") {
            const v = Number(attrLoose(pp, "w:val"));
            if (Number.isFinite(v)) info.outlineLevel = v;
          }
        }
      } else if (t === "w:rPr") {
        for (const rp of kidsOf(sc, "w:rPr")) {
          const tt = tagOf(rp);
          if (tt === "w:sz") {
            const v = Number(attrLoose(rp, "w:val"));
            if (Number.isFinite(v)) info.fontSizeHalfPt = v;
          } else if (tt === "w:b") {
            const v = attrLoose(rp, "w:val");
            info.bold = v !== "0" && v !== "false";
          } else if (tt === "w:i") {
            const v = attrLoose(rp, "w:val");
            info.italic = v !== "0" && v !== "false";
          } else if (tt === "w:vertAlign") {
            const v = attrLoose(rp, "w:val");
            if (v === "superscript") info.vertAlign = "superscript";
            else if (v === "subscript") info.vertAlign = "subscript";
          } else if (tt === "w:position") {
            const v = Number(attrLoose(rp, "w:val"));
            if (Number.isFinite(v)) {
              info.positionHalfPt = v;
              if (!info.vertAlign && v > 0) info.vertAlign = "superscript";
              else if (!info.vertAlign && v < 0) info.vertAlign = "subscript";
            }
          }
        }
      }
    }
    // Detect "Heading 1/2/3" by name or styleId
    const n = (info.name ?? id).toLowerCase();
    const m = n.match(/^heading\s*([1-9])$/) ?? id.match(/^Heading([1-9])$/);
    info.isTitle = /^(title|book\s*title|عنوان|عنوان\s*کتاب)$/i.test((info.name ?? id).trim());
    info.isSubtitle = /^(subtitle|sub\s*title|زیر\s*عنوان|زیرعنوان)$/i.test((info.name ?? id).trim());
    if (m) {
      const lv = Math.min(3, Math.max(1, Number(m[1]))) as 1 | 2 | 3;
      info.isHeading = true;
      info.headingLevel = lv;
    }
    // Detect superscript/subscript character styles by name
    const lname = (info.name ?? "").toLowerCase();
    if (!info.vertAlign) {
      if (/superscript|exposant|hoch|نمای|بالانویس/.test(lname)) info.vertAlign = "superscript";
      else if (/subscript|indice|tief|پایین\s*نویس|زیرنویس/.test(lname)) info.vertAlign = "subscript";
    }
    map.set(id, info);
  }
  // Resolve basedOn inheritance one level deep
  for (const s of map.values()) {
    if (s.basedOn) {
      const p = map.get(s.basedOn);
      if (p) {
        if (s.outlineLevel === undefined) s.outlineLevel = p.outlineLevel;
        if (s.fontSizeHalfPt === undefined) s.fontSizeHalfPt = p.fontSizeHalfPt;
        if (s.bold === undefined) s.bold = p.bold;
        if (s.italic === undefined) s.italic = p.italic;
        if (s.vertAlign === undefined) s.vertAlign = p.vertAlign;
        if (s.positionHalfPt === undefined) s.positionHalfPt = p.positionHalfPt;
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
  positionHalfPt?: number;
}


function parseRunProps(rPr: PNode | null, styles?: Map<string, StyleInfo>): RunFormat {
  const out: RunFormat = {};
  if (!rPr) return out;
  // First, apply rStyle inheritance (so direct props can still override).
  for (const p of kidsOf(rPr, "w:rPr")) {
    if (tagOf(p) === "w:rStyle") {
      const sid = attrLoose(p, "w:val");
      const s = sid ? styles?.get(sid) : undefined;
      if (s) {
        if (s.bold && out.bold === undefined) out.bold = true;
        if (s.italic && out.italic === undefined) out.italic = true;
        if (s.vertAlign && !out.vertAlign) out.vertAlign = s.vertAlign;
        if (s.fontSizeHalfPt && out.fontSizeHalfPt === undefined) out.fontSizeHalfPt = s.fontSizeHalfPt;
        if (s.positionHalfPt && out.positionHalfPt === undefined) out.positionHalfPt = s.positionHalfPt;
      }
    }
  }
  for (const p of kidsOf(rPr, "w:rPr")) {
    const t = tagOf(p);
    if (!t) continue;
    if (t === "w:b") {
      const v = attrLoose(p, "w:val");
      out.bold = v !== "0" && v !== "false";
    } else if (t === "w:i") {
      const v = attrLoose(p, "w:val");
      out.italic = v !== "0" && v !== "false";
    } else if (t === "w:u") {
      const v = attrLoose(p, "w:val");
      out.underline = !!v && v !== "none";
    } else if (t === "w:vertAlign") {
      const v = attrLoose(p, "w:val");
      if (v === "superscript") out.vertAlign = "superscript";
      else if (v === "subscript") out.vertAlign = "subscript";
    } else if (t === "w:position") {
      const v = Number(attrLoose(p, "w:val"));
      if (Number.isFinite(v)) {
        out.positionHalfPt = v;
        if (v > 0) out.vertAlign = "superscript";
        else if (v < 0) out.vertAlign = "subscript";
      }
    } else if (t === "w:color") {
      const v = attrLoose(p, "w:val");
      if (v && v !== "auto") out.color = "#" + v;
    } else if (t === "w:sz") {
      const v = Number(attrLoose(p, "w:val"));
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

function runToTextNodes(run: PNode, styles?: Map<string, StyleInfo>): TextNode[] {
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
      format = parseRunProps(c, styles);

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
      const ch = attrLoose(c, "w:char");
      if (ch) {
        const code = parseInt(ch, 16);
        if (Number.isFinite(code)) buf += String.fromCodePoint(code);
      }
    } else if (t === "w:footnoteReference" || t === "w:endnoteReference") {
      const id = attrLoose(c, "w:id");
      if (id && !id.startsWith("-")) {
        flush();
        const kind = t === "w:footnoteReference" ? "footnote" : "endnote";
        out.push({
          type: "text",
          text: id,
          marks: [
            { type: "superscript" },
            // content resolved later in the main loop once notes maps are known
            { type: "footnote", attrs: { kind, id } } as any,
          ],
        });
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
  /** Image refs (rid + size in EMU) referenced by this paragraph. */
  imageRels?: ImageRef[];
  /** True if this paragraph contains an OMML math element. */
  hasMath?: boolean;
  align?: "left" | "center" | "right" | "justify";
  noteRefs?: Array<{ kind: "footnote" | "endnote"; id: string }>;
  isTitle?: boolean;
  isSubtitle?: boolean;
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
    if (t === "w:pStyle") out.styleId = attrLoose(p, "w:val");
    else if (t === "w:outlineLvl") {
      const v = Number(attrLoose(p, "w:val"));
      if (Number.isFinite(v)) out.outlineLevel = v;
    } else if (t === "w:bidi") {
      const v = attrLoose(p, "w:val");
      out.bidi = v !== "0" && v !== "false";
    } else if (t === "w:jc") {
      const v = attrLoose(p, "w:val");
      if (v === "left" || v === "right" || v === "center" || v === "both" || v === "justify") {
        out.align = v === "both" ? "justify" : v;
      }
    } else if (t === "w:numPr") {
      for (const np of kidsOf(p, "w:numPr")) {
        const tt = tagOf(np);
        if (tt === "w:numId") {
          const v = Number(attrLoose(np, "w:val"));
          if (Number.isFinite(v)) out.numId = v;
        } else if (tt === "w:ilvl") {
          const v = Number(attrLoose(np, "w:val"));
          if (Number.isFinite(v)) out.ilvl = v;
        }
      }
    } else if (t === "w:rPr") {
      for (const rp of kidsOf(p, "w:rPr")) {
        if (tagOf(rp) === "w:lang") {
          out.lang = attrLoose(rp, "w:val") ?? attrLoose(rp, "w:bidi");
        }
      }
    }
  }
  return out;
}

function parseParagraph(p: PNode, rels: Map<string, string>, styles?: Map<string, StyleInfo>): ParaInfo {
  const children = kidsOf(p, "w:p");
  const pPr = findFirst(children, "w:pPr");
  const meta = parsePPr(pPr);
  const styleInfo = meta.styleId ? styles?.get(meta.styleId) : undefined;
  const textNodes: TextNode[] = [];
  let sumSize = 0;
  let sizeCount = 0;
  let anyBold = false;
  const imageRels: ImageRef[] = [];
  let hasMath = false;
  const noteRefs: Array<{ kind: "footnote" | "endnote"; id: string }> = [];

  for (const c of children) {
    const t = tagOf(c);
    if (!t || t === "w:pPr") continue;
    if (t === "w:r") {
      // Inspect run properties for size / bold stats and image

      // Inspect run properties for size / bold stats and image
      const rChildren = kidsOf(c, "w:r");
      const rPr = findFirst(rChildren, "w:rPr");
      const fmt = parseRunProps(rPr, styles);
      if (fmt.fontSizeHalfPt) {
        sumSize += fmt.fontSizeHalfPt;
        sizeCount++;
      }
      if (fmt.bold) anyBold = true;
      // images via w:drawing > … > a:blip r:embed
      collectImageRels(rChildren, imageRels);
      collectNoteRefs(rChildren, noteRefs);
      textNodes.push(...runToTextNodes(c, styles));
    } else if (t === "w:hyperlink") {
      // unwrap hyperlink runs; record href
      const hChildren = kidsOf(c, "w:hyperlink");
      const ridAttr = attrLoose(c, "r:id");
      const href = ridAttr ? rels.get(ridAttr) : undefined;
      for (const hc of hChildren) {
        if (tagOf(hc) === "w:r") {
          const nodes = runToTextNodes(hc, styles);
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
        if (tagOf(ic) === "w:r") textNodes.push(...runToTextNodes(ic, styles));
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
    isTitle: styleInfo?.isTitle || undefined,
    isSubtitle: styleInfo?.isSubtitle || undefined,
    dominantSizeHalfPt: sizeCount ? sumSize / sizeCount : undefined,
    anyBold,
    imageRels: imageRels.length ? imageRels : undefined,
    hasMath: hasMath || undefined,
    noteRefs: noteRefs.length ? noteRefs : undefined,
  };
}

function collectNoteRefs(nodes: PNode[], out: Array<{ kind: "footnote" | "endnote"; id: string }>) {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    const t = tagOf(n);
    if (!t) continue;
    if (t === "w:footnoteReference" || t === "w:endnoteReference") {
      const id = attrLoose(n, "w:id");
      if (id && !id.startsWith("-")) out.push({ kind: t === "w:footnoteReference" ? "footnote" : "endnote", id });
    } else if (Array.isArray(n[t])) {
      collectNoteRefs(n[t], out);
    }
  }
}

interface ImageRef { rid: string; widthEmu?: number; heightEmu?: number }

function collectImageRels(nodes: PNode[], out: ImageRef[]) {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    const t = tagOf(n);
    if (!t) continue;
    if (t === "w:drawing") {
      // Walk inside the drawing: find wp:extent (cx/cy) and a:blip (r:embed)
      let widthEmu: number | undefined;
      let heightEmu: number | undefined;
      const rids: string[] = [];
      const findExtentAndBlip = (sub: PNode[]) => {
        for (const m of sub ?? []) {
          if (!m || typeof m !== "object") continue;
          const tt = tagOf(m);
          if (!tt) continue;
          if (tt === "wp:extent") {
            const cx = Number(attrLoose(m, "cx"));
            const cy = Number(attrLoose(m, "cy"));
            if (Number.isFinite(cx)) widthEmu = cx;
            if (Number.isFinite(cy)) heightEmu = cy;
          } else if (tt === "a:blip") {
            const rid = attrLoose(m, "r:embed") ?? attrLoose(m, "r:link");
            if (rid) rids.push(rid);
          }
          if (Array.isArray(m[tt])) findExtentAndBlip(m[tt]);
        }
      };
      findExtentAndBlip(kidsOf(n, "w:drawing"));
      for (const rid of rids) out.push({ rid, widthEmu, heightEmu });
    } else if (t === "a:blip") {
      // Fallback for v:imagedata or stray blips outside drawings
      const rid = attrLoose(n, "r:embed") ?? attrLoose(n, "r:link");
      if (rid && !out.some((r) => r.rid === rid)) out.push({ rid });
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
          const v = attrLoose(cp, "m:val");
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
  // Match Word Navigation Panel: only explicit outline levels / built-in
  // heading styles are considered headings. Do not promote bold/large text.
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
  const dist: Record<number, number> = {};
  for (const p of paras) {
    if (p.outlineLevel !== undefined) {
      const lv = Math.min(3, p.outlineLevel + 1);
      dist[lv] = (dist[lv] ?? 0) + 1;
    }
  }
  return { promotedCount: 0, levelDistribution: dist };
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
    const id = attrLoose(r, "Id");
    const target = attrLoose(r, "Target");
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
      const numId = Number(attrLoose(c, "w:numId"));
      for (const cc of kidsOf(c, "w:num")) {
        if (tagOf(cc) === "w:abstractNumId") {
          const aid = Number(attrLoose(cc, "w:val"));
          if (Number.isFinite(numId) && Number.isFinite(aid)) info.numToAbstract.set(numId, aid);
        }
      }
    } else if (t === "w:abstractNum") {
      const aid = Number(attrLoose(c, "w:abstractNumId"));
      if (!Number.isFinite(aid)) continue;
      const levels = new Map<number, NumLevelFmt>();
      for (const lvl of kidsOf(c, "w:abstractNum")) {
        if (tagOf(lvl) !== "w:lvl") continue;
        const ilvl = Number(attrLoose(lvl, "w:ilvl"));
        const fmt: NumLevelFmt = {};
        for (const lp of kidsOf(lvl, "w:lvl")) {
          const lt = tagOf(lp);
          if (lt === "w:numFmt") fmt.numFmt = attrLoose(lp, "w:val");
          else if (lt === "w:lvlText") fmt.lvlText = attrLoose(lp, "w:val");
        }
        if (Number.isFinite(ilvl)) levels.set(ilvl, fmt);
      }
      info.abstractLevels.set(aid, levels);
    }
  }
  return info;
}

function textForFirstTag(nodes: PNode[] | null | undefined, tag: string): string | undefined {
  for (const n of nodes ?? []) {
    const t = tagOf(n);
    if (!t) continue;
    if (t === tag) {
      const txt = getText(kidsOf(n, t)).trim();
      if (txt) return txt;
    }
    const child = textForFirstTag(kidsOf(n, t), tag);
    if (child) return child;
  }
  return undefined;
}

function parseNotes(
  notesXml: any | null,
  rootTag: "w:footnotes" | "w:endnotes",
  itemTag: "w:footnote" | "w:endnote",
  rels: Map<string, string>,
  styles: Map<string, StyleInfo>,
): Map<string, TextNode[]> {
  const out = new Map<string, TextNode[]>();
  const root = notesXml ? findFirst(notesXml, rootTag) : null;
  if (!root) return out;
  for (const note of kidsOf(root, rootTag)) {
    if (tagOf(note) !== itemTag) continue;
    const id = attrLoose(note, "w:id");
    if (!id || id.startsWith("-")) continue;
    const nodes: TextNode[] = [];
    for (const child of kidsOf(note, itemTag)) {
      if (tagOf(child) !== "w:p") continue;
      const p = parseParagraph(child, rels, styles);
      if (!p.textNodes.length) continue;
      if (nodes.length) nodes.push({ type: "text", text: "\n" });
      nodes.push(...p.textNodes);
    }
    if (nodes.length) out.set(id, nodes);
  }
  return out;
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
  metadata: { title?: string; subtitle?: string };
  diagnostics: {
    promotedHeadings: number;
    headingLevels: Record<number, number>;
    paragraphsTotal: number;
    imagesEmbedded: number;
    formulasDetected: number;
    footnotesDetected: number;
    cleanedMarker: boolean;
  };
}


export function mapOoxmlToDoc(bundle: OoxmlBundle): MapResult {
  const stylesMap = parseStyles(bundle.styles);
  const rels = parseRels(bundle.rels);
  const numInfo = parseNumbering(bundle.numbering);
  const footnotes = parseNotes(bundle.footnotes, "w:footnotes", "w:footnote", rels, stylesMap);
  const endnotes = parseNotes(bundle.endnotes, "w:endnotes", "w:endnote", rels, stylesMap);
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
        const info = parseParagraph(c, rels, stylesMap);
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
  const metadata = {
    title: textForFirstTag(bundle.coreProps, "dc:title") || paras.find((p) => p.isTitle)?.text,
    subtitle: paras.find((p) => p.isSubtitle)?.text,
  };
  
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

  // EMU → px (Word DOCX: 914400 EMU/inch; 96dpi → 9525 EMU/px).
  const emuToPx = (emu?: number): number | undefined =>
    emu && emu > 0 ? Math.max(16, Math.round(emu / 9525)) : undefined;

  const pushImage = (ref: ImageRef) => {
    const m = mediaByRid.get(ref.rid);
    if (!m) return;
    usedMediaNames.add(m.name);
    imagesEmbedded++;
    const w = emuToPx(ref.widthEmu);
    const h = emuToPx(ref.heightEmu);
    const attrs: any = { src: `media://${m.name}` };
    // Only carry the width when the image was small in Word (icon-sized).
    // Larger images keep responsive full-container rendering.
    if (w && w < 480) {
      attrs.width = w;
      if (h) attrs.height = h;
    }
    content.push({ type: "image", attrs } as ImageNode);
  };

  // Track unique footnote references for diagnostics. Note content is inlined
  // into the reference mark so the UI can show it as a tooltip / popover.
  const seenNote = new Set<string>();

  const noteTextOf = (kind: string, id: string): string | undefined => {
    const note = kind === "footnote" ? footnotes.get(id) : endnotes.get(id);
    if (!note?.length) return undefined;
    return note.map((n) => n.text ?? "").join("").trim();
  };

  /** Walk text nodes; resolve any footnote mark's id/kind into its content. */
  const resolveFootnoteMarks = (nodes: TextNode[] | undefined) => {
    if (!nodes) return;
    for (const n of nodes) {
      const marks = (n as any).marks as any[] | undefined;
      if (!marks) continue;
      for (const m of marks) {
        if (m?.type !== "footnote" || !m.attrs) continue;
        const { kind, id, content } = m.attrs;
        if (content !== undefined) continue;
        const text = id && kind ? noteTextOf(kind, id) : undefined;
        m.attrs = { content: text ?? "" };
        if (id) seenNote.add(`${kind}:${id}`);
      }
    }
  };

  for (const b of topBlocks) {
    if (b.kind === "table") {
      const tbl = parseTable(b.node);
      if (tbl) content.push(tbl);
      continue;
    }
    const info = b.info;

    if (info.hasMath) formulasDetected++;

    resolveFootnoteMarks(info.textNodes);

    // Image-only paragraph → emit ImageNode(s)
    if (info.imageRels && info.imageRels.length && !info.text.trim()) {
      for (const ref of info.imageRels) pushImage(ref);
      continue;
    }

    // List item
    if (info.numId !== undefined) {
      if (!info.text.trim() && !(info.imageRels?.length)) continue;
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
        attrs: { dir: detectDir(info.text, info.bidi), textAlign: info.align ?? null },
        content: nodes,
      } as ParagraphNode);
      continue;
    }

    // Heading — skip empty ones (matches Word Navigation pane behaviour:
    // explicit-heading styles applied to blank lines should not appear in TOC).
    if (info.outlineLevel !== undefined) {
      if (!info.text.trim()) continue;
      const level = Math.min(3, Math.max(1, (info.outlineLevel ?? 0) + 1)) as 1 | 2 | 3;
      content.push({
        type: "heading",
        attrs: { level, dir: detectDir(info.text, info.bidi), textAlign: info.align ?? null },
        content: info.textNodes,
      } as HeadingNode);
      continue;
    }

    // Inline images embedded with text → emit images first, then paragraph
    if (info.imageRels && info.imageRels.length) {
      for (const ref of info.imageRels) pushImage(ref);
    }

    // Normal paragraph — skip totally empty ones
    if (!info.text.trim()) continue;
    content.push({
      type: "paragraph",
      attrs: { dir: detectDir(info.text, info.bidi), textAlign: info.align ?? null },
      content: info.textNodes,
    } as ParagraphNode);
  }

  // Footnotes are now rendered inline as tooltips/popovers at their reference
  // location (see BlockRenderer / WordAddin preview). No appendix is emitted.

  /* ----------------------------------------------------------------------
   * Auto-extract image captions from the next paragraph(s).
   * If an image has no caption and the next ≤3 paragraphs start with a
   * caption keyword like «شکل ۱» / «Figure 1» / «Abbildung 2», take that
   * line as the caption, mark it as pending user confirmation, and remove
   * the duplicate paragraph from the flow.
   * -------------------------------------------------------------------- */
  const isCaptionableImage = (n: any): boolean =>
    n?.type === "image" && !n.attrs?.caption;
  const blockPlainText = (n: any): string => {
    if (!n || (n.type !== "paragraph" && n.type !== "heading")) return "";
    return (n.content ?? [])
      .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
      .trim();
  };
  for (let i = 0; i < content.length; i += 1) {
    const img: any = content[i];
    if (!isCaptionableImage(img)) continue;
    for (let j = 1; j <= 3 && i + j < content.length; j += 1) {
      const nx: any = content[i + j];
      if (!nx) continue;
      if (nx.type === "image" || nx.type === "image_placeholder") break;
      const text = blockPlainText(nx);
      if (!text) continue;
      if (FIG_RE.test(text)) {
        img.attrs = {
          ...img.attrs,
          caption: text,
          captionPendingConfirm: true,
        };
        // Consume the source paragraph so the same text doesn't appear twice.
        content.splice(i + j, 1);
      }
      // Whether matched or not, the first non-empty text block ends the search.
      break;
    }
  }


  const doc: TiptapDoc = { type: "doc", content };
  const media = bundle.media.filter((m) => usedMediaNames.has(m.name));

  return {
    doc,
    media,
    metadata,
    diagnostics: {
      promotedHeadings: headingDiag.promotedCount,
      headingLevels: headingDiag.levelDistribution,
      paragraphsTotal: paras.length,
      imagesEmbedded,
      formulasDetected,
      footnotesDetected: seenNote.size,
      cleanedMarker: bundle.hasCleanedMarker,
    },
  };
}

/** Parse a <w:tbl> into a proper TableNode (headers + rows of plain text). */
function parseTable(tbl: PNode): any | null {
  const allRows: string[][] = [];
  for (const r of kidsOf(tbl, "w:tbl")) {
    if (tagOf(r) !== "w:tr") continue;
    const cells: string[] = [];
    for (const c of kidsOf(r, "w:tr")) {
      if (tagOf(c) !== "w:tc") continue;
      const parts: string[] = [];
      for (const p of kidsOf(c, "w:tc")) {
        if (tagOf(p) === "w:p") {
          const txt = getText(kidsOf(p, "w:p")).trim();
          if (txt) parts.push(txt);
        }
      }
      cells.push(parts.join(" "));
    }
    if (cells.length) allRows.push(cells);
  }
  if (!allRows.length) return null;
  // Treat the first row as header (typical Word table convention).
  const headers = allRows[0];
  const rows = allRows.slice(1);
  // Normalize column count: pad each row to the widest length.
  const cols = Math.max(headers.length, ...rows.map((r) => r.length));
  const pad = (row: string[]) => row.length === cols ? row : [...row, ...Array(cols - row.length).fill("")];
  return {
    type: "table",
    attrs: {
      headers: pad(headers),
      rows: rows.map(pad),
    },
  };
}

