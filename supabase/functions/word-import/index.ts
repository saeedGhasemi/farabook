// Edge Function: parse uploaded .docx into a structured book and insert it.
// Extracts text, headings, tables, and images (uploaded to public storage).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=deno";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Block =
  | { type: "heading"; level?: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "callout"; text: string }
  | { type: "image"; src: string; caption?: string; figureNumber?: string }
  | { type: "table"; headers: string[]; rows: string[][]; caption?: string; tableNumber?: string };

interface Page { title: string; blocks: Block[]; }

const htmlText = (s: string) =>
  s
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const dummyCitationTarget = (url: string): string | null => {
  const d = /dummy-citation\.com\/citation\?d=([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!d) return null;
  try {
    const b64 = d.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(d.length / 4) * 4, "=");
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    const work = (Array.isArray(payload) ? payload[0]?.work : payload?.work) ?? payload?.[0] ?? payload;
    return work?.url || work?.resourceUrl || (work?.ids?.doi ? `https://doi.org/${work.ids.doi}` : null);
  } catch {
    return null;
  }
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/&amp;/g, "&"));
  } catch {
    return value.replace(/&amp;/g, "&");
  }
};

const extractCitationTarget = (value: string): string | null => {
  const dummy = dummyCitationTarget(value);
  if (dummy) return dummy;

  const decoded = safeDecodeURIComponent(value);
  const directUrl = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(decoded)?.[1];
  if (directUrl) return directUrl.replace(/\\\//g, "/");

  const runs = decoded.match(/[A-Za-z0-9+/_=-]{80,}/g) ?? [];
  for (const run of runs) {
    const maxOffset = Math.min(180, run.length - 24);
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidate = run.slice(offset).replace(/-/g, "+").replace(/_/g, "/");
      try {
        const padded = candidate.padEnd(Math.ceil(candidate.length / 4) * 4, "=");
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        const url = /"(?:url|resourceUrl)"\s*:\s*"(https?:\/\/[^"\\]+)"/.exec(text)?.[1];
        if (url) return url.replace(/\\\//g, "/");
        const doi = /"doi"\s*:\s*"([^"\\]+)"/.exec(text)?.[1];
        if (doi) return `https://doi.org/${doi}`;
      } catch {
        // Try the next possible start; citation add-ins often prepend bytes.
      }
    }
  }

  return null;
};

const wrapBareUrls = (text: string): string =>
  text
    .split(/(\[[^\]\n]+\]\([^\)\s]+\))/g)
    .map((part) => {
      if (/^\[[^\]\n]+\]\([^\)\s]+\)$/.test(part)) return part;
      return part.replace(/https?:\/\/[^\s<>"'\]\)]+/g, (url) => `[Link](${url})`);
    })
    .join("");

const normalizeImportedLinks = (text: string): string => {
  const withoutCitationPayloads = text
    .replace(/(\([0-9,\s\-–—]+\))\s*((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9+/_=-]){80,})/g, (_m, label, payload) => {
      const target = extractCitationTarget(payload);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/(\([0-9,\s\-–—]+\))\s*(https:\/\/dummy-citation\.com\/citation\?d=[A-Za-z0-9_-]+)/g, (_m, label, url) => {
      const target = extractCitationTarget(url);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/(\[[^\]\n]+\]\([^)]+\))(?:%3D|=)+/gi, "$1")
    .replace(/https:\/\/dummy-citation\.com\/citation\?d=[A-Za-z0-9_-]+/g, "");
  return wrapBareUrls(withoutCitationPayloads).replace(/\s+/g, " ").trim();
};

// Convert <a href="URL">label</a> into the markdown form [label](URL) which
// the reader/editor recognize. Citation add-ins sometimes store a long
// dummy-citation URL; decode it to the real DOI/resource URL and keep the
// visible citation label instead of exposing the technical address.
const convertAnchors = (s: string): string => {
  return s.replace(
    /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q: string, href: string, inner: string) => {
      const label = htmlText(inner);
      const url = href.trim().replace(/&amp;/g, "&");
      if (!url) return label;
      if (url.startsWith("#")) return label;
      if (url.includes("dummy-citation.com/citation")) {
        const target = extractCitationTarget(url);
        if (!label || label === url || label.includes("dummy-citation.com/citation")) {
          return target ? `[${label || target}](${target})` : "";
        }
        return target ? `[${label}](${target})` : label;
      }
      const safeLabel = label || url;
      return `[${safeLabel}](${url})`;
    },
  );
};

const stripTags = (s: string) =>
  normalizeImportedLinks(htmlText(convertAnchors(s)));

// Find Persian/English figure or table label like "شکل ۹–۱" / "Figure 9.1" / "جدول ۲-۱"
const FIG_RE = /^(شکل|تصویر|نگاره|figure|fig\.?)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;
const TBL_RE = /^(جدول|table)\s*[\d\u06F0-\u06F9۰-۹]+([.\-\u2013\u2014][\d\u06F0-\u06F9۰-۹]+)?/i;

function splitLabel(text: string, re: RegExp): { label?: string; rest: string } {
  const m = text.match(re);
  if (!m) return { rest: text };
  const label = m[0].trim();
  const rest = text.slice(label.length).replace(/^[\s:–\-—.]+/, "").trim();
  return { label, rest };
}

/* Walk the produced HTML token by token in document order so images and
   tables appear in the right place inside chapters. */
function htmlToPages(html: string): Page[] {
  let cleaned = html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&nbsp;/g, " ");

  // Extract tables FIRST and replace them with placeholder tokens, so the
  // generic tokenizer below doesn't accidentally swallow `<p>` cells inside
  // tables (which would leave the outer `<table>` un-matched).
  const extractedTables: string[] = [];
  cleaned = cleaned.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    const idx = extractedTables.length;
    extractedTables.push(inner);
    return `<p>__TABLE_PLACEHOLDER_${idx}__</p>`;
  });

  // tokenize: headings, paragraphs, blockquote, lists, standalone images
  const tokenRe = /<(h1|h2|h3|h4|p|blockquote|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;

  const pages: Page[] = [];
  let cur: Page = { title: "مقدمه", blocks: [] };
  let pendingImageCaption: { fig?: string; text: string } | null = null;
  let pendingTableCaption: { tbl?: string; text: string } | null = null;

  const pushPage = () => {
    if (cur.blocks.length) pages.push(cur);
  };

  const handleParagraph = (inner: string) => {
    // 1) Extract any inline images first (preserving order)
    const imgRe = /<img[^>]*src="([^"]+)"[^>]*>/gi;
    let lastIdx = 0;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner)) !== null) {
      const before = inner.slice(lastIdx, im.index);
      const beforeText = stripTags(before);
      if (beforeText) {
        // attach as paragraph or caption depending on label
        if (FIG_RE.test(beforeText)) {
          const { label, rest } = splitLabel(beforeText, FIG_RE);
          pendingImageCaption = { fig: label, text: rest };
        } else if (TBL_RE.test(beforeText)) {
          const { label, rest } = splitLabel(beforeText, TBL_RE);
          pendingTableCaption = { tbl: label, text: rest };
        } else {
          cur.blocks.push({ type: "paragraph", text: beforeText });
        }
      }
      cur.blocks.push({
        type: "image",
        src: im[1],
        caption: pendingImageCaption?.text,
        figureNumber: pendingImageCaption?.fig,
      });
      pendingImageCaption = null;
      lastIdx = im.index + im[0].length;
    }
    const tail = stripTags(inner.slice(lastIdx));
    if (!tail) return;

    // Caption immediately after an image?
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.type === "image" && !last.caption && (FIG_RE.test(tail) || tail.length < 220)) {
      if (FIG_RE.test(tail)) {
        const { label, rest } = splitLabel(tail, FIG_RE);
        last.figureNumber = label;
        last.caption = rest;
      } else {
        last.caption = tail;
      }
      return;
    }

    if (FIG_RE.test(tail)) {
      const { label, rest } = splitLabel(tail, FIG_RE);
      pendingImageCaption = { fig: label, text: rest };
      return;
    }
    if (TBL_RE.test(tail)) {
      const { label, rest } = splitLabel(tail, TBL_RE);
      pendingTableCaption = { tbl: label, text: rest };
      return;
    }

    cur.blocks.push({ type: "paragraph", text: tail });
  };

  const handleTable = (inner: string) => {
    const rows: string[][] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(inner)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push(stripTags(cm[2]));
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return;
    const headers = rows.shift() ?? [];
    cur.blocks.push({
      type: "table",
      headers,
      rows,
      caption: pendingTableCaption?.text,
      tableNumber: pendingTableCaption?.tbl,
    });
    pendingTableCaption = null;
  };

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2];

    if (tag === "h1" || tag === "h2") {
      const text = stripTags(inner);
      if (!text) continue;
      pushPage();
      cur = { title: text.slice(0, 120), blocks: [] };
    } else if (tag === "h3" || tag === "h4") {
      const text = stripTags(inner);
      if (text) cur.blocks.push({ type: "heading", level: 3, text });
    } else if (tag === "blockquote") {
      const text = stripTags(inner);
      if (text) cur.blocks.push({ type: "quote", text });
    } else if (tag === "ul" || tag === "ol") {
      const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? [];
      items.forEach((li) => {
        const t = stripTags(li);
        if (t) cur.blocks.push({ type: "paragraph", text: "• " + t });
      });
    } else if (tag === "table") {
      handleTable(inner);
    } else {
      // p — but check for table placeholder first
      const phMatch = /^\s*__TABLE_PLACEHOLDER_(\d+)__\s*$/.exec(stripTags(inner));
      if (phMatch) {
        const tblInner = extractedTables[parseInt(phMatch[1], 10)];
        if (tblInner) handleTable(tblInner);
      } else {
        handleParagraph(inner);
      }
    }
  }
  pushPage();

  return pages.filter((p) => p.blocks.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const u = { user: { id: claims.claims.sub as string } };

    // Only publishers / admins may create books via this endpoint.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const allowedRoles = new Set(["publisher", "admin", "super_admin"]);
    const canCreate = (roleRows || []).some((r: any) => allowedRoles.has(r.role));
    if (!canCreate) {
      return new Response(
        JSON.stringify({ error: "publisher_role_required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    let path: string = body.path;
    let title: string = (body.title || "کتاب جدید").toString().slice(0, 200);
    let author: string = (body.author || "ناشناس").toString().slice(0, 120);
    let description: string = (body.description || "").toString().slice(0, 600);
    const replaceBookId: string | undefined = body.replaceBookId;
    const importId: string | undefined = body.importId;
    // Caller can opt out of image extraction (faster + lower-memory) — useful
    // as a fallback after a previous failed attempt with images.
    const skipImages: boolean = body.skipImages === true;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // If an importId is provided, hydrate path/title/author/description from
    // the saved row so the user does not have to re-upload or retype.
    if (importId) {
      const { data: imp, error: impErr } = await admin
        .from("word_imports")
        .select("user_id, file_path, title, author, description, attempt_count")
        .eq("id", importId)
        .maybeSingle();
      if (impErr || !imp) {
        return new Response(JSON.stringify({ error: "import_not_found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (imp.user_id !== u.user.id) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      path = imp.file_path;
      title = body.title || imp.title || title;
      author = body.author || imp.author || author;
      description = body.description ?? imp.description ?? description;

      await admin.from("word_imports").update({
        status: "converting",
        last_error: null,
        attempt_count: (imp.attempt_count || 0) + 1,
        title, author, description,
      }).eq("id", importId);
    }

    if (!path || typeof path !== "string") {
      return new Response(JSON.stringify({ error: "missing path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!path.startsWith(`${u.user.id}/`)) {
      return new Response(JSON.stringify({ error: "forbidden path" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper to record failure on the import row before bailing out.
    const failImport = async (msg: string) => {
      if (importId) {
        await admin.from("word_imports").update({
          status: "failed",
          last_error: msg.slice(0, 500),
        }).eq("id", importId);
      }
    };

    const { data: file, error: dlErr } = await admin.storage
      .from("book-uploads")
      .download(path);
    if (dlErr || !file) {
      const msg = dlErr?.message || "download failed";
      await failImport(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileSize = arrayBuffer.byteLength;
    // Edge runtime memory cap is around 256MB. Mammoth roughly needs 5-8x the
    // file size while parsing a docx full of images, so anything beyond ~80MB
    // risks OOM even in text-only mode. The file is already saved in storage,
    // so the user can split or re-import without re-uploading.
    const HARD_LIMIT = 80 * 1024 * 1024;
    if (fileSize > HARD_LIMIT) {
      const msg = `حجم فایل ورد (${(fileSize / 1024 / 1024).toFixed(1)} مگابایت) بیش از حد قابل پردازش است. لطفاً کتاب را به چند فایل کوچک‌تر تقسیم کنید.`;
      await failImport(msg);
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const buffer = Buffer.from(arrayBuffer);

    // Decide a stable folder for this import's images
    const folder = `${u.user.id}/${crypto.randomUUID()}`;
    let imgIdx = 0;
    let skippedImages = 0;
    // Skip embedded images larger than 4MB to keep memory bounded.
    const PER_IMAGE_LIMIT = 4 * 1024 * 1024;

    const tryConvert = async (includeImages: boolean) => {
      return await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image: any) => {
            if (!includeImages) return { src: "" };
            try {
              const ct: string = image.contentType || "image/png";
              const ext = (ct.split("/")[1] || "png").replace("jpeg", "jpg");
              const buf: Buffer = await image.read();
              if (buf.length > PER_IMAGE_LIMIT) {
                skippedImages += 1;
                return { src: "" };
              }
              imgIdx += 1;
              const key = `${folder}/img-${String(imgIdx).padStart(3, "0")}.${ext}`;
              const up = await admin.storage.from("book-media").upload(key, buf, {
                contentType: ct,
                upsert: true,
              });
              if (up.error) {
                console.warn("upload failed", up.error);
                return { src: "" };
              }
              const pub = admin.storage.from("book-media").getPublicUrl(key);
              return { src: pub.data.publicUrl };
            } catch (e) {
              console.warn("image convert error", e);
              return { src: "" };
            }
          }),
        },
      );
    };

    let result;
    try {
      result = await tryConvert(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("first pass failed, retrying without images:", msg);
      // Memory pressure or mammoth crash on images: retry text-only so the
      // user still gets the manuscript inside the editor.
      imgIdx = 0;
      try {
        result = await tryConvert(false);
      } catch (e2) {
        return new Response(
          JSON.stringify({
            error: `پردازش فایل ورد با خطا مواجه شد. احتمالاً فایل بسیار بزرگ یا پیچیده است. (${e2 instanceof Error ? e2.message : String(e2)})`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const pages = htmlToPages(result.value || "");
    if (pages.length === 0) {
      return new Response(JSON.stringify({ error: "no content extracted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the first uploaded image as the cover, if any
    let cover_url = "/placeholder.svg";
    for (const p of pages) {
      const img = p.blocks.find((b) => b.type === "image" && (b as any).src) as any;
      if (img?.src) { cover_url = img.src; break; }
    }

    let bookId: string;
    let bookTitle = title;
    if (replaceBookId) {
      const { data: upd, error: updErr } = await admin
        .from("books")
        .update({ title, author, description, cover_url, pages })
        .eq("id", replaceBookId)
        .select("id, title")
        .single();
      if (updErr || !upd) {
        return new Response(JSON.stringify({ error: updErr?.message || "update failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookId = upd.id;
      bookTitle = upd.title;
    } else {
      const { data: book, error: insErr } = await admin
        .from("books")
        .insert({
          title,
          author,
          description,
          ambient_theme: "paper",
          category: "کتاب کاربر",
          cover_url,
          price: 0,
          pages,
          publisher_id: u.user.id,
          status: "draft",
        })
        .select("id, title")
        .single();
      if (insErr || !book) {
        return new Response(JSON.stringify({ error: insErr?.message || "insert failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookId = book.id;
      bookTitle = book.title;

      await admin.from("user_books").insert({
        user_id: u.user.id,
        book_id: bookId,
        acquired_via: "upload",
        status: "unread",
      });
    }

    return new Response(
      JSON.stringify({ book: { id: bookId, title: bookTitle }, chapters: pages.length, images: imgIdx, skippedImages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
