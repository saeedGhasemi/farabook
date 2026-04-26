// In-app notifications hook. Listens for real-time inserts via Supabase
// realtime and exposes unread count + recent items + helpers.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: any;
  is_read: boolean;
  created_at: string;
}

const PAGE_SIZE = 20;

export const useNotifications = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnread(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const list = (data as any[]) || [];
    setItems(list as any);
    setUnread(list.filter((n) => !n.is_read).length);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: any insert/update for this user → refresh.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refresh]);

  const markRead = async (id: string) => {
    await supabase.from("notifications" as any).update({ is_read: true }).eq("id", id);
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications" as any)
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    setItems((cur) => cur.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  };

  return { items, unread, loading, refresh, markRead, markAllRead };
};
