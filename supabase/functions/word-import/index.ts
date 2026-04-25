// Edge Function: parse uploaded .docx into a structured book and insert it.
// Uses mammoth to extract HTML, then splits by headings into chapters/blocks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Block {
  type: "heading" | "paragraph" | "quote" | "callout";
  level?: number;
  text: string;
}
interface Page { title: string; blocks: Block[]; }

function htmlToBlocks(html: string): Page[] {
  // very small/safe HTML walker — split by h1/h2/h3 into pages
  const cleaned = html
    .replace(/<img[^>]*>/g, "")
    .replace(/<table[\s\S]*?<\/table>/g, "")
    .replace(/<figure[\s\S]*?<\/figure>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&nbsp;/g, " ");

  // tokenize by block-level tags
  const tokenRe = /<(h1|h2|h3|p|blockquote|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
  const pages: Page[] = [];
  let cur: Page = { title: "مقدمه", blocks: [] };
  const stripTags = (s: string) =>
    s.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    const tag = m[1].toLowerCase();
    const text = stripTags(m[2]);
    if (!text) continue;

    if (tag === "h1" || tag === "h2") {
      if (cur.blocks.length) pages.push(cur);
      cur = { title: text.slice(0, 80), blocks: [] };
    } else if (tag === "h3") {
      cur.blocks.push({ type: "heading", level: 3, text });
    } else if (tag === "blockquote") {
      cur.blocks.push({ type: "quote", text });
    } else if (tag === "ul" || tag === "ol") {
      const items = m[2].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? [];
      items.forEach((li) => {
        const t = stripTags(li);
        if (t) cur.blocks.push({ type: "paragraph", text: "• " + t });
      });
    } else {
      cur.blocks.push({ type: "paragraph", text });
    }
  }
  if (cur.blocks.length) pages.push(cur);

  // Filter chapters with no real content
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

    if (!path || typeof path !== "string") {
      return new Response(JSON.stringify({ error: "missing path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ensure path is inside the user's folder
    if (!path.startsWith(`${u.user.id}/`)) {
      return new Response(JSON.stringify({ error: "forbidden path" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // download file using service role
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
    const result = await mammoth.convertToHtml({ buffer });
    const pages = htmlToBlocks(result.value || "");

    if (pages.length === 0) {
      return new Response(JSON.stringify({ error: "no content extracted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: book, error: insErr } = await admin
      .from("books")
      .insert({
        title,
        author,
        description,
        ambient_theme: "paper",
        category: "کتاب کاربر",
        cover_url: "/placeholder.svg",
        price: 0,
        pages,
      })
      .select("id, title")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // also add to user's library
    await admin.from("user_books").insert({
      user_id: u.user.id,
      book_id: book.id,
      acquired_via: "upload",
      status: "unread",
    });

    return new Response(
      JSON.stringify({ book, chapters: pages.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
