// Generates a book cover image automatically based on the first few pages
// of content (title + extracted text). Uses Lovable AI image model.
// Saves to `book-media` bucket via service role and updates books.cover_url.
//
// Idempotent: if the book already has a cover_url, returns it without
// regenerating. Designed to be called publicly (anyone viewing the store
// can trigger generation for a book missing a cover) — but rate limited
// per book via the cover_url itself (set immediately after gen).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3.1-flash-image-preview";

interface ReqBody { book_id: string }

// Walk a tiptap-style pages JSON and concatenate visible text up to a limit.
function extractText(pages: unknown, max = 1500): string {
  const out: string[] = [];
  let total = 0;
  const walk = (node: any) => {
    if (!node || total > max) return;
    if (typeof node === "string") { out.push(node); total += node.length; return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object") {
      if (typeof node.text === "string") { out.push(node.text); total += node.text.length; }
      if (node.content) walk(node.content);
      if (node.children) walk(node.children);
      // Common page shapes
      if (node.blocks) walk(node.blocks);
      if (node.paragraphs) walk(node.paragraphs);
      if (node.body) walk(node.body);
    }
  };
  try { walk(pages); } catch { /* ignore */ }
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = (await req.json()) as ReqBody;
    const bookId = body?.book_id;
    if (!bookId) return new Response(JSON.stringify({ error: "missing book_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load book
    const { data: book, error: bErr } = await sbAdmin
      .from("books")
      .select("id, title, title_en, author, category, description, cover_url, language, pages, publisher_id")
      .eq("id", bookId)
      .maybeSingle();
    if (bErr || !book) return new Response(JSON.stringify({ error: "book not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Idempotency: if cover already exists and is non-placeholder, return.
    if (book.cover_url && !/placeholder/i.test(book.cover_url)) {
      return new Response(JSON.stringify({ url: book.cover_url, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fa = (book.language || "fa") === "fa";
    const sample = extractText(book.pages, 1200);
    const title = book.title || book.title_en || "";
    const desc = book.description || "";

    const promptParts = [
      "Create a professional, elegant book cover illustration (no text, no typography, no letters).",
      "Style: tasteful editorial book-cover art, painterly, atmospheric, single coherent scene, vertical 3:4 composition, suitable as a thumbnail.",
      `Book title (for context only, do NOT render text): "${title}".`,
      book.category ? `Genre: ${book.category}.` : "",
      desc ? `Synopsis: ${desc.slice(0, 300)}.` : "",
      sample ? `Opening passages (use to infer mood, setting, themes): ${sample}` : "",
      "Output: a single illustrative cover image, no borders, no captions, no watermark, no text of any language.",
    ].filter(Boolean);
    const prompt = promptParts.join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("auto-cover ai", r.status, txt);
      return new Response(JSON.stringify({ error: fa ? "خطای تولید کاور" : "cover gen failed", status: r.status }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const imgUrl: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const m = imgUrl?.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return new Response(JSON.stringify({ error: "no image" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const mime = m[1];
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const ext = mime === "image/png" ? "png" : "jpg";
    const owner = book.publisher_id || "system";
    const key = `${owner}/auto-cover/${bookId}-${Date.now()}.${ext}`;
    const up = await sbAdmin.storage.from("book-media").upload(key, bin, { contentType: mime, upsert: true });
    if (up.error) {
      console.error("upload", up.error);
      return new Response(JSON.stringify({ error: up.error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = sbAdmin.storage.from("book-media").getPublicUrl(key);
    const url = pub.publicUrl;

    await sbAdmin.from("books").update({ cover_url: url }).eq("id", bookId);

    return new Response(JSON.stringify({ url, cached: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("book-auto-cover", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
