import { useEffect, useState } from "react";
import { z } from "zod";
import { MessageCircle, Send, Loader2, Trash2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  rating: number | null;
  edited: boolean;
  created_at: string;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "متن نظر لازم است").max(4000, "حداکثر ۴۰۰۰ کاراکتر"),
  rating: z.number().int().min(1).max(5).optional(),
});

interface Props {
  bookId: string;
}

export const BookComments = ({ bookId }: Props) => {
  const { user } = useAuth();
  const { isAdmin, has } = useRoles();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const canModerate = isAdmin || has("moderator");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("book_comments")
      .select("id, user_id, body, rating, edited, created_at, profiles:user_id(display_name, avatar_url)")
      .eq("book_id", bookId)
      .order("created_at", { ascending: false });
    setComments((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (bookId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const submit = async () => {
    if (!user) return toast.error("برای ثبت نظر وارد شوید");
    const parsed = commentSchema.safeParse({ body, rating: rating ?? undefined });
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      return toast.error(first || "ورودی نامعتبر");
    }
    setPosting(true);
    const { error } = await supabase.from("book_comments").insert({
      book_id: bookId,
      user_id: user.id,
      body: parsed.data.body,
      rating: parsed.data.rating ?? null,
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    setBody("");
    setRating(null);
    toast.success("نظر شما ثبت شد");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("book_comments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("حذف شد");
    setComments((c) => c.filter((x) => x.id !== id));
  };

  return (
    <section className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-accent" />
        نظرات کاربران
        <Badge variant="outline" className="ms-auto text-xs">{comments.length}</Badge>
      </h3>

      {user ? (
        <div className="rounded-xl border bg-card p-3 space-y-2">
          <Textarea
            rows={3}
            maxLength={4000}
            placeholder="نظر خود را بنویسید…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground me-1">امتیاز:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? null : n)}
                  className="p-0.5"
                  aria-label={`امتیاز ${n}`}
                >
                  <Star
                    className={`w-4 h-4 transition-colors ${
                      rating && n <= rating ? "fill-accent text-accent" : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
              <span className="text-xs text-muted-foreground ms-2">{body.length}/4000</span>
            </div>
            <Button size="sm" onClick={submit} disabled={posting || !body.trim()} className="gap-1.5 bg-gradient-warm">
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              ارسال نظر
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground text-center">
          برای ثبت نظر <Link to="/auth" className="text-primary underline">وارد شوید</Link>.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-4">هنوز نظری ثبت نشده. اولین نفر باشید.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const canDelete = user?.id === c.user_id || canModerate;
            return (
              <div key={c.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    {c.profiles?.avatar_url && <AvatarImage src={c.profiles.avatar_url} />}
                    <AvatarFallback className="text-xs">
                      {(c.profiles?.display_name || "?").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.profiles?.display_name || "کاربر"}
                      </span>
                      <span>•</span>
                      <span>{new Date(c.created_at).toLocaleDateString("fa-IR")}</span>
                      {c.edited && <span className="italic">(ویرایش‌شده)</span>}
                      {c.rating && (
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: c.rating }).map((_, i) => (
                            <Star key={i} className="w-3 h-3 fill-accent text-accent" />
                          ))}
                        </span>
                      )}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ms-auto h-6 w-6 p-0 text-destructive"
                          onClick={() => remove(c.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap leading-relaxed">{c.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
