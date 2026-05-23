// Use Lovable AI to detect a book's table of contents (TOC) from the
// plain-text content of its first pages. Two modes:
//   1) `auto`   — scan pages, locate the TOC, return entries + page indexes.
//   2) `pages`  — user has picked TOC pages; just extract entries from them.
//
// Response: { tocPageIndexes: number[], entries: [{title, level}] }
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface PageIn { index: number; title?: string; text: string; }
interface ReqBody {
  pages: PageIn[];
  mode?: "auto" | "pages";
  lang?: "fa" | "en";
  book_id?: string | null;
}

const MODEL = "google/gemini-3-flash-preview";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    const lang = body.lang === "en" ? "en" : "fa";
    const fa = lang === "fa";
    const mode = body.mode === "pages" ? "pages" : "auto";
    const pages = Array.isArray(body.pages) ? body.pages.slice(0, 20) : [];
    if (!pages.length) {
      return new Response(JSON.stringify({ error: fa ? "صفحه‌ای ارسال نشده" : "no pages" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authn (no charging; this is structural & infrequent)
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: fa ? "نیاز به ورود" : "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const sys = fa
      ? `تو یک ابزار تحلیل کتاب فارسی هستی. وظیفه‌ات تشخیص «فهرست مطالب» کتاب از روی متن صفحات و استخراج عنوان فصل‌ها به همراه سطح تودرتویی است.
- اگر مشخصاً یکی یا چند صفحه «فهرست مطالب» (یا Table of Contents/Contents) هستند، شماره‌شان را در tocPageIndexes برگردان.
- در entries، هر سرفصل را با title (همان عنوان بدون شماره صفحه/نقطه‌چین) و level (۰ برای سرفصل اصلی، ۱ برای زیرفصل، ۲ برای زیرزیرفصل …) برگردان.
- سطح را از تورفتگی یا شماره‌گذاری (۱، ۱.۱، ۱.۱.۱) یا کلمات (فصل/بخش/گفتار) تشخیص بده.
- خط‌های غیرعنوان (پیشگفتار/نوبت چاپ/…) را در نظر نگیر مگر عنوان واقعی باشند.`
      : `You analyze a book to detect its Table of Contents and extract chapter titles + nesting levels.
- Return the page indexes that contain the TOC in tocPageIndexes.
- For each TOC line return { title, level } where level is 0 for top, 1 for sub-section, etc. Infer level from indentation, numbering (1, 1.1, 1.1.1), or words like Chapter/Section/Part.
- Skip non-title lines (front-matter, edition, etc.).`;

    const user_msg = (mode === "pages"
      ? (fa ? "این صفحات حاوی فهرست مطالب هستند. فقط entries را استخراج کن؛ tocPageIndexes را همان شماره صفحات ارسالی برگردان.\n\n"
            : "These pages contain the TOC. Extract entries; set tocPageIndexes to the page indexes given.\n\n")
      : "")
      + pages.map((p) => `--- PAGE ${p.index}${p.title ? ` (${p.title})` : ""} ---\n${(p.text || "").slice(0, 4000)}`).join("\n\n");

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user_msg },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_toc",
            description: "Return TOC page indexes and chapter entries.",
            parameters: {
              type: "object",
              properties: {
                tocPageIndexes: { type: "array", items: { type: "number" } },
                entries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      level: { type: "number", description: "0=top, 1=sub, 2=sub-sub..." },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["tocPageIndexes", "entries"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_toc" } },
      }),
    });

    if (r.status === 429) {
      return new Response(JSON.stringify({ error: fa ? "محدودیت درخواست. کمی صبر کنید." : "Rate limited" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (r.status === 402) {
      return new Response(JSON.stringify({ error: fa ? "اعتبار AI تمام شده است." : "Credits exhausted" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!r.ok) {
      const err = await r.text();
      console.error("AI gateway", r.status, err);
      return new Response(JSON.stringify({ error: fa ? "خطای هوش مصنوعی" : "AI error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { tocPageIndexes?: number[]; entries?: Array<{ title: string; level?: number }> } = {};
    try { parsed = JSON.parse(args ?? "{}"); } catch { /* ignore */ }
    const tocPageIndexes = Array.isArray(parsed.tocPageIndexes) ? parsed.tocPageIndexes.filter((n) => typeof n === "number") : [];
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .filter((e) => e && typeof e.title === "string" && e.title.trim())
          .map((e) => ({ title: String(e.title).trim().slice(0, 220), level: Math.max(0, Math.min(5, Math.floor(Number(e.level) || 0))) }))
      : [];
    return new Response(JSON.stringify({ tocPageIndexes, entries }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("book-toc-detect", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
