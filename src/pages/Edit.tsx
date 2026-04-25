// Edit page for an existing book draft. Loads the book, ensures the
// current user owns it (publisher_id), and renders the BookEditor in
// edit mode with autosave.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BookEditor, draftsFromDbPages } from "@/components/builder/BookEditor";

const Edit = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<Parameters<typeof BookEditor>[0]["initial"] | null>(null);

  useEffect(() => {
    if (!id) return;
    if (authLoading) return; // wait for session to hydrate
    if (!user) {
      nav("/auth");
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("books")
        .select("id, title, author, description, cover_url, pages, publisher_id, status, typography_preset")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        toast.error(lang === "fa" ? "کتاب یافت نشد" : "Book not found");
        nav("/library");
        return;
      }
      // Allow editing if the user is the publisher OR the book has no
      // publisher yet (legacy seed) — claim it on first save.
      if (data.publisher_id && data.publisher_id !== user.id) {
        toast.error(
          lang === "fa"
            ? "اجازه ویرایش این کتاب را ندارید"
            : "You can't edit this book",
        );
        nav("/library");
        return;
      }
      // Claim ownership of legacy book
      if (!data.publisher_id) {
        await supabase
          .from("books")
          .update({ publisher_id: user.id })
          .eq("id", id);
      }
      setInitial({
        id: data.id,
        title: data.title,
        author: data.author,
        description: data.description,
        cover_url: data.cover_url,
        pages: draftsFromDbPages(data.pages as any[]),
        typography_preset: data.typography_preset,
      });
      setLoading(false);
    })();
  }, [id, user, authLoading, nav, lang]);

  if (loading || !initial) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="container py-8 md:py-12 min-h-[calc(100vh-4rem)] max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <Back className="w-4 h-4 me-1.5" />
            {lang === "fa" ? "بازگشت" : "Back"}
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
              <Pencil className="w-5 h-5 text-accent" />
              {lang === "fa" ? "ویرایش کتاب" : "Edit Book"}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {lang === "fa"
                ? "ذخیره خودکار هر چند ثانیه یک‌بار اجرا می‌شود."
                : "Autosaves every few seconds."}
            </p>
          </div>
        </div>
      </motion.div>

      <BookEditor initial={initial} />
    </main>
  );
};

export default Edit;
