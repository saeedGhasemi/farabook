// word-addin-ingest
//
// Receives the cleaned AST from the wizard. Two modes:
//   1) Create new book (default).
//   2) Replace existing book content (when body.replaceBookId is set).
//
// Media: prefer `mediaUrlMap` (Record<storageName, publicUrl>) — the wizard
// already uploaded optimized images to the book-media bucket. We also still
// accept legacy `media` (base64) for backward compatibility with old clients.
//
// Metadata: full BookMetadata shape (title/subtitle/author/contributors/
// publisher/isbn/etc.) is persisted to the books row and user_books is
// populated for the owner.

import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LegacyMedia { name: string; contentType: string; base64: string }

interface MetaPayload {
  sourceFileName?: string;
  diagnostics?: Record<string, unknown>;
  printStartPage?: number;
  metadata?: {
    title?: string;
    subtitle?: string;
    description?: string | null;
    book_type?: string;
    contributors?: Array<{ name: string; role: string; user_id?: string | null }>;
    publisher?: string | null;
    publication_year?: number | null;
    edition?: string | null;
    isbn?: string | null;
    page_count?: number | null;
    language?: string | null;
    original_title?: string | null;
    original_language?: string | null;
    categories?: string[];
    subjects?: string[];
    series_name?: string | null;
    series_index?: number | null;
  };
}

interface Body {
  ast: { type: "doc"; content: any[] };
  /** Preferred: storageName → public URL. */
  mediaUrlMap?: Record<string, string>;
  /** Legacy fallback: inline base64 media. */
  media?: LegacyMedia[];
  replaceBookId?: string | null;
  meta?: MetaPayload;
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

/** Walks AST and replaces media://NAME image srcs using the URL map. */
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
          if (url) { n.attrs.src = url; replaced++; } else { missing++; }
        }
      }
      if (Array.isArray(n?.content)) visit(n.content);
    }
  };
  visit(ast.content);
  return { imagesReplaced: replaced, imagesMissing: missing };
}

/** Shift every existing `print_page` node by the offset that aligns the first
 *  marker with `startPage`. If no markers exist but startPage > 0, insert a
 *  single marker at the very beginning so the reader at least shows the
 *  starting page label. */
function applyPrintStartPage(ast: { content: any[] }, startPage: number): void {
  if (!startPage || startPage < 1) return;
  const markers: any[] = [];
  for (const n of ast.content ?? []) {
    if (n?.type === "print_page") markers.push(n);
  }
  if (markers.length === 0) {
    ast.content.unshift({ type: "print_page", attrs: { number: String(startPage) } });
    return;
  }
  const firstNum = Number(markers[0]?.attrs?.number);
  const base = Number.isFinite(firstNum) ? firstNum : 1;
  const offset = startPage - base;
  if (offset === 0) return;
  for (const n of markers) {
    const cur = Number(n.attrs?.number);
    if (Number.isFinite(cur)) {
      n.attrs = { ...(n.attrs ?? {}), number: String(cur + offset) };
    }
  }
}

/** Splits the doc into pages, breaking before every heading (H1..H8) so
 *  the full chapter tree is visible in the editor sidebar, not just H1/H2. */
function splitIntoPages(ast: { content: any[] }): Array<{ title: string; doc: any; level?: number }> {
  const pages: Array<{ title: string; doc: any; level?: number }> = [];
  let current: { title: string; doc: { type: "doc"; content: any[] }; level?: number } = {
    title: "صفحه ۱",
    doc: { type: "doc", content: [] },
    level: 0,
  };
  for (const node of ast.content ?? []) {
    const lv = node?.type === "heading" ? Number(node.attrs?.level) : 0;
    if (lv >= 1 && lv <= 8) {
      const title = (node.content ?? []).map((t: any) => t.text ?? "").join("").trim() || "بدون عنوان";
      if (current.doc.content.length > 0) pages.push(current);
      current = {
        title,
        doc: { type: "doc", content: [node] },
        level: Math.min(7, Math.max(0, lv - 1)),
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
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid_jwt" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userRes.user;

  let body: Body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.ast || body.ast.type !== "doc" || !Array.isArray(body.ast.content)) {
    return new Response(JSON.stringify({ error: "invalid_ast" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const sourceName = body.meta?.sourceFileName ?? "Word document";
  const metaIn = body.meta?.metadata ?? {};
  const wordTitle = metaIn.title?.trim();
  const baseTitle = wordTitle || sourceName.replace(/\.docx$/i, "").trim() || "کتاب جدید";

  // Author display (legacy `author` column on books) from contributors
  const firstAuthor = (metaIn.contributors ?? []).find(
    (c) => (c.role === "author" || c.role === "coauthor") && c.name?.trim(),
  );
  const authorDisplay = firstAuthor?.name?.trim() || "نامشخص";

  // Verify replaceBookId ownership when present
  let bookId: string;
  if (body.replaceBookId) {
    const { data: existing, error: chkErr } = await admin
      .from("books")
      .select("id, publisher_id")
      .eq("id", body.replaceBookId)
      .maybeSingle();
    if (chkErr || !existing) {
      return new Response(JSON.stringify({ error: "book_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (existing.publisher_id && existing.publisher_id !== user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    bookId = body.replaceBookId;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("books")
      .insert({
        title: baseTitle,
        subtitle: metaIn.subtitle?.trim() || null,
        author: authorDisplay,
        publisher_id: user.id,
        status: "draft",
        description: metaIn.description ?? null,
        metadata: metaIn as any,
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
    bookId = inserted.id;

    // Add to owner's library (idempotent)
    await admin.from("user_books").upsert(
      { user_id: user.id, book_id: bookId, acquired_via: "publisher" },
      { onConflict: "user_id,book_id" },
    );
  }

  // Build url map: prefer mediaUrlMap; for legacy media[], upload then map.
  const urlMap = new Map<string, string>();
  let uploaded = 0;
  let uploadFailed = 0;
  if (body.mediaUrlMap) {
    for (const [k, v] of Object.entries(body.mediaUrlMap)) {
      if (typeof v === "string") urlMap.set(k, v);
    }
  }
  if (body.media?.length) {
    const folder = `${user.id}/${bookId}/word-addin`;
    for (const m of body.media) {
      try {
        const ext = extOf(m.name, m.contentType);
        const key = `${folder}/${m.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const bytes = b64ToBytes(m.base64);
        const up = await admin.storage.from("book-media").upload(key, bytes, {
          contentType: m.contentType, upsert: true,
        });
        if (up.error) { uploadFailed++; continue; }
        const pub = admin.storage.from("book-media").getPublicUrl(key);
        urlMap.set(m.name, pub.data.publicUrl);
        uploaded++;
        void ext;
      } catch { uploadFailed++; }
    }
  }

  const { imagesReplaced, imagesMissing } = replaceMediaUrls(body.ast, urlMap);
  const pages = splitIntoPages(body.ast);

  const updatePayload: Record<string, unknown> = {
    pages,
    content_version: 1,
    content_updated_at: new Date().toISOString(),
  };
  if (body.replaceBookId) {
    // On re-convert, also refresh title/subtitle/metadata if user changed them
    updatePayload.title = baseTitle;
    updatePayload.subtitle = metaIn.subtitle?.trim() || null;
    updatePayload.author = authorDisplay;
    updatePayload.description = metaIn.description ?? null;
    updatePayload.metadata = metaIn as any;
  }

  const { error: updateErr } = await admin.from("books").update(updatePayload).eq("id", bookId);
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
      printStartPage: body.meta?.printStartPage ?? 1,
      mode: body.replaceBookId ? "replace" : "create",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
