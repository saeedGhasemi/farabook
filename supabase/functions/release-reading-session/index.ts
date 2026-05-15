// Edge Function: release-reading-session
// Releases the active session for (user, book, device). Used on tab close /
// app background / heartbeat timeout / explicit "I'm done reading".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return j({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u.user) return j({ error: "unauthorized" }, 401);
    const userId = u.user.id;

    const body = await req.json().catch(() => ({}));
    const bookId = String(body.book_id ?? "").trim();
    const deviceId = String(body.device_id ?? "").trim();
    const reason = String(body.reason ?? "explicit").slice(0, 64);
    if (!bookId || !deviceId) return j({ error: "missing_params" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { error } = await admin
      .from("book_reading_sessions")
      .update({ released_at: new Date().toISOString(), released_reason: reason })
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .eq("device_id", deviceId)
      .is("released_at", null);
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true }, 200);
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
