import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Briefcase, Plus, Pencil, Trash2, Eye, BookOpen, Users, FileEdit,
  CheckCircle2, ExternalLink, Loader2, Settings,
} from "lucide-react";
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
  const { user } = useAuth();
  const { lang } = useI18n();
  const nav = useNavigate();

  const isMe = paramId === "me" || paramId === user?.id;
  const targetId = isMe ? user?.id : paramId;

  const [books, setBooks] = useState<Book[]>([]);
  const [profile, setProfile] = useState<PublisherProfile | null>(null);
  const [storefront, setStorefront] = useState<PublisherStorefront | null>(null);
  const [readerStats, setReaderStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);

  useEffect(() => {
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

      // Reader counts via user_books
      if (visible.length) {
        const ids = visible.map((b) => b.id);
        const { data: ub } = await supabase
          .from("user_books")
          .select("book_id")
          .in("book_id", ids);
        const counts: Record<string, number> = {};
        (ub ?? []).forEach((r: any) => {
          counts[r.book_id] = (counts[r.book_id] ?? 0) + 1;
        });
        if (!cancelled) setReaderStats(counts);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [targetId, isMe, paramId, user, nav]);

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

  if (loading) {
    return (
      <main className="container py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </main>
    );
  }

  const displayName = profile?.display_name || (isMe
    ? (lang === "fa" ? "ناشر" : "Publisher")
    : (lang === "fa" ? "ناشر" : "Publisher"));

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-3xl p-6 md:p-8 mb-10 flex flex-col md:flex-row md:items-center gap-6"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow shrink-0">
          <Briefcase className="w-8 h-8" />
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {isMe ? (lang === "fa" ? "داشبورد" : "Dashboard") : (lang === "fa" ? "ویترین ناشر" : "Publisher storefront")}
          </p>
          <h1 className="text-3xl md:text-4xl font-display font-bold mt-1">{displayName}</h1>
          {!isMe && (
            <p className="text-sm text-muted-foreground mt-1">
              {stats.published} {lang === "fa" ? "کتاب منتشر شده" : "published books"}
            </p>
          )}
        </div>
        {isMe ? (
          <div className="flex gap-2">
            <Link to="/upload">
              <Button className="gap-2 bg-gradient-warm hover:opacity-90">
                <Plus className="w-4 h-4" /> {lang === "fa" ? "کتاب جدید" : "New book"}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { icon: BookOpen, label: lang === "fa" ? "کل" : "Total", value: stats.total, color: "text-primary" },
            { icon: CheckCircle2, label: lang === "fa" ? "منتشرشده" : "Published", value: stats.published, color: "text-emerald-500" },
            { icon: FileEdit, label: lang === "fa" ? "پیش‌نویس" : "Drafts", value: stats.drafts, color: "text-amber-500" },
            { icon: Users, label: lang === "fa" ? "خوانندگان" : "Readers", value: stats.readers, color: "text-accent" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="paper-card rounded-2xl p-5"
            >
              <s.icon className={`w-6 h-6 mb-2 ${s.color}`} />
              <div className="text-3xl font-display font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </motion.div>
          ))}
        </div>
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {books.map((book, i) => {
            const title = lang === "en" && book.title_en ? book.title_en : book.title;
            const isDraft = book.status === "draft";
            const readers = readerStats[book.id] ?? 0;
            return (
              <motion.div
                key={book.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ y: -6 }}
                className="paper-card rounded-2xl overflow-hidden flex flex-col group relative"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
                  {book.cover_url && (
                    <img
                      src={resolveBookMedia(book.cover_url)}
                      alt={title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  )}
                  {book.category && (
                    <Badge className="absolute top-3 start-3 glass-strong text-foreground border-0">{book.category}</Badge>
                  )}
                  <Badge className={`absolute top-3 end-3 border-0 ${
                    isDraft ? "bg-amber-500 text-white" : "bg-emerald-500 text-white"
                  }`}>
                    {isDraft
                      ? (lang === "fa" ? "پیش‌نویس" : "Draft")
                      : (lang === "fa" ? "منتشر شد" : "Live")}
                  </Badge>
                </div>
                <div className="p-5 flex-1 flex flex-col gap-3">
                  <div>
                    <h3 className="font-display font-bold text-lg leading-tight line-clamp-2">{title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{book.author}</p>
                  </div>
                  {isMe && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {readers}</span>
                      <span className="font-semibold text-primary">
                        {book.price === 0
                          ? (lang === "fa" ? "رایگان" : "Free")
                          : `${book.price.toLocaleString()} ${lang === "fa" ? "ت" : "T"}`}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2 mt-auto flex-wrap">
                    {isMe ? (
                      <>
                        <Link to={`/edit/${book.id}`} className="flex-1 min-w-[100px]">
                          <Button size="sm" variant="outline" className="gap-1.5 w-full">
                            <Pencil className="w-3.5 h-3.5" /> {lang === "fa" ? "ویرایش" : "Edit"}
                          </Button>
                        </Link>
                        {isDraft && (
                          <Link to={`/publish/${book.id}`}>
                            <Button size="sm" className="gap-1.5 bg-gradient-warm">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {lang === "fa" ? "انتشار" : "Publish"}
                            </Button>
                          </Link>
                        )}
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
    </main>
  );
};

export default Publisher;
