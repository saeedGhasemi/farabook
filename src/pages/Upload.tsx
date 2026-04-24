import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload as UploadIcon, Loader2, FileText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const Upload = () => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user) { nav("/auth"); return; }
    if (!file) { toast.error(lang === "fa" ? "یک فایل ورد انتخاب کنید" : "Pick a .docx file"); return; }
    if (!title.trim()) { toast.error(lang === "fa" ? "عنوان لازم است" : "Title required"); return; }
    setBusy(true);
    try {
      const path = `${user.id}/${Date.now()}-${file.name}`;
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
      nav(`/read/${data.book.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)] max-w-2xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold">
            {lang === "fa" ? "ساخت کتاب از فایل ورد" : "Create a book from Word"}
          </h1>
        </div>
        <p className="text-muted-foreground mb-8 text-sm">
          {lang === "fa"
            ? "یک فایل .docx آپلود کنید — به‌طور خودکار به فصل‌ها و پاراگراف‌های تعاملی تبدیل می‌شود."
            : "Upload a .docx — it will be converted to interactive chapters automatically."}
        </p>

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
          <Button onClick={submit} disabled={busy} className="w-full bg-gradient-warm hover:opacity-90">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin me-2" /> {lang === "fa" ? "در حال پردازش…" : "Processing…"}</>
                  : (lang === "fa" ? "بساز و باز کن" : "Create & Open")}
          </Button>
        </div>
      </motion.div>
    </main>
  );
};

export default Upload;
