import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, Library, Store, LogIn, LogOut, Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Navbar = () => {
  const { t, lang, setLang, dir } = useI18n();
  const { user } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  const links = [
    { to: "/", label: t("nav_home"), icon: BookOpen },
    { to: "/library", label: t("nav_library"), icon: Library },
    { to: "/store", label: t("nav_store"), icon: Store },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    nav("/");
  };

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="glass-strong border-b border-border/40">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-warm flex items-center justify-center shadow-glow group-hover:scale-110 transition-transform">
              <BookOpen className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-display font-bold gold-text">{t("brand")}</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map(({ to, label, icon: Icon }) => {
              const active = loc.pathname === to;
              return (
                <Link key={to} to={to}>
                  <motion.div
                    whileHover={{ y: -2 }}
                    whileTap={{ y: 0 }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      active ? "bg-primary text-primary-foreground shadow-soft" : "text-foreground/70 hover:text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </motion.div>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang(lang === "fa" ? "en" : "fa")}
              className="gap-1.5"
            >
              <Languages className="w-4 h-4" />
              {lang === "fa" ? "EN" : "فا"}
            </Button>
            {user ? (
              <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">{t("nav_signout")}</span>
              </Button>
            ) : (
              <Button size="sm" onClick={() => nav("/auth")} className="gap-1.5 bg-gradient-warm hover:opacity-90">
                <LogIn className="w-4 h-4" />
                {t("nav_signin")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
};
