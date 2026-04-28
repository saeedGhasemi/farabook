// Generate a single illustrative image for a book step (timeline /
// scrollytelling). Uses the Lovable AI image model, then uploads the
// resulting PNG to the user's `book-media/ai-gen/...` folder and
// returns its public URL. Charges the user's credits + logs USD cost.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  prompt: string;
  lang?: "fa" | "en";
  book_id?: string;
}

const MODEL = "google/gemini-3.1-flash-image-preview";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = (await req.json()) as ReqBody;
    const prompt = (body?.prompt || "").trim();
    const fa = body?.lang === "fa";
    if (!prompt) return new Response(JSON.stringify({ error: fa ? "متن خالی" : "Empty prompt" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Charge credits + log usage BEFORE calling AI (so failed generations
    // don't bill, we'll refund on AI failure).
    const charge = await sb.rpc("charge_ai_usage", {
      _operation: "image_gen",
      _book_id: body.book_id || null,
      _model: MODEL,
      _metadata: { prompt: prompt.slice(0, 200) },
    });
    if (charge.error) {
      const msg = charge.error.message || "";
      if (msg.includes("insufficient_credits")) {
        return new Response(JSON.stringify({ error: fa ? "اعتبار کافی ندارید" : "Insufficient credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const chargeInfo = charge.data as { cost?: number; usd?: number };
    const sbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const refund = async (reason: string) => {
      if (!chargeInfo?.cost) return;
      await sbAdmin.from("credit_transactions").insert({
        user_id: user.id,
        amount: chargeInfo.cost,
        reason: "ai_image_gen_refund",
        metadata: { reason, book_id: body.book_id || null },
      });
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) { await refund("missing_key"); throw new Error("LOVABLE_API_KEY missing"); }

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (r.status === 429) { await refund("rate_limit"); return new Response(JSON.stringify({ error: fa ? "محدودیت درخواست" : "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (r.status === 402) { await refund("ai_credits"); return new Response(JSON.stringify({ error: fa ? "اعتبار AI تمام شده" : "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (!r.ok) {
      const txt = await r.text();
      console.error("AI image", r.status, txt);
      await refund("ai_error_" + r.status);
      return new Response(JSON.stringify({ error: fa ? "خطای تولید تصویر" : "Image gen error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const imgUrl: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl?.startsWith("data:")) {
      await refund("no_image");
      return new Response(JSON.stringify({ error: fa ? "تصویری برگردانده نشد" : "No image returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const m = imgUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) { await refund("bad_data"); return new Response(JSON.stringify({ error: "bad data url" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    const mime = m[1];
    const b64 = m[2];
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "png";
    const key = `${user.id}/ai-gen/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const up = await sbAdmin.storage.from("book-media").upload(key, bin, { contentType: mime, upsert: false });
    if (up.error) {
      console.error("upload", up.error);
      await refund("upload_error");
      return new Response(JSON.stringify({ error: up.error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = sbAdmin.storage.from("book-media").getPublicUrl(key);
    return new Response(JSON.stringify({ url: pub.publicUrl, cost: chargeInfo?.cost ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("book-image-gen", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
