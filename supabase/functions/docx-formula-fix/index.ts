// Edge function: re-scan the source .docx and patch paragraphs that contain
// superscript / subscript runs or OMML formulas. Returns repaired paragraph
// text keyed by a normalized prefix of the original plain text, so the
// client can swap them in-place without re-running the full importer.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { strFromU8, unzipSync, type Unzipped } from "https://esm.sh/fflate@0.8.2?target=deno";

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

const SUP_MAP: Record<string, string> = {
  "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹",
  "+":"⁺","-":"⁻","=":"⁼","(":"⁽",")":"⁾","n":"ⁿ","i":"ⁱ",
};
const SUB_MAP: Record<string, string> = {
  "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉",
  "+":"₊","-":"₋","=":"₌","(":"₍",")":"₎",
};
const mapAll = (s: string, m: Record<string,string>): string | null => {
  let out = "";
  for (const ch of s) { const v = m[ch]; if (!v) return null; out += v; }
  return out;
};
const toSuper = (s: string) => mapAll(s, SUP_MAP) ?? `^{${s}}`;
const toSub = (s: string) => mapAll(s, SUB_MAP) ?? `_{${s}}`;

// Normalize a string the same way the client does so matches are stable
// across small whitespace / punctuation differences.
const norm = (s: string): string =>
  String(s ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30))
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function unzipFiltered(buf: Uint8Array, wanted: (name: string) => boolean): Unzipped {
  return unzipSync(buf, { filter: (f) => wanted(f.name) });
}

// --- tiny XML walker over <w:p>, <w:r>, <m:oMath> nodes ---
//
// We avoid pulling a full XML parser dep — the OOXML subset we need is
// well-structured enough that a token regex pass works reliably and is
// cheap in edge runtime memory.
interface ParaResult { plain: string; repaired: string; hasChange: boolean }

function extractRunText(runXml: string): string {
  // Pull every <w:t ...>...</w:t> in order.
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(runXml)) !== null) parts.push(m[1]);
  return parts.join("").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}

function omathToText(xml: string): string {
  // crude OMML → TeX-ish: join every <m:t> text in document order.
  const parts: string[] = [];
  const re = /<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  const txt = parts.join("").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
  return txt;
}

function processParagraph(pXml: string): ParaResult {
  let plain = "";
  let repaired = "";
  let hasChange = false;

  // Walk every direct token: <w:r>...</w:r> or <m:oMath>...</m:oMath>
  const tokenRe = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>|<m:oMath(?:Para)?(?:\s[^>]*)?>[\s\S]*?<\/m:oMath(?:Para)?>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pXml)) !== null) {
    const tok = m[0];
    if (tok.startsWith("<m:")) {
      const tex = omathToText(tok);
      if (tex) {
        plain += tex;
        repaired += `$${tex}$`;
        hasChange = true;
      }
      continue;
    }
    const text = extractRunText(tok);
    if (!text) continue;
    plain += text;
    // Look for <w:vertAlign w:val="superscript|subscript"/> inside this run's rPr
    const va = /<w:vertAlign\s+w:val="(superscript|subscript)"\s*\/>/.exec(tok);
    if (va) {
      repaired += va[1] === "superscript" ? toSuper(text) : toSub(text);
      hasChange = true;
    } else {
      repaired += text;
    }
  }
  return { plain: plain.trim(), repaired: repaired.trim(), hasChange };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      console.error("[docx-formula-fix] auth failed", userErr);
      return json(401, { error: "unauthorized", detail: userErr?.message });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const bookId: string = body.bookId;
    const importId: string | undefined = body.importId;
    if (!bookId) return json(400, { error: "missing_bookId" });

    const { data: bookRow, error: bookErr } = await admin.from("books").select("id, publisher_id").eq("id", bookId).maybeSingle();
    if (bookErr) { console.error("[docx-formula-fix] book lookup", bookErr); return json(500, { error: "book_lookup_failed", detail: bookErr.message }); }
    if (!bookRow) return json(404, { error: "book_not_found" });
    if (bookRow.publisher_id !== userId) return json(403, { error: "forbidden" });

    let filePath: string | null = null;
    if (importId) {
      const { data: imp } = await admin.from("word_imports").select("file_path, user_id").eq("id", importId).maybeSingle();
      if (!imp || imp.user_id !== userId) return json(404, { error: "import_not_found" });
      filePath = imp.file_path;
    } else {
      const { data: imp } = await admin.from("word_imports").select("file_path")
        .eq("book_id", bookId).eq("user_id", userId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      filePath = imp?.file_path ?? null;
    }
    if (!filePath) return json(400, { error: "no_source_docx" });

    const dl = await admin.storage.from("book-uploads").download(filePath);
    if (dl.error || !dl.data) {
      console.error("[docx-formula-fix] download failed", dl.error);
      return json(404, { error: "source_missing", detail: dl.error?.message });
    }
    const buf = new Uint8Array(await dl.data.arrayBuffer());

    let files: Unzipped;
    try {
      files = await unzipFiltered(buf, (n) => n === "word/document.xml");
    } catch (e) {
      console.error("[docx-formula-fix] unzip failed", e);
      return json(500, { error: "unzip_failed", detail: String((e as any)?.message ?? e) });
    }
    const xmlBytes = files["word/document.xml"];
    if (!xmlBytes) return json(500, { error: "no_document_xml" });
    const xml = strFromU8(xmlBytes);

    const entries: Array<{ key: string; plain: string; repaired: string }> = [];
    const pRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const r = processParagraph(m[0]);
      if (!r.hasChange || !r.plain || r.plain.length < 2) continue;
      entries.push({
        key: norm(r.plain).slice(0, 160),
        plain: r.plain,
        repaired: r.repaired,
      });
    }

    return json(200, { entries });
  } catch (e) {
    console.error("[docx-formula-fix] crash", e);
    return json(500, { error: String((e as any)?.message ?? e), stack: String((e as any)?.stack ?? "") });
  }
});
