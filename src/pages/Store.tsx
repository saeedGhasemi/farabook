import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, ShoppingBag, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { resolveBookMedia } from "@/lib/book-media";

const resolveCover = (s: string | null) => resolveBookMedia(s);

interface Book {
  id: string;
  title: string;
  title_en: string | null;
  author: string;
  publisher: string | null;
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

  useEffect(() => {
    supabase.from("books").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setBooks(data ?? []));
  }, []);

  useEffect(() => {
    if (!user) { setOwned(new Set()); return; }
    supabase.from("user_books").select("book_id").eq("user_id", user.id)
      .then(({ data }) => setOwned(new Set((data ?? []).map((d) => d.book_id))));
  }, [user]);

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
          const title = lang === "en" && book.title_en ? book.title_en : book.title;
          return (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
              whileHover={{ y: -8 }}
              className="paper-card rounded-2xl overflow-hidden flex flex-col group"
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
                  {isOwned ? (
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
    </main>
  );
};

export default Store;
