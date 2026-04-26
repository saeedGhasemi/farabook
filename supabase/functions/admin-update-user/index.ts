// Admin: update an existing user's email / password / display name. Super-admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "no_token" }, 401);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: me } = await userClient.auth.getUser();
    if (!me.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: me.user.id });
    if (!isSuper) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const target = String(body.user_id || "").trim();
    if (!target) return json({ error: "user_id required" }, 400);

    const updates: Record<string, unknown> = {};
    if (typeof body.password === "string" && body.password.length >= 6) updates.password = body.password;
    if (typeof body.email === "string" && body.email.includes("@")) updates.email = body.email.trim();
    if (typeof body.display_name === "string") updates.user_metadata = { display_name: body.display_name.trim() };
    if (body.confirm_email) updates.email_confirm = true;

    if (Object.keys(updates).length === 0) return json({ error: "nothing_to_update" }, 400);

    const { data, error } = await admin.auth.admin.updateUserById(target, updates as any);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, id: data.user?.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
