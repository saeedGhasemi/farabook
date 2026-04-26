// Admin: create a new user (super-admin only). Requires JWT.
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
    const { data: isAdmin } = await admin.rpc("is_super_admin", { _user_id: me.user.id });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const display_name = String(body.display_name || "").trim();
    const roles: string[] = Array.isArray(body.roles) ? body.roles : ["user"];
    const credits = Number(body.credits || 0);

    if (!email || password.length < 6) return json({ error: "invalid_input" }, 400);

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name || email.split("@")[0] },
    });
    if (cErr || !created.user) return json({ error: cErr?.message || "create_failed" }, 400);

    const uid = created.user.id;
    for (const r of roles) {
      await admin.from("user_roles").upsert({ user_id: uid, role: r }, { onConflict: "user_id,role" });
    }
    if (credits > 0) {
      await admin.from("credit_transactions").insert({
        user_id: uid,
        amount: credits,
        reason: "admin_create_user",
        created_by: me.user.id,
      });
    }
    return json({ ok: true, id: uid, email });
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
