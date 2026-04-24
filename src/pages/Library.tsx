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
  } | null;
}

const Library = () => {
  const { t, lang } = useI18n();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!loading && !user) nav("/auth");
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_books")
      .select("id, status, progress, current_page, acquired_via, books(id, title, title_en, author, cover_url, category)")
      .eq("user_id", user.id)
      .then(({ data }) => setRows((data as unknown as Row[]) ?? []));
  }, [user]);

  const statusLabel = (s: string) =>
    s === "reading" ? t("status_reading") : s === "finished" ? t("status_finished") : t("status_unread");

  return (
    <main className="container py-10 md:py-16 min-h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl font-display font-bold">
          {t("library_title")}
        </motion.h1>
        <Link to="/upload">
          <Button className="bg-gradient-warm hover:opacity-90 gap-2">
            <BookOpen className="w-4 h-4" />
            {lang === "fa" ? "ساخت کتاب از ورد" : "Import from Word"}
          </Button>
        </Link>
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {rows.map((r, i) => {
            if (!r.books) return null;
            const title = lang === "en" && r.books.title_en ? r.books.title_en : r.books.title;
            return (
              <motion.div key={r.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -6 }}
                className="paper-card rounded-2xl overflow-hidden flex group"
              >
                <Link to={`/read/${r.books.id}`} className="flex w-full">
                  <div className="w-32 flex-shrink-0 aspect-[3/4] overflow-hidden bg-secondary">
                    {r.books.cover_url && (
                      <img src={r.books.cover_url} alt={title} loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col gap-2">
                    <div>
                      <h3 className="font-display font-bold leading-tight line-clamp-2">{title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{r.books.author}</p>
                    </div>
                    <Badge variant="outline" className="w-fit text-xs">{statusLabel(r.status)}</Badge>
                    <div className="mt-auto">
                      <Progress value={r.progress} className="h-1.5" />
                      <p className="text-xs text-muted-foreground mt-1">{Math.round(r.progress)}%</p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </main>
  );
};

export default Library;
