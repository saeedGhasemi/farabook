import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CREDITS_REFRESH_EVENT } from "@/lib/credits-bus";

/**
 * Returns the user's available credit balance computed from credit_transactions.
 * Falls back to 0 when not signed in. Listens to the global `credits:refresh`
 * event so any component can trigger a balance refresh after a transaction.
 */
export const useCredits = () => {
  const { user } = useAuth();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setCredits(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("credit_transactions")
      .select("amount")
      .eq("user_id", user.id);
    const total = ((data as any[]) || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    setCredits(total);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(CREDITS_REFRESH_EVENT, handler);
    return () => window.removeEventListener(CREDITS_REFRESH_EVENT, handler);
  }, [refresh]);

  return { credits, loading, refresh };
};
