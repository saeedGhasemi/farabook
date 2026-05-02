// Dialog for publishers to manage comments on a single book of theirs.
// They can toggle the global "comments_enabled" switch on the book and
// show/hide individual comments without deleting them.
import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Eye, EyeOff, Trash2, Star } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  rating: number | null;
  is_hidden: boolean;
  created_at: string;
  auto_flagged?: boolean;
  flag_reason?: string | null;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

interface Props {
  bookId: string | null;
  bookTitle: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const PublisherCommentsDialog = ({ bookId, bookTitle, open, onOpenChange }: Props) => {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !bookId) return;
    setLoading(true);
    (async () => {
      const [{ data: bk }, { data }] = await Promise.all([
        supabase.from("books").select("comments_enabled").eq("id", bookId).maybeSingle(),
        supabase
          .from("book_comments")
          .select("id, user_id, body, rating, is_hidden, created_at, profiles:user_id(display_name, avatar_url)")
          .eq("book_id", bookId)
          .order("created_at", { ascending: false }),
      ]);
      setEnabled((bk as { comments_enabled?: boolean } | null)?.comments_enabled !== false);
      setComments((data as unknown as CommentRow[]) || []);
      setLoading(false);
    })();
  }, [open, bookId]);

  const toggleEnabled = async (next: boolean) => {
    if (!bookId) return;
    setEnabled(next);
    const { error } = await (supabase.from("books") as unknown as {
      update: (v: { comments_enabled: boolean }) => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> };
    }).update({ comments_enabled: next }).eq("id", bookId);
    if (error) {
      setEnabled(!next);
      toast.error(error.message);
    } else {
      toast.success(next ? "کامنت‌گذاری فعال شد" : "کامنت‌گذاری بسته شد");
    }
  };

  const toggleHidden = async (c: CommentRow) => {
    const next = !c.is_hidden;
    const { error } = await (supabase.from("book_comments") as unknown as {
      update: (v: { is_hidden: boolean }) => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> };
    }).update({ is_hidden: next }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setComments((arr) => arr.map((x) => (x.id === c.id ? { ...x, is_hidden: next } : x)));
    toast.success(next ? "مخفی شد" : "نمایش داده شد");
  };

  const remove = async (id: string) => {
    if (!confirm("این کامنت برای همیشه حذف شود؟")) return;
    const { error } = await supabase.from("book_comments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setComments((arr) => arr.filter((x) => x.id !== id));
    toast.success("حذف شد");
  };

  const total = comments.length;
  const hidden = comments.filter((c) => c.is_hidden).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0" dir="rtl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-accent" />
            مدیریت نظرات
          </DialogTitle>
          <DialogDescription className="truncate">{bookTitle}</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b flex items-center justify-between gap-3 bg-muted/30">
          <div className="text-sm">
            <span className="font-medium">امکان کامنت‌گذاری روی این کتاب</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              با خاموش کردن این کلید، کاربران دیگر نمی‌توانند نظر جدیدی روی این کتاب بنویسند.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={toggleEnabled} />
        </div>

        <div className="px-6 py-2 border-b text-xs text-muted-foreground flex items-center gap-3">
          <span>کل: <span className="font-mono text-foreground">{total.toLocaleString("fa-IR")}</span></span>
          <span>پنهان: <span className="font-mono text-foreground">{hidden.toLocaleString("fa-IR")}</span></span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-0">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground italic">
              هنوز نظری روی این کتاب ثبت نشده است.
            </p>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-xl border bg-card p-3 ${c.is_hidden ? "opacity-60 border-dashed" : ""}`}
                >
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
                        {c.is_hidden && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <EyeOff className="w-3 h-3" /> پنهان
                          </Badge>
                        )}
                        {c.rating && (
                          <span className="flex items-center gap-0.5">
                            {Array.from({ length: c.rating }).map((_, i) => (
                              <Star key={i} className="w-3 h-3 fill-accent text-accent" />
                            ))}
                          </span>
                        )}
                        <div className="ms-auto flex items-center gap-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs"
                            onClick={() => toggleHidden(c)}
                          >
                            {c.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            {c.is_hidden ? "نمایش" : "پنهان"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => remove(c.id)}
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm mt-1.5 whitespace-pre-wrap leading-relaxed">{c.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
