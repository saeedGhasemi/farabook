// word-addin-ingest
//
// Receives the cleaned AST + media from the Word taskpane,
// uploads images to the book-media bucket, replaces media://NAME
// placeholders with public URLs, creates a new books row owned by
// the authenticated publisher, and returns its id.
//
// The frontend then redirects to /edit/:bookId — same surface as the
// existing word-import flow, just one shot.

import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Media {
  name: string;
  contentType: string;
  base64: string;
}

interface Body {
  ast: { type: "doc"; content: any[] };
  media?: Media[];
  meta?: {
    sourceFileName?: string;
    diagnostics?: Record<string, unknown>;
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extOf(name: string, ct: string): string {
  const fromName = (name.split(".").pop() ?? "").toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("webp")) return "webp";
  return "bin";
}

/** Walks AST and replaces media://NAME image srcs with the uploaded URL map. */
function replaceMediaUrls(
  ast: { content: any[] },
  urls: Map<string, string>,
): { imagesReplaced: number; imagesMissing: number } {
  let replaced = 0;
  let missing = 0;
  const visit = (nodes: any[] | undefined) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (n?.type === "image" && typeof n.attrs?.src === "string") {
        const m = n.attrs.src.match(/^media:\/\/(.+)$/);
        if (m) {
          const url = urls.get(m[1]);
          if (url) {
            n.attrs.src = url;
            replaced++;
          } else {
            missing++;
          }
        }
      }
      if (Array.isArray(n?.content)) visit(n.content);
    }
  };
  visit(ast.content);
  return { imagesReplaced: replaced, imagesMissing: missing };
}

/** Splits the doc into pages, breaking before each top-level heading. */
function splitIntoPages(ast: { content: any[] }): Array<{ title: string; doc: any; level?: number }> {
  const pages: Array<{ title: string; doc: any; level?: number }> = [];
  let current: { title: string; doc: { type: "doc"; content: any[] }; level?: number } = {
    title: "صفحه ۱",
    doc: { type: "doc", content: [] },
    level: 0,
  };
  for (const node of ast.content ?? []) {
    if (node?.type === "heading" && (node.attrs?.level === 1 || node.attrs?.level === 2)) {
      const title = (node.content ?? []).map((t: any) => t.text ?? "").join("").trim() || "بدون عنوان";
      if (current.doc.content.length > 0) pages.push(current);
      current = {
        title,
        doc: { type: "doc", content: [node] },
        level: (node.attrs.level ?? 1) - 1,
      };
    } else {
      current.doc.content.push(node);
    }
  }
  if (current.doc.content.length > 0) pages.push(current);
  if (pages.length === 0) pages.push({ title: "صفحه ۱", doc: { type: "doc", content: [] }, level: 0 });
  return pages;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid_jwt" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userRes.user;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.ast || body.ast.type !== "doc" || !Array.isArray(body.ast.content)) {
    return new Response(JSON.stringify({ error: "invalid_ast" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const sourceName = body.meta?.sourceFileName ?? "Word document";
  const baseTitle = sourceName.replace(/\.docx$/i, "").trim() || "کتاب جدید";

  const { data: inserted, error: insertErr } = await admin
    .from("books")
    .insert({
      title: baseTitle,
      author: "نامشخص",
      publisher_id: user.id,
      status: "draft",
      pages: [],
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return new Response(
      JSON.stringify({ error: "create_book_failed", detail: insertErr?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const bookId: string = inserted.id;
  const folder = `${user.id}/${bookId}/word-addin`;

  const urlMap = new Map<string, string>();
  let uploaded = 0;
  let uploadFailed = 0;
  for (const m of body.media ?? []) {
    try {
      const ext = extOf(m.name, m.contentType);
      const key = `${folder}/${m.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const bytes = b64ToBytes(m.base64);
      const up = await admin.storage.from("book-media").upload(key, bytes, {
        contentType: m.contentType,
        upsert: true,
      });
      if (up.error) {
        uploadFailed++;
        console.warn("upload failed for", m.name, up.error);
        continue;
      }
      const pub = admin.storage.from("book-media").getPublicUrl(key);
      urlMap.set(m.name, pub.data.publicUrl);
      uploaded++;
      void ext;
    } catch (e) {
      uploadFailed++;
      console.warn("upload threw for", m.name, e);
    }
  }

  const { imagesReplaced, imagesMissing } = replaceMediaUrls(body.ast, urlMap);
  const pages = splitIntoPages(body.ast);

  const { error: updateErr } = await admin
    .from("books")
    .update({
      pages,
      content_version: 1,
      content_updated_at: new Date().toISOString(),
    })
    .eq("id", bookId);

  if (updateErr) {
    return new Response(
      JSON.stringify({ error: "save_pages_failed", detail: updateErr.message, bookId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      bookId,
      pages: pages.length,
      mediaUploaded: uploaded,
      mediaFailed: uploadFailed,
      imagesReplaced,
      imagesMissing,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
