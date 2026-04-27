import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Briefcase, Plus, Pencil, Trash2, Eye, BookOpen, Users, FileEdit,
  CheckCircle2, ExternalLink, Loader2, Settings, BarChart3,
  Rocket,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { BookPreviewDialog } from "@/components/store/BookPreviewDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { resolveBookMedia } from "@/lib/book-media";

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
  created_at: string;
}

interface PublisherProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface PublisherStorefront {
  display_name: string;
  bio: string | null;
  banner_url: string | null;
  logo_url: string | null;
  theme: string | null;
  is_trusted: boolean;
}

const Publisher = () => {
  const { id: paramId } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();

  const isMe = paramId === "me" || paramId === user?.id;
  const targetId = isMe ? user?.id : paramId;

  const [books, setBooks] = useState<Book[]>([]);
  const [profile, setProfile] = useState<PublisherProfile | null>(null);
  const [storefront, setStorefront] = useState<PublisherStorefront | null>(null);
  const [readerStats, setReaderStats] = useState<Record<string, number>>({});
  const [salesStats, setSalesStats] = useState<Record<string, { count: number; gross: number; toMe: number; distributed: { user_id: string; role: string; amount: number; name?: string }[] }>>({});
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);
  const [previewBook, setPreviewBook] = useState<Book | null>(null);
  const [salesDetailFor, setSalesDetailFor] = useState<Book | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (paramId === "me" && !user) {
      nav("/auth");
      return;
    }
    if (!targetId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [{ data: bookList }, { data: prof }, { data: sf }] = await Promise.all([
        supabase
          .from("books")
          .select("*")
          .eq("publisher_id", targetId)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, display_name, avatar_url").eq("id", targetId).maybeSingle(),
        supabase.from("publisher_profiles").select("display_name, bio, banner_url, logo_url, theme, is_trusted").eq("user_id", targetId).maybeSingle(),
      ]);
      if (cancelled) return;

      const list = (bookList as Book[]) ?? [];
      const visible = isMe ? list : list.filter((b) => b.status === "published");
      setBooks(visible);
      setProfile((prof as PublisherProfile) ?? null);
      setStorefront((sf as PublisherStorefront) ?? null);

      if (visible.length) {
        const ids = visible.map((b) => b.id);
        // Reader counts
        const { data: ub } = await supabase
          .from("user_books")
          .select("book_id")
          .in("book_id", ids);
        const counts: Record<string, number> = {};
        (ub ?? []).forEach((r: any) => {
          counts[r.book_id] = (counts[r.book_id] ?? 0) + 1;
        });
        if (!cancelled) setReaderStats(counts);

        // Sales + revenue distribution (only for owner view) — uses SECURITY DEFINER RPC
        if (isMe && targetId) {
          const { data: rows } = await (supabase.rpc as any)("publisher_book_sales_stats", { _publisher_id: targetId });
          const stats: typeof salesStats = {};
          ((rows as any[]) ?? []).forEach((r) => {
            const dist = (r.distribution || []).map((d: any) => ({
              user_id: d.recipient_id,
              role: d.role,
              amount: Number(d.amount),
              name: d.recipient_name,
            }));
            stats[r.book_id] = {
              count: Number(r.sales_count) || 0,
              gross: Number(r.gross_credits) || 0,
              toMe: Number(r.to_publisher) || 0,
              distributed: dist,
            };
          });
          if (!cancelled) setSalesStats(stats);
        }
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [targetId, isMe, paramId, user, authLoading, nav]);

  const stats = useMemo(() => {
    const total = books.length;
    const published = books.filter((b) => b.status === "published").length;
    const drafts = books.filter((b) => b.status === "draft").length;
    const readers = Object.values(readerStats).reduce((a, b) => a + b, 0);
    return { total, published, drafts, readers };
  }, [books, readerStats]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("books").delete().eq("id", confirmDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "fa" ? "کتاب حذف شد" : "Book deleted");
    setBooks((prev) => prev.filter((b) => b.id !== confirmDelete.id));
    setConfirmDelete(null);
  };

  if (authLoading || loading) {
    return (
      <main className="container py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </main>
    );
  }

  const displayName = storefront?.display_name || profile?.display_name || (lang === "fa" ? "ناشر" : "Publisher");
  const statusLabel = (status: string) => {
    if (status === "published") return lang === "fa" ? "در فروشگاه" : "In store";
    if (status === "draft") return lang === "fa" ? "در حال آماده‌سازی" : "Preparing";
    return status;
  };

  return (
    <main className="container py-6 md:py-12 min-h-[calc(100vh-4rem)] overflow-x-hidden">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-2xl p-5 md:p-7 mb-6 md:mb-8 flex flex-col lg:flex-row lg:items-center gap-5"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-glow shrink-0">
          <Briefcase className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {isMe ? (lang === "fa" ? "مرکز کاری ناشر" : "Publisher workspace") : (lang === "fa" ? "ویترین ناشر" : "Publisher storefront")}
          </p>
          <h1 className="text-3xl md:text-4xl font-display font-bold mt-1">{displayName}</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            {isMe
              ? (lang === "fa"
                  ? "اول محتوای کتاب را کامل کنید؛ سپس از دکمه «قیمت، سهام و انتشار» وارد ویزارد فروشگاه شوید و بعد از ذخیره سهم‌بندی، انتشار نهایی را بزنید."
                  : "Finish content first, then use Price, shares & publish to open the storefront wizard and finalize publication.")
              : `${stats.published} ${lang === "fa" ? "کتاب منتشر شده" : "published books"}`}
          </p>
        </div>
        {isMe ? (
          <div className="flex gap-2 flex-wrap lg:justify-end">
            <Link to="/upload">
              <Button className="gap-2 bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4" /> {lang === "fa" ? "کتاب جدید" : "New book"}
              </Button>
            </Link>
            <Link to={`/publisher/${user?.id}/settings`}>
              <Button variant="outline" className="gap-2">
                <Settings className="w-4 h-4" /> {lang === "fa" ? "تنظیمات" : "Settings"}
              </Button>
            </Link>
            {user && (
              <Link to={`/publisher/${user.id}`}>
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="w-4 h-4" /> {lang === "fa" ? "ویترین عمومی" : "Public view"}
                </Button>
              </Link>
            )}
          </div>
        ) : null}
      </motion.div>

      {/* Stats (only for owner) */}
      {isMe && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
          {[
            { icon: BookOpen, label: lang === "fa" ? "کل" : "Total", value: stats.total, color: "text-primary" },
            { icon: CheckCircle2, label: lang === "fa" ? "در فروشگاه" : "In store", value: stats.published, color: "text-primary" },
            { icon: FileEdit, label: lang === "fa" ? "آماده‌سازی" : "Preparing", value: stats.drafts, color: "text-accent" },
            { icon: Users, label: lang === "fa" ? "خوانندگان" : "Readers", value: stats.readers, color: "text-accent" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="paper-card rounded-2xl p-4 md:p-5"
            >
              <s.icon className={`w-6 h-6 mb-2 ${s.color}`} />
              <div className="text-3xl font-display font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </motion.div>
          ))}
        </div>
        <div className="mb-8 rounded-2xl border bg-card/70 p-4 grid md:grid-cols-3 gap-3 text-sm">
          {[
            { n: "۱", title: lang === "fa" ? "ویرایش محتوا" : "Edit content", body: lang === "fa" ? "دکمه «ویرایش متن و محتوا» فقط ادیتور کتاب را باز می‌کند." : "Edit content opens only the book editor." },
            { n: "۲", title: lang === "fa" ? "قیمت و سهام" : "Price & shares", body: lang === "fa" ? "دکمه آبی «قیمت، سهام و انتشار» ویزارد قیمت‌گذاری و سهم‌بندی را باز می‌کند." : "The primary button opens pricing and revenue split." },
            { n: "۳", title: lang === "fa" ? "انتشار نهایی" : "Final publish", body: lang === "fa" ? "بعد از ذخیره سهم‌بندی و پیش‌نمایش، دکمه نهایی فعال می‌شود." : "Final publish unlocks after split and preview are saved." },
          ].map((step) => (
            <div key={step.n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{step.n}</span>
              <div>
                <div className="font-semibold">{step.title}</div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Books grid */}
      {books.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted-foreground mb-4">
            {isMe
              ? (lang === "fa" ? "هنوز کتابی نساخته‌اید" : "You haven't created any book yet")
              : (lang === "fa" ? "هنوز کتاب منتشرشده‌ای ندارد" : "No published books yet")}
          </p>
          {isMe && (
            <Link to="/upload">
              <Button className="gap-2 bg-gradient-warm hover:opacity-90">
                <Plus className="w-4 h-4" /> {lang === "fa" ? "اولین کتاب را بسازید" : "Create your first book"}
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {books.map((book, i) => {
            const title = lang === "en" && book.title_en ? book.title_en : book.title;
            const isDraft = book.status === "draft";
            const readers = readerStats[book.id] ?? 0;
            const s = salesStats[book.id];
            const sales = s?.count || 0;
            const earned = s?.toMe || 0;
            return (
              <motion.div
                key={book.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="paper-card rounded-2xl overflow-hidden grid md:grid-cols-[132px_1fr] group relative"
              >
                <div className="relative aspect-[3/4] md:aspect-auto md:min-h-[190px] overflow-hidden bg-secondary">
                  {book.cover_url && (
                    <img
                      src={resolveBookMedia(book.cover_url)}
                      alt={title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  )}
                </div>
                <div className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant={isDraft ? "outline" : "default"}>{statusLabel(book.status)}</Badge>
                        {book.category && <Badge variant="secondary">{book.category}</Badge>}
                      </div>
                      <h3 className="font-display font-bold text-xl leading-tight line-clamp-2">{title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{book.author}</p>
                    </div>
                    {isMe && (
                      <div className="grid grid-cols-3 gap-2 lg:min-w-[270px]">
                        <div className="rounded-xl border bg-background/40 p-2 text-center">
                          <div className="text-sm font-bold">{readers.toLocaleString(lang === "fa" ? "fa-IR" : undefined)}</div>
                          <div className="text-[10px] text-muted-foreground">{lang === "fa" ? "خواننده" : "Readers"}</div>
                        </div>
                        <button type="button" onClick={() => setSalesDetailFor(book)} className="rounded-xl border bg-background/40 p-2 text-center hover:border-primary/40 transition-colors">
                          <div className="text-sm font-bold">{sales.toLocaleString(lang === "fa" ? "fa-IR" : undefined)}</div>
                          <div className="text-[10px] text-muted-foreground">{lang === "fa" ? "فروش" : "Sales"}</div>
                        </button>
                        <button type="button" onClick={() => setSalesDetailFor(book)} className="rounded-xl border bg-primary/10 p-2 text-center hover:border-primary/40 transition-colors">
                          <div className="text-sm font-bold text-primary">{earned.toLocaleString(lang === "fa" ? "fa-IR" : undefined)}</div>
                          <div className="text-[10px] text-muted-foreground">{lang === "fa" ? "سهم شما" : "Your share"}</div>
                        </button>
                      </div>
                    )}
                  </div>
                  {isMe && (
                    <>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {readers.toLocaleString(lang === "fa" ? "fa-IR" : undefined)}</span>
                        <span className="font-semibold text-primary">
                          {book.price === 0
                            ? (lang === "fa" ? "رایگان" : "Free")
                            : `${book.price.toLocaleString(lang === "fa" ? "fa-IR" : undefined)} ${lang === "fa" ? "تومان" : "Toman"}`}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-2 pt-1 mt-auto flex-wrap">
                    {isMe ? (
                      <>
                        <Link to={`/edit/${book.id}`} className="flex-1 min-w-[150px]">
                          <Button size="sm" variant="outline" className="gap-1.5 w-full">
                            <Pencil className="w-3.5 h-3.5" /> {lang === "fa" ? "ویرایش متن و محتوا" : "Edit content"}
                          </Button>
                        </Link>
                        <Link to={`/publish/${book.id}`} className="flex-1 min-w-[170px]">
                          <Button size="sm" className="gap-1.5 w-full bg-primary hover:bg-primary/90">
                            <Rocket className="w-3.5 h-3.5" /> {lang === "fa" ? "قیمت، سهام و انتشار" : "Price, shares & publish"}
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setPreviewBook(book)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {lang === "fa" ? "پیش‌نمایش" : "Preview"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setConfirmDelete(book)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Link to={`/read/${book.id}`} className="w-full">
                        <Button size="sm" variant="outline" className="gap-1.5 w-full">
                          <Eye className="w-3.5 h-3.5" /> {lang === "fa" ? "مشاهده" : "View"}
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
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
                ? `آیا از حذف «${confirmDelete?.title}» مطمئن هستید؟`
                : `Delete "${confirmDelete?.title}"?`}
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
        book={previewBook ? {
          id: previewBook.id,
          title: previewBook.title,
          author: previewBook.author,
          cover_url: previewBook.cover_url,
          description: previewBook.description,
          category: previewBook.category,
          price: previewBook.price,
          publisher_id: previewBook.publisher_id,
        } : null}
        open={!!previewBook}
        onOpenChange={(o) => !o && setPreviewBook(null)}
        isOwned={false}
        isOwner={true}
        canBuy={false}
        onBuy={() => {}}
      />

      {/* Sales detail dialog */}
      <Dialog open={!!salesDetailFor} onOpenChange={(o) => !o && setSalesDetailFor(null)}>
        <DialogContent className="max-w-lg glass-strong">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-accent" />
              {lang === "fa" ? "گزارش فروش و سهم‌بندی" : "Sales & revenue breakdown"}
            </DialogTitle>
            <DialogDescription className="truncate">{salesDetailFor?.title}</DialogDescription>
          </DialogHeader>
          {salesDetailFor && (() => {
            const s = salesStats[salesDetailFor.id];
            if (!s || s.count === 0) {
              return (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {lang === "fa" ? "هنوز فروشی ثبت نشده است." : "No sales recorded yet."}
                </p>
              );
            }
            const grouped = new Map<string, { name?: string; role: string; amount: number }>();
            s.distributed.forEach((d) => {
              const k = `${d.user_id}-${d.role}`;
              const existing = grouped.get(k);
              if (existing) existing.amount += d.amount;
              else grouped.set(k, { name: d.name, role: d.role, amount: d.amount });
            });
            const fmt = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : undefined);
            const roleLabel = (r: string) =>
              r === "publisher" ? (lang === "fa" ? "ناشر (شما)" : "Publisher (you)")
              : r === "author" ? (lang === "fa" ? "نویسنده" : "Author")
              : r === "editor" ? (lang === "fa" ? "ادیتور" : "Editor")
              : r;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border bg-background/40 p-3">
                    <div className="text-2xl font-display font-bold">{fmt(s.count)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{lang === "fa" ? "تعداد فروش" : "Sales"}</div>
                  </div>
                  <div className="rounded-xl border bg-background/40 p-3">
                    <div className="text-2xl font-display font-bold">{fmt(s.gross)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{lang === "fa" ? "مجموع درآمد" : "Gross"}</div>
                  </div>
                  <div className="rounded-xl border bg-accent/10 p-3">
                    <div className="text-2xl font-display font-bold text-accent">{fmt(s.toMe)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{lang === "fa" ? "سهم شما" : "Your share"}</div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {lang === "fa" ? "توزیع درآمد" : "Distribution"}
                  </h4>
                  <div className="space-y-1.5">
                    {Array.from(grouped.values()).map((d, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-background/30">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{d.name || (lang === "fa" ? "ناشناس" : "Unknown")}</div>
                          <div className="text-[10px] text-muted-foreground">{roleLabel(d.role)}</div>
                        </div>
                        <div className="font-mono text-sm text-accent">{fmt(d.amount)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Publisher;
