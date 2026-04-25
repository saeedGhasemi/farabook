import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Image as ImageIcon, Video, Layers, Type, ArrowUp, ArrowDown, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type BlockDraft =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "slideshow"; images: { src: string; caption?: string }[]; autoplay?: boolean }
  | { kind: "video"; src: string; caption?: string }
  | { kind: "scrollytelling"; title?: string; steps: { marker?: string; title: string; description: string; image?: string; video?: string }[] };

interface PageDraft {
  title: string;
  blocks: BlockDraft[];
}

const newPage = (): PageDraft => ({ title: "فصل جدید", blocks: [{ kind: "paragraph", text: "" }] });

export const ManualBuilder = ({ onCreated }: { onCreated: (id: string) => void }) => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageDraft[]>([newPage()]);
  const [busy, setBusy] = useState(false);

  /* ---------- helpers ---------- */
  const updatePage = (pi: number, patch: Partial<PageDraft>) => {
    setPages((ps) => ps.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  };
  const updateBlock = (pi: number, bi: number, patch: Partial<BlockDraft>) => {
    setPages((ps) =>
      ps.map((p, i) =>
        i === pi
          ? { ...p, blocks: p.blocks.map((b, j) => (j === bi ? ({ ...b, ...patch } as BlockDraft) : b)) }
          : p,
      ),
    );
  };
  const addBlock = (pi: number, kind: BlockDraft["kind"]) => {
    let block: BlockDraft;
    switch (kind) {
      case "heading": block = { kind, text: "" }; break;
      case "paragraph": block = { kind, text: "" }; break;
      case "slideshow": block = { kind, images: [], autoplay: true }; break;
      case "video": block = { kind, src: "", caption: "" }; break;
      case "scrollytelling": block = { kind, title: "", steps: [{ marker: "مرحله ۱", title: "", description: "" }] }; break;
    }
    setPages((ps) => ps.map((p, i) => (i === pi ? { ...p, blocks: [...p.blocks, block] } : p)));
  };
  const removeBlock = (pi: number, bi: number) => {
    setPages((ps) => ps.map((p, i) => (i === pi ? { ...p, blocks: p.blocks.filter((_, j) => j !== bi) } : p)));
  };
  const moveBlock = (pi: number, bi: number, dir: -1 | 1) => {
    setPages((ps) =>
      ps.map((p, i) => {
        if (i !== pi) return p;
        const arr = [...p.blocks];
        const j = bi + dir;
        if (j < 0 || j >= arr.length) return p;
        [arr[bi], arr[j]] = [arr[j], arr[bi]];
        return { ...p, blocks: arr };
      }),
    );
  };

  /* ---------- upload helper ---------- */
  const uploadToBucket = async (file: File, prefix = "manual"): Promise<string | null> => {
    if (!user) return null;
    const ext = file.name.split(".").pop() || "jpg";
    const key = `${user.id}/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("book-media").upload(key, file, {
      contentType: file.type, upsert: false,
    });
    if (error) { toast.error(error.message); return null; }
    const { data } = supabase.storage.from("book-media").getPublicUrl(key);
    return data.publicUrl;
  };

  /* ---------- submit ---------- */
  const submit = async () => {
    if (!user) { nav("/auth"); return; }
    if (!title.trim()) { toast.error(lang === "fa" ? "عنوان لازم است" : "Title required"); return; }
    setBusy(true);
    try {
      let coverUrl = "/placeholder.svg";
      if (coverFile) {
        const url = await uploadToBucket(coverFile, "covers");
        if (url) coverUrl = url;
      }

      // Convert drafts → DB blocks
      const dbPages = pages.map((p) => ({
        title: p.title || "—",
        blocks: p.blocks
          .map((b) => {
            switch (b.kind) {
              case "heading": return b.text.trim() ? { type: "heading", text: b.text } : null;
              case "paragraph": return b.text.trim() ? { type: "paragraph", text: b.text } : null;
              case "slideshow":
                return b.images.length
                  ? { type: "slideshow", images: b.images, autoplay: b.autoplay !== false, interval: 4500 }
                  : null;
              case "video":
                return b.src.trim() ? { type: "video", src: b.src, caption: b.caption } : null;
              case "scrollytelling":
                return b.steps.some((s) => s.title || s.description)
                  ? { type: "scrollytelling", title: b.title, steps: b.steps.filter((s) => s.title || s.description) }
                  : null;
            }
          })
          .filter(Boolean),
      })).filter((p) => p.blocks.length > 0);

      if (!dbPages.length) {
        toast.error(lang === "fa" ? "حداقل یک بلوک با محتوا اضافه کنید" : "Add at least one block");
        setBusy(false); return;
      }

      // Find first image as cover fallback
      if (coverUrl === "/placeholder.svg") {
        for (const p of dbPages) {
          for (const b of p.blocks as Array<{ type: string; src?: string; images?: { src: string }[] }>) {
            if (b.type === "slideshow" && b.images?.[0]?.src) { coverUrl = b.images[0].src; break; }
          }
          if (coverUrl !== "/placeholder.svg") break;
        }
      }

      const { data: book, error: insErr } = await supabase
        .from("books")
        .insert({
          title,
          author: author || (lang === "fa" ? "ناشناس" : "Unknown"),
          description,
          ambient_theme: "paper",
          category: lang === "fa" ? "کتاب کاربر" : "User book",
          cover_url: coverUrl,
          price: 0,
          pages: dbPages,
        })
        .select("id")
        .single();
      if (insErr || !book) throw insErr || new Error("insert failed");

      await supabase.from("user_books").insert({
        user_id: user.id,
        book_id: book.id,
        acquired_via: "upload",
        status: "unread",
      });

      toast.success(lang === "fa" ? "کتاب ساخته شد" : "Book created");
      onCreated(book.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- block editors ---------- */
  const BlockEditor = ({ b, pi, bi }: { b: BlockDraft; pi: number; bi: number }) => {
    const Header = (
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {b.kind}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => moveBlock(pi, bi, -1)} className="p-1 rounded hover:bg-foreground/5" aria-label="up"><ArrowUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => moveBlock(pi, bi, 1)} className="p-1 rounded hover:bg-foreground/5" aria-label="down"><ArrowDown className="w-3.5 h-3.5" /></button>
          <button onClick={() => removeBlock(pi, bi)} className="p-1 rounded hover:bg-destructive/10 text-destructive" aria-label="remove"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    );

    if (b.kind === "heading") {
      return (
        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-glass-border">
          {Header}
          <Input value={b.text} onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
            placeholder={lang === "fa" ? "عنوان زیربخش" : "Subheading"} />
        </div>
      );
    }
    if (b.kind === "paragraph") {
      return (
        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-glass-border">
          {Header}
          <Textarea value={b.text} onChange={(e) => updateBlock(pi, bi, { text: e.target.value })}
            rows={4} placeholder={lang === "fa" ? "متن پاراگراف…" : "Paragraph text…"} />
        </div>
      );
    }
    if (b.kind === "slideshow") {
      return (
        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-glass-border space-y-2">
          {Header}
          <input type="file" accept="image/*" multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              const uploaded: { src: string; caption?: string }[] = [];
              for (const f of files) {
                const url = await uploadToBucket(f, "slides");
                if (url) uploaded.push({ src: url, caption: "" });
              }
              updateBlock(pi, bi, { images: [...b.images, ...uploaded] });
              e.target.value = "";
            }}
            className="block text-sm" />
          {b.images.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
              {b.images.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img src={img.src} alt="" className="w-full h-20 object-cover rounded-lg" />
                  <button
                    onClick={() => updateBlock(pi, bi, { images: b.images.filter((_, k) => k !== idx) })}
                    className="absolute top-1 end-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                    aria-label="remove image"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <Input
                    value={img.caption || ""}
                    onChange={(e) => updateBlock(pi, bi, {
                      images: b.images.map((x, k) => k === idx ? { ...x, caption: e.target.value } : x),
                    })}
                    placeholder={lang === "fa" ? "زیرنویس" : "Caption"}
                    className="mt-1 h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={b.autoplay !== false}
              onChange={(e) => updateBlock(pi, bi, { autoplay: e.target.checked })} />
            {lang === "fa" ? "پخش خودکار" : "Autoplay"}
          </label>
        </div>
      );
    }
    if (b.kind === "video") {
      return (
        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-glass-border space-y-2">
          {Header}
          <Input value={b.src} onChange={(e) => updateBlock(pi, bi, { src: e.target.value })}
            placeholder={lang === "fa" ? "لینک YouTube/Vimeo یا MP4" : "YouTube/Vimeo URL or MP4 link"} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{lang === "fa" ? "یا آپلود:" : "or upload:"}</span>
            <input type="file" accept="video/*"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const url = await uploadToBucket(f, "videos");
                if (url) updateBlock(pi, bi, { src: url });
                e.target.value = "";
              }} className="text-sm flex-1" />
          </div>
          <Input value={b.caption || ""} onChange={(e) => updateBlock(pi, bi, { caption: e.target.value })}
            placeholder={lang === "fa" ? "زیرنویس (اختیاری)" : "Caption (optional)"} />
        </div>
      );
    }
    if (b.kind === "scrollytelling") {
      return (
        <div className="p-3 rounded-xl bg-foreground/[0.03] border border-glass-border space-y-3">
          {Header}
          <Input value={b.title || ""} onChange={(e) => updateBlock(pi, bi, { title: e.target.value })}
            placeholder={lang === "fa" ? "عنوان فرآیند" : "Process title"} />
          {b.steps.map((s, si) => (
            <div key={si} className="p-2 rounded-lg bg-background/40 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-accent">{lang === "fa" ? `مرحله ${si + 1}` : `Step ${si + 1}`}</span>
                <button
                  onClick={() => updateBlock(pi, bi, { steps: b.steps.filter((_, k) => k !== si) })}
                  className="p-1 rounded hover:bg-destructive/10 text-destructive"
                ><Trash2 className="w-3 h-3" /></button>
              </div>
              <Input value={s.marker || ""}
                onChange={(e) => updateBlock(pi, bi, { steps: b.steps.map((x, k) => k === si ? { ...x, marker: e.target.value } : x) })}
                placeholder={lang === "fa" ? "برچسب (مثلاً «مرحله ۱»)" : "Marker (e.g. Step 1)"} />
              <Input value={s.title}
                onChange={(e) => updateBlock(pi, bi, { steps: b.steps.map((x, k) => k === si ? { ...x, title: e.target.value } : x) })}
                placeholder={lang === "fa" ? "عنوان مرحله" : "Step title"} />
              <Textarea value={s.description} rows={2}
                onChange={(e) => updateBlock(pi, bi, { steps: b.steps.map((x, k) => k === si ? { ...x, description: e.target.value } : x) })}
                placeholder={lang === "fa" ? "توضیح مرحله" : "Step description"} />
              <div className="flex gap-2 items-center">
                <input type="file" accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const url = await uploadToBucket(f, "scrolly");
                    if (url) updateBlock(pi, bi, { steps: b.steps.map((x, k) => k === si ? { ...x, image: url } : x) });
                    e.target.value = "";
                  }} className="text-xs flex-1" />
                {s.image && <img src={s.image} alt="" className="w-12 h-9 object-cover rounded" />}
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm"
            onClick={() => updateBlock(pi, bi, { steps: [...b.steps, { marker: `مرحله ${b.steps.length + 1}`, title: "", description: "" }] })}
          >
            <Plus className="w-3 h-3 me-1" /> {lang === "fa" ? "افزودن مرحله" : "Add step"}
          </Button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Book metadata */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div>
          <Label>{lang === "fa" ? "عنوان کتاب *" : "Title *"}</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>{lang === "fa" ? "نویسنده" : "Author"}</Label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>{lang === "fa" ? "جلد (اختیاری)" : "Cover (optional)"}</Label>
            <Input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} className="mt-1" />
          </div>
        </div>
        <div>
          <Label>{lang === "fa" ? "توضیحات" : "Description"}</Label>
          <Textarea value={description} rows={2} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
        </div>
      </div>

      {/* Pages */}
      {pages.map((page, pi) => (
        <motion.section
          key={pi}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-strong rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <Input value={page.title} onChange={(e) => updatePage(pi, { title: e.target.value })}
              placeholder={lang === "fa" ? "عنوان فصل" : "Chapter title"} className="font-display font-bold" />
            <button
              onClick={() => setPages((ps) => ps.filter((_, i) => i !== pi))}
              disabled={pages.length === 1}
              className="p-2 rounded-lg hover:bg-destructive/10 text-destructive disabled:opacity-30"
              aria-label="remove chapter"
            ><Trash2 className="w-4 h-4" /></button>
          </div>

          <div className="space-y-2">
            {page.blocks.map((b, bi) => (
              <BlockEditor key={bi} b={b} pi={pi} bi={bi} />
            ))}
          </div>

          {/* Add block buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="outline" onClick={() => addBlock(pi, "paragraph")}><Type className="w-3 h-3 me-1" />{lang === "fa" ? "متن" : "Text"}</Button>
            <Button size="sm" variant="outline" onClick={() => addBlock(pi, "heading")}><FileText className="w-3 h-3 me-1" />{lang === "fa" ? "عنوان" : "Heading"}</Button>
            <Button size="sm" variant="outline" onClick={() => addBlock(pi, "slideshow")}><ImageIcon className="w-3 h-3 me-1" />{lang === "fa" ? "اسلایدشو" : "Slideshow"}</Button>
            <Button size="sm" variant="outline" onClick={() => addBlock(pi, "video")}><Video className="w-3 h-3 me-1" />{lang === "fa" ? "ویدیو" : "Video"}</Button>
            <Button size="sm" variant="outline" onClick={() => addBlock(pi, "scrollytelling")}><Layers className="w-3 h-3 me-1" />{lang === "fa" ? "مولتی‌استپ" : "Multi-step"}</Button>
          </div>
        </motion.section>
      ))}

      <Button variant="outline" className="w-full" onClick={() => setPages((ps) => [...ps, newPage()])}>
        <Plus className="w-4 h-4 me-2" />{lang === "fa" ? "افزودن فصل" : "Add chapter"}
      </Button>

      <Button onClick={submit} disabled={busy} className="w-full bg-gradient-warm hover:opacity-90 h-12">
        {busy ? (lang === "fa" ? "در حال ذخیره…" : "Saving…") : (lang === "fa" ? "بساز و باز کن" : "Create & Open")}
      </Button>
    </div>
  );
};
