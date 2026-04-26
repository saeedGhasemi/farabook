import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole =
  | "super_admin"
  | "admin"
  | "moderator"
  | "reviewer"
  | "publisher"
  | "editor"
  | "user";

export const useRoles = () => {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRoles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!cancelled) {
        setRoles(((data as any[]) || []).map((r) => r.role as AppRole));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const has = (r: AppRole) => roles.includes(r);
  const hasAny = (...r: AppRole[]) => r.some((x) => roles.includes(x));

  return {
    roles,
    loading,
    has,
    hasAny,
    isSuperAdmin: has("super_admin"),
    isAdmin: hasAny("super_admin", "admin"),
    isModerator: hasAny("super_admin", "admin", "moderator"),
    isPublisher: has("publisher"),
    isEditor: has("editor"),
    isReviewer: has("reviewer"),
  };
};
