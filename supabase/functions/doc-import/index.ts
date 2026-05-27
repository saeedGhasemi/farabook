// Edge Function: import a PDF or HTML file uploaded to `book-uploads` and
// create a draft book with structured pages/blocks (matching the shape used
// by the existing word-import flow). This is an MVP alternative path so we
// can test conversion quality on non-Word inputs.
//
// Body: { filePath, kind: "pdf" | "html", title, author?, description?,
//         metadata?, replaceBookId? }
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { parseHTML } from "npm:linkedom@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Block =
  | { type: "heading"; level?: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "image"; src: string; caption?: string }
  | { type: "table"; headers: string[]; rows: string[][] };

interface Page { title: string; blocks: Block[]; level?: number }

// ----------------------------- PDF ------------------------------------

/**
 * Convert a PDF into one Page per PDF page. Each non-empty line in the
 * extracted text becomes a paragraph; very short ALL-CAPS / leading lines
 * are promoted to headings as a light heuristic.
 */
async function pdfToPages(buf: Uint8Array): Promise<Page[]> {
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: false });
  const pagesText = Array.isArray(text) ? text : [String(text ?? "")];
  const pages: Page[] = [];
  pagesText.forEach((raw, idx) => {
    const lines = String(raw || "")
      .replace(/\u0000/g, "")
      .split(/\r?\n+/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!lines.length) {
      pages.push({ title: `صفحه ${idx + 1}`, blocks: [] });
      return;
    }
    const blocks: Block[] = [];
    const firstShort = lines[0].length <= 80;
    const title = firstShort ? lines[0] : `صفحه ${idx + 1}`;
    const start = firstShort ? 1 : 0;
    if (firstShort) blocks.push({ type: "heading", level: 1, text: lines[0] });
    // Merge consecutive lines into paragraph chunks (blank line separates).
    let buf2: string[] = [];
    const flush = () => {
      const t = buf2.join(" ").trim();
      if (t) blocks.push({ type: "paragraph", text: t });
      buf2 = [];
    };
    for (let i = start; i < lines.length; i += 1) {
      const l = lines[i];
      // A line ending with sentence punctuation finishes the current paragraph.
      buf2.push(l);
      if (/[.!?؟…]$/.test(l) || /[:\-—]$/.test(l)) flush();
    }
    flush();
    pages.push({ title, blocks });
  });
  return pages.length ? pages : [{ title: "صفحه ۱", blocks: [] }];
}

// ----------------------------- HTML -----------------------------------

const cleanText = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Convert HTML into pages, starting a new page at every <h1>. Other heading
 * levels become heading blocks within the current page.
 */
function htmlToPages(html: string): Page[] {
  const { document } = parseHTML(html);
  const root = document.body || document.documentElement;
  const pages: Page[] = [];
  let current: Page = { title: cleanText(document.title || "") || "صفحه ۱", blocks: [] };
  const pushCurrent = () => { pages.push(current); };

  const walk = (node: Element) => {
    const children = Array.from(node.children) as Element[];
    for (const el of children) {
      const tag = el.tagName.toLowerCase();
      if (tag === "h1") {
        if (current.blocks.length) pushCurrent();
        current = { title: cleanText(el.textContent || "") || `صفحه ${pages.length + 1}`, blocks: [] };
        current.blocks.push({ type: "heading", level: 1, text: cleanText(el.textContent || "") });
      } else if (/^h[2-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const text = cleanText(el.textContent || "");
        if (text) current.blocks.push({ type: "heading", level, text });
      } else if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
        // Recurse into structural containers; leaf <p>/<div> with text → paragraph.
        const hasBlockChildren = Array.from(el.children).some((c) =>
          ["h1","h2","h3","h4","h5","h6","p","ul","ol","blockquote","img","table","pre","section","article","div"].includes(
            (c as Element).tagName.toLowerCase(),
          ),
        );
        if (hasBlockChildren) walk(el);
        else {
          const text = cleanText(el.textContent || "");
          if (text) current.blocks.push({ type: "paragraph", text });
        }
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(el.querySelectorAll(":scope > li"))
          .map((li) => cleanText((li as Element).textContent || ""))
          .filter(Boolean);
        if (items.length) {
          const bullet = tag === "ul" ? "• " : "";
          items.forEach((t, i) => {
            const prefix = tag === "ol" ? `${i + 1}. ` : bullet;
            current.blocks.push({ type: "paragraph", text: prefix + t });
          });
        }
      } else if (tag === "blockquote") {
        const text = cleanText(el.textContent || "");
        if (text) current.blocks.push({ type: "quote", text });
      } else if (tag === "pre") {
        const text = (el.textContent || "").replace(/\u0000/g, "").trimEnd();
        if (text) current.blocks.push({ type: "paragraph", text });
      } else if (tag === "img") {
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        if (src && /^https?:\/\//i.test(src)) {
          current.blocks.push({ type: "image", src, caption: alt || undefined });
        }
      } else if (tag === "table") {
        const trs = Array.from(el.querySelectorAll("tr")) as Element[];
        const rows = trs.map((tr) => Array.from(tr.querySelectorAll("th,td"))
          .map((c) => cleanText((c as Element).textContent || "")));
        if (rows.length) {
          const [head, ...body] = rows;
          current.blocks.push({ type: "table", headers: head, rows: body });
        }
      } else {
        walk(el);
      }
    }
  };
  walk(root as Element);
  pushCurrent();
  return pages.length ? pages : [{ title: "صفحه ۱", blocks: [] }];
}

// ----------------------------- main -----------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
    const token = auth.replace("Bearer ", "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return json(401, { error: "unauthorized", detail: uErr?.message });

    const body = await req.json().catch(() => ({} as any));
    const filePath: string = body.filePath;
    const kind: "pdf" | "html" = body.kind;
    const title: string = (body.title || "").trim() || "کتاب بدون عنوان";
    const author: string = (body.author || "").trim() || "ناشناس";
    const description: string | null = body.description?.trim() || null;
    const metadata = body.metadata || {};
    const replaceBookId: string | null = body.replaceBookId || null;

    if (!filePath) return json(400, { error: "missing_filePath" });
    if (kind !== "pdf" && kind !== "html") return json(400, { error: "invalid_kind" });

    const dl = await admin.storage.from("book-uploads").download(filePath);
    if (dl.error || !dl.data) return json(404, { error: "source_missing", detail: dl.error?.message });
    const ab = await dl.data.arrayBuffer();

    let pages: Page[];
    try {
      if (kind === "pdf") {
        pages = await pdfToPages(new Uint8Array(ab));
      } else {
        const html = new TextDecoder("utf-8").decode(new Uint8Array(ab));
        pages = htmlToPages(html);
      }
    } catch (e) {
      console.error("[doc-import] parse failed", e);
      return json(500, { error: "parse_failed", detail: String((e as any)?.message ?? e) });
    }

    // Trim totally empty trailing pages
    while (pages.length && !pages[pages.length - 1].blocks.length) pages.pop();
    if (!pages.length) pages = [{ title: "صفحه ۱", blocks: [] }];

    // Pick first http image as cover, fallback to placeholder.
    let cover_url = "/placeholder.svg";
    for (const p of pages) {
      const img = p.blocks.find((b) => b.type === "image" && (b as any).src) as any;
      if (img?.src) { cover_url = img.src; break; }
    }

    let bookId: string;
    if (replaceBookId) {
      const { data: upd, error } = await admin.from("books")
        .update({ title, author, description, cover_url, pages })
        .eq("id", replaceBookId)
        .select("id").single();
      if (error || !upd) return json(500, { error: "update_failed", detail: error?.message });
      bookId = upd.id;
    } else {
      const m = metadata as any;
      const extra: Record<string, unknown> = {};
      if (m.subtitle) extra.subtitle = m.subtitle;
      if (m.book_type) extra.book_type = m.book_type;
      if (m.publication_year) extra.publication_year = Number(m.publication_year) || null;
      if (m.edition) extra.edition = m.edition;
      if (m.isbn) extra.isbn = m.isbn;
      if (Array.isArray(m.categories) && m.categories.length) extra.categories = m.categories;
      if (Array.isArray(m.subjects) && m.subjects.length) extra.subjects = m.subjects;
      if (Array.isArray(m.contributors) && m.contributors.length) extra.contributors = m.contributors;
      if (m.publisher) extra.publisher = m.publisher;
      if (m.language) extra.language = m.language;

      const { data: book, error } = await admin.from("books").insert({
        title, author, description,
        ambient_theme: "paper",
        category: m.categories?.[0] || "کتاب کاربر",
        cover_url, price: 0, pages,
        publisher_id: u.user.id,
        status: "draft",
        ...extra,
      }).select("id").single();
      if (error || !book) return json(500, { error: "insert_failed", detail: error?.message });
      bookId = book.id;
      await admin.from("user_books").insert({
        user_id: u.user.id, book_id: bookId, acquired_via: "upload", status: "unread",
      });
    }

    return json(200, { book: { id: bookId }, chapters: pages.length, kind });
  } catch (e) {
    console.error("[doc-import] crash", e);
    return json(500, { error: String((e as any)?.message ?? e) });
  }
});
