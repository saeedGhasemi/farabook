// Suggest interactive enrichments for a page of text. Returns a list
// of structured suggestions (callout/highlight/heading/quote/typography)
// that the editor can accept one-by-one or apply all at once.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface ReqBody {
  text: string;
  lang?: "fa" | "en";
  /** Optional: restrict the page title hint */
  title?: string;
}

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const fa = lang === "fa";
    const sys = fa
      ? `تو یک ویراستار باهوش هستی که می‌خواهی یک متن خشک کتاب را به صفحه‌ای جذاب و آموزشی تبدیل کنی.
بر اساس متن داده‌شده، حداکثر ۶ پیشنهاد دقیق برای ارتقای صفحه بده. هر پیشنهاد باید:
- روی یک جمله یا عبارتِ دقیقاً موجود در متن اعمال شود (target_text باید عیناً در متن باشد، حتی یک حرف فرق نکند).
- یکی از این عملیات‌ها باشد:
  • make_callout: تبدیل آن جمله به یک «نکته/مهم/هشدار/سؤال» (variant را خودت انتخاب کن).
  • make_quote: تبدیل به نقل‌قول.
  • make_heading: تبدیل به تیتر بخش (level=2 یا 3).
  • emphasize: bold/italic/underline کردن یک عبارت کوتاه (۲ تا ۸ کلمه).
  • split_paragraph: شکستن یک پاراگراف طولانی به دو پاراگراف برای خوانایی بهتر.
از تکرار اجتناب کن. روی نکات کلیدی، تعاریف، هشدارها، سؤالات و جملات قابل‌نقل‌قول تمرکز کن.`
      : `You are a thoughtful editor turning dry book text into an engaging, educational page.
Given the text, return up to 6 precise suggestions to upgrade it. Each must:
- Apply to a sentence or phrase that EXISTS verbatim in the text (target_text must match exactly).
- Be one of these operations:
  • make_callout: turn the sentence into a callout (info/tip/note/warning/success/danger/question).
  • make_quote: turn into a blockquote.
  • make_heading: turn into a section heading (level 2 or 3).
  • emphasize: bold/italic/underline a short phrase (2-8 words).
  • split_paragraph: split a long paragraph into two for readability.
Avoid repetition. Focus on key points, definitions, warnings, questions, quotable lines.`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
                typography_preset: {
                  type: "string",
                  enum: ["editorial", "modern", "classic", "playful"],
                  description: "Suggested overall typography preset that fits the tone of this page.",
                },
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      op: {
                        type: "string",
                        enum: ["make_callout", "make_quote", "make_heading", "emphasize", "split_paragraph"],
                      },
                      target_text: { type: "string", description: "Exact substring from the page text to act on." },
                      variant: {
                        type: "string",
                        enum: ["info", "tip", "note", "warning", "success", "danger", "question", "quote"],
                        description: "Only for make_callout.",
                      },
                      level: { type: "number", enum: [2, 3], description: "Only for make_heading." },
                      mark: { type: "string", enum: ["bold", "italic", "underline"], description: "Only for emphasize." },
                      split_after: { type: "string", description: "Only for split_paragraph: the sentence after which to split." },
                      reason: { type: "string", description: "Short user-facing reason (one sentence)." },
                    },
                    required: ["op", "target_text", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_enrichments" } },
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: fa ? "محدودیت درخواست. کمی صبر کنید." : "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: fa ? "اعتبار AI تمام شده است." : "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const err = await r.text();
      console.error("AI gateway", r.status, err);
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
