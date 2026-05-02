// Admin panel for managing the auto-moderation rules applied to book comments.
// Rules: link blocking, @mention blocking, sensitive-word list, and whether
// flagged comments are auto-hidden or just marked for review.
import { useEffect, useState } from "react";
import { Loader2, Save, ShieldAlert, Eye, EyeOff, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Settings {
  sensitive_words: string[];
  block_links: boolean;
  block_mentions: boolean;
  auto_hide: boolean;
}

interface FlaggedRow {
  id: string;
  body: string;
  flag_reason: string | null;
  is_hidden: boolean;
  created_at: string;
  book_id: string;
}

export const CommentModerationPanel = () => {
  const [s, setS] = useState<Settings>({
    sensitive_words: [],
    block_links: true,
    block_mentions: false,
    auto_hide: true,
  });
  const [newWord, setNewWord] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flagged, setFlagged] = useState<FlaggedRow[]>([]);

  const load = async () => {
    setLoading(true);
    const [{ data: cfg }, { data: rows }] = await Promise.all([
      (supabase.from as any)("comment_moderation_settings").select("*").eq("id", 1).maybeSingle(),
      (supabase.from as any)("book_comments")
        .select("id, body, flag_reason, is_hidden, created_at, book_id")
        .eq("auto_flagged", true)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (cfg) setS({
      sensitive_words: cfg.sensitive_words || [],
      block_links: !!cfg.block_links,
      block_mentions: !!cfg.block_mentions,
      auto_hide: !!cfg.auto_hide,
    });
    setFlagged((rows as FlaggedRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from as any)("comment_moderation_settings")
      .update({
        sensitive_words: s.sensitive_words,
        block_links: s.block_links,
        block_mentions: s.block_mentions,
        auto_hide: s.auto_hide,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("تنظیمات ذخیره شد");
  };

  const addWord = () => {
    const w = newWord.trim();
    if (!w) return;
    if (s.sensitive_words.includes(w)) return;
    setS({ ...s, sensitive_words: [...s.sensitive_words, w] });
    setNewWord("");
  };

  const removeWord = (w: string) =>
    setS({ ...s, sensitive_words: s.sensitive_words.filter((x) => x !== w) });

  const toggleHidden = async (c: FlaggedRow) => {
    const next = !c.is_hidden;
    const { error } = await (supabase.from as any)("book_comments")
      .update({ is_hidden: next })
      .eq("id", c.id);
    if (error) return toast.error(error.message);
    setFlagged((arr) => arr.map((x) => x.id === c.id ? { ...x, is_hidden: next } : x));
  };

  const remove = async (id: string) => {
    if (!confirm("این کامنت برای همیشه حذف شود؟")) return;
    const { error } = await supabase.from("book_comments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setFlagged((arr) => arr.filter((x) => x.id !== id));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-accent" />
            قوانین تأیید خودکار نظرات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">مسدودسازی لینک</div>
                <div className="text-xs text-muted-foreground">کامنت‌های دارای URL یا دامنه</div>
              </div>
              <Switch checked={s.block_links} onCheckedChange={(v) => setS({ ...s, block_links: v })} />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">مسدودسازی @منشن</div>
                <div className="text-xs text-muted-foreground">@username در متن</div>
              </div>
              <Switch checked={s.block_mentions} onCheckedChange={(v) => setS({ ...s, block_mentions: v })} />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">مخفی‌سازی خودکار</div>
                <div className="text-xs text-muted-foreground">در غیر این‌صورت فقط علامت می‌خورد</div>
              </div>
              <Switch checked={s.auto_hide} onCheckedChange={(v) => setS({ ...s, auto_hide: v })} />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">کلمات حساس</div>
            <div className="flex gap-2">
              <Input
                placeholder="افزودن کلمه…"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())}
              />
              <Button type="button" variant="outline" onClick={addWord} className="gap-1">
                <Plus className="w-4 h-4" /> افزودن
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
              {s.sensitive_words.length === 0 && (
                <span className="text-xs text-muted-foreground italic">هیچ کلمه‌ای ثبت نشده.</span>
              )}
              {s.sensitive_words.map((w) => (
                <Badge
                  key={w}
                  variant="secondary"
                  className="gap-1 cursor-pointer hover:bg-destructive/20"
                  onClick={() => removeWord(w)}
                  title="کلیک برای حذف"
                >
                  {w}
                  <Trash2 className="w-3 h-3" />
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              ذخیره تنظیمات
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            نظرات علامت‌خورده اخیر
            <Badge variant="outline" className="ms-auto">{flagged.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {flagged.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 italic">
              نظری برای بررسی وجود ندارد.
            </p>
          ) : (
            <div className="space-y-2">
              {flagged.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 ${c.is_hidden ? "opacity-70 border-dashed" : "border-amber-500/40 bg-amber-500/5"}`}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {c.flag_reason || "علامت‌خورده"}
                    </Badge>
                    <span>•</span>
                    <span>{new Date(c.created_at).toLocaleString("fa-IR")}</span>
                    <div className="ms-auto flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" onClick={() => toggleHidden(c)}>
                        {c.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {c.is_hidden ? "تأیید و نمایش" : "مخفی‌سازی"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => remove(c.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
