// Suggest interactive enrichments for a page of text. Returns a list
// of structured suggestions (callout/highlight/heading/quote/typography)
// that the editor can accept one-by-one or apply all at once.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface ReqBody {
  text: string;
  lang?: "fa" | "en";
  /** Optional: restrict the page title hint */
  title?: string;
  book_id?: string;
}

const MODEL = "google/gemini-3-flash-preview";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    const text = (body?.text ?? "").trim();
    const lang = body?.lang === "en" ? "en" : "fa";
    if (!text || text.length < 20) {
      return new Response(JSON.stringify({ error: lang === "fa" ? "متن خیلی کوتاه است" : "Text too short" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Charge credits via authed client
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: lang === "fa" ? "نیاز به ورود" : "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const charge = await sb.rpc("charge_ai_usage", {
      _operation: "text_suggest",
      _book_id: body.book_id || null,
      _model: MODEL,
      _metadata: { chars: text.length },
    });
    if (charge.error) {
      const msg = charge.error.message || "";
      if (msg.includes("insufficient_credits")) {
        return new Response(JSON.stringify({ error: lang === "fa" ? "اعتبار کافی ندارید" : "Insufficient credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const chargeInfo = charge.data as { cost?: number };
    const sbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const refund = async (reason: string) => {
      if (!chargeInfo?.cost) return;
      await sbAdmin.from("credit_transactions").insert({
        user_id: user.id, amount: chargeInfo.cost, reason: "ai_text_suggest_refund",
        metadata: { reason, book_id: body.book_id || null },
      });
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) { await refund("no_key"); throw new Error("LOVABLE_API_KEY missing"); }

    const fa = lang === "fa";
    const sys = fa
      ? `تو یک ویراستار باهوش هستی که می‌خواهی یک متن خشک کتاب را به صفحه‌ای جذاب، تعاملی و آموزشی تبدیل کنی.
بر اساس متن داده‌شده، حداکثر ۸ پیشنهاد دقیق برای ارتقای صفحه بده. هر پیشنهاد باید:
- وقتی روی متن موجود اعمال می‌شود، target_text باید عیناً (حتی یک حرف فرق نکند) در متن باشد.
- یکی از این عملیات‌ها باشد:
  • make_callout: تبدیل آن جمله به یک بلوک (variant: info|tip|note|warning|success|danger|question|definition|example).
  • make_quote: تبدیل به نقل‌قول.
  • make_heading: تبدیل به تیتر بخش (level=2 یا 3).
  • emphasize: bold/italic/underline کردن یک عبارت کوتاه (۲ تا ۸ کلمه).
  • split_paragraph: شکستن یک پاراگراف طولانی به دو پاراگراف.
  • insert_timeline: اگر متن شامل مراحل، توالی زمانی یا فرآیند است، یک تایم‌لاین پیشنهاد بده. target_text آخرین جمله‌ای است که تایم‌لاین بعدش درج شود. فیلد title (الزامی) را با یک عنوان جذاب و کوتاه پر کن. steps را با ۳ تا ۶ گام (هر گام: marker، title، description، و image_prompt که توصیف بصری مختصر انگلیسی برای تولید تصویر آن گام است) پر کن.
  • insert_scrollytelling: اگر متن شامل توضیح مرحله‌به‌مرحله یک مفهوم/پدیده است، یک اسکرولی‌تلینگ پیشنهاد بده. title (الزامی) را با عنوانی جذاب پر کن. steps با ۳ تا ۵ گام (هر گام: title، description، image_prompt انگلیسی برای تولید تصویر).
از تکرار اجتناب کن. روی نکات کلیدی، تعاریف، مثال‌ها، فرآیندها، و موارد قابل تبدیل به تعامل تمرکز کن.`
      : `You are an editor turning dry book text into an engaging, interactive, educational page.
Return up to 8 precise suggestions. Each must:
- If acting on text, target_text must match a substring verbatim.
- Be one of:
  • make_callout (variant: info|tip|note|warning|success|danger|question|definition|example)
  • make_quote
  • make_heading (level 2 or 3)
  • emphasize (mark: bold|italic|underline) — short phrase 2-8 words
  • split_paragraph
  • insert_timeline — if the text describes stages/process/chronology. Always set a short engaging title. Provide steps[3-6] each with marker, title, description, and image_prompt (a short ENGLISH visual description for AI image generation). target_text = sentence after which to insert.
  • insert_scrollytelling — if the text walks through a concept step-by-step. Always set a title. Provide steps[3-5] each with title, description, image_prompt (ENGLISH). target_text = sentence after which to insert.
Avoid repetition. Focus on key points, definitions, examples, processes, and interactive opportunities.`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: text },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_enrichments",
            description: "Return enrichment suggestions for the page.",
            parameters: {
              type: "object",
              properties: {
                typography_preset: { type: "string" },
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      op: { type: "string", description: "make_callout|make_quote|make_heading|emphasize|split_paragraph|insert_timeline|insert_scrollytelling" },
                      target_text: { type: "string" },
                      variant: { type: "string", description: "callout variant" },
                      level: { type: "number" },
                      mark: { type: "string" },
                      split_after: { type: "string" },
                      title: { type: "string", description: "Optional title for inserted block" },
                      steps: {
                        type: "array",
                        description: "Steps for insert_timeline / insert_scrollytelling",
                        items: {
                          type: "object",
                          properties: {
                            marker: { type: "string" },
                            title: { type: "string" },
                            description: { type: "string" },
                            image_prompt: { type: "string", description: "ENGLISH short visual description (clean illustration, soft colors) for AI image generation of this step" },
                          },
                        },
                      },
                      reason: { type: "string" },
                    },
                    required: ["op", "reason"],
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_enrichments" } },
      }),
    });

    if (r.status === 429) { await refund("rate_limit"); return new Response(JSON.stringify({ error: fa ? "محدودیت درخواست. کمی صبر کنید." : "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (r.status === 402) { await refund("ai_credits"); return new Response(JSON.stringify({ error: fa ? "اعتبار AI تمام شده است." : "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (!r.ok) {
      const err = await r.text();
      console.error("AI gateway", r.status, err);
      await refund("ai_error_" + r.status);
      return new Response(JSON.stringify({ error: fa ? "خطای هوش مصنوعی" : "AI error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { suggestions?: unknown[]; typography_preset?: string } = {};
    try { parsed = JSON.parse(args ?? "{}"); } catch { /* ignore */ }
    return new Response(JSON.stringify({
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      typography_preset: typeof parsed.typography_preset === "string" ? parsed.typography_preset : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("book-suggest", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
