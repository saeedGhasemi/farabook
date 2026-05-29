import { describe, expect, it } from "vitest";
import { mapOoxmlToDoc } from "./ast-mapper";
import type { OoxmlBundle } from "./ooxml-reader";

const t = (text: string) => ({ "w:t": [{ "#text": text }] });
const r = (text: string, rPr?: any[]) => ({
  "w:r": [
    ...(rPr ? [{ "w:rPr": rPr }] : []),
    t(text),
  ],
});
const p = (...runs: any[]) => ({ "w:p": runs });

const bundle = (paragraphs: any[], styles: any | null = null): OoxmlBundle => ({
  doc: [{ "w:document": [{ "w:body": paragraphs }] }],
  styles,
  numbering: null,
  rels: null,
  media: [],
  hasCleanedMarker: false,
});

describe("OOXML superscript/subscript mapping", () => {
  it("keeps direct vertAlign marks even when OOXML attributes are parsed without prefixes", () => {
    const result = mapOoxmlToDoc(bundle([
      p(
        r("Gy"),
        r("3", [{ "w:vertAlign": [], ":@": { "@_val": "superscript" } }]),
        r(" و H"),
        r("2", [{ "w:vertAlign": [], ":@": { "@_val": "subscript" } }]),
        r("O"),
      ),
    ]));

    expect((result.doc.content[0] as any).content).toEqual([
      { type: "text", text: "Gy" },
      { type: "text", text: "3", marks: [{ type: "superscript" }] },
      { type: "text", text: " و H" },
      { type: "text", text: "2", marks: [{ type: "subscript" }] },
      { type: "text", text: "O" },
    ]);
  });

  it("maps Word position offsets to superscript and subscript marks", () => {
    const result = mapOoxmlToDoc(bundle([
      p(
        r("x"),
        r("2", [{ "w:position": [], ":@": { "@_val": "6" } }]),
        r(" y"),
        r("i", [{ "w:position": [], ":@": { "@_val": "-4" } }]),
      ),
    ]));

    expect((result.doc.content[0] as any).content).toEqual([
      { type: "text", text: "x" },
      { type: "text", text: "2", marks: [{ type: "superscript" }] },
      { type: "text", text: " y" },
      { type: "text", text: "i", marks: [{ type: "subscript" }] },
    ]);
  });
});