// Edge Function: issue-book-key
// Validates ownership + enforces a per-book 2-device offline cap, then returns
// a per-(user,book,device) pepper.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_OFFLINE_DEVICES_PER_BOOK = 2;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pepperSecret = serviceKey;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const bookId = String(body.book_id ?? "").trim();
    const deviceId = String(body.device_id ?? "").trim();
    const deviceLabel = String(body.device_label ?? "").slice(0, 120) || null;
    const platform = String(body.platform ?? "").slice(0, 32) || null;

    if (!bookId || !deviceId) return json({ error: "missing_params" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // 1) Verify ownership
    const { data: ownership } = await admin
      .from("user_books").select("book_id")
      .eq("user_id", userId).eq("book_id", bookId).maybeSingle();
    let owns = !!ownership;
    if (!owns) {
      const { data: book } = await admin
        .from("books").select("id, price, publisher_id")
        .eq("id", bookId).maybeSingle();
      if (!book) return json({ error: "book_not_found" }, 404);
      if (book.publisher_id === userId || Number(book.price) === 0) owns = true;
    }
    if (!owns) return json({ error: "not_owned" }, 403);

    // 2) Enforce per-BOOK 2-device cap.
    const { data: devicesForBook } = await admin
      .from("user_offline_devices")
      .select("device_id, device_label, platform, last_seen_at, book_id")
      .eq("user_id", userId)
      .eq("book_id", bookId);
    const existing = (devicesForBook ?? []).find((d) => d.device_id === deviceId);

    if (!existing && (devicesForBook?.length ?? 0) >= MAX_OFFLINE_DEVICES_PER_BOOK) {
      return json({
        error: "device_limit_reached",
        max: MAX_OFFLINE_DEVICES_PER_BOOK,
        book_id: bookId,
        devices: devicesForBook ?? [],
      }, 409);
    }

    // 3) Upsert (user, book, device) row.
    await admin.from("user_offline_devices").upsert({
      user_id: userId,
      book_id: bookId,
      device_id: deviceId,
      device_label: deviceLabel,
      platform,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,book_id,device_id" });

    const pepper = await hmac(pepperSecret, `${userId}:${bookId}:${deviceId}`);

    return json({
      pepper,
      max_devices: MAX_OFFLINE_DEVICES_PER_BOOK,
      devices_used: (devicesForBook?.length ?? 0) + (existing ? 0 : 1),
    }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
