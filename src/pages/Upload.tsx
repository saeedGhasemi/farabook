import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload as UploadIcon, Loader2, FileText, Sparkles, Wand2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { BookEditor } from "@/components/builder/BookEditor";

const Upload = () => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submitWord = async () => {
    if (!user) { nav("/auth"); return; }
    if (!file) { toast.error(lang === "fa" ? "یک فایل ورد انتخاب کنید" : "Pick a .docx file"); return; }
    if (!title.trim()) { toast.error(lang === "fa" ? "عنوان لازم است" : "Title required"); return; }
    setBusy(true);
    try {
      // Sanitize filename: Storage keys must be ASCII-safe.
      const dot = file.name.lastIndexOf(".");
      const ext = (dot >= 0 ? file.name.slice(dot + 1) : "docx").toLowerCase().replace(/[^a-z0-9]/g, "") || "docx";
      const safeName = `book-${Date.now()}.${ext}`;
      const path = `${user.id}/${safeName}`;
      const up = await supabase.storage.from("book-uploads").upload(path, file, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (up.error) throw up.error;

      const { data, error } = await supabase.functions.invoke("word-import", {
        body: { path, title, author: author || (lang === "fa" ? "ناشناس" : "Unknown"), description },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(
        (lang === "fa" ? "کتاب با " : "Imported with ") + (data?.chapters ?? 0) +
        (lang === "fa" ? " فصل ساخته شد" : " chapters")
      );
      nav(`/edit/${data.book.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  // For "word import" tab we want the narrow centered container.
  // For "manual" tab we want full-width since the live editor uses
  // its own three-pane layout.
  const [tab, setTab] = useState<"manual" | "word">("manual");

  if (tab === "manual") {
    return (
      <main className="min-h-[calc(100vh-4rem)]">
        <div className="container max-w-5xl pt-4 pb-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">
                {lang === "fa" ? "کتاب‌ساز" : "Book Builder"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {lang === "fa" ? "ادیتور بصری زنده — همان‌جا که می‌نویسی، می‌بینی" : "Live visual editor — what you see is what you publish"}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTab("word")}>
            <FileText className="w-4 h-4 me-2" />
            {lang === "fa" ? "از فایل ورد" : "From Word"}
          </Button>
        </div>
        <BookEditor onCreated={(id) => nav(`/edit/${id}`)} />
      </main>
    );
  }

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)] max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold">
            {lang === "fa" ? "کتاب‌ساز" : "Book Builder"}
          </h1>
        </div>
        <p className="text-muted-foreground mb-8 text-sm">
          {lang === "fa"
            ? "از یک فایل ورد بساز یا با ادیتور بصری، صفحه‌به‌صفحه کتاب تعاملی خود را طراحی کن."
            : "Import from Word, or design an interactive book page-by-page with the visual editor."}
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "word")} className="w-full">
          <TabsList className="grid grid-cols-2 mb-6 w-full max-w-sm">
            <TabsTrigger value="manual">
              <Wand2 className="w-4 h-4 me-2" />
              {lang === "fa" ? "ساخت دستی" : "Visual builder"}
            </TabsTrigger>
            <TabsTrigger value="word">
              <FileText className="w-4 h-4 me-2" />
              {lang === "fa" ? "از فایل ورد" : "From Word"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            {/* unreachable, manual tab returned earlier */}
          </TabsContent>

          <TabsContent value="word">
            <div className="glass-strong rounded-3xl p-6 md:p-8 space-y-5">
              <div>
                <Label>{lang === "fa" ? "فایل ورد" : "Word file"}</Label>
                <label className="mt-2 flex flex-col items-center justify-center gap-2 p-8 rounded-2xl border-2 border-dashed border-border hover:border-accent/60 cursor-pointer transition-colors bg-background/40">
                  {file ? (
                    <>
                      <FileText className="w-8 h-8 text-accent" />
                      <span className="text-sm font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                    </>
                  ) : (
                    <>
                      <UploadIcon className="w-8 h-8 text-muted-foreground" />
                      <span className="text-sm">{lang === "fa" ? "برای انتخاب کلیک کنید" : "Click to select"}</span>
                    </>
                  )}
                  <input type="file" accept=".docx" className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <div>
                <Label>{lang === "fa" ? "عنوان کتاب" : "Title"}</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label>{lang === "fa" ? "نویسنده" : "Author"}</Label>
                <Input value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label>{lang === "fa" ? "توضیحات" : "Description"}</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-2" />
              </div>
              <Button onClick={submitWord} disabled={busy} className="w-full bg-gradient-warm hover:opacity-90">
                {busy ? <><Loader2 className="w-4 h-4 animate-spin me-2" /> {lang === "fa" ? "در حال پردازش…" : "Processing…"}</>
                      : (lang === "fa" ? "بساز و باز کن" : "Create & Open")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </main>
  );
};

export default Upload;
