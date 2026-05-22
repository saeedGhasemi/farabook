import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

export const InstallAppButton = () => {
  const { lang } = useI18n();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setAvailable(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!available) return null;
  return (
    <Link to="/install">
      <Button variant="ghost" size="sm" className="gap-1.5" title={lang === "fa" ? "نصب اپ" : "Install app"}>
        <Download className="w-4 h-4" />
        <span className="hidden lg:inline">{lang === "fa" ? "نصب اپ" : "Install"}</span>
      </Button>
    </Link>
  );
};
