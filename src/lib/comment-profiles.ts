import { supabase } from "@/integrations/supabase/client";

export interface CommentProfile {
  display_name: string | null;
  avatar_url: string | null;
}

export const attachCommentProfiles = async <T extends { user_id: string }>(rows: T[]) => {
  const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  if (ids.length === 0) return rows.map((row) => ({ ...row, profiles: null as CommentProfile | null }));

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);

  const profiles = new Map(
    ((data as Array<{ id: string } & CommentProfile>) ?? []).map((p) => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]),
  );

  return rows.map((row) => ({ ...row, profiles: profiles.get(row.user_id) ?? null }));
};