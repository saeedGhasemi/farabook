// Edge function: extract images from a previously-uploaded .docx in storage
// and place them into image_placeholder slots of an existing book.
//
// Body: { bookId: string, importId?: string, batchSize?: number, startSlot?: number }
//
// Memory-safe strategy:
//  1) Compute the list of slots to process for this batch FIRST (without unzipping).
//  2) Use streaming `unzip` and only inflate the specific media files needed
//     for this batch (plus the rels/content-types XML). This avoids decompressing
//     all 100+ images at once which blows the 256MB edge function limit.
//  3) Skip vector formats browsers cannot render (.emf, .wmf) — record as failure
//     so the UI can show them but never retry forever.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { strFromU8, unzip, type Unzipped } from "https://esm.sh/fflate@0.8.2?target=deno";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PER_IMAGE_HARD_LIMIT = 6 * 1024 * 1024; // 6MB upload cap
const UNRENDERABLE_EXT = new Set(["emf", "wmf"]); // vector formats browsers cannot show

// Promisified streaming unzip with file filter — only inflates files matching `wanted`.
function unzipFiltered(buf: Uint8Array, wanted: (name: string) => boolean): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(buf, { filter: (f) => wanted(f.name) }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json(401, { error: "unauthorized" });
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const bookId: string = body.bookId;
    const importId: string | undefined = body.importId;
    const batchSize: number = Math.min(40, Math.max(1, Number(body.batchSize) || 15));
    const startSlot: number = Math.max(0, Number(body.startSlot) || 0);

    if (!bookId) return json(400, { error: "missing bookId" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: bookRow, error: bookErr } = await admin
      .from("books")
      .select("id, publisher_id, pages")
      .eq("id", bookId)
      .maybeSingle();
    if (bookErr || !bookRow) return json(404, { error: "book_not_found" });
    if (bookRow.publisher_id !== userId) return json(403, { error: "forbidden" });

    let filePath: string | null = null;
    if (importId) {
      const { data: imp } = await admin
        .from("word_imports")
        .select("file_path, user_id")
        .eq("id", importId)
        .maybeSingle();
      if (!imp || imp.user_id !== userId) return json(404, { error: "import_not_found" });
      filePath = imp.file_path;
    } else {
      const { data: imp } = await admin
        .from("word_imports")
        .select("file_path")
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      filePath = imp?.file_path ?? null;
    }
    if (!filePath) return json(400, { error: "no_source_docx" });

    // Walk pages.blocks and find image_placeholder nodes that still need images.
    const pagesArr: any[] = Array.isArray(bookRow.pages) ? bookRow.pages : [];

    type Slot = {
      pageIdx: number;
      blockIdx: number;
      slot: number;
      originalPath: string;
    };
    const allSlots: Slot[] = [];
    for (let pi = 0; pi < pagesArr.length; pi++) {
      const blocks = pagesArr[pi]?.blocks;
      if (!Array.isArray(blocks)) continue;
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b?.type === "image_placeholder" && b.originalPath && !b.pendingSrc) {
          allSlots.push({
            pageIdx: pi,
            blockIdx: bi,
            slot: Number(b.slot || 0),
            originalPath: String(b.originalPath),
          });
        }
      }
    }

    const totalSlots = allSlots.length;
    const remaining = allSlots.filter((s) => s.slot > startSlot);
    const batch = remaining.slice(0, batchSize);

    if (batch.length === 0) {
      return json(200, {
        done: true,
        totalSlots,
        processed: 0,
        filled: 0,
        failures: [],
        nextStartSlot: null,
      });
    }

    // Download the original docx
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from("book-uploads")
      .download(filePath);
    if (dlErr || !fileBlob) return json(400, { error: dlErr?.message || "download failed" });

    const ab = await fileBlob.arrayBuffer();
    const zipBytes = new Uint8Array(ab);

    // Build set of media file names this batch actually needs (skip unrenderable).
    const wantedMedia = new Set<string>();
    for (const s of batch) {
      const ext = (s.originalPath.split(".").pop() || "").toLowerCase();
      if (UNRENDERABLE_EXT.has(ext)) continue;
      wantedMedia.add(s.originalPath.toLowerCase());
    }

    // Streaming unzip — only inflate the specific files we need.
    const files = await unzipFiltered(zipBytes, (name) => {
      if (name === "word/_rels/document.xml.rels") return true;
      if (name === "[Content_Types].xml") return true;
      return wantedMedia.has(name.toLowerCase());
    });

    const ctXml = files["[Content_Types].xml"]
      ? strFromU8(files["[Content_Types].xml"]) : "";

    const ctMap = new Map<string, string>();
    for (const m of ctXml.matchAll(/<Default\b[^>]*Extension=["']([^"']+)["'][^>]*ContentType=["']([^"']+)["'][^>]*\/>/gi)) {
      ctMap.set(m[1].toLowerCase(), m[2]);
    }

    const mediaByPath = new Map<string, Uint8Array>();
    for (const key of Object.keys(files)) {
      if (/^word\/media\//i.test(key)) mediaByPath.set(key.toLowerCase(), files[key]);
    }

    const updateDocNode = (page: any, blockIdx: number, mut: (n: any) => void) => {
      const docContent = page?.doc?.content;
      if (!Array.isArray(docContent)) return;
      let domI = -1;
      let plIdx = -1;
      for (let i = 0; i < docContent.length; i++) {
        if (docContent[i]?.type === "image_placeholder") {
          plIdx += 1;
          if (plIdx === blockIdx) { domI = i; break; }
        }
      }
      if (domI === -1) {
        const targetSlot = Number(page.blocks?.[blockIdx]?.slot || 0);
        for (let i = 0; i < docContent.length; i++) {
          const n = docContent[i];
          if (n?.type === "image_placeholder" && Number(n.attrs?.slot || 0) === targetSlot) {
            domI = i; break;
          }
        }
      }
      if (domI >= 0) mut(docContent[domI]);
    };

    const failures: { slot: number; reason: string; originalPath: string }[] = [];
    let filled = 0;

    const folder = `${userId}/${bookId}/auto-fill`;

    for (const sl of batch) {
      const ext = (sl.originalPath.split(".").pop() || "png").toLowerCase().replace("jpeg", "jpg");

      if (UNRENDERABLE_EXT.has(ext)) {
        failures.push({
          slot: sl.slot,
          reason: `unsupported_format: .${ext} (cannot display in browser — please replace manually)`,
          originalPath: sl.originalPath,
        });
        // Mark placeholder so UI shows the issue
        const page = pagesArr[sl.pageIdx];
        const block = page?.blocks?.[sl.blockIdx];
        if (block) {
          block.reason = `unsupported_${ext}`;
          block.unsupported = true;
        }
        updateDocNode(page, sl.blockIdx, (node) => {
          node.attrs = node.attrs || {};
          node.attrs.reason = `unsupported_${ext}`;
          node.attrs.unsupported = true;
        });
        continue;
      }

      const norm = sl.originalPath.toLowerCase();
      const data = mediaByPath.get(norm);
      if (!data) {
        failures.push({ slot: sl.slot, reason: "media_missing", originalPath: sl.originalPath });
        continue;
      }
      if (data.byteLength > PER_IMAGE_HARD_LIMIT) {
        failures.push({ slot: sl.slot, reason: "too_large", originalPath: sl.originalPath });
        continue;
      }
      const ct = ctMap.get(ext) || (
        ext === "png" ? "image/png" :
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
        ext === "gif" ? "image/gif" :
        ext === "webp" ? "image/webp" :
        ext === "svg" ? "image/svg+xml" :
        "application/octet-stream"
      );
      const key = `${folder}/slot-${String(sl.slot).padStart(4, "0")}.${ext}`;
      const up = await admin.storage.from("book-media").upload(
        key, Buffer.from(data), { contentType: ct, upsert: true },
      );
      if (up.error) {
        failures.push({ slot: sl.slot, reason: `upload_failed: ${up.error.message}`, originalPath: sl.originalPath });
        continue;
      }
      const pub = admin.storage.from("book-media").getPublicUrl(key);
      const url = pub.data.publicUrl;

      const page = pagesArr[sl.pageIdx];
      if (!page) continue;
      const block = page.blocks?.[sl.blockIdx];
      if (block && block.type === "image_placeholder") {
        block.pendingSrc = url;
        block.bytes = data.byteLength;
        block.contentType = ct;
        block.reason = "auto_filled";
      }
      updateDocNode(page, sl.blockIdx, (node) => {
        node.attrs = node.attrs || {};
        node.attrs.pendingSrc = url;
        node.attrs.bytes = data.byteLength;
        node.attrs.contentType = ct;
        node.attrs.reason = "auto_filled";
      });
      filled += 1;
    }

    const { error: updErr } = await admin
      .from("books")
      .update({ pages: pagesArr })
      .eq("id", bookId);
    if (updErr) return json(500, { error: updErr.message });

    const lastSlotInBatch = batch[batch.length - 1].slot;
    const stillRemaining = allSlots.some((s) => s.slot > lastSlotInBatch);

    return json(200, {
      done: !stillRemaining,
      totalSlots,
      processed: batch.length,
      filled,
      failures,
      nextStartSlot: stillRemaining ? lastSlotInBatch : null,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
