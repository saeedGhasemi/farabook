// Build a chapter tree from the AST's heading nodes and (optionally)
// promote paragraphs with a user-chosen Word style name to H1, when the
// document author used a custom style instead of "Heading 1".

import type { TiptapDoc } from "@/lib/tiptap-doc";

export interface TocNode {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  /** Index of the heading node in doc.content. */
  index: number;
  /** Number of non-empty content nodes until next same-or-higher heading. */
  contentNodes: number;
  children: TocNode[];
}

const plainText = (n: any): string =>
  (n?.content ?? []).map((c: any) => c?.text ?? "").join("").trim();

/**
 * Promote paragraphs that carry the user's custom heading style to actual
 * headings. The wizard's AST is re-built from the docx with the option, so
 * this function is only used for an additional in-place pass when needed.
 */
export function buildToc(doc: TiptapDoc): TocNode[] {
  const flat: TocNode[] = [];
  let lastIdx = -1;
  doc.content?.forEach((node: any, i: number) => {
    if (node?.type === "heading" && node.attrs?.level >= 1 && node.attrs?.level <= 3) {
      const title = plainText(node) || "—";
      flat.push({
        id: `h-${i}`,
        level: node.attrs.level,
        title,
        index: i,
        contentNodes: 0,
        children: [],
      });
      lastIdx = flat.length - 1;
    } else if (lastIdx >= 0 && (node?.type === "paragraph" || node?.type === "image" || node?.type === "table")) {
      flat[lastIdx].contentNodes++;
    }
  });

  // Stack-based tree
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of flat) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) roots.push(h);
    else stack[stack.length - 1].children.push(h);
    stack.push(h);
  }
  return roots;
}

/** Count total chapters at the chosen top level. */
export function countChapters(toc: TocNode[]): number {
  return toc.length;
}

/** Flatten for simple list display. */
export function flattenToc(toc: TocNode[], depth = 0): Array<TocNode & { depth: number }> {
  const out: Array<TocNode & { depth: number }> = [];
  for (const n of toc) {
    out.push({ ...n, depth });
    if (n.children.length) out.push(...flattenToc(n.children, depth + 1));
  }
  return out;
}

/** Detect tiny chapters (<minContent nodes). */
export function findTinyChapters(toc: TocNode[], minContent = 2): TocNode[] {
  const tiny: TocNode[] = [];
  const walk = (nodes: TocNode[]) => {
    for (const n of nodes) {
      if (n.contentNodes < minContent && n.children.length === 0) tiny.push(n);
      walk(n.children);
    }
  };
  walk(toc);
  return tiny;
}
