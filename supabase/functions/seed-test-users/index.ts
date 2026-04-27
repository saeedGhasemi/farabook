// Seed test users (idempotent). Call with header `x-seed-secret` matching SEED_SECRET if set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-seed-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Hard gate: caller must present the SEED_SECRET. If the secret is
  // not configured at all, we refuse to run rather than fall open.
  const expected = Deno.env.get("SEED_SECRET");
  const provided = req.headers.get("x-seed-secret") || "";
  if (!expected || provided.length === 0 || provided !== expected) {
    return new Response(
      JSON.stringify({ error: "forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const seedUsers = [
    { email: "user1@test.com", password: "Test1234!", display_name: "کاربر تست ۱", roles: ["user"], credits: 100 },
    { email: "user2@test.com", password: "Test1234!", display_name: "کاربر تست ۲", roles: ["user"], credits: 50 },
    { email: "publisher1@test.com", password: "Test1234!", display_name: "ناشر تست", roles: ["user", "publisher"], trustedPublisher: true, credits: 200 },
    { email: "editor1@test.com", password: "Test1234!", display_name: "ادیتور تست", roles: ["user", "editor"], credits: 30 },
  ];

  const results: any[] = [];

  for (const u of seedUsers) {
    // create or fetch
    let userId: string | null = null;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { display_name: u.display_name },
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      // already exists -> look it up and RESET password to seed value
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list?.users.find((x) => x.email === u.email);
      userId = found?.id ?? null;
      if (!userId) {
        results.push({ email: u.email, error: cErr?.message || "not found" });
        continue;
      }
      // Force-reset password & confirm email so seed creds always work
      await admin.auth.admin.updateUserById(userId, {
        password: u.password,
        email_confirm: true,
        user_metadata: { display_name: u.display_name },
      });
    }

    // assign roles
    for (const r of u.roles) {
      await admin.from("user_roles").upsert(
        { user_id: userId, role: r as any },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    }

    // publisher profile if needed
    if (u.roles.includes("publisher")) {
      const slug = u.email.split("@")[0];
      await admin
        .from("publisher_profiles")
        .upsert(
          {
            user_id: userId,
            display_name: u.display_name,
            slug,
            bio: "ناشر آزمایشی برای دموی سامانه",
            theme: "paper",
            is_trusted: !!u.trustedPublisher,
            is_active: true,
          },
          { onConflict: "user_id" },
        );
    }

    // give starter credits (idempotent: skip if already seeded)
    const { data: existingTx } = await admin
      .from("credit_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", "seed_starter_credits")
      .limit(1);
    if (!existingTx || existingTx.length === 0) {
      await admin.from("credit_transactions").insert({
        user_id: userId,
        amount: u.credits ?? 100,
        reason: "seed_starter_credits",
      });
    }

    results.push({ email: u.email, password: u.password, id: userId, roles: u.roles });
  }

  return new Response(JSON.stringify({ ok: true, users: results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
