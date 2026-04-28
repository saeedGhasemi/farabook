import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Search, Sparkles, Flame, Clock, Briefcase,
  BookOpen, Stethoscope, Microscope, Brain, MapPin, BookText, Atom,
  GraduationCap, Palette as PaletteIcon, Layers,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { resolveBookMedia, resolveBookCover } from "@/lib/book-media";

interface Book {
  id: string;
  title: string;
  title_en: string | null;
  author: string;
  category: string | null;
  cover_url: string | null;
  description: string | null;
  price: number;
  publisher_id: string | null;
  created_at: string;
  ai_summary: string | null;
}

interface PublisherCard {
  id: string;
  display_name: string | null;
  count: number;
  cover_url: string | null;
}

// Icon mapping for known categories (Persian + English keywords)
const categoryIcon = (cat: string) => {
  const c = cat.toLowerCase();
  if (c.includes("پاتولوژی") || c.includes("path")) return Microscope;
  if (c.includes("هماتو") || c.includes("hema")) return Stethoscope;
  if (c.includes("اعصاب") || c.includes("neuro") || c.includes("ذهن")) return Brain;
  if (c.includes("پزشک") || c.includes("med")) return Stethoscope;
  if (c.includes("سفر") || c.includes("travel") || c.includes("جغراف")) return MapPin;
  if (c.includes("ادب") || c.includes("liter") || c.includes("شعر")) return BookText;
  if (c.includes("علوم") || c.includes("science")) return Atom;
  if (c.includes("آموز") || c.includes("educ") || c.includes("درس")) return GraduationCap;
  if (c.includes("هنر") || c.includes("art")) return PaletteIcon;
  return Layers;
};

const Landing = () => {
  const { t, lang, dir } = useI18n();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const nav = useNavigate();

  const [books, setBooks] = useState<Book[]>([]);
  const [readerCounts, setReaderCounts] = useState<Record<string, number>>({});
  const [publishers, setPublishers] = useState<PublisherCard[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("books")
        .select("id,title,title_en,author,category,cover_url,description,price,publisher_id,created_at,ai_summary")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      const list = (data as Book[]) ?? [];
      setBooks(list);

      if (list.length) {
        const ids = list.map((b) => b.id);
        const { data: ub } = await supabase.from("user_books").select("book_id").in("book_id", ids);
        const counts: Record<string, number> = {};
        (ub ?? []).forEach((r: any) => { counts[r.book_id] = (counts[r.book_id] ?? 0) + 1; });
        setReaderCounts(counts);
      }

      // Top publishers (only those with publisher_id set)
      const pubIds = Array.from(new Set(list.map((b) => b.publisher_id).filter(Boolean))) as string[];
      if (pubIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,display_name,avatar_url")
          .in("id", pubIds);
        const cards: PublisherCard[] = (profs ?? []).map((p: any) => {
          const pubBooks = list.filter((b) => b.publisher_id === p.id);
          return {
            id: p.id,
            display_name: p.display_name,
            count: pubBooks.length,
            cover_url: pubBooks[0]?.cover_url ?? null,
          };
        }).sort((a, b) => b.count - a.count).slice(0, 6);
        setPublishers(cards);
      }
    })();
  }, []);

  const featured = books[0];
  const trending = useMemo(() => {
    return [...books]
      .sort((a, b) => (readerCounts[b.id] ?? 0) - (readerCounts[a.id] ?? 0))
      .slice(0, 6);
  }, [books, readerCounts]);
  const fresh = books.slice(0, 6);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    books.forEach((b) => {
      if (b.category) m.set(b.category, (m.get(b.category) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [books]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    nav(`/store${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  const titleOf = (b: Book) => (lang === "en" && b.title_en ? b.title_en : b.title);

  return (
    <main className="relative">
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-hero">
        <div className="absolute inset-0 ambient-paper opacity-50" />
        <div className="container relative py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl mx-auto text-center space-y-5"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-sm font-medium">
              <Sparkles className="w-4 h-4 text-accent" />
              {t("tagline")}
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold leading-[1.05] text-balance">
              {t("hero_title")}
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              {t("hero_sub")}
            </p>

            <form onSubmit={onSearch} className="relative max-w-xl mx-auto pt-4">
              <Search className="absolute top-1/2 mt-2 -translate-y-1/2 start-4 w-5 h-5 text-muted-foreground pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("search_ph")}
                className="ps-12 pe-24 sm:pe-32 h-14 glass-strong text-base"
              />
              <Button type="submit" size="sm" className="absolute end-2 top-2 bottom-2 bg-gradient-warm px-3 sm:px-4">
                <Search className="w-4 h-4 sm:hidden" />
                <span className="hidden sm:inline">{t("nav_store")}</span>
                <Arrow className="w-4 h-4 ms-1 hidden sm:inline-block" />
              </Button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* FEATURED BOOK OF THE WEEK */}
      {featured && (
        <section className="container py-10 md:py-14 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="paper-card rounded-3xl overflow-hidden grid md:grid-cols-12 gap-0"
          >
            <div className="md:col-span-4 relative bg-secondary flex items-center justify-center p-5 md:p-6">
              <div className="relative w-40 sm:w-48 md:w-full md:max-w-[220px] aspect-[3/4] rounded-2xl overflow-hidden book-shadow">
                {featured.cover_url && (
                  <img
                    src={resolveBookCover(featured.cover_url, { width: 480, quality: 75 })}
                    srcSet={`${resolveBookCover(featured.cover_url, { width: 320, quality: 70 })} 320w, ${resolveBookCover(featured.cover_url, { width: 480, quality: 75 })} 480w, ${resolveBookCover(featured.cover_url, { width: 640, quality: 78 })} 640w`}
                    sizes="(max-width: 768px) 200px, 220px"
                    alt={titleOf(featured)}
                    loading="eager"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <Badge className="absolute top-4 start-4 bg-gradient-warm text-primary-foreground border-0 gap-1.5 shadow-glow">
                <Sparkles className="w-3.5 h-3.5" />
                {t("featured_label")}
              </Badge>
            </div>
            <div className="md:col-span-8 p-6 md:p-8 flex flex-col justify-center gap-3">
              {featured.category && (
                <Badge variant="secondary" className="w-fit">{featured.category}</Badge>
              )}
              <h2 className="text-2xl md:text-3xl font-display font-bold leading-tight">{titleOf(featured)}</h2>
              <p className="text-sm text-muted-foreground">{featured.author}</p>
              <p className="text-sm md:text-base text-foreground/80 line-clamp-3 md:line-clamp-4 leading-relaxed">
                {featured.ai_summary || featured.description}
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link to={`/read/${featured.id}`}>
                  <Button size="default" className="bg-gradient-warm hover:opacity-90 shadow-glow gap-2">
                    {t("read")} <Arrow className="w-4 h-4" />
                  </Button>
                </Link>
                <Link to="/store">
                  <Button size="default" variant="outline" className="glass">{t("see_all")}</Button>
                </Link>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* CATEGORIES */}
      {categories.length > 0 && (
        <section className="container py-12 md:py-16">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-3xl md:text-4xl font-display font-bold">{t("categories_title")}</h2>
              <div className="w-12 h-1 mt-3 bg-gradient-warm rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {categories.map((c, i) => {
              const Icon = categoryIcon(c.name);
              return (
                <motion.div
                  key={c.name}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    to={`/store?cat=${encodeURIComponent(c.name)}`}
                    className="paper-card rounded-2xl p-5 flex flex-col items-start gap-3 group hover:shadow-glow transition-shadow h-full"
                  >
                    <div className="w-11 h-11 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground group-hover:scale-110 transition-transform">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-display font-semibold text-base leading-tight">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.count} {t("books_count")}
                      </p>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* HOTTEST */}
      {trending.length > 0 && (
        <section className="container py-12 md:py-16">
          <SectionHeader icon={Flame} title={t("hot_books")} subtitle={t("hot_sub")} link="/store" linkLabel={t("see_all")} arrow={Arrow} />
          <BookRow books={trending} readerCounts={readerCounts} lang={lang} t={t} />
        </section>
      )}

      {/* FRESH */}
      {fresh.length > 0 && (
        <section className="container py-12 md:py-16">
          <SectionHeader icon={Clock} title={t("fresh_books")} subtitle={t("fresh_sub")} link="/store" linkLabel={t("see_all")} arrow={Arrow} />
          <BookRow books={fresh} readerCounts={readerCounts} lang={lang} t={t} />
        </section>
      )}

      {/* TOP PUBLISHERS */}
      {publishers.length > 0 && (
        <section className="container py-12 md:py-16">
          <SectionHeader icon={Briefcase} title={t("top_publishers")} arrow={Arrow} />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {publishers.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/publisher/${p.id}`}
                  className="paper-card rounded-2xl p-5 flex flex-col items-center text-center gap-3 hover:shadow-glow transition-shadow h-full"
                >
                  <div className="w-14 h-14 rounded-2xl bg-gradient-warm flex items-center justify-center text-primary-foreground">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-display font-semibold text-sm leading-tight line-clamp-2">
                      {p.display_name || (lang === "fa" ? "ناشر" : "Publisher")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.count} {t("books_count")}
                    </p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-border/40 py-8 mt-10 text-center text-sm text-muted-foreground">
        © 2026 {t("brand")}
      </footer>
    </main>
  );
};

const SectionHeader = ({
  icon: Icon, title, subtitle, link, linkLabel, arrow: Arrow,
}: { icon: any; title: string; subtitle?: string; link?: string; linkLabel?: string; arrow: any }) => (
  <div className="flex items-end justify-between mb-8 gap-4">
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-2xl md:text-3xl font-display font-bold leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
    {link && (
      <Link to={link} className="text-sm font-medium text-accent hover:underline flex items-center gap-1 shrink-0">
        {linkLabel} <Arrow className="w-3.5 h-3.5" />
      </Link>
    )}
  </div>
);

const BookRow = ({
  books, readerCounts, lang, t,
}: { books: Book[]; readerCounts: Record<string, number>; lang: string; t: any }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
    {books.map((b, i) => {
      const title = lang === "en" && b.title_en ? b.title_en : b.title;
      const readers = readerCounts[b.id] ?? 0;
      return (
        <motion.div
          key={b.id}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.04 }}
          whileHover={{ y: -5 }}
        >
          <Link to={`/read/${b.id}`} className="block group">
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-secondary book-shadow">
              {b.cover_url && (
                <img
                  src={resolveBookCover(b.cover_url, { width: 480, quality: 70 })}
                  srcSet={`${resolveBookCover(b.cover_url, { width: 320, quality: 65 })} 320w, ${resolveBookCover(b.cover_url, { width: 480, quality: 70 })} 480w`}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
                  alt={title}
                  loading="lazy"
                  decoding="async"
                  width={480}
                  height={640}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              )}
              {readers > 0 && (
                <Badge className="absolute top-2 end-2 glass-strong text-foreground border-0 text-[10px] gap-1">
                  <BookOpen className="w-3 h-3" /> {readers}
                </Badge>
              )}
            </div>
            <div className="mt-3 px-1">
              <p className="font-display font-semibold text-sm leading-tight line-clamp-2">{title}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{b.author}</p>
            </div>
          </Link>
        </motion.div>
      );
    })}
  </div>
);

export default Landing;
