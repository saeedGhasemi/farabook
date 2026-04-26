import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, ShoppingBag, Check, Eye, Star } from "lucide-react";
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
import { BookPreviewDialog } from "@/components/store/BookPreviewDialog";
import { bookCreditCost, purchaseBookWithCredits } from "@/lib/purchase";
import { ConfirmTransactionDialog } from "@/components/ConfirmTransactionDialog";
import { useCredits } from "@/hooks/useCredits";

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
  const nav = useNavigate();
  const { credits } = useCredits();
  const [searchParams, setSearchParams] = useSearchParams();
  const [books, setBooks] = useState<Book[]>([]);
  const [ratings, setRatings] = useState<Record<string, { avg: number; count: number }>>({});
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const cat = searchParams.get("cat");
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);
  const [previewBook, setPreviewBook] = useState<Book | null>(null);
  const [confirmBuy, setConfirmBuy] = useState<Book | null>(null);

  const reload = () => {
    supabase.from("books")
      .select("id, title, title_en, author, publisher, publisher_id, status, category, cover_url, description, price, ambient_theme")
      .order("created_at", { ascending: false })
      .then(({ data }) => setBooks((data as Book[]) ?? []));
    supabase.from("book_comments").select("book_id, rating")
      .then(({ data }) => {
        const map: Record<string, { sum: number; count: number }> = {};
        ((data as any[]) || []).forEach((r) => {
          if (r.rating == null) return;
          if (!map[r.book_id]) map[r.book_id] = { sum: 0, count: 0 };
          map[r.book_id].sum += Number(r.rating);
          map[r.book_id].count += 1;
        });
        const out: Record<string, { avg: number; count: number }> = {};
        Object.keys(map).forEach((k) => { out[k] = { avg: map[k].sum / map[k].count, count: map[k].count }; });
        setRatings(out);
      });
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

  const requestBuy = (book: Book) => {
    if (!user) { toast.error(t("nav_signin")); nav("/auth"); return; }
    setConfirmBuy(book);
  };

  const performBuy = async (book: Book) => {
    setConfirmBuy(null);
    const res = await purchaseBookWithCredits({
      bookId: book.id,
      bookTitle: lang === "en" && book.title_en ? book.title_en : book.title,
      bookPrice: book.price,
      lang,
      navigate: (to) => nav(to),
    });
    if (res?.ok) setOwned((prev) => new Set(prev).add(book.id));
  };

  const filtered = books.filter((b) => {
    if (cat && b.category !== cat) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [b.title, b.title_en, b.author, b.publisher, b.category]
      .filter(Boolean).some((x) => String(x).toLowerCase().includes(s));
  });

  const updateQ = (v: string) => {
    setQ(v);
    const next = new URLSearchParams(searchParams);
    if (v.trim()) next.set("q", v.trim()); else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const clearCat = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("cat");
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10 space-y-4">
        <h1 className="text-4xl md:text-5xl font-display font-bold">{t("store_title")}</h1>
        <div className="relative max-w-xl">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => updateQ(e.target.value)}
            placeholder={t("search_ph")}
            className="ps-10 h-12 glass"
          />
        </div>
        {cat && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-2 py-1.5 px-3">
              {cat}
              <button onClick={clearCat} className="text-muted-foreground hover:text-foreground" aria-label="Clear filter">×</button>
            </Badge>
          </div>
        )}
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
                {/* Edit/Delete actions are only available in the Publisher page. */}
              </div>
              <div className="p-5 flex-1 flex flex-col gap-3">
                <div>
                  <h3 className="font-display font-bold text-lg leading-tight line-clamp-2">{title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{book.author}</p>
                </div>
                {ratings[book.id] && (
                  <div className="flex items-center gap-1 text-xs">
                    <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                    <span className="font-semibold text-foreground">
                      {ratings[book.id].avg.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">
                      ({ratings[book.id].count.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")})
                    </span>
                  </div>
                )}
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{book.description}</p>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-primary">
                      {book.price === 0 ? t("free") : `${book.price.toLocaleString()} ${t("toman")}`}
                    </span>
                    {book.price > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {lang === "fa"
                          ? `${bookCreditCost(book.price).toLocaleString("fa-IR")} اعتبار`
                          : `${bookCreditCost(book.price).toLocaleString()} credits`}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreviewBook(book)}
                      className="gap-1.5"
                      title={lang === "fa" ? "پیش‌نمایش" : "Preview"}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    {isOwner ? (
                      <Link to={`/read/${book.id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Check className="w-3.5 h-3.5" /> {t("read")}
                        </Button>
                      </Link>
                    ) : isOwned ? (
                      <Link to={`/read/${book.id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Check className="w-3.5 h-3.5" /> {t("read")}
                        </Button>
                      </Link>
                    ) : (
                      <Button size="sm" onClick={() => requestBuy(book)} className="gap-1.5 bg-gradient-warm hover:opacity-90">
                        <ShoppingBag className="w-3.5 h-3.5" /> {t("buy")}
                      </Button>
                    )}
                  </div>
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

      <BookPreviewDialog
        book={previewBook}
        open={!!previewBook}
        onOpenChange={(o) => !o && setPreviewBook(null)}
        isOwned={previewBook ? owned.has(previewBook.id) : false}
        isOwner={!!user && !!previewBook && previewBook.publisher_id === user.id}
        canBuy={!!user && !!previewBook && !owned.has(previewBook.id) && previewBook.publisher_id !== user.id}
        onBuy={() => { if (previewBook) { requestBuy(previewBook); setPreviewBook(null); } }}
      />

      <ConfirmTransactionDialog
        open={!!confirmBuy}
        onOpenChange={(o) => !o && setConfirmBuy(null)}
        title={lang === "fa" ? "خرید کتاب" : "Purchase book"}
        description={confirmBuy ? (
          lang === "fa"
            ? `می‌خواهید «${confirmBuy.title}» را به قفسه خود اضافه کنید؟`
            : `Add “${confirmBuy.title_en || confirmBuy.title}” to your library?`
        ) : null}
        currentBalance={credits}
        cost={confirmBuy ? bookCreditCost(confirmBuy.price) : 0}
        lang={lang}
        onConfirm={() => confirmBuy && performBuy(confirmBuy)}
      />
    </main>
  );
};

export default Store;
