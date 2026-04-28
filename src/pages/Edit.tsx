// Edit page for an existing book draft. Loads the book, ensures the
// current user owns it (publisher_id), and renders the BookEditor in
// edit mode with autosave.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Pencil, Eye, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BookEditor, draftsFromDbPages } from "@/components/builder/BookEditor";
import { BookPreviewDialog } from "@/components/store/BookPreviewDialog";

const Edit = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<Parameters<typeof BookEditor>[0]["initial"] | null>(null);
  const [previewBook, setPreviewBook] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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
        .select("id, title, author, description, cover_url, pages, publisher_id, status, typography_preset, author_user_id, category, price")
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
        // Pass raw DB pages straight through — TextBookEditor handles
        // both new (`doc`) and legacy (`blocks`) shapes via dbPagesToTextPages.
        pages: (data.pages as any[]) ?? [],
        typography_preset: data.typography_preset,
        author_user_id: (data as any).author_user_id ?? null,
      });
      setPreviewBook({
        id: data.id,
        title: data.title,
        author: data.author,
        cover_url: data.cover_url,
        description: data.description,
        category: (data as any).category ?? null,
        price: Number((data as any).price ?? 0),
        publisher_id: data.publisher_id,
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
    <main className="min-h-[calc(100vh-4rem)]">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-none px-3 md:px-4 pt-3 pb-1 flex items-center gap-3"
      >
        <Button variant="ghost" size="sm" onClick={() => nav(-1)} className="h-8">
          <Back className="w-4 h-4 me-1.5" />
          {lang === "fa" ? "بازگشت" : "Back"}
        </Button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Pencil className="w-4 h-4 text-accent shrink-0" />
          <span className="text-muted-foreground shrink-0">{lang === "fa" ? "ویرایش زنده:" : "Editing:"}</span>
          <span className="font-display font-semibold truncate text-foreground" title={initial.title} dir="auto">
            {initial.title}
          </span>
          <span className="text-[11px] hidden lg:inline text-muted-foreground shrink-0">
            · {lang === "fa" ? "ذخیره خودکار فعال" : "Autosaving"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ms-auto h-8 gap-1.5"
          onClick={() => id && window.open(`/read/${id}`, "_blank")}
        >
          <Eye className="w-4 h-4" />
          <span className="hidden sm:inline">{lang === "fa" ? "پیش‌نمایش" : "Preview"}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setPreviewOpen(true)}
        >
          <Eye className="w-4 h-4" />
          <span className="hidden sm:inline">{lang === "fa" ? "پیش‌نمایش فروشگاه" : "Store preview"}</span>
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-stage-pricing text-stage-pricing-foreground hover:bg-stage-pricing/90"
          onClick={() => id && nav(`/publish/${id}`)}
        >
          <Rocket className="w-4 h-4" />
          {lang === "fa" ? "مرحله بعد" : "Next step"}
        </Button>
      </motion.div>

      <BookEditor initial={initial} />

      <BookPreviewDialog
        book={previewBook}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        isOwned={false}
        isOwner={true}
        canBuy={false}
        onBuy={() => {}}
      />
    </main>
  );
};

export default Edit;
