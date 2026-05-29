// Build a chapter tree from the AST's heading nodes and (optionally)
// promote paragraphs with a user-chosen Word style name to a chosen level,
// for live preview without re-running the full converter.

import type { TiptapDoc } from "@/lib/tiptap-doc";

export interface TocNode {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  title: string;
  /** Index of the heading node in doc.content. */
  index: number;
  /** Number of non-empty content nodes until next same-or-higher heading. */
  contentNodes: number;
  /** Display name of the Word style that produced this heading (when known). */
  sourceStyleName?: string | null;
  /** Style id (matches w:pStyle w:val). */
  sourceStyleId?: string | null;
  /** True if this entry was promoted from a paragraph by a live custom-style rule. */
  promoted?: boolean;
  children: TocNode[];
}

const plainText = (n: any): string =>
  (n?.content ?? []).map((c: any) => c?.text ?? "").join("").trim();

interface FlatEntry {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  title: string;
  index: number;
  sourceStyleName?: string | null;
  sourceStyleId?: string | null;
  promoted?: boolean;
}

function flatToTree(flat: FlatEntry[], doc: TiptapDoc, promotedIdx: Set<number>): TocNode[] {
  // Compute content-node counts: for each entry, count following non-heading,
  // non-promoted content nodes until the next entry.
  const indices = flat.map((f) => f.index).sort((a, b) => a - b);
  const followingIdx = new Map<number, number>();
  for (let i = 0; i < indices.length; i += 1) followingIdx.set(indices[i], indices[i + 1] ?? Infinity);

  const counts = new Map<number, number>();
  for (const f of flat) {
    const next = followingIdx.get(f.index)!;
    let c = 0;
    const items = doc.content ?? [];
    for (let i = f.index + 1; i < items.length && i < next; i += 1) {
      const n: any = items[i];
      if (!n) continue;
      if (n.type === "heading") continue;
      if (promotedIdx.has(i)) continue;
      if (n.type === "paragraph" || n.type === "image" || n.type === "table") c += 1;
    }
    counts.set(f.index, c);
  }

  const nodes: TocNode[] = flat.map((f) => ({
    id: f.id,
    level: f.level,
    title: f.title,
    index: f.index,
    contentNodes: counts.get(f.index) ?? 0,
    sourceStyleName: f.sourceStyleName ?? null,
    sourceStyleId: f.sourceStyleId ?? null,
    promoted: f.promoted,
    children: [],
  }));

  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of nodes) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) roots.push(h);
    else stack[stack.length - 1].children.push(h);
    stack.push(h);
  }
  return roots;
}

export function buildToc(doc: TiptapDoc): TocNode[] {
  const flat: FlatEntry[] = [];
  doc.content?.forEach((node: any, i: number) => {
    if (node?.type === "heading" && node.attrs?.level >= 1 && node.attrs?.level <= 8) {
      flat.push({
        id: `h-${i}`,
        level: node.attrs.level,
        title: plainText(node) || "—",
        index: i,
        sourceStyleName: node.attrs?.srcStyleName ?? null,
        sourceStyleId: node.attrs?.srcStyleId ?? null,
      });
    }
  });
  return flatToTree(flat, doc, new Set());
}

/**
 * Build a TOC that reflects (1) existing heading nodes and (2) paragraphs
 * whose source Word style matches one of `customHeadings`. The AST is
 * NOT mutated — this is for live preview only.
 */
export function buildTocLive(
  doc: TiptapDoc,
  customHeadings: Array<{ name: string; level: number }>,
): TocNode[] {
  const normalize = (s: string) => (s || "").trim().toLowerCase();
  const customMap = new Map<string, number>();
  for (const c of customHeadings) {
    const key = normalize(c.name);
    if (!key) continue;
    customMap.set(key, Math.min(8, Math.max(1, Math.floor(c.level || 1))));
  }

  const flat: FlatEntry[] = [];
  const promotedIdx = new Set<number>();
  doc.content?.forEach((node: any, i: number) => {
    if (node?.type === "heading" && node.attrs?.level >= 1 && node.attrs?.level <= 8) {
      flat.push({
        id: `h-${i}`,
        level: node.attrs.level,
        title: plainText(node) || "—",
        index: i,
        sourceStyleName: node.attrs?.srcStyleName ?? null,
        sourceStyleId: node.attrs?.srcStyleId ?? null,
      });
      return;
    }
    if (node?.type === "paragraph" && customMap.size) {
      const sid = node.attrs?.srcStyleId;
      const sname = node.attrs?.srcStyleName;
      const keys = [normalize(sid ?? ""), normalize(sname ?? "")];
      for (const k of keys) {
        if (k && customMap.has(k)) {
          const lv = customMap.get(k) as 1|2|3|4|5|6|7|8;
          const title = plainText(node) || "—";
          if (!title.trim()) return;
          promotedIdx.add(i);
          flat.push({
            id: `p-${i}`,
            level: lv,
            title,
            index: i,
            sourceStyleName: sname ?? sid ?? null,
            sourceStyleId: sid ?? null,
            promoted: true,
          });
          return;
        }
      }
    }
  });

  return flatToTree(flat, doc, promotedIdx);
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
