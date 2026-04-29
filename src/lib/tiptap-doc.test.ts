import { describe, it, expect } from "vitest";
import {
  dbPagesToTextPages,
  textPagesToDbPages,
  legacyPageToTextPage,
} from "./tiptap-doc";

const countTablesInBlocks = (blocks: any[]): number =>
  (blocks ?? []).filter((b) => b?.type === "table").length;

const countTablesInDoc = (doc: any): number =>
  (doc?.content ?? []).filter((n: any) => n?.type === "table").length;

const sampleTableBlock = (n: number) => ({
  type: "table",
  headers: ["A", "B"],
  rows: [[`r${n}c1`, `r${n}c2`], [`r${n}c3`, `r${n}c4`]],
  caption: `Table ${n}`,
});

describe("tiptap-doc table preservation (regression)", () => {
  it("preserves Word-imported tables across one editor open/save cycle", () => {
    const importedDbPages = [
      {
        title: "فصل ۱",
        blocks: [
          { type: "heading", text: "مقدمه" },
          { type: "paragraph", text: "متن آغازین" },
          sampleTableBlock(1),
          { type: "paragraph", text: "بین جدول‌ها" },
          sampleTableBlock(2),
          sampleTableBlock(3),
        ],
      },
    ];
    const originalCount = countTablesInBlocks(importedDbPages[0].blocks);
    expect(originalCount).toBe(3);

    // Open in editor (DB → TextPage with Tiptap doc)
    const pages = dbPagesToTextPages(importedDbPages);
    expect(countTablesInDoc(pages[0].doc)).toBe(originalCount);

    // Save back from editor (TextPage → DB shape)
    const saved = textPagesToDbPages(pages);
    expect(countTablesInBlocks(saved[0].blocks)).toBe(originalCount);
  });

  it("keeps table count stable across many open/save cycles", () => {
    let dbPages: any[] = [
      {
        title: "فصل ۲",
        blocks: [
          sampleTableBlock(1),
          { type: "paragraph", text: "x" },
          sampleTableBlock(2),
          sampleTableBlock(3),
          sampleTableBlock(4),
        ],
      },
    ];
    const expected = countTablesInBlocks(dbPages[0].blocks);
    for (let i = 0; i < 5; i++) {
      const pages = dbPagesToTextPages(dbPages);
      expect(countTablesInDoc(pages[0].doc)).toBe(expected);
      dbPages = textPagesToDbPages(pages);
      expect(countTablesInBlocks(dbPages[0].blocks)).toBe(expected);
    }
  });

  it("recovers tables when a previously-saved doc is missing them but legacy blocks have them", () => {
    // Simulates a book saved while the editor schema didn't yet know about tables:
    // doc has no table nodes, but blocks (from import) still do.
    const stalePage = {
      title: "بازیابی",
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "متن" }] }],
      },
      blocks: [
        { type: "paragraph", text: "متن" },
        sampleTableBlock(1),
        sampleTableBlock(2),
      ],
    };
    const recovered = legacyPageToTextPage(stalePage);
    expect(countTablesInDoc(recovered.doc)).toBe(2);
  });

  it("preserves headers/rows/caption content of tables through a roundtrip", () => {
    const dbPages = [{ title: "x", blocks: [sampleTableBlock(7)] }];
    const pages = dbPagesToTextPages(dbPages);
    const node: any = pages[0].doc.content.find((n: any) => n.type === "table");
    expect(node?.attrs?.headers).toEqual(["A", "B"]);
    expect(node?.attrs?.rows).toEqual([
      ["r7c1", "r7c2"],
      ["r7c3", "r7c4"],
    ]);
    expect(node?.attrs?.caption).toBe("Table 7");

    const saved = textPagesToDbPages(pages);
    const block: any = (saved[0].blocks ?? []).find((b: any) => b.type === "table");
    expect(block?.headers).toEqual(["A", "B"]);
    expect(block?.rows).toEqual([
      ["r7c1", "r7c2"],
      ["r7c3", "r7c4"],
    ]);
    expect(block?.caption).toBe("Table 7");
  });
});
