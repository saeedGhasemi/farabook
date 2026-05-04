// Edge Function: parse uploaded .docx into a structured book and insert it.
// Extracts text, headings, tables, and images (uploaded to public storage).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import { strFromU8, strToU8, unzipSync, zipSync } from "https://esm.sh/fflate@0.8.2?target=deno";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Block =
  | { type: "heading"; level?: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "callout"; text: string }
  | { type: "image"; src: string; caption?: string; figureNumber?: string }
  | {
      type: "image_placeholder";
      pendingSrc: string;
      bytes: number;
      contentType?: string;
      reason?: string;
      caption?: string;
      figureNumber?: string;
      originalPath?: string;
      slot?: number;
    }
  | { type: "table"; headers: string[]; rows: string[][]; caption?: string; tableNumber?: string };

interface Page { title: string; blocks: Block[]; }

const htmlText = (s: string) =>
  s
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const dummyCitationTarget = (url: string): string | null => {
  const d = /dummy-citation\.com\/citation\?d=([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!d) return null;
  try {
    const b64 = d.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(d.length / 4) * 4, "=");
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    const work = (Array.isArray(payload) ? payload[0]?.work : payload?.work) ?? payload?.[0] ?? payload;
    return work?.url || work?.resourceUrl || (work?.ids?.doi ? `https://doi.org/${work.ids.doi}` : null);
  } catch {
    return null;
  }
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/&amp;/g, "&"));
  } catch {
    return value.replace(/&amp;/g, "&");
  }
};

const extractCitationTarget = (value: string): string | null => {
  const dummy = dummyCitationTarget(value);
  if (dummy) return dummy;

  const decoded = safeDecodeURIComponent(value);
  const directUrl = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(decoded)?.[1];
  if (directUrl) return directUrl.replace(/\\\//g, "/");

  const runs = decoded.match(/[A-Za-z0-9+/_=-]{80,}/g) ?? [];
  for (const run of runs) {
    const maxOffset = Math.min(180, run.length - 24);
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidate = run.slice(offset).replace(/-/g, "+").replace(/_/g, "/");
      try {
        const padded = candidate.padEnd(Math.ceil(candidate.length / 4) * 4, "=");
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        const url = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(text)?.[1];
        if (url) return url.replace(/\\\//g, "/");
        const doi = /"doi"\s*:\s*"([^"\\]+)"/.exec(text)?.[1];
        if (doi) return `https://doi.org/${doi}`;
      } catch {
        // Try the next possible start; citation add-ins often prepend bytes.
      }
    }
  }

  return null;
};

const wrapBareUrls = (text: string): string =>
  text
    .split(/(\[[^\]\n]+\]\([^\)\s]+\))/g)
    .map((part) => {
      if (/^\[[^\]\n]+\]\([^\)\s]+\)$/.test(part)) return part;
      return part.replace(/https?:\/\/[^\s<>"'\]\)]+/g, (url) => `[Link](${url})`);
    })
    .join("");

const normalizeImportedLinks = (text: string): string => {
  const withoutCitationPayloads = text
    .replace(/(\([0-9,\s\-–—]+\))\s*((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9+/_=-]){80,})/g, (_m, label, payload) => {
      const target = extractCitationTarget(payload);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/(\([0-9,\s\-–—]+\))\s*(https:\/\/dummy-citation\.com\/citation\?d=[A-Za-z0-9_-]+)/g, (_m, label, url) => {
      const target = extractCitationTarget(url);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/(\[[^\]\n]+\]\([^)]+\))(?:%3D|=)+/gi, "$1")
    .replace(/https:\/\/dummy-citation\.com\/citation\?d=[A-Za-z0-9_-]+/g, "");
  return wrapBareUrls(withoutCitationPayloads).replace(/\s+/g, " ").trim();
};

// Convert <a href="URL">label</a> into the markdown form [label](URL) which
// the reader/editor recognize. Citation add-ins sometimes store a long
// dummy-citation URL; decode it to the real DOI/resource URL and keep the
// visible citation label instead of exposing the technical address.
const convertAnchors = (s: string): string => {
  return s.replace(
    /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q: string, href: string, inner: string) => {
      const label = htmlText(inner);
      const url = href.trim().replace(/&amp;/g, "&");
      if (!url) return label;
      if (url.startsWith("#")) return label;
      if (url.includes("dummy-citation.com/citation")) {
        const target = extractCitationTarget(url);
        if (!label || label === url || label.includes("dummy-citation.com/citation")) {
          return target ? `[${label || target}](${target})` : "";
        }
        return target ? `[${label}](${target})` : label;
      }
      const safeLabel = label || url;
      return `[${safeLabel}](${url})`;
    },
  );
};

const stripTags = (s: string) =>
  normalizeImportedLinks(htmlText(convertAnchors(s)));

// Word stores EMF/WMF vector images inside <mc:AlternateContent>:
//   <mc:Choice>  → modern path with EMF (browsers can't render)
//   <mc:Fallback>→ legacy path with a raster PNG/JPEG that Word generated
// mammoth defaults to mc:Choice, so the editor ends up with broken EMF
// `<img>`s. We rewrite each AlternateContent to keep only the Fallback so
// mammoth emits the raster image instead. We also try to delete the now
// unused EMF/WMF media entries so they don't bloat memory.
function preferRasterFallback(input: Buffer): { buffer: Buffer; replaced: number; droppedVector: number } {
  let replaced = 0;
  const files = unzipSync(new Uint8Array(input));

  // 1. Rewrite XML: replace <mc:AlternateContent>…</mc:AlternateContent> with
  //    just the inner <mc:Fallback> body when a Fallback exists; otherwise
  //    leave it (mammoth will at least try the EMF and we'll mark it later).
  for (const key of Object.keys(files)) {
    if (!/^word\/.*\.xml$/i.test(key)) continue;
    const xml = strFromU8(files[key]);
    const next = xml.replace(
      /<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/gi,
      (whole, inner) => {
        const fb = /<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/i.exec(inner);
        if (fb && fb[1]) {
          replaced += 1;
          return fb[1];
        }
        return whole;
      },
    );
    if (next !== xml) files[key] = strToU8(next);
  }

  // 2. Inspect remaining drawings to know which media paths are still
  //    referenced. Drop EMF/WMF media + their relationship entries that no
  //    XML still points at.
  const referencedRelIds = new Set<string>();
  for (const key of Object.keys(files)) {
    if (!/^word\/.*\.xml$/i.test(key)) continue;
    const xml = strFromU8(files[key]);
    for (const m of xml.matchAll(/(?:r:embed|r:id|r:link)=["']([^"']+)["']/gi)) {
      referencedRelIds.add(m[1]);
    }
  }
  let droppedVector = 0;
  for (const key of Object.keys(files)) {
    if (!/\.rels$/i.test(key)) continue;
    const xml = strFromU8(files[key]);
    const next = xml.replace(/<Relationship\b[^>]*\/>/gi, (tag) => {
      if (!/Type=["'][^"']*\/image["']/i.test(tag)) return tag;
      const id = extractAttr(tag, "Id") || "";
      const target = extractAttr(tag, "Target") || "";
      const isVector = /\.(emf|wmf)$/i.test(target);
      if (isVector && !referencedRelIds.has(id)) {
        // also drop the actual binary
        const norm = target.startsWith("../")
          ? target.replace(/^\.\.\//, "word/")
          : `word/${target.replace(/^\//, "")}`;
        if (files[norm]) {
          delete files[norm];
          droppedVector += 1;
        }
        return "";
      }
      return tag;
    });
    if (next !== xml) files[key] = strToU8(next);
  }

  return { buffer: Buffer.from(zipSync(files, { level: 0 })), replaced, droppedVector };
}

function stripDocxImages(input: Buffer): { buffer: Buffer; removedImages: number } {
  let removedImages = 0;
  const files = unzipSync(new Uint8Array(input), {
    // Critical for large books: do not inflate media entries at all. Inflating
    // hundreds of embedded images can exceed the edge memory cap before we get
    // a chance to remove them.
    filter: (file: { name: string }) => {
      const isMedia = /^word\/media\//i.test(file.name);
      if (isMedia) removedImages += 1;
      return !isMedia;
    },
  });

  for (const key of Object.keys(files)) {
    if (!/\.rels$/i.test(key)) continue;
    const xml = strFromU8(files[key]);
    const next = xml.replace(/<Relationship\b[^>]*\/>/gi, (tag) =>
      /Type=["'][^"']*\/image["']/i.test(tag) ? "" : tag,
    );
    if (next !== xml) files[key] = strToU8(next);
  }

  for (const key of Object.keys(files)) {
    if (!/^word\/.*\.xml$/i.test(key)) continue;
    const xml = strFromU8(files[key]);
    const next = xml
      .replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/gi, "")
      .replace(/<w:drawing[\s\S]*?<\/w:drawing>/gi, "")
      .replace(/<w:pict[\s\S]*?<\/w:pict>/gi, "")
      .replace(/<v:shape[\s\S]*?<\/v:shape>/gi, "");
    if (next !== xml) files[key] = strToU8(next);
  }

  return { buffer: Buffer.from(zipSync(files, { level: 0 })), removedImages };
}

const xmlText = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const textFromWordXml = (xml: string): string => {
  const normalized = xml
    .replace(/<w:tab\b[^>]*\/>/gi, " ")
    .replace(/<w:br\b[^>]*\/>/gi, "\n");
  const parts: string[] = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) parts.push(xmlText(m[1]));
  return normalizeImportedLinks(parts.join(""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const extractAttr = (xml: string, name: string): string | undefined => {
  const escaped = name.replace(/:/g, "(?::|&#58;)");
  return new RegExp(`${escaped}=["']([^"']+)["']`, "i").exec(xml)?.[1];
};

const normalizeTarget = (target: string): string =>
  target.startsWith("../") ? target.replace(/^\.\.\//, "word/") : `word/${target.replace(/^\//, "")}`;

type DocxImageRef = { path: string; bytes: number; contentType?: string };

function docxToPagesTextOnly(input: Buffer): { pages: Page[]; removedImages: number } {
  let removedImages = 0;
  const files = unzipSync(new Uint8Array(input), {
    filter: (file: { name: string }) => {
      const keep = file.name === "word/document.xml" || file.name === "word/_rels/document.xml.rels" || file.name === "[Content_Types].xml";
      if (/^word\/media\//i.test(file.name)) {
        removedImages += 1;
        return false;
      }
      return keep;
    },
  });
  const doc = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  if (!doc) return { pages: [], removedImages };

  const relsXml = files["word/_rels/document.xml.rels"] ? strFromU8(files["word/_rels/document.xml.rels"]) : "";
  const contentTypesXml = files["[Content_Types].xml"] ? strFromU8(files["[Content_Types].xml"]) : "";
  const contentTypes = new Map<string, string>();
  for (const m of contentTypesXml.matchAll(/<Default\b[^>]*Extension=["']([^"']+)["'][^>]*ContentType=["']([^"']+)["'][^>]*\/>/gi)) {
    contentTypes.set(m[1].toLowerCase(), m[2]);
  }
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/gi)) {
    const tag = m[0];
    if (!/Type=["'][^"']*\/image["']/i.test(tag)) continue;
    const id = extractAttr(tag, "Id");
    const target = extractAttr(tag, "Target");
    if (id && target) rels.set(id, normalizeTarget(target));
  }
  let imageSlot = 0;
  const imageRefsFromXml = (xml: string): DocxImageRef[] => {
    const refs: DocxImageRef[] = [];
    for (const m of xml.matchAll(/(?:r:embed|r:id)=["']([^"']+)["']/gi)) {
      const path = rels.get(m[1]);
      if (!path) continue;
      const ext = path.split(".").pop()?.toLowerCase() || "";
      refs.push({ path, bytes: 0, contentType: contentTypes.get(ext) });
    }
    return refs;
  };

  const pages: Page[] = [];
  let cur: Page = { title: "مقدمه", blocks: [] };
  const pushPage = () => {
    if (cur.blocks.length) pages.push(cur);
  };
  const maxBlocksPerPage = 80;
  const ensureRoom = () => {
    if (cur.blocks.length < maxBlocksPerPage) return;
    pushPage();
    cur = { title: `بخش ${pages.length + 1}`, blocks: [] };
  };

  const tokenRe = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(doc)) !== null) {
    const token = m[0];
    if (/^<w:tbl\b/i.test(token)) {
      const rows: string[][] = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(token)) !== null) {
        const cells: string[] = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[0])) !== null) cells.push(textFromWordXml(cm[0]));
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) {
        ensureRoom();
        cur.blocks.push({ type: "table", headers: rows.shift() ?? [], rows });
      }
      continue;
    }

    const imageRefs = imageRefsFromXml(token);
    if (imageRefs.length) {
      ensureRoom();
      for (const ref of imageRefs) {
        imageSlot += 1;
        cur.blocks.push({
          type: "image_placeholder",
          pendingSrc: "",
          bytes: ref.bytes,
          contentType: ref.contentType,
          reason: "text_only",
          originalPath: ref.path,
          slot: imageSlot,
        });
      }
    }

    const style = /<w:pStyle\b[^>]*(?:w:val|val)=["']([^"']+)["']/i.exec(token)?.[1] || "";
    const headingMatch = /heading\s*([1-4])|Heading([1-4])|عنوان\s*([1-4])/i.exec(style);
    const level = Number(headingMatch?.[1] || headingMatch?.[2] || headingMatch?.[3] || 0);
    const parts = token.split(/<w:lastRenderedPageBreak\b[^>]*\/>|<w:br\b[^>]*(?:w:)?type=["']page["'][^>]*\/>/gi);
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const text = textFromWordXml(part);
      if (text) {
        if (level === 1 || level === 2) {
          pushPage();
          cur = { title: text.slice(0, 120), blocks: [] };
        } else {
          ensureRoom();
          cur.blocks.push(level ? { type: "heading", level: Math.min(level, 3), text } : { type: "paragraph", text });
        }
      }
      if (i < parts.length - 1) {
        pushPage();
        cur = { title: `صفحه ${pages.length + 1}`, blocks: [] };
      }
    }
  }
  pushPage();
  return { pages: pages.filter((p) => p.blocks.length > 0), removedImages };
}

// Find Persian/English figure or table label like "شکل ۹–۱" / "Figure 9.1" / "جدول ۲-۱"
const FIG_RE = /^(شکل|تصویر|نگاره|figure|fig\.?)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;
const TBL_RE = /^(جدول|table)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;
// Recognize chapter / section headings written as plain paragraphs (the
// author didn't apply Word's Heading style). Persian "فصل اول" / "فصل ۱" /
// "بخش دوم" and English "Chapter 1" / "Part II" all qualify.
const CHAPTER_RE = /^\s*(فصل|بخش|گفتار|chapter|part|section)\s+(?:[\d\u06F0-\u06F9۰-۹IVXLC]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم)\b/i;

function splitLabel(text: string, re: RegExp): { label?: string; rest: string } {
  const m = text.match(re);
  if (!m) return { rest: text };
  const label = m[0].trim();
  const rest = text.slice(label.length).replace(/^[\s:–\-—.]+/, "").trim();
  return { label, rest };
}

/* Walk the produced HTML token by token in document order so images and
   tables appear in the right place inside chapters. */
function htmlToPages(html: string): Page[] {
  let cleaned = html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&nbsp;/g, " ");

  // Extract tables FIRST and replace them with placeholder tokens, so the
  // generic tokenizer below doesn't accidentally swallow `<p>` cells inside
  // tables (which would leave the outer `<table>` un-matched).
  const extractedTables: string[] = [];
  cleaned = cleaned.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    const idx = extractedTables.length;
    extractedTables.push(inner);
    return `<p>__TABLE_PLACEHOLDER_${idx}__</p>`;
  });

  // tokenize: headings, paragraphs, blockquote, lists, standalone images
  const tokenRe = /<(h1|h2|h3|h4|p|blockquote|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;

  const pages: Page[] = [];
  let cur: Page = { title: "مقدمه", blocks: [] };
  let pendingImageCaption: { fig?: string; text: string } | null = null;
  let pendingTableCaption: { tbl?: string; text: string } | null = null;

  const pushPage = () => {
    if (cur.blocks.length) pages.push(cur);
  };

  const handleParagraph = (inner: string) => {
    // 1) Extract any inline images first (preserving order)
    const imgRe = /<img[^>]*src="([^"]+)"[^>]*>/gi;
    let lastIdx = 0;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner)) !== null) {
      const before = inner.slice(lastIdx, im.index);
      const beforeText = stripTags(before);
      if (beforeText) {
        // attach as paragraph or caption depending on label
        if (FIG_RE.test(beforeText)) {
          const { label, rest } = splitLabel(beforeText, FIG_RE);
          pendingImageCaption = { fig: label, text: rest };
        } else if (TBL_RE.test(beforeText)) {
          const { label, rest } = splitLabel(beforeText, TBL_RE);
          pendingTableCaption = { tbl: label, text: rest };
        } else {
          cur.blocks.push({ type: "paragraph", text: beforeText });
        }
      }
      const rawSrc = im[1];
      if (rawSrc.startsWith("__WI_PLACEHOLDER__|")) {
        const [, bytesStr, ct, reason, url] = rawSrc.split("|");
        cur.blocks.push({
          type: "image_placeholder",
          pendingSrc: url || "",
          bytes: Number(bytesStr) || 0,
          contentType: ct || undefined,
          reason: reason || undefined,
          caption: pendingImageCaption?.text,
          figureNumber: pendingImageCaption?.fig,
        });
      } else {
        cur.blocks.push({
          type: "image",
          src: rawSrc,
          caption: pendingImageCaption?.text,
          figureNumber: pendingImageCaption?.fig,
        });
      }
      pendingImageCaption = null;
      lastIdx = im.index + im[0].length;
    }
    const tail = stripTags(inner.slice(lastIdx));
    if (!tail) return;

    // Caption immediately after an image?
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && (last.type === "image" || last.type === "image_placeholder") && !last.caption && (FIG_RE.test(tail) || tail.length < 220)) {
      if (FIG_RE.test(tail)) {
        const { label, rest } = splitLabel(tail, FIG_RE);
        (last as any).figureNumber = label;
        last.caption = rest;
      } else {
        last.caption = tail;
      }
      return;
    }

    if (FIG_RE.test(tail)) {
      const { label, rest } = splitLabel(tail, FIG_RE);
      pendingImageCaption = { fig: label, text: rest };
      return;
    }
    if (TBL_RE.test(tail)) {
      const { label, rest } = splitLabel(tail, TBL_RE);
      pendingTableCaption = { tbl: label, text: rest };
      return;
    }

    cur.blocks.push({ type: "paragraph", text: tail });
  };

  const handleTable = (inner: string) => {
    const rows: string[][] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(inner)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push(stripTags(cm[2]));
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return;
    const headers = rows.shift() ?? [];
    cur.blocks.push({
      type: "table",
      headers,
      rows,
      caption: pendingTableCaption?.text,
      tableNumber: pendingTableCaption?.tbl,
    });
    pendingTableCaption = null;
  };

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2];

    if (tag === "h1" || tag === "h2") {
      const text = stripTags(inner);
      if (!text) continue;
      pushPage();
      cur = { title: text.slice(0, 120), blocks: [] };
    } else if (tag === "h3" || tag === "h4") {
      const text = stripTags(inner);
      if (text) cur.blocks.push({ type: "heading", level: 3, text });
    } else if (tag === "blockquote") {
      const text = stripTags(inner);
      if (text) cur.blocks.push({ type: "quote", text });
    } else if (tag === "ul" || tag === "ol") {
      const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? [];
      items.forEach((li) => {
        const t = stripTags(li);
        if (t) cur.blocks.push({ type: "paragraph", text: "• " + t });
      });
    } else if (tag === "table") {
      handleTable(inner);
    } else {
      // p — but check for table placeholder first
      const phMatch = /^\s*__TABLE_PLACEHOLDER_(\d+)__\s*$/.exec(stripTags(inner));
      if (phMatch) {
        const tblInner = extractedTables[parseInt(phMatch[1], 10)];
        if (tblInner) handleTable(tblInner);
      } else {
        handleParagraph(inner);
      }
    }
  }
  pushPage();

  return pages.filter((p) => p.blocks.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const u = { user: { id: claims.claims.sub as string } };

    // Only publishers / admins may create books via this endpoint.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const allowedRoles = new Set(["publisher", "admin", "super_admin"]);
    const canCreate = (roleRows || []).some((r: any) => allowedRoles.has(r.role));
    if (!canCreate) {
      return new Response(
        JSON.stringify({ error: "publisher_role_required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    let path: string = body.path;
    let title: string = (body.title || "کتاب جدید").toString().slice(0, 200);
    let author: string = (body.author || "ناشناس").toString().slice(0, 120);
    let description: string = (body.description || "").toString().slice(0, 600);
    const replaceBookId: string | undefined = body.replaceBookId;
    const importId: string | undefined = body.importId;
    // Caller can opt out of image extraction (faster + lower-memory) — useful
    // as a fallback after a previous failed attempt with images.
    const skipImages: boolean = body.skipImages === true;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // If an importId is provided, hydrate path/title/author/description from
    // the saved row so the user does not have to re-upload or retype.
    let importMetadata: Record<string, unknown> | null = null;
    if (importId) {
      const { data: imp, error: impErr } = await admin
        .from("word_imports")
        .select("user_id, file_path, title, author, description, attempt_count, metadata")
        .eq("id", importId)
        .maybeSingle();
      if (impErr || !imp) {
        return new Response(JSON.stringify({ error: "import_not_found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (imp.user_id !== u.user.id) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      path = imp.file_path;
      title = body.title || imp.title || title;
      author = body.author || imp.author || author;
      description = body.description ?? imp.description ?? description;
      importMetadata = (imp.metadata as Record<string, unknown> | null) ?? null;

      await admin.from("word_imports").update({
        status: "converting",
        last_error: null,
        attempt_count: (imp.attempt_count || 0) + 1,
        title, author, description,
      }).eq("id", importId);
    }

    if (!path || typeof path !== "string") {
      return new Response(JSON.stringify({ error: "missing path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!path.startsWith(`${u.user.id}/`)) {
      return new Response(JSON.stringify({ error: "forbidden path" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper to record failure on the import row before bailing out.
    const failImport = async (msg: string) => {
      if (importId) {
        await admin.from("word_imports").update({
          status: "failed",
          last_error: msg.slice(0, 500),
        }).eq("id", importId);
      }
    };

    const { data: file, error: dlErr } = await admin.storage
      .from("book-uploads")
      .download(path);
    if (dlErr || !file) {
      const msg = dlErr?.message || "download failed";
      await failImport(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileSize = arrayBuffer.byteLength;
    // Edge runtime memory cap is around 256MB. Mammoth roughly needs 5-8x the
    // file size while parsing a docx full of images, so anything beyond ~80MB
    // risks OOM even in text-only mode. The file is already saved in storage,
    // so the user can split or re-import without re-uploading.
    const HARD_LIMIT = 80 * 1024 * 1024;
    if (fileSize > HARD_LIMIT) {
      const msg = `حجم فایل ورد (${(fileSize / 1024 / 1024).toFixed(1)} مگابایت) بیش از حد قابل پردازش است. لطفاً کتاب را به چند فایل کوچک‌تر تقسیم کنید.`;
      await failImport(msg);
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const originalBuffer = Buffer.from(arrayBuffer);
    let buffer = originalBuffer;
    let textOnlyPages: Page[] | null = null;
    let strippedImageCount = 0;
    let rasterReplaced = 0;
    let droppedVector = 0;
    if (skipImages) {
      try {
        const textOnly = docxToPagesTextOnly(originalBuffer);
        textOnlyPages = textOnly.pages;
        strippedImageCount = textOnly.removedImages;
      } catch (e) {
        console.warn("direct text-only docx extraction failed; falling back to mammoth", e);
        const stripped = stripDocxImages(originalBuffer);
        buffer = stripped.buffer;
        strippedImageCount = stripped.removedImages;
      }
    } else {
      // Replace EMF/WMF AlternateContent branches with their raster Fallback
      // so the editor receives PNG/JPEG instead of unrenderable vector files.
      try {
        const swap = preferRasterFallback(originalBuffer);
        buffer = swap.buffer;
        rasterReplaced = swap.replaced;
        droppedVector = swap.droppedVector;
        console.log(`emf→raster swaps: ${rasterReplaced}, dropped vector media: ${droppedVector}`);
      } catch (e) {
        console.warn("emf fallback rewrite failed; continuing with original docx", e);
      }
    }

    // Decide a stable folder for this import's images
    const folder = `${u.user.id}/${crypto.randomUUID()}`;
    let imgIdx = 0;
    let skippedImages = strippedImageCount;
    // Images larger than this are uploaded but kept out of the editor as
    // placeholders, so the user can review and insert them manually.
    const PER_IMAGE_LIMIT = 4 * 1024 * 1024;
    // Anything bigger than this is too risky to even buffer in mammoth's
    // memory pipeline – we still record the slot so the editor can prompt
    // the user to upload the image manually later.
    const HARD_IMAGE_LIMIT = 12 * 1024 * 1024;

    const tryConvert = async (includeImages: boolean) => {
      return await mammoth.convertToHtml(
        { buffer },
        {
          // Detect Persian/English chapter & section headings even when the
          // author used custom paragraph styles instead of Word's built-in
          // Heading 1/2 styles.
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => h2:fresh",
            "p[style-name^='Heading 1'] => h1:fresh",
            "p[style-name^='Heading 2'] => h2:fresh",
            "p[style-name^='Heading 3'] => h3:fresh",
            "p[style-name^='Heading 4'] => h4:fresh",
            "p[style-name^='عنوان 1'] => h1:fresh",
            "p[style-name^='عنوان 2'] => h2:fresh",
            "p[style-name^='عنوان 3'] => h3:fresh",
            "p[style-name*='Chapter'] => h1:fresh",
            "p[style-name*='فصل'] => h1:fresh",
            "p[style-name*='بخش'] => h2:fresh",
          ],
          convertImage: mammoth.images.imgElement(async (image: any) => {
            if (!includeImages) return { src: "" };
            try {
              const ct: string = image.contentType || "image/png";
              const ext = (ct.split("/")[1] || "png").replace("jpeg", "jpg");
              const buf: Buffer = await image.read();
              // EMF/WMF files that survived the fallback rewrite — drop them
              // out of the running text and record a placeholder so the
              // editor can prompt the user to replace them.
              if (/emf|wmf|x-emf|x-wmf/i.test(ct) || /\.(emf|wmf)$/i.test(image?.altText || "")) {
                skippedImages += 1;
                const token = `__WI_PLACEHOLDER__|${buf.length}|${ct}|vector_unsupported|`;
                return { src: token };
              }
              const isOversize = buf.length > PER_IMAGE_LIMIT;
              if (buf.length > HARD_IMAGE_LIMIT) {
                // Don't even try to upload – just leave a metadata-only slot.
                skippedImages += 1;
                const token =
                  `__WI_PLACEHOLDER__|${buf.length}|${ct}|too_large|`;
                return { src: token };
              }
              imgIdx += 1;
              const subfolder = isOversize ? "pending" : "img";
              const key =
                `${folder}/${subfolder}-${String(imgIdx).padStart(3, "0")}.${ext}`;
              const up = await admin.storage.from("book-media").upload(
                key,
                buf,
                { contentType: ct, upsert: true },
              );
              if (up.error) {
                console.warn("upload failed", up.error);
                skippedImages += 1;
                const token =
                  `__WI_PLACEHOLDER__|${buf.length}|${ct}|upload_failed|`;
                return { src: token };
              }
              const pub = admin.storage.from("book-media").getPublicUrl(key);
              if (isOversize) {
                // Big image: keep it out of the running text but remember
                // the URL + position so the editor can offer to insert it.
                skippedImages += 1;
                const token =
                  `__WI_PLACEHOLDER__|${buf.length}|${ct}|oversize|${pub.data.publicUrl}`;
                return { src: token };
              }
              return { src: pub.data.publicUrl };
            } catch (e) {
              console.warn("image convert error", e);
              skippedImages += 1;
              const token = `__WI_PLACEHOLDER__|0||error|`;
              return { src: token };
            }
          }),
        },
      );
    };

    let pages = textOnlyPages ?? [];
    if (!textOnlyPages) {
      let result;
      try {
        result = await tryConvert(!skipImages);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("first pass failed, retrying without images:", msg);
        // Memory pressure or mammoth crash on images: retry text-only so the
        // user still gets the manuscript inside the editor.
        imgIdx = 0;
        try {
          result = await tryConvert(false);
        } catch (e2) {
          const finalMsg = `پردازش فایل ورد با خطا مواجه شد. می‌توانید با گزینه «تبدیل بدون تصاویر» دوباره تلاش کنید. (${e2 instanceof Error ? e2.message : String(e2)})`;
          await failImport(finalMsg);
          return new Response(
            JSON.stringify({ error: finalMsg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      pages = htmlToPages(result.value || "");
    }
    if (pages.length === 0) {
      const msg = "no content extracted";
      await failImport(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the first uploaded image as the cover, if any
    let cover_url = "/placeholder.svg";
    for (const p of pages) {
      const img = p.blocks.find((b) => b.type === "image" && (b as any).src) as any;
      if (img?.src) { cover_url = img.src; break; }
    }

    let bookId: string;
    let bookTitle = title;
    if (replaceBookId) {
      const { data: upd, error: updErr } = await admin
        .from("books")
        .update({ title, author, description, cover_url, pages })
        .eq("id", replaceBookId)
        .select("id, title")
        .single();
      if (updErr || !upd) {
        const msg = updErr?.message || "update failed";
        await failImport(msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookId = upd.id;
      bookTitle = upd.title;
    } else {
      // Pull rich bibliographic metadata from the import payload, if any.
      const m = (importMetadata || {}) as any;
      const extra: Record<string, unknown> = {};
      if (m.subtitle) extra.subtitle = m.subtitle;
      if (m.book_type) extra.book_type = m.book_type;
      if (m.original_title) extra.original_title = m.original_title;
      if (m.original_language) extra.original_language = m.original_language;
      if (m.publication_year) extra.publication_year = Number(m.publication_year) || null;
      if (m.edition) extra.edition = m.edition;
      if (m.isbn) extra.isbn = m.isbn;
      if (m.page_count) extra.page_count = Number(m.page_count) || null;
      if (Array.isArray(m.categories) && m.categories.length) extra.categories = m.categories;
      if (Array.isArray(m.subjects) && m.subjects.length) extra.subjects = m.subjects;
      if (m.series_name) extra.series_name = m.series_name;
      if (m.series_index) extra.series_index = Number(m.series_index) || null;
      if (Array.isArray(m.contributors) && m.contributors.length) extra.contributors = m.contributors;
      if (m.publisher) extra.publisher = m.publisher;
      if (m.language) extra.language = m.language;

      const { data: book, error: insErr } = await admin
        .from("books")
        .insert({
          title,
          author,
          description,
          ambient_theme: "paper",
          category: m.categories?.[0] || "کتاب کاربر",
          cover_url,
          price: 0,
          pages,
          publisher_id: u.user.id,
          status: "draft",
          ...extra,
        })
        .select("id, title")
        .single();
      if (insErr || !book) {
        const msg = insErr?.message || "insert failed";
        await failImport(msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookId = book.id;
      bookTitle = book.title;

      await admin.from("user_books").insert({
        user_id: u.user.id,
        book_id: bookId,
        acquired_via: "upload",
        status: "unread",
      });
    }

    if (importId) {
      await admin.from("word_imports").update({
        status: "done",
        last_error: null,
        book_id: bookId,
        chapters_count: pages.length,
        images_count: imgIdx,
        skipped_images_count: skippedImages,
      }).eq("id", importId);
    }

    return new Response(
      JSON.stringify({ book: { id: bookId, title: bookTitle }, chapters: pages.length, images: imgIdx, skippedImages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
