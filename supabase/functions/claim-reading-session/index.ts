// Edge Function: claim-reading-session
// Releases any active reading session for (user, book) and creates a fresh one
// for the requesting device. Returns the previous device (if any) so the caller
// can show "stolen from device X" UX.
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
    const deviceLabel = String(body.device_label ?? "").slice(0, 120) || null;
    if (!bookId || !deviceId) return j({ error: "missing_params" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Find any active session for this user+book.
    const { data: active } = await admin
      .from("book_reading_sessions")
      .select("id, device_id, device_label")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .is("released_at", null);

    let previous: { device_id: string; device_label: string | null } | null = null;
    if (active && active.length) {
      const sameDevice = active.find((a) => a.device_id === deviceId);
      const others = active.filter((a) => a.device_id !== deviceId);
      if (others.length) {
        previous = { device_id: others[0].device_id, device_label: others[0].device_label };
        await admin
          .from("book_reading_sessions")
          .update({ released_at: new Date().toISOString(), released_reason: "claimed_by_other_device" })
          .in("id", others.map((o) => o.id));
      }
      if (sameDevice) {
        // Refresh heartbeat and return existing session.
        await admin
          .from("book_reading_sessions")
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq("id", sameDevice.id);
        return j({ session_id: sameDevice.id, previous_device: previous }, 200);
      }
    }

    const { data: created, error: ce } = await admin
      .from("book_reading_sessions")
      .insert({ user_id: userId, book_id: bookId, device_id: deviceId, device_label: deviceLabel })
      .select("id")
      .single();
    if (ce) return j({ error: ce.message }, 500);

    return j({ session_id: created.id, previous_device: previous }, 200);
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
