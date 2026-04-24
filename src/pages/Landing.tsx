import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Sparkles, Volume2, BookMarked, Share2, Trophy, Brain } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import heroImg from "@/assets/hero-book.jpg";

const Landing = () => {
  const { t, dir } = useI18n();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  const features = [
    { icon: Sparkles, key: "f_ai" },
    { icon: BookMarked, key: "f_ambient" },
    { icon: Brain, key: "f_flip" },
    { icon: Volume2, key: "f_voice" },
    { icon: Share2, key: "f_share" },
    { icon: Trophy, key: "f_gamify" },
  ] as const;

  return (
    <main className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero">
        <div className="absolute inset-0 ambient-paper opacity-60" />
        <div className="container relative grid md:grid-cols-2 gap-12 items-center py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm font-medium">
              <Sparkles className="w-4 h-4 text-accent" />
              {t("tagline")}
            </div>
            <h1 className="text-5xl md:text-7xl font-display font-bold leading-[1.05] text-balance">
              <span className="block">{t("hero_title")}</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl text-balance">
              {t("hero_sub")}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link to="/store">
                <Button size="lg" className="bg-gradient-warm hover:opacity-90 shadow-glow gap-2 text-base h-12 px-7">
                  {t("cta_explore")}
                  <Arrow className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline" className="gap-2 text-base h-12 px-7 glass">
                  {t("cta_start")}
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9, rotate: -2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="absolute -inset-8 bg-gradient-gold blur-3xl opacity-30 animate-float-slow" />
            <motion.img
              src={heroImg}
              alt="Interactive open book glowing with golden light"
              width={1536}
              height={1024}
              className="relative rounded-3xl book-shadow w-full h-auto"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="container py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16 space-y-3"
        >
          <h2 className="text-4xl md:text-5xl font-display font-bold">{t("feat_title")}</h2>
          <div className="w-16 h-1 mx-auto bg-gradient-warm rounded-full" />
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, key }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              whileHover={{ y: -6 }}
              className="paper-card rounded-2xl p-6 group cursor-default"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-warm flex items-center justify-center mb-4 group-hover:shadow-glow transition-shadow">
                <Icon className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-display font-semibold mb-2">{t(key)}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{t(`${key}_d` as never)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/40 py-8 text-center text-sm text-muted-foreground">
        © 2026 {t("brand")}
      </footer>
    </main>
  );
};

export default Landing;
