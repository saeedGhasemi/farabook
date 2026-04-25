import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, mode = "summary", lang = "fa" } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const fa = lang === "fa";
    const prompts: Record<string, string> = {
      summary: fa
        ? "متن زیر را به فارسی روان و ادبی در ۳ تا ۴ جمله خلاصه کن. فقط متن خلاصه را بنویس بدون مقدمه."
        : "Summarize the text in 3-4 elegant sentences. Only return the summary, no preamble.",
      quiz: fa
        ? "از متن زیر یک پرسش چهارگزینه‌ای مفهومی و عمیق به فارسی بساز. خروجی را دقیقاً به این فرمت بده:\n\nسوال: [پرسش]\n۱) [گزینه]\n۲) [گزینه]\n۳) [گزینه]\n۴) [گزینه]\nپاسخ صحیح: [شماره]\nتوضیح: [دلیل کوتاه]"
        : "Create one deep conceptual multiple-choice question. Format:\n\nQuestion: ...\n1) ...\n2) ...\n3) ...\n4) ...\nCorrect: [number]\nExplanation: ...",
      mindmap: fa
        ? "از متن زیر یک نقشهٔ ذهنی متنی به این صورت بساز:\n\n● موضوع اصلی\n  ○ شاخه ۱\n    - نکته\n    - نکته\n  ○ شاخه ۲\n    - نکته\n\nحداکثر ۳ شاخه اصلی و در هر کدام ۲ تا ۳ نکته. فارسی روان."
        : "Create a text mind-map:\n\n● Main topic\n  ○ Branch 1\n    - point\n    - point\n  ○ Branch 2\n    - point\n\nMax 3 branches, 2-3 points each.",
      explain: fa
        ? "متن زیر را به زبان ساده و گفتاری برای یک نوجوان توضیح بده، با مثال روزمره. حداکثر ۴ جمله."
        : "Explain the text in simple conversational language for a teen with a real-life example. Max 4 sentences.",
    };

    // ---------- Timeline (structured output via tool calling) ----------
    if (mode === "timeline") {
      const sys = fa
        ? "از متن زیر یک تایم‌لاین استخراج کن. اگر متن شامل مراحل، روند، فآیند یا توالی زمانی است (مثل رشد جنین، تاریخچه، مراحل یک پدیده)، آن را به ۳ تا ۸ گام تبدیل کن. هر گام: marker (مثلا «هفته ۴» یا «۱۹۶۹» یا «گام ۲»)، title کوتاه، description دو تا چهار جمله. اگر متن واقعاً قابل تبدیل به تایم‌لاین نیست، آرایه steps را خالی برگردان."
        : "Extract a timeline from the text. If it describes stages, a process, or a chronological sequence, return 3-8 steps. Each: marker (e.g. 'Week 4', '1969', 'Step 2'), short title, description 2-4 sentences. If text is not timeline-shaped, return empty steps.";

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
              name: "build_timeline",
              description: "Return a structured timeline.",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Optional short title for the timeline" },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        marker: { type: "string" },
                        title: { type: "string" },
                        description: { type: "string" },
                      },
                      required: ["marker", "title", "description"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["steps"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "build_timeline" } },
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
      let timeline: { title?: string; steps: Array<{ marker: string; title: string; description: string }> } = { steps: [] };
      try { timeline = JSON.parse(args ?? "{}"); } catch (_) { /* ignore */ }
      return new Response(JSON.stringify({ timeline }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sys = prompts[mode] ?? prompts.summary;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: text },
        ],
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: "محدودیت درخواست. کمی صبر کنید." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "اعتبار AI تمام شده است." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const err = await r.text();
      console.error("AI gateway", r.status, err);
      return new Response(JSON.stringify({ error: "خطای هوش مصنوعی" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ content }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
