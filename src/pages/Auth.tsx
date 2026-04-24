import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Auth = () => {
  const { t } = useI18n();
  const nav = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav("/library");
  }, [user, nav]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/library` },
        });
        if (error) throw error;
        toast.success("✓");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-hero p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="glass-strong rounded-3xl p-8 shadow-book">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow mb-4">
              <BookOpen className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-display font-bold">
              {mode === "signin" ? t("welcome_back") : t("create_account")}
            </h1>
          </div>

          <form onSubmit={handle} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("email")}</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>{t("password")}</Label>
              <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-warm hover:opacity-90 shadow-soft">
              {busy ? "..." : mode === "signin" ? t("signin") : t("signup")}
            </Button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="block mx-auto mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === "signin" ? t("switch_signup") : t("switch_signin")}
          </button>
        </div>
      </motion.div>
    </main>
  );
};

export default Auth;
