import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns the user's available credit balance computed from credit_transactions.
 * Falls back to 0 when not signed in.
 */
export const useCredits = () => {
  const { user } = useAuth();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
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
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { credits, loading, refresh };
};
