// Reads a .docx (OOXML) zip in the browser and returns parsed XML + media.
// No server roundtrip. Used by the Word Add-in taskpane and by the standalone
// "/word-addin" test page (drop a .docx without installing the add-in).

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface OoxmlMedia {
  /** Path inside the zip, e.g. "word/media/image1.png". */
  path: string;
  /** Bare filename, e.g. "image1.png". */
  name: string;
  /** Best-guess MIME type. */
  contentType: string;
  /** Raw bytes. */
  bytes: Uint8Array;
}

export interface OoxmlBundle {
  /** Parsed word/document.xml. */
  doc: any;
  /** Parsed word/styles.xml (may be null). */
  styles: any | null;
  /** Parsed word/numbering.xml (may be null). */
  numbering: any | null;
  /** Parsed word/footnotes.xml (may be null). */
  footnotes: any | null;
  /** Parsed word/endnotes.xml (may be null). */
  endnotes: any | null;
  /** Parsed docProps/core.xml (may be null). */
  coreProps: any | null;
  /** Parsed word/_rels/document.xml.rels (may be null). */
  rels: any | null;
  /** All images extracted from word/media/. */
  media: OoxmlMedia[];
  /** True if our cleaned-marker custom XML part is present. */
  hasCleanedMarker: boolean;
  /** Raw XML text of word/document.xml (used to mine TOC field instructions). */
  rawDocXml?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,        // CRITICAL: keep text/element ordering
  trimValues: false,          // CRITICAL: keep whitespace (ZWNJ etc.)
  parseTagValue: false,
  parseAttributeValue: false,
  textNodeName: "#text",
  alwaysCreateTextNode: false,
});

export async function readDocx(input: ArrayBuffer | Blob | File): Promise<OoxmlBundle> {
  const buf = input instanceof ArrayBuffer ? input : await (input as Blob).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const readXml = async (path: string): Promise<any | null> => {
    const f = zip.file(path);
    if (!f) return null;
    const xml = await f.async("text");
    return parser.parse(xml);
  };

  const rawDocXml = (await zip.file("word/document.xml")?.async("text")) ?? undefined;

  const [doc, styles, numbering, footnotes, endnotes, coreProps, rels] = await Promise.all([
    readXml("word/document.xml"),
    readXml("word/styles.xml"),
    readXml("word/numbering.xml"),
    readXml("word/footnotes.xml"),
    readXml("word/endnotes.xml"),
    readXml("docProps/core.xml"),
    readXml("word/_rels/document.xml.rels"),
  ]);

  if (!doc) throw new Error("فایل .docx معتبر نیست (word/document.xml یافت نشد)");

  // Extract every file under word/media/
  const media: OoxmlMedia[] = [];
  const mediaFiles = zip.folder("word/media");
  if (mediaFiles) {
    const entries: JSZip.JSZipObject[] = [];
    mediaFiles.forEach((_, entry) => {
      if (!entry.dir) entries.push(entry);
    });
    for (const entry of entries) {
      const bytes = await entry.async("uint8array");
      const name = entry.name.split("/").pop() ?? entry.name;
      media.push({
        path: entry.name,
        name,
        contentType: guessMime(name),
        bytes,
      });
    }
  }

  // Detect our cleaned marker (Custom XML part with id "farabook-cleaned-v1")
  let hasCleanedMarker = false;
  const customXmlFolder = zip.folder("customXml");
  if (customXmlFolder) {
    const customFiles: JSZip.JSZipObject[] = [];
    customXmlFolder.forEach((_, e) => {
      if (!e.dir && e.name.endsWith(".xml")) customFiles.push(e);
    });
    for (const f of customFiles) {
      const txt = await f.async("text");
      if (txt.includes("farabook-cleaned-v1")) {
        hasCleanedMarker = true;
        break;
      }
    }
  }

  return { doc, styles, numbering, footnotes, endnotes, coreProps, rels, media, hasCleanedMarker, rawDocXml };
}

/**
 * Extract style→level hints from any TOC field in the document.
 *
 * Looks for:
 *   • `\o "1-3"` switch (built-in heading range) → emits {Heading N, N}.
 *   • `\t "Style1,1,Style2,2"` switch (custom style map).
 *
 * Handles both `<w:fldSimple w:instr="...">` and complex fields built from
 * a run of `<w:instrText>` fragments. Returns a de-duplicated list,
 * preserving first-seen order.
 */
export function extractTocFieldStyles(
  rawDocXml: string | undefined,
): Array<{ name: string; level: number }> {
  if (!rawDocXml) return [];
  const out: Array<{ name: string; level: number }> = [];
  const decode = (s: string) =>
    s.replace(/&quot;/g, '"').replace(/&amp;/g, "&")
     .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'");

  const instructions: string[] = [];

  // Simple fields: <w:fldSimple w:instr="TOC ...">
  const reSimple = /<w:fldSimple\b[^>]*\bw:instr="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = reSimple.exec(rawDocXml))) instructions.push(decode(m[1]));

  // Complex fields: concat ALL <w:instrText> contents. This may mash multiple
  // field instructions together but our regexes below are anchored to TOC.
  const reInstr = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g;
  let bulk = "";
  while ((m = reInstr.exec(rawDocXml))) bulk += " " + decode(m[1]);
  if (bulk.trim()) instructions.push(bulk);

  for (const raw of instructions) {
    // Isolate the TOC instruction (a single field). Stop at the next field
    // keyword or end of string.
    const idx = raw.search(/\bTOC\b/);
    if (idx < 0) continue;
    let segment = raw.slice(idx);
    const stop = segment.search(/\b(?:PAGEREF|HYPERLINK|REF|SEQ|STYLEREF|XE|TOA)\b/);
    if (stop > 0) segment = segment.slice(0, stop);

    // \o "1-3"  (built-in heading levels)
    const o = /\\o\s*"(\d+)\s*-\s*(\d+)"/.exec(segment);
    if (o) {
      const lo = Math.max(1, +o[1]);
      const hi = Math.min(8, +o[2]);
      for (let lv = lo; lv <= hi; lv++) out.push({ name: `Heading ${lv}`, level: lv });
    }

    // \t "Style1,1,Style2,2,..."
    const t = /\\t\s*"([^"]+)"/.exec(segment);
    if (t) {
      const parts = t[1].split(",").map((s) => s.trim());
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const name = parts[i];
        const lv = parseInt(parts[i + 1], 10);
        if (name && lv >= 1 && lv <= 8) out.push({ name, level: lv });
      }
    }
  }

  const seen = new Set<string>();
  const dedup: Array<{ name: string; level: number }> = [];
  for (const e of out) {
    const k = e.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push({ name: e.name.trim(), level: e.level });
  }
  return dedup;
}

/* ------------------------------------------------------------------ */
/* Small helpers to walk the preserveOrder tree                       */
/* ------------------------------------------------------------------ */

/** Returns the array of children for a node in preserveOrder mode. */
export function childrenOf(node: any, tag: string): any[] {
  if (!node) return [];
  const arr = node[tag];
  return Array.isArray(arr) ? arr : [];
}

/** preserveOrder nodes are arrays of { tagName: [...children], ":@": attrs }. */
export function walk(nodes: any[], visit: (tag: string, node: any) => void) {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    for (const key of Object.keys(n)) {
      if (key === ":@" || key === "#text") continue;
      visit(key, n);
    }
  }
}

/** Extract attribute from a preserveOrder node, e.g. attr(n, "w:val"). */
export function attr(node: any, name: string): string | undefined {
  const at = node?.[":@"];
  if (!at) return undefined;
  return at["@_" + name];
}
