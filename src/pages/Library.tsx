import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { BookCover } from "@/components/store/BookCover";
import { bookCreditCost } from "@/lib/purchase";
import { MessageCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BookComments } from "@/components/BookComments";


interface Row {
  id: string;
  status: string;
  progress: number;
  current_page: number;
  acquired_via: string;
  books: {
    id: string;
    title: string;
    title_en: string | null;
    author: string;
    cover_url: string | null;
    category: string | null;
    publisher_id: string | null;
    status: string;
    price: number;
  } | null;
}

const Library = () => {
  const { t, lang } = useI18n();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Row["books"] | null>(null);
  const [commentsBook, setCommentsBook] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) nav("/auth");
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // 1) Books explicitly in the user's library
      const { data: ub } = await supabase.from("user_books")
        .select("id, status, progress, current_page, acquired_via, books(id, title, title_en, author, cover_url, category, publisher_id, status, price)")
        .eq("user_id", user.id);
      const ownedRows = ((ub as unknown as Row[]) ?? []).filter((r) => r.books);

      // 2) Books the user published AND are live in the store — auto-included
      //    as virtual library entries. Drafts stay only in "My Publications"
      //    until the publisher finalizes them.
      const ownedBookIds = new Set(ownedRows.map((r) => r.books?.id));
      const { data: pub } = await supabase.from("books")
        .select("id, title, title_en, author, cover_url, category, publisher_id, status, price")
        .eq("publisher_id", user.id)
        .eq("status", "published");
      const virtualRows: Row[] = ((pub as NonNullable<Row["books"]>[]) ?? [])
        .filter((b) => !ownedBookIds.has(b.id))
        .map((b) => ({
          id: `pub-${b.id}`,
          status: "unread",
          progress: 0,
          current_page: 0,
          acquired_via: "publisher",
          books: b,
        }));

      setRows([...ownedRows, ...virtualRows]);
      setRowsLoading(false);
    })();
  }, [user]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("books").delete().eq("id", confirmDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "fa" ? "کتاب حذف شد" : "Book deleted");
    setRows((prev) => prev.filter((r) => r.books?.id !== confirmDelete.id));
    setConfirmDelete(null);
  };

  const statusLabel = (s: string) =>
    s === "reading" ? t("status_reading") : s === "finished" ? t("status_finished") : t("status_unread");

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl font-display font-bold">
          {t("library_title")}
        </motion.h1>
      </div>

      {rows.length === 0 ? (
        <div className="glass-strong rounded-3xl p-16 text-center max-w-xl mx-auto">
          <BookOpen className="w-14 h-14 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg text-muted-foreground mb-6">{t("library_empty")}</p>
          <Link to="/store">
            <Button className="bg-gradient-warm hover:opacity-90">{t("library_browse")}</Button>
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {rows.map((r, i) => {
            if (!r.books) return null;
            const title = lang === "en" && r.books.title_en ? r.books.title_en : r.books.title;
            const isOwner = !!user && r.books.publisher_id === user.id;
            const isDraft = r.books.status === "draft";
            return (
              <motion.div key={r.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -6 }}
                className="paper-card rounded-2xl overflow-hidden flex flex-col group relative"
              >
                <Link to={`/read/${r.books.id}`} className="flex flex-col w-full h-full">
                  <div className="relative aspect-[3/4] overflow-hidden bg-secondary book-shadow">
                    <BookCover
                      bookId={r.books.id}
                      cover={r.books.cover_url}
                      title={title}
                      width={480}
                      quality={70}
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                    {isDraft && (
                      <Badge className="absolute top-3 end-3 bg-accent text-accent-foreground border-0">
                        {lang === "fa" ? "پیش‌نویس" : "Draft"}
                      </Badge>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col gap-3">
                    <div>
                      <h3 className="font-display font-bold text-lg leading-tight line-clamp-2">{title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{r.books.author}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-xs">{statusLabel(r.status)}</Badge>
                      <span className="text-xs font-semibold text-primary">
                        {r.books.price === 0
                          ? (lang === "fa" ? "رایگان" : "Free")
                          : (lang === "fa"
                              ? `${bookCreditCost(r.books.price).toLocaleString("fa-IR")} اعتبار`
                              : `${bookCreditCost(r.books.price).toLocaleString()} cr`)}
                      </span>
                    </div>
                    <div className="mt-auto">
                      <Progress value={r.progress} className="h-1.5" />
                      <p className="text-xs text-muted-foreground mt-1">{Math.round(r.progress)}%</p>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCommentsBook({ id: r.books!.id, title: title }); }}
                  className="absolute top-3 start-3 h-8 w-8 rounded-full bg-background/90 backdrop-blur border flex items-center justify-center hover:bg-background transition"
                  title={lang === "fa" ? "نظرات" : "Comments"}
                >
                  <MessageCircle className="w-4 h-4 text-accent" />
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === "fa" ? "حذف کتاب" : "Delete book"}</AlertDialogTitle>
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

      <Dialog open={!!commentsBook} onOpenChange={(o) => !o && setCommentsBook(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="truncate">{commentsBook?.title}</DialogTitle>
          </DialogHeader>
          {commentsBook && <BookComments bookId={commentsBook.id} />}
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Library;
