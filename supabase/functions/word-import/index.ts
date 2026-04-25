// Edge Function: parse uploaded .docx into a structured book and insert it.
// Extracts text, headings, tables, and images (uploaded to public storage).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Block =
  | { type: "heading"; level?: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "callout"; text: string }
  | { type: "image"; src: string; caption?: string; figureNumber?: string }
  | { type: "table"; headers: string[]; rows: string[][]; caption?: string; tableNumber?: string };

interface Page { title: string; blocks: Block[]; }

const stripTags = (s: string) =>
  s.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Find Persian/English figure or table label like "شکل ۹–۱" / "Figure 9.1" / "جدول ۲-۱"
const FIG_RE = /^(شکل|تصویر|نگاره|figure|fig\.?)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;
const TBL_RE = /^(جدول|table)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;

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
  const cleaned = html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&nbsp;/g, " ");

  // tokenize: headings, paragraphs, blockquote, lists, tables, standalone images
  const tokenRe = /<(h1|h2|h3|h4|p|blockquote|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/gi;

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
      cur.blocks.push({
        type: "image",
        src: im[1],
        caption: pendingImageCaption?.text,
        figureNumber: pendingImageCaption?.fig,
      });
      pendingImageCaption = null;
      lastIdx = im.index + im[0].length;
    }
    const tail = stripTags(inner.slice(lastIdx));
    if (!tail) return;

    // Caption immediately after an image?
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.type === "image" && !last.caption && (FIG_RE.test(tail) || tail.length < 220)) {
      if (FIG_RE.test(tail)) {
        const { label, rest } = splitLabel(tail, FIG_RE);
        last.figureNumber = label;
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
      // p
      handleParagraph(inner);
    }
  }
  pushPage();

  return pages.filter((p) => p.blocks.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const path: string = body.path;
    const title: string = (body.title || "کتاب جدید").toString().slice(0, 200);
    const author: string = (body.author || "ناشناس").toString().slice(0, 120);
    const description: string = (body.description || "").toString().slice(0, 600);
    const replaceBookId: string | undefined = body.replaceBookId;

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: file, error: dlErr } = await admin.storage
      .from("book-uploads")
      .download(path);
    if (dlErr || !file) {
      return new Response(JSON.stringify({ error: dlErr?.message || "download failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Decide a stable folder for this import's images
    const folder = `${u.user.id}/${crypto.randomUUID()}`;
    let imgIdx = 0;
    const supaUrl = Deno.env.get("SUPABASE_URL")!;

    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image: any) => {
          try {
            const ct: string = image.contentType || "image/png";
            const ext = (ct.split("/")[1] || "png").replace("jpeg", "jpg");
            const buf: Buffer = await image.read();
            imgIdx += 1;
            const key = `${folder}/img-${String(imgIdx).padStart(3, "0")}.${ext}`;
            const up = await admin.storage.from("book-media").upload(key, buf, {
              contentType: ct,
              upsert: true,
            });
            if (up.error) {
              console.warn("upload failed", up.error);
              return { src: "" };
            }
            const pub = admin.storage.from("book-media").getPublicUrl(key);
            return { src: pub.data.publicUrl };
          } catch (e) {
            console.warn("image convert error", e);
            return { src: "" };
          }
        }),
      },
    );

    const pages = htmlToPages(result.value || "");
    if (pages.length === 0) {
      return new Response(JSON.stringify({ error: "no content extracted" }), {
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
        return new Response(JSON.stringify({ error: updErr?.message || "update failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookId = upd.id;
      bookTitle = upd.title;
    } else {
      const { data: book, error: insErr } = await admin
        .from("books")
        .insert({
          title,
          author,
          description,
          ambient_theme: "paper",
          category: "کتاب کاربر",
          cover_url,
          price: 0,
          pages,
          publisher_id: u.user.id,
          status: "draft",
        })
        .select("id, title")
        .single();
      if (insErr || !book) {
        return new Response(JSON.stringify({ error: insErr?.message || "insert failed" }), {
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

    return new Response(
      JSON.stringify({ book: { id: bookId, title: bookTitle }, chapters: pages.length, images: imgIdx }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
