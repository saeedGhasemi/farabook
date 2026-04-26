// Navbar bell with unread badge. Shows recent notifications in a popover.
import { Bell, CheckCheck, Coins, ShoppingBag, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications } from "@/hooks/useNotifications";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const iconFor = (type: string) => {
  switch (type) {
    case "revenue_received": return Coins;
    case "purchase_success": return ShoppingBag;
    case "fee_charged": return Sparkles;
    default: return Bell;
  }
};

const formatTime = (iso: string, lang: "fa" | "en") => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return lang === "fa" ? "لحظاتی پیش" : "just now";
  if (mins < 60) return lang === "fa" ? `${mins} دقیقه پیش` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return lang === "fa" ? `${hours} ساعت پیش` : `${hours}h ago`;
  return d.toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US");
};

export const NotificationsBell = () => {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { items, unread, markRead, markAllRead } = useNotifications();

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={lang === "fa" ? "اعلان‌ها" : "Notifications"}
        >
          <Bell className="w-5 h-5" />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center shadow-sm"
              >
                {unread > 9 ? "9+" : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0 glass-strong">
        <div className="flex items-center justify-between p-3 border-b border-border/40">
          <h3 className="font-display font-bold text-sm">
            {lang === "fa" ? "اعلان‌ها" : "Notifications"}
          </h3>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 text-xs gap-1">
              <CheckCheck className="w-3.5 h-3.5" />
              {lang === "fa" ? "همه را خوانده‌شده کن" : "Mark all read"}
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[380px]">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {lang === "fa" ? "اعلانی ندارید" : "No notifications yet"}
            </div>
          ) : (
            <ul className="py-1">
              {items.map((n) => {
                const Icon = iconFor(n.type);
                const Content: any = n.link ? Link : "div";
                return (
                  <li key={n.id}>
                    <Content
                      to={n.link || undefined}
                      onClick={() => !n.is_read && markRead(n.id)}
                      className={cn(
                        "flex gap-3 p-3 hover:bg-accent/10 cursor-pointer transition-colors border-b border-border/30 last:border-0",
                        !n.is_read && "bg-accent/5",
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        n.type === "revenue_received" ? "bg-primary/15 text-primary"
                          : n.type === "purchase_success" ? "bg-secondary text-secondary-foreground"
                          : "bg-accent/15 text-accent",
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight">{n.title}</p>
                          {!n.is_read && (
                            <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-1.5" />
                          )}
                        </div>
                        {n.body && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {formatTime(n.created_at, lang)}
                        </p>
                      </div>
                    </Content>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
