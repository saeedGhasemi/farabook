// Book publishing pipeline:
// - Generates a 2-3 paragraph AI summary of the whole book
// - Optionally generates a TTS narration of the summary (Lovable AI Gemini TTS)
// - Updates book row with metadata + status=published
//
// Auth: requires the calling user to be the publisher (owner) of the book.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PublishBody {
  bookId: string;
  metadata: {
    title?: string;
    title_en?: string | null;
    author?: string;
    subtitle?: string | null;
    book_type?: string | null;
    contributors?: unknown;
    publisher?: string | null;
    category?: string | null;
    categories?: string[];
    subjects?: string[];
    audience?: string | null;
    isbn?: string | null;
    publication_year?: number | null;
    edition?: string | null;
    page_count?: number | null;
    series_name?: string | null;
    series_index?: number | null;
    original_title?: string | null;
    original_language?: string | null;
    language?: string | null;
    tags?: string[];
    price?: number;
    preview_pages?: number[];
    description?: string | null;
  };
  generateSummary?: boolean;
  generateAudio?: boolean;
  ttsProvider?: "lovable" | "browser";
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "book";

const extractText = (pages: any[]): string => {
  if (!Array.isArray(pages)) return "";
  const out: string[] = [];
  for (const p of pages) {
    if (typeof p?.title === "string") out.push(p.title);
    if (Array.isArray(p?.blocks)) {
      for (const b of p.blocks) {
        if (typeof b?.text === "string") out.push(b.text);
        if (typeof b?.caption === "string") out.push(b.caption);
        if (Array.isArray(b?.steps)) {
          for (const s of b.steps) {
            if (s?.title) out.push(s.title);
            if (s?.description) out.push(s.description);
          }
        }
      }
    }
    if (typeof p?.content === "string") out.push(p.content);
  }
  return out.join("\n").slice(0, 12000);
};

/** Detect whether the book content is Persian/Arabic (fa) or Latin (en).
 *  Uses character-class ratios so the result reflects the *actual* text
 *  rather than the metadata flag (which authors often forget to set). */
const detectLang = (text: string): "fa" | "en" => {
  if (!text) return "fa";
  const sample = text.slice(0, 4000);
  let fa = 0;
  let en = 0;
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    // Arabic + Persian + Arabic Supplement
    if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF)) fa++;
    else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) en++;
  }
  if (fa === 0 && en === 0) return "fa";
  return fa >= en ? "fa" : "en";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as PublishBody;
    if (!body?.bookId) {
      return new Response(JSON.stringify({ error: "bookId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch the book; verify ownership.
    const { data: book, error: fetchErr } = await admin
      .from("books")
      .select("id, title, author, pages, publisher_id, language")
      .eq("id", body.bookId)
      .maybeSingle();
    if (fetchErr || !book) throw fetchErr || new Error("book not found");
    if (book.publisher_id !== user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bookText = extractText(book.pages as any[]);
    const detectedLang = detectLang(bookText);
    const lang = body.metadata.language || book.language || detectedLang;
    const fa = lang === "fa";
    console.log("book-publish lang:", { metadata: body.metadata.language, book: book.language, detected: detectedLang, final: lang });

    // ---- 1. AI Summary -------------------------------------------------
    let aiSummary: string | null = null;
    if (body.generateSummary && LOVABLE_API_KEY) {
      const text = bookText;
      if (text.trim().length > 50) {
        const sys = fa
          ? "تو یک ویراستار حرفه‌ای کتاب هستی. متن کتاب را بخوان و یک خلاصهٔ گیرا و توصیفی در دو تا سه پاراگراف به فارسی روان بنویس. لحن کتاب را حفظ کن. فقط خلاصه را بنویس، بدون مقدمه یا پایان."
          : "You are a professional book editor. Read the manuscript and write a captivating, descriptive summary in 2-3 paragraphs. Preserve the book's tone. Output only the summary.";
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: text },
            ],
          }),
        });
        if (r.ok) {
          const j = await r.json();
          aiSummary = j?.choices?.[0]?.message?.content?.trim() ?? null;
        } else if (r.status === 429) {
          console.warn("AI summary rate limited");
        } else if (r.status === 402) {
          console.warn("AI summary credits exhausted");
        }
      }
    }

    // ---- 2. AI Audio (Lovable Gemini TTS) ------------------------------
    let aiAudioUrl: string | null = null;
    if (
      body.generateAudio &&
      body.ttsProvider === "lovable" &&
      LOVABLE_API_KEY &&
      aiSummary
    ) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-preview-tts",
            messages: [{ role: "user", content: aiSummary }],
            modalities: ["audio"],
            audio: { voice: fa ? "Kore" : "Puck", format: "mp3" },
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const b64 =
            j?.choices?.[0]?.message?.audio?.data ??
            j?.choices?.[0]?.message?.audio ??
            null;
          if (b64 && typeof b64 === "string") {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const key = `${user.id}/audio/${book.id}-${Date.now()}.mp3`;
            const up = await admin.storage
              .from("book-media")
              .upload(key, bytes, { contentType: "audio/mpeg", upsert: true });
            if (!up.error) {
              aiAudioUrl = admin.storage.from("book-media").getPublicUrl(key)
                .data.publicUrl;
            }
          }
        } else {
          console.warn("TTS failed", r.status, await r.text());
        }
      } catch (e) {
        console.error("TTS error:", e);
      }
    }

    // ---- 3. Compose update -------------------------------------------
    const md = body.metadata;
    const slug = `${slugify(md.title || book.title)}-${book.id.slice(0, 6)}`;

    const update: Record<string, unknown> = {
      status: "published",
      published_at: new Date().toISOString(),
      slug,
    };
    if (md.title !== undefined) update.title = md.title;
    if (md.title_en !== undefined) update.title_en = md.title_en;
    if (md.author !== undefined) update.author = md.author;
    if (md.subtitle !== undefined) update.subtitle = md.subtitle;
    if (md.book_type !== undefined) update.book_type = md.book_type;
    if (md.contributors !== undefined) update.contributors = md.contributors;
    if (md.publisher !== undefined) update.publisher = md.publisher;
    if (md.category !== undefined) update.category = md.category;
    if (md.categories !== undefined) update.categories = md.categories;
    if (md.subjects !== undefined) update.subjects = md.subjects;
    if (md.audience !== undefined) update.audience = md.audience;
    if (md.isbn !== undefined) update.isbn = md.isbn;
    if (md.publication_year !== undefined) update.publication_year = md.publication_year;
    if (md.edition !== undefined) update.edition = md.edition;
    if (md.page_count !== undefined) update.page_count = md.page_count;
    if (md.series_name !== undefined) update.series_name = md.series_name;
    if (md.series_index !== undefined) update.series_index = md.series_index;
    if (md.original_title !== undefined) update.original_title = md.original_title;
    if (md.original_language !== undefined) update.original_language = md.original_language;
    if (md.language !== undefined) update.language = md.language;
    if (md.tags !== undefined) update.tags = md.tags;
    if (md.price !== undefined) update.price = md.price;
    if (md.preview_pages !== undefined) update.preview_pages = md.preview_pages;
    if (md.description !== undefined) update.description = md.description;
    if (aiSummary) update.ai_summary = aiSummary;
    if (aiAudioUrl) update.ai_audio_url = aiAudioUrl;

    const { error: upErr } = await admin
      .from("books")
      .update(update)
      .eq("id", book.id);
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({
        ok: true,
        slug,
        ai_summary: aiSummary,
        ai_audio_url: aiAudioUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("publish error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
