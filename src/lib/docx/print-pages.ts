// Reads Word's printed page-number start hint (`w:pgNumType w:start`) from
// either the body-level sectPr or the last paragraph's sectPr.
// Returns undefined when not present; the wizard then asks the user.

import type { OoxmlBundle } from "./ooxml-reader";

function findFirst(nodes: any[], tag: string): any | null {
  for (const n of nodes ?? []) {
    if (n && typeof n === "object" && Array.isArray(n[tag])) return n;
  }
  return null;
}
function kidsOf(n: any, tag: string): any[] {
  if (!n) return [];
  const arr = n[tag];
  return Array.isArray(arr) ? arr : [];
}
function tagOf(n: any): string | null {
  if (!n || typeof n !== "object") return null;
  for (const k of Object.keys(n)) if (k !== ":@" && k !== "#text") return k;
  return null;
}
function attrLoose(node: any, name: string): string | undefined {
  const at = node?.[":@"];
  if (!at) return undefined;
  const local = name.includes(":") ? name.split(":").pop() : name;
  return at[`@_${name}`] ?? at[`@_${local}`] ?? at[`@_w:${local}`];
}

function findPgNumStart(node: any): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const key of Object.keys(node)) {
    if (key === ":@") continue;
    const v = (node as any)[key];
    if (key === "w:pgNumType") {
      const list = Array.isArray(v) ? v : [v];
      for (const it of list) {
        const s = attrLoose(it, "w:start");
        const n = Number(s);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } else if (Array.isArray(v)) {
      for (const child of v) {
        const r = findPgNumStart(child);
        if (r !== undefined) return r;
      }
    }
  }
  return undefined;
}

/** Returns the printed start page if the docx specifies one. */
export function extractPrintStartPage(bundle: OoxmlBundle): number | undefined {
  const root = findFirst(bundle.doc, "w:document");
  if (!root) return undefined;
  const body = findFirst(kidsOf(root, "w:document"), "w:body");
  if (!body) return undefined;
  return findPgNumStart(body);
}

/** Apply a start offset to every existing `print_page` node in the AST. */
export function shiftPrintPages(doc: { content: any[] }, startPage: number): void {
  if (!startPage || startPage === 1) return;
  const offset = startPage - 1;
  for (const n of doc.content ?? []) {
    if (n?.type === "print_page" && n.attrs?.number !== undefined) {
      const cur = Number(n.attrs.number);
      if (Number.isFinite(cur)) n.attrs.number = String(cur + offset);
    }
  }
}
