// Helpers to bridge between legacy "blocks" pages and the new Tiptap
// (ProseMirror) document. We keep a tiny, explicit JSON shape so the
// Reader can render either format without parsing surprises.
//
// Document shape:
// {
//   type: "doc",
//   content: [ ParagraphNode | HeadingNode | BlockquoteNode | CalloutNode |
//              ImageNode | VideoNode | GalleryNode | TimelineNode | ScrollyNode ]
// }
//
// Text inside paragraph/heading/quote/callout uses the Tiptap text-node
// shape with `marks` (bold, italic, underline). Media nodes are leaf
// nodes (no `content`). Anything we don't know is dropped silently.

import type { TimelineStep } from "@/components/reader/Timeline";
import type { ScrollyStep } from "@/components/reader/Scrollytelling";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "textStyle"; attrs?: { color?: string } }
  | { type: "link"; attrs?: { href?: string } };

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

export interface TextBlockAttrs { textAlign?: "left" | "center" | "right" | "justify" | null; dir?: "rtl" | "ltr" | null }
export interface ParagraphNode { type: "paragraph"; attrs?: TextBlockAttrs; content?: TextNode[] }
export interface HeadingNode { type: "heading"; attrs: { level: 1 | 2 | 3 } & TextBlockAttrs; content?: TextNode[] }
export interface QuoteNode { type: "quote"; attrs?: { author?: string } & TextBlockAttrs; content?: TextNode[] }
export interface CalloutNode {
  type: "callout";
  attrs: { variant: "info" | "tip" | "note" | "warning" | "success" | "danger" | "question" | "quote" | "definition" | "example" } & TextBlockAttrs;
  content?: TextNode[];
}
export interface ImageNode {
  type: "image";
  attrs: { src: string; caption?: string; hideCaption?: boolean };
}
export interface GalleryNode { type: "gallery"; attrs: { images: string[]; caption?: string } }
export interface VideoNode { type: "video"; attrs: { src: string; caption?: string } }
export interface TableNode { type: "table"; attrs: { headers: string[]; rows: string[][]; caption?: string; tableNumber?: string } }
export interface TimelineNode { type: "timeline"; attrs: { title?: string; steps: TimelineStep[] } }
export interface ScrollyNode { type: "scrollytelling"; attrs: { title?: string; steps: ScrollyStep[] } }

export type DocNode =
  | ParagraphNode
  | HeadingNode
  | QuoteNode
  | CalloutNode
  | ImageNode
  | GalleryNode
  | VideoNode
  | TableNode
  | TimelineNode
  | ScrollyNode
  // Lists are passed through as-is from Tiptap (StarterKit) — we only
  // care about reading them back out for the legacy renderer below.
  | { type: "bulletList" | "orderedList"; content?: any[] }
  | { type: "listItem"; content?: any[] };

export interface TiptapDoc {
  type: "doc";
  content: DocNode[];
}

export interface TextPage {
  /** Page/chapter title (kept on the page level, not as a block) */
  title: string;
  /** New document format */
  doc: TiptapDoc;
}

export const isTiptapPage = (p: unknown): p is { title: string; doc: TiptapDoc } =>
  !!p && typeof p === "object" && "doc" in (p as Record<string, unknown>) &&
  (p as { doc?: { type?: string } }).doc?.type === "doc";

/* ------------------------------------------------------------------ */
/* Inline text helpers                                                */
/* ------------------------------------------------------------------ */

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/&amp;/g, "&"));
  } catch {
    return value.replace(/&amp;/g, "&");
  }
};

const extractCitationTarget = (value: string): string | null => {
  const decoded = safeDecodeURIComponent(value);
  const directUrl = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(decoded)?.[1];
  if (directUrl) return directUrl.replace(/\\\//g, "/");

  const runs = decoded.match(/[A-Za-z0-9+/_=-]{80,}/g) ?? [];
  for (const run of runs) {
    const maxOffset = Math.min(180, run.length - 24);
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      try {
        const candidate = run.slice(offset).replace(/-/g, "+").replace(/_/g, "/");
        const padded = candidate.padEnd(Math.ceil(candidate.length / 4) * 4, "=");
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        const url = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(text)?.[1];
        if (url) return url.replace(/\\\//g, "/");
        const doi = /"doi"\s*:\s*"([^"\\]+)"/.exec(text)?.[1];
        if (doi) return `https://doi.org/${doi}`;
      } catch {
        // Citation add-ins may prepend a few non-base64 bytes; keep scanning.
      }
    }
  }

  return null;
};

export const normalizeImportedText = (text: string): string =>
  String(text ?? "")
    .replace(/(\([0-9,\s\-–—]+\))\s*((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9+/_=-]){80,})/g, (_m, label, payload) => {
      const target = extractCitationTarget(payload);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/(\[[^\]\n]+\]\([^)]+\))(?:%3D|=)+/gi, "$1");

/** Convert plain text (with light **bold** / *italic* / __under__ / [link](url)) to text nodes. */
export const textToNodes = (text: string): TextNode[] => {
  text = normalizeImportedText(text);
  if (!text) return [];
  const out: TextNode[] = [];
  const re = /(\[[^\]\n]+\]\([^\)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  const parts = text.split(re);
  for (const p of parts) {
    if (!p) continue;
    const linkM = /^\[([^\]\n]+)\]\(([^\)\s]+)\)$/.exec(p);
    if (linkM) {
      out.push({ type: "text", text: linkM[1], marks: [{ type: "link", attrs: { href: linkM[2] } }] });
    } else if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      out.push({ type: "text", text: p.slice(2, -2), marks: [{ type: "bold" }] });
    } else if (p.startsWith("__") && p.endsWith("__") && p.length > 4) {
      out.push({ type: "text", text: p.slice(2, -2), marks: [{ type: "underline" }] });
    } else if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      out.push({ type: "text", text: p.slice(1, -1), marks: [{ type: "italic" }] });
    } else {
      out.push({ type: "text", text: p });
    }
  }
  return out;
};

/** Flatten a Tiptap text node array to plain text (for AI input / search). */
export const nodesToPlainText = (nodes?: TextNode[]): string =>
  (nodes ?? []).map((n) => n.text).join("");

/** Walk the doc and collect plain text per block (keeps order). */
export const docToPlainText = (doc: TiptapDoc): string => {
  const lines: string[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === "paragraph" || n.type === "heading" || n.type === "quote" || n.type === "callout") {
      const t = nodesToPlainText(n.content);
      if (t.trim()) lines.push(t);
    } else if (n.type === "image" && n.attrs.caption) {
      lines.push(`[image: ${n.attrs.caption}]`);
    } else if (n.type === "video" && n.attrs.caption) {
      lines.push(`[video: ${n.attrs.caption}]`);
    }
  }
  return lines.join("\n\n");
};

/* ------------------------------------------------------------------ */
/* Legacy → new                                                       */
/* ------------------------------------------------------------------ */

const calloutVariant = (icon?: string): CalloutNode["attrs"]["variant"] => {
  switch (icon) {
    case "tip": case "sparkle": return "tip";
    case "warning": return "warning";
    case "success": return "success";
    case "danger": return "danger";
    case "question": return "question";
    case "quote": return "quote";
    case "note": return "note";
    case "definition": return "definition";
    case "example": return "example";
    default: return "info";
  }
};

/** Split legacy multi-paragraph text on blank lines so each paragraph
 *  becomes its own node. Without this, an entire multi-line "paragraph"
 *  block from old data ends up as a single ProseMirror paragraph and
 *  double-clicking selects every visual line at once. */
const splitParas = (raw: string): string[] => {
  const s = String(raw ?? "").replace(/\r\n/g, "\n");
  const parts = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [s];
};

/** Convert one legacy block (DB shape: { type, ... }) to one or more doc nodes. */
const legacyTextAttrs = (b: any): TextBlockAttrs => ({
  textAlign: b?.textAlign ?? b?.align ?? null,
  dir: b?.dir ?? null,
});

const legacyBlockToNodes = (b: any): DocNode[] => {
  if (!b || typeof b !== "object" || !b.type) return [];
  switch (b.type) {
    case "heading":
      return [{ type: "heading", attrs: { level: 2, ...legacyTextAttrs(b) }, content: textToNodes(String(b.text ?? "")) }];
    case "paragraph":
      return splitParas(String(b.text ?? "")).map(
        (t) => ({ type: "paragraph", attrs: legacyTextAttrs(b), content: textToNodes(t) }) as ParagraphNode,
      );
    case "quote":
      return splitParas(String(b.text ?? "")).map(
        (t) => ({
          type: "quote",
          attrs: { ...(b.author ? { author: String(b.author) } : {}), ...legacyTextAttrs(b) },
          content: textToNodes(t),
        }) as QuoteNode,
      );
    case "callout":
    case "highlight":
      return splitParas(String(b.text ?? "")).map(
        (t) => ({
          type: "callout",
          attrs: { variant: calloutVariant(b.icon ?? (b.type === "highlight" ? "sparkle" : "info")), ...legacyTextAttrs(b) },
          content: textToNodes(t),
        }) as CalloutNode,
      );
    case "image":
      return [{
        type: "image",
        attrs: {
          src: String(b.src ?? ""),
          caption: b.caption ? String(b.caption) : undefined,
          hideCaption: !!b.hideCaption,
        },
      }];
    case "gallery":
      return [{
        type: "gallery",
        attrs: { images: Array.isArray(b.images) ? b.images.map(String) : [], caption: b.caption ? String(b.caption) : undefined },
      }];
    case "slideshow": {
      const imgs: string[] = Array.isArray(b.images)
        ? b.images.map((i: any) => (typeof i === "string" ? i : i?.src)).filter(Boolean)
        : [];
      return [{ type: "gallery", attrs: { images: imgs } }];
    }
    case "video":
      return [{ type: "video", attrs: { src: String(b.src ?? ""), caption: b.caption ? String(b.caption) : undefined } }];
    case "table":
      return [{
        type: "table",
        attrs: {
          headers: Array.isArray(b.headers) ? b.headers.map((x: any) => String(x ?? "")) : [],
          rows: Array.isArray(b.rows) ? b.rows.map((r: any) => (Array.isArray(r) ? r.map((x: any) => String(x ?? "")) : [])) : [],
          caption: b.caption ? String(b.caption) : undefined,
          tableNumber: b.tableNumber ? String(b.tableNumber) : undefined,
        },
      }];
    case "timeline":
      return [{
        type: "timeline",
        attrs: {
          title: b.title ? String(b.title) : undefined,
          steps: Array.isArray(b.steps) ? b.steps : [],
        },
      }];
    case "scrollytelling":
      return [{
        type: "scrollytelling",
        attrs: {
          title: b.title ? String(b.title) : undefined,
          steps: Array.isArray(b.steps) ? b.steps : [],
        },
      }];
    case "list": {
      const ordered = b.ordered === true || b.style === "ordered";
      const items: string[] = Array.isArray(b.items) ? b.items.map((x: any) => String(x ?? "")) : [];
      return [{
        type: ordered ? "orderedList" : "bulletList",
        content: items.map((t) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: textToNodes(t) }],
        })),
      }];
    }
    default:
      return [];
  }
};

/** Convert a legacy page (`{ title, blocks: [...] }`) to a new TextPage. */
export const legacyPageToTextPage = (p: any): TextPage => {
  if (isTiptapPage(p)) {
    return { title: typeof p.title === "string" ? p.title : "", doc: p.doc };
  }
  const blocks: any[] = Array.isArray(p?.blocks) ? p.blocks : [];
  const nodes: DocNode[] = blocks.flatMap(legacyBlockToNodes);
  if (!nodes.length) nodes.push({ type: "paragraph" });
  return {
    title: typeof p?.title === "string" ? p.title : "",
    doc: { type: "doc", content: nodes },
  };
};

/** Normalize whatever we got from DB to an array of TextPages. */
export const dbPagesToTextPages = (raw: unknown): TextPage[] => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ title: "", doc: { type: "doc", content: [{ type: "paragraph" }] } }];
  }
  return raw.map((p) => legacyPageToTextPage(p));
};

/** Reverse: pages → DB shape (kept compatible: we store new docs alongside `title`). */
/** Reverse: pages → DB shape. We write both the new `doc` AND legacy
 *  `blocks` so the existing Reader/BlockRenderer keeps rendering. */
export const textPagesToDbPages = (pages: TextPage[]): any[] =>
  pages.map((p) => ({ title: p.title || "—", doc: p.doc, blocks: docToLegacyBlocks(p.doc) }));

/* ------------------------------------------------------------------ */
/* HTML rendering for the Reader (no React, used inside dangerouslySet)*/
/* ------------------------------------------------------------------ */

const textBlockAttrsToLegacy = (attrs?: TextBlockAttrs | null): Record<string, string> => {
  const out: Record<string, string> = {};
  if (attrs?.textAlign) out.textAlign = attrs.textAlign;
  if (attrs?.dir) out.dir = attrs.dir;
  return out;
};

const sanitizeCssValue = (value: string): string =>
  value.replace(/[;{}<>]/g, "").trim();

/* ------------------------------------------------------------------ */
/* New doc → legacy blocks (so the existing Reader keeps working)     */
/* ------------------------------------------------------------------ */

/** Encode inline marks (bold/italic/underline + textStyle color) as a
 *  light markdown-ish string the Reader's renderInlineMarkdown understands.
 *  Color is encoded as `[c=COLOR]text[/c]` and gets parsed back into a
 *  <span style="color:..."> on the reader side. */
const inlineToMarkdown = (nodes?: TextNode[]): string =>
  (nodes ?? []).map((n: any) => {
    if (n?.type === "hardBreak") return "\n";
    let t = n.text ?? "";
    let color: string | undefined;
    let href: string | undefined;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") t = `**${t}**`;
      else if (m.type === "italic") t = `*${t}*`;
      else if (m.type === "underline") t = `__${t}__`;
      else if (m.type === "textStyle" && (m as any).attrs?.color) {
        color = sanitizeCssValue((m as any).attrs.color as string);
      } else if (m.type === "link" && (m as any).attrs?.href) {
        href = (m as any).attrs.href as string;
      }
    }
    if (href) t = `[${t}](${href})`;
    if (color) t = `[c=${color}]${t}[/c]`;
    return t;
  }).join("");

const calloutIconFromVariant = (v: string): string => {
  switch (v) {
    case "tip": return "tip";
    case "warning": return "warning";
    case "success": return "success";
    case "danger": return "danger";
    case "question": return "question";
    case "quote": return "quote";
    case "note": return "note";
    case "definition": return "definition";
    case "example": return "example";
    default: return "info";
  }
};

/** Convert a single list-item node to its inline markdown text (joining
 *  any nested paragraphs with newlines). */
const listItemToLegacy = (item: any): { text: string; attrs: Record<string, string> } => {
  const inner: string[] = [];
  let attrs: Record<string, string> = {};
  for (const child of item?.content ?? []) {
    if (child?.type === "paragraph" || child?.type === "heading") {
      if (!Object.keys(attrs).length) attrs = textBlockAttrsToLegacy(child.attrs);
      inner.push(inlineToMarkdown(child.content));
    }
  }
  return { text: inner.join("\n").trim(), attrs };
};

/** Convert a Tiptap doc back to legacy block array for the Reader. */
export const docToLegacyBlocks = (doc: TiptapDoc): any[] => {
  const out: any[] = [];
  for (const n of (doc?.content ?? []) as any[]) {
    switch (n.type) {
      case "paragraph": {
        const t = inlineToMarkdown(n.content);
        if (t.trim()) out.push({ type: "paragraph", text: t, ...textBlockAttrsToLegacy(n.attrs) });
        break;
      }
      case "heading":
        out.push({ type: "heading", text: inlineToMarkdown(n.content), ...textBlockAttrsToLegacy(n.attrs) });
        break;
      case "quote":
        out.push({ type: "quote", text: inlineToMarkdown(n.content), author: n.attrs?.author, ...textBlockAttrsToLegacy(n.attrs) });
        break;
      case "callout":
        out.push({ type: "callout", icon: calloutIconFromVariant(n.attrs.variant), text: inlineToMarkdown(n.content), ...textBlockAttrsToLegacy(n.attrs) });
        break;
      case "image":
        out.push({ type: "image", src: n.attrs.src, caption: n.attrs.caption, hideCaption: n.attrs.hideCaption });
        break;
      case "gallery":
        out.push({ type: "gallery", images: n.attrs.images, caption: n.attrs.caption });
        break;
      case "video":
        out.push({ type: "video", src: n.attrs.src, caption: n.attrs.caption });
        break;
      case "table":
        out.push({
          type: "table",
          headers: Array.isArray(n.attrs.headers) ? n.attrs.headers : [],
          rows: Array.isArray(n.attrs.rows) ? n.attrs.rows : [],
          caption: n.attrs.caption,
          tableNumber: n.attrs.tableNumber,
        });
        break;
      case "timeline":
        out.push({ type: "timeline", title: n.attrs.title, steps: n.attrs.steps });
        break;
      case "scrollytelling":
        out.push({ type: "scrollytelling", title: n.attrs.title, steps: n.attrs.steps });
        break;
      case "bulletList":
      case "orderedList": {
        const itemData = (n.content ?? [])
          .map((it: any) => listItemToLegacy(it))
          .filter((it: { text: string }) => it.text.length > 0);
        const items = itemData.map((it: { text: string }) => it.text);
        const listAttrs = { ...itemData[0]?.attrs, ...textBlockAttrsToLegacy(n.attrs) };
        if (items.length) out.push({ type: "list", ordered: n.type === "orderedList", items, itemAttrs: itemData.map((it: { attrs: Record<string, string> }) => it.attrs), ...listAttrs });
        break;
      }
    }
  }
  return out;
};

