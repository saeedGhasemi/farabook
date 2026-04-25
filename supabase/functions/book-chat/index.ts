import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface Msg { role: "user" | "assistant"; content: string }

const extractBookText = (pages: unknown): string => {
  if (!Array.isArray(pages)) return "";
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i] as Record<string, unknown>;
    const title = (p?.title as string) || `Page ${i + 1}`;
    out.push(`\n\n=== [Page ${i + 1}] ${title} ===\n`);
    const blocks = p?.blocks as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        const t = b?.type as string;
        if (t === "paragraph" || t === "heading" || t === "highlight" || t === "callout") {
          out.push(String(b.text ?? ""));
        } else if (t === "quote") {
          out.push(`"${b.text ?? ""}"${b.author ? ` — ${b.author}` : ""}`);
        } else if (t === "image" || t === "gallery" || t === "video") {
          if (b.caption) out.push(`[${t}] ${b.caption}`);
        } else if (t === "table") {
          const headers = (b.headers as string[]) ?? [];
          const rows = (b.rows as string[][]) ?? [];
          out.push(`[Table] ${headers.join(" | ")}`);
          for (const r of rows.slice(0, 30)) out.push(r.join(" | "));
        } else if (t === "timeline") {
          const steps = (b.steps as Array<Record<string, string>>) ?? [];
          for (const s of steps) out.push(`[${s.marker}] ${s.title}: ${s.description}`);
        }
      }
    } else if (typeof p?.content === "string") {
      out.push(p.content);
    }
  }
  return out.join("\n");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bookId, messages, lang = "fa" } = await req.json();
    if (!bookId || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "bookId and messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: book, error } = await supa
      .from("books")
      .select("title, author, pages")
      .eq("id", bookId)
      .maybeSingle();

    if (error) throw error;
    if (!book) {
      return new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let bookText = extractBookText(book.pages);
    // Trim very large books to avoid context overflow
    const MAX = 60000;
    if (bookText.length > MAX) bookText = bookText.slice(0, MAX) + "\n\n[...متن کتاب کوتاه شد...]";

    const fa = lang === "fa";
    const sys = fa
      ? `شما دستیار اختصاصی کتاب «${book.title}» نوشته «${book.author}» هستید.\n\nقوانین مهم:\n- فقط بر اساس متن این کتاب پاسخ بده.\n- اگر پاسخ سؤال در متن کتاب نیست، صادقانه بگو «این موضوع در این کتاب مطرح نشده است» و حدس نزن.\n- هر جا ممکن بود به شماره صفحه ارجاع بده (مثلا: «صفحه ۳»).\n- پاسخ‌ها را روان، فارسی و کوتاه بنویس مگر کاربر جزئیات بخواهد.\n\n--- متن کامل کتاب ---\n${bookText}\n--- پایان متن کتاب ---`
      : `You are the dedicated assistant for the book "${book.title}" by ${book.author}.\n\nRules:\n- Answer ONLY from the book text below.\n- If the answer is not in the book, say "This is not covered in this book" — do not guess.\n- Cite page numbers when possible (e.g. "page 3").\n- Be concise unless the user asks for detail.\n\n--- Book text ---\n${bookText}\n--- End book text ---`;

    const cleanMessages = (messages as Msg[])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-20);

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: sys }, ...cleanMessages],
        stream: true,
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: fa ? "محدودیت درخواست. کمی صبر کنید." : "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: fa ? "اعتبار AI تمام شده است." : "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const err = await r.text();
      console.error("AI gateway", r.status, err);
      return new Response(JSON.stringify({ error: fa ? "خطای هوش مصنوعی" : "AI error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(r.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("book-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
