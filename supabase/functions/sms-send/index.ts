// Generic SMS sender. Reads provider config from public.sms_settings (admin-managed).
// Supports: kavenegar, melipayamak, twilio, custom (HTTP POST with JSON template).
// Requires the caller to be authenticated; only admins can trigger arbitrary sends
// (used for the "test message" button). Internal/server callers can pass service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  to: string;          // mobile (any format, normalized server-side)
  message: string;
  event?: string;      // e.g. 'test', 'purchase', ...
  user_id?: string;    // optional, for logging
}

const normalize = (raw: string): string | null => {
  const s = (raw || "").replace(/\D/g, "");
  let n = s;
  if (/^0098/.test(n)) n = n.slice(2);
  if (/^98/.test(n))   n = "0" + n.slice(2);
  if (/^9/.test(n) && n.length === 10) n = "0" + n;
  return /^09\d{9}$/.test(n) ? n : null;
};

const renderTpl = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

async function sendKavenegar(cfg: any, to: string, msg: string) {
  if (!cfg.api_key) throw new Error("kavenegar_api_key_missing");
  const url = `https://api.kavenegar.com/v1/${cfg.api_key}/sms/send.json`;
  const params = new URLSearchParams({ receptor: to, message: msg });
  if (cfg.sender) params.set("sender", cfg.sender);
  const r = await fetch(`${url}?${params.toString()}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.return?.status !== 200) {
    throw new Error(`kavenegar: ${j?.return?.message || r.status}`);
  }
  return String(j?.entries?.[0]?.messageid ?? "");
}

async function sendMelipayamak(cfg: any, to: string, msg: string) {
  if (!cfg.api_username || !cfg.api_password || !cfg.sender) {
    throw new Error("melipayamak_credentials_missing");
  }
  const r = await fetch("https://rest.payamak-panel.com/api/SendSMS/SendSMS", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: cfg.api_username,
      password: cfg.api_password,
      to,
      from: cfg.sender,
      text: msg,
      isflash: "false",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j?.RetStatus && j.RetStatus !== 1)) {
    throw new Error(`melipayamak: ${j?.StrRetStatus || r.status}`);
  }
  return String(j?.Value ?? "");
}

async function sendTwilio(cfg: any, to: string, msg: string) {
  // For Twilio we expect: api_username = AccountSID, api_password = AuthToken, sender = From number
  if (!cfg.api_username || !cfg.api_password || !cfg.sender) {
    throw new Error("twilio_credentials_missing");
  }
  // Twilio expects E.164: +98XXXXXXXXXX
  const e164 = "+98" + to.replace(/^0/, "");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.api_username}/Messages.json`;
  const auth = btoa(`${cfg.api_username}:${cfg.api_password}`);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: e164, From: cfg.sender, Body: msg }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`twilio: ${j?.message || r.status}`);
  return String(j?.sid ?? "");
}

async function sendCustom(cfg: any, to: string, msg: string) {
  if (!cfg.custom_endpoint) throw new Error("custom_endpoint_missing");
  let bodyStr = cfg.custom_payload_template || JSON.stringify({ to: "{to}", message: "{message}" });
  bodyStr = renderTpl(bodyStr, { to, message: msg, sender: cfg.sender || "", api_key: cfg.api_key || "" });
  const r = await fetch(cfg.custom_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
    },
    body: bodyStr,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`custom: ${r.status} ${txt.slice(0, 200)}`);
  return txt.slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") || "";

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "super_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const phone = normalize(body.to || "");
    if (!phone) {
      return new Response(JSON.stringify({ error: "invalid_mobile" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const text = String(body.message || "").slice(0, 600);
    if (!text) {
      return new Response(JSON.stringify({ error: "empty_message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await admin.from("sms_settings").select("*").eq("id", 1).maybeSingle();
    if (!cfg || !cfg.enabled) {
      return new Response(JSON.stringify({ error: "sms_disabled" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let messageId = "";
    try {
      switch (cfg.provider) {
        case "kavenegar":   messageId = await sendKavenegar(cfg, phone, text); break;
        case "melipayamak": messageId = await sendMelipayamak(cfg, phone, text); break;
        case "twilio":      messageId = await sendTwilio(cfg, phone, text); break;
        case "custom":      messageId = await sendCustom(cfg, phone, text); break;
        default: throw new Error(`unknown_provider:${cfg.provider}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send_failed";
      await admin.from("sms_log").insert({
        user_id: body.user_id || user.id,
        phone, event: body.event || "manual",
        body: text, status: "failed", error: msg,
      });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("sms_log").insert({
      user_id: body.user_id || user.id,
      phone, event: body.event || "manual",
      body: text, status: "sent", provider_message_id: messageId,
    });

    return new Response(JSON.stringify({ ok: true, message_id: messageId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
