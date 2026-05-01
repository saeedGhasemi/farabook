// Generates a book cover image automatically based on the first few pages
// of content (title + extracted text). Uses Lovable AI image model when
// available, otherwise falls back to a deterministic SVG cover so the
// endpoint NEVER returns a 5xx error.
// Build version: v4 (force redeploy — SVG fallback when AI is 402/5xx)
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

    // Helpers for SVG fallback (deterministic, no AI required)
    const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
    const hashStr = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return Math.abs(h); };
    const buildSvgCover = (): { bin: Uint8Array; mime: string; ext: string } => {
      const palettes = [
        ["#1e3a8a", "#3b82f6", "#fbbf24"],
        ["#0f766e", "#14b8a6", "#fef3c7"],
        ["#7c2d12", "#ea580c", "#fde68a"],
        ["#581c87", "#a855f7", "#fbcfe8"],
        ["#064e3b", "#10b981", "#fef9c3"],
        ["#831843", "#ec4899", "#fde68a"],
        ["#1e293b", "#475569", "#f1f5f9"],
        ["#7c1d6f", "#c026d3", "#fef3c7"],
      ];
      const h = hashStr(`${title}|${book.author || ""}|${book.category || ""}`);
      const [c1, c2, c3] = palettes[h % palettes.length];
      const initial = (title.trim().charAt(0) || "?").toUpperCase();
      const cat = book.category ? escapeXml(book.category) : "";
      const author = book.author ? escapeXml(book.author) : "";
      const titleEsc = escapeXml(title.slice(0, 40));
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="60%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <rect width="600" height="800" fill="url(#glow)"/>
  <g opacity="0.18" stroke="#ffffff" stroke-width="1.5" fill="none">
    <circle cx="500" cy="120" r="80"/>
    <circle cx="500" cy="120" r="140"/>
    <circle cx="100" cy="700" r="100"/>
    <circle cx="100" cy="700" r="160"/>
  </g>
  <text x="300" y="430" text-anchor="middle" font-family="Georgia, serif" font-size="320" font-weight="700" fill="#ffffff" fill-opacity="0.9">${escapeXml(initial)}</text>
  ${cat ? `<text x="300" y="560" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="4" fill="#ffffff" fill-opacity="0.85">${cat.toUpperCase()}</text>` : ""}
  <text x="300" y="650" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="600" fill="#ffffff">${titleEsc}</text>
  ${author ? `<text x="300" y="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.8">${author}</text>` : ""}
  <rect x="20" y="20" width="560" height="760" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2" rx="8"/>
</svg>`;
      return { bin: new TextEncoder().encode(svg), mime: "image/svg+xml", ext: "svg" };
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    let bin: Uint8Array | null = null;
    let mime = "image/jpeg";
    let ext = "jpg";
    let usedFallback = false;

    if (LOVABLE_API_KEY) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
        });
        if (r.ok) {
          const data = await r.json();
          const imgUrl: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          const m = imgUrl?.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            mime = m[1];
            bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
            ext = mime === "image/png" ? "png" : "jpg";
          }
        } else {
          const txt = await r.text();
          console.warn("auto-cover ai", r.status, txt);
        }
      } catch (e) {
        console.warn("auto-cover ai exception", e);
      }
    }

    if (!bin) {
      const fb = buildSvgCover();
      bin = fb.bin; mime = fb.mime; ext = fb.ext;
      usedFallback = true;
    }

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

    return new Response(JSON.stringify({ url, cached: false, fallback: usedFallback }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("book-auto-cover", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
