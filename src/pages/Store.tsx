import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, ShoppingBag, Check, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { resolveBookMedia } from "@/lib/book-media";

const resolveCover = (s: string | null) => resolveBookMedia(s);

interface Book {
  id: string;
  title: string;
  title_en: string | null;
  author: string;
  publisher: string | null;
  publisher_id: string | null;
  status: string;
  category: string | null;
  cover_url: string | null;
  description: string | null;
  price: number;
  ambient_theme: string | null;
}

const Store = () => {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);

  const reload = () => {
    supabase.from("books").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setBooks((data as Book[]) ?? []));
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!user) { setOwned(new Set()); return; }
    supabase.from("user_books").select("book_id").eq("user_id", user.id)
      .then(({ data }) => setOwned(new Set((data ?? []).map((d) => d.book_id))));
  }, [user]);

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    const { error } = await supabase.from("books").delete().eq("id", confirmDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "fa" ? "کتاب حذف شد" : "Book deleted");
    setBooks((prev) => prev.filter((b) => b.id !== confirmDelete.id));
    setConfirmDelete(null);
  };

  const handleAdd = async (book: Book) => {
    if (!user) { toast.error(t("nav_signin")); return; }
    const { error } = await supabase.from("user_books").insert({
      user_id: user.id,
      book_id: book.id,
      acquired_via: book.price === 0 ? "purchase" : "purchase",
    });
    if (error) { toast.error(error.message); return; }
    setOwned((prev) => new Set(prev).add(book.id));
    toast.success(t("added"));
  };

  const filtered = books.filter((b) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [b.title, b.title_en, b.author, b.publisher, b.category]
      .filter(Boolean).some((x) => String(x).toLowerCase().includes(s));
  });

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10 space-y-4">
        <h1 className="text-4xl md:text-5xl font-display font-bold">{t("store_title")}</h1>
        <div className="relative max-w-xl">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search_ph")}
            className="ps-10 h-12 glass"
          />
        </div>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filtered.map((book, i) => {
          const isOwned = owned.has(book.id);
          const isOwner = !!user && book.publisher_id === user.id;
          const isDraft = book.status === "draft";
          const title = lang === "en" && book.title_en ? book.title_en : book.title;
          return (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
              whileHover={{ y: -8 }}
              className="paper-card rounded-2xl overflow-hidden flex flex-col group relative"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
                {book.cover_url && (
                  <img
                    src={resolveCover(book.cover_url)}
                    alt={title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                )}
                {book.category && (
                  <Badge className="absolute top-3 start-3 glass-strong text-foreground border-0">{book.category}</Badge>
                )}
                {isDraft && (
                  <Badge className="absolute top-3 end-3 bg-accent text-accent-foreground border-0">
                    {lang === "fa" ? "پیش‌نویس" : "Draft"}
                  </Badge>
                )}
                {isOwner && (
                  <div className="absolute bottom-2 end-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link to={`/edit/${book.id}`}>
                      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full shadow-md">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8 rounded-full shadow-md"
                      onClick={() => setConfirmDelete(book)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="p-5 flex-1 flex flex-col gap-3">
                <div>
                  <h3 className="font-display font-bold text-lg leading-tight line-clamp-2">{title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{book.author}</p>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{book.description}</p>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="font-semibold text-primary">
                    {book.price === 0 ? t("free") : `${book.price.toLocaleString()} ${t("toman")}`}
                  </span>
                  {isOwner ? (
                    <Link to={`/edit/${book.id}`}>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Pencil className="w-3.5 h-3.5" /> {lang === "fa" ? "ویرایش" : "Edit"}
                      </Button>
                    </Link>
                  ) : isOwned ? (
                    <Link to={`/read/${book.id}`}>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Check className="w-3.5 h-3.5" /> {t("read")}
                      </Button>
                    </Link>
                  ) : (
                    <Button size="sm" onClick={() => handleAdd(book)} className="gap-1.5 bg-gradient-warm hover:opacity-90">
                      <ShoppingBag className="w-3.5 h-3.5" /> {t("buy")}
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "fa" ? "حذف کتاب" : "Delete book"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "fa"
                ? `آیا از حذف «${confirmDelete?.title}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`
                : `Delete "${confirmDelete?.title}"? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "fa" ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {lang === "fa" ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default Store;
