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
  | { type: "underline" };

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

export interface ParagraphNode { type: "paragraph"; content?: TextNode[] }
export interface HeadingNode { type: "heading"; attrs: { level: 1 | 2 | 3 }; content?: TextNode[] }
export interface QuoteNode { type: "quote"; attrs?: { author?: string }; content?: TextNode[] }
export interface CalloutNode {
  type: "callout";
  attrs: { variant: "info" | "tip" | "note" | "warning" | "success" | "danger" | "question" | "quote" };
  content?: TextNode[];
}
export interface ImageNode {
  type: "image";
  attrs: { src: string; caption?: string; hideCaption?: boolean };
}
export interface GalleryNode { type: "gallery"; attrs: { images: string[]; caption?: string } }
export interface VideoNode { type: "video"; attrs: { src: string; caption?: string } }
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
  | TimelineNode
  | ScrollyNode;

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

/** Convert plain text (with light **bold** / *italic* / __under__) to text nodes. */
export const textToNodes = (text: string): TextNode[] => {
  if (!text) return [];
  const out: TextNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  const parts = text.split(re);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
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
    default: return "info";
  }
};

/** Convert one legacy block (DB shape: { type, ... }) to one or more doc nodes. */
const legacyBlockToNodes = (b: any): DocNode[] => {
  if (!b || typeof b !== "object" || !b.type) return [];
  switch (b.type) {
    case "heading":
      return [{ type: "heading", attrs: { level: 2 }, content: textToNodes(String(b.text ?? "")) }];
    case "paragraph":
      return [{ type: "paragraph", content: textToNodes(String(b.text ?? "")) }];
    case "quote":
      return [{
        type: "quote",
        attrs: b.author ? { author: String(b.author) } : undefined,
        content: textToNodes(String(b.text ?? "")),
      }];
    case "callout":
    case "highlight":
      return [{
        type: "callout",
        attrs: { variant: calloutVariant(b.icon ?? (b.type === "highlight" ? "sparkle" : "info")) },
        content: textToNodes(String(b.text ?? "")),
      }];
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const renderTextNodes = (nodes?: TextNode[]): string =>
  (nodes ?? [])
    .map((n) => {
      let t = escapeHtml(n.text);
      for (const m of n.marks ?? []) {
        if (m.type === "bold") t = `<strong>${t}</strong>`;
        else if (m.type === "italic") t = `<em>${t}</em>`;
        else if (m.type === "underline") t = `<u>${t}</u>`;
      }
      return t;
    })
    .join("");

/* ------------------------------------------------------------------ */
/* New doc → legacy blocks (so the existing Reader keeps working)     */
/* ------------------------------------------------------------------ */

const inlineToMarkdown = (nodes?: TextNode[]): string =>
  (nodes ?? []).map((n) => {
    let t = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") t = `**${t}**`;
      else if (m.type === "italic") t = `*${t}*`;
      else if (m.type === "underline") t = `__${t}__`;
    }
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
    default: return "info";
  }
};

/** Convert a Tiptap doc back to legacy block array for the Reader. */
export const docToLegacyBlocks = (doc: TiptapDoc): any[] => {
  const out: any[] = [];
  for (const n of doc?.content ?? []) {
    switch (n.type) {
      case "paragraph": {
        const t = inlineToMarkdown(n.content);
        if (t.trim()) out.push({ type: "paragraph", text: t });
        break;
      }
      case "heading":
        out.push({ type: "heading", text: inlineToMarkdown(n.content) });
        break;
      case "quote":
        out.push({ type: "quote", text: inlineToMarkdown(n.content), author: n.attrs?.author });
        break;
      case "callout":
        out.push({ type: "callout", icon: calloutIconFromVariant(n.attrs.variant), text: inlineToMarkdown(n.content) });
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
      case "timeline":
        out.push({ type: "timeline", title: n.attrs.title, steps: n.attrs.steps });
        break;
      case "scrollytelling":
        out.push({ type: "scrollytelling", title: n.attrs.title, steps: n.attrs.steps });
        break;
    }
  }
  return out;
};
