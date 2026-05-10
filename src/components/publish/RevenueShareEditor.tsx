// Revenue share editor used inside the Publish wizard.
// The platform fee (book purchase percent) is reserved at the top and the
// remaining percentage can be allocated to author / editor(s) — whatever
// is left automatically goes to the publisher.
import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Loader2, Coins, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export interface ShareRow {
  user_id: string;
  role: "author" | "editor";
  percent: number;
  display_name?: string;
}

interface Props {
  bookId: string;
  publisherId: string;
  authorUserId: string | null;
  lang: "fa" | "en";
  onSavedChange?: (allShares: ShareRow[]) => void;
}

export const RevenueShareEditor = ({
  bookId,
  publisherId,
  authorUserId,
  lang,
  onSavedChange,
}: Props) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platformPct, setPlatformPct] = useState(0);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, string>>({});

  // Load fee settings + existing shares + relevant profile names
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [feesRes, shRes, edRes] = await Promise.all([
        supabase.from("platform_fee_settings").select("book_purchase_mode, book_purchase_value").eq("id", 1).maybeSingle(),
        supabase.from("book_revenue_shares").select("*").eq("book_id", bookId),
        supabase.from("book_editors").select("editor_id, can_publish").eq("book_id", bookId),
      ]);
      if (cancelled) return;
      const fees: any = feesRes.data;
      const pct = fees?.book_purchase_mode === "percent" ? Number(fees.book_purchase_value) : 0;
      setPlatformPct(pct);

      const existing = ((shRes.data as any[]) || []).map((r) => ({
        user_id: r.user_id, role: r.role, percent: Number(r.percent),
      })) as ShareRow[];

      // Seed from suggestions if no rows yet
      let seeded = existing;
      if (existing.length === 0) {
        const sugg: ShareRow[] = [];
        if (authorUserId && authorUserId !== publisherId) {
          sugg.push({ user_id: authorUserId, role: "author", percent: Math.max(0, 100 - pct - 10) });
        }
        ((edRes.data as any[]) || []).forEach((e) => {
          if (e.editor_id !== publisherId && e.editor_id !== authorUserId) {
            sugg.push({ user_id: e.editor_id, role: "editor", percent: 10 });
          }
        });
        seeded = sugg;
      }
      setShares(seeded);

      // Resolve names
      const ids = Array.from(new Set([
        publisherId,
        ...(authorUserId ? [authorUserId] : []),
        ...seeded.map((s) => s.user_id),
        ...(((edRes.data as any[]) || []).map((e) => e.editor_id)),
      ]));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, username")
          .in("id", ids);
        const map: Record<string, string> = {};
        ((profs as any[]) || []).forEach((p) => {
          map[p.id] = p.display_name || p.username || p.id.slice(0, 8);
        });
        if (!cancelled) setProfilesById(map);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookId, publisherId, authorUserId]);

  const totalAssigned = useMemo(
    () => shares.reduce((s, r) => s + (Number(r.percent) || 0), 0),
    [shares],
  );
  const publisherShare = Math.max(0, 100 - platformPct - totalAssigned);
  const tooMuch = totalAssigned + platformPct > 100;

  const updatePercent = (i: number, val: number) => {
    setShares((cur) => cur.map((r, idx) => (idx === i ? { ...r, percent: val } : r)));
  };
  const removeRow = (i: number) => {
    setShares((cur) => cur.filter((_, idx) => idx !== i));
  };
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"author" | "editor">("editor");
  const [addingLookup, setAddingLookup] = useState(false);

  const submitAdd = async () => {
    const email = addEmail.trim();
    if (!email) {
      toast.error(lang === "fa" ? "ایمیل را وارد کنید" : "Enter an email");
      return;
    }
    setAddingLookup(true);
    const { data: uid, error } = await (supabase.rpc as any)("find_user_by_email", { _email: email });
    setAddingLookup(false);
    if (error) return toast.error(error.message);
    if (!uid) {
      toast.error(lang === "fa"
        ? "این کاربر در سامانه ثبت نیست — نویسنده/ادیتور باید عضو سامانه باشد."
        : "User not registered in the system.");
      return;
    }
    if (uid === publisherId) {
      toast.message(lang === "fa" ? "ناشر سهم باقیمانده را خودکار دریافت می‌کند." : "Publisher gets the remainder automatically.");
      return;
    }
    if (shares.some((s) => s.user_id === uid && s.role === addRole)) {
      toast.error(lang === "fa" ? "این کاربر با همین نقش قبلاً اضافه شده" : "Already added with this role");
      return;
    }
    setShares((cur) => [...cur, { user_id: uid, role: addRole, percent: 0 }]);
    const { data: prof } = await supabase
      .from("profiles").select("display_name, username").eq("id", uid).maybeSingle();
    if (prof) {
      setProfilesById((m) => ({ ...m, [uid]: (prof as any).display_name || (prof as any).username || uid.slice(0, 8) }));
    }
    setAddEmail("");
    setAddRole("editor");
    setAddOpen(false);
  };

  const save = async () => {
    if (tooMuch) {
      toast.error(lang === "fa" ? "مجموع سهم‌ها بیش از ۱۰۰٪ است" : "Shares exceed 100%");
      return;
    }
    setSaving(true);
    const { error } = await (supabase.rpc as any)("set_book_revenue_shares", {
      _book_id: bookId,
      _shares: shares.map((s) => ({ user_id: s.user_id, role: s.role, percent: s.percent })),
    });
    setSaving(false);
    if (error) {
      if (String(error.message).includes("shares_exceed_100")) {
        toast.error(lang === "fa" ? "مجموع سهم‌ها بیش از سهم مجاز" : "Shares exceed allowance");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success(lang === "fa" ? "سهم‌بندی ذخیره شد" : "Revenue split saved");
    onSavedChange?.(shares);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin me-2" />
        {lang === "fa" ? "در حال بارگذاری…" : "Loading…"}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {lang === "fa"
          ? "ابتدا سهم سامانه (طبق تنظیمات ادمین) کسر می‌شود. سهم نویسنده/ادیتور را تعیین کنید؛ باقیمانده به ناشر می‌رسد. فقط کاربران ثبت‌شده می‌توانند سهم بگیرند."
          : "Platform share is deducted first. Assign author/editor shares; the remainder goes to the publisher. Only registered users can receive shares."}
      </p>

      {/* Allocation summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Coins className="w-3 h-3" />
          {lang === "fa" ? "سهم سامانه" : "Platform"}: {platformPct}%
        </Badge>
        <Badge variant="outline">
          {lang === "fa" ? "تخصیص‌یافته" : "Assigned"}: {totalAssigned}%
        </Badge>
        <Badge className="bg-gradient-warm">
          {lang === "fa" ? "سهم ناشر (باقیمانده)" : "Publisher (remainder)"}: {publisherShare}%
        </Badge>
        {tooMuch && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="w-3 h-3" /> {lang === "fa" ? "بیش از ۱۰۰٪" : "Over 100%"}
          </Badge>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {shares.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            {lang === "fa"
              ? "سهمی برای دیگران تخصیص نیافته — همه باقیمانده به ناشر می‌رسد."
              : "No shares assigned — all remainder goes to the publisher."}
          </p>
        )}
        {shares.map((s, i) => (
          <div key={`${s.user_id}-${s.role}`} className="flex items-center gap-2 p-2 rounded-lg border bg-background/40">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {profilesById[s.user_id] || s.user_id.slice(0, 8) + "…"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {s.role === "author"
                  ? (lang === "fa" ? "نویسنده" : "Author")
                  : (lang === "fa" ? "ادیتور" : "Editor")}
              </div>
            </div>
            <Input
              type="number"
              min={0}
              max={100}
              value={s.percent}
              onChange={(e) => updatePercent(i, Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="w-20 h-9 text-sm"
            />
            <span className="text-xs text-muted-foreground w-4">%</span>
            <Button size="sm" variant="ghost" onClick={() => removeRow(i)} className="h-9 w-9 p-0">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1">
          <Plus className="w-3.5 h-3.5" />
          {lang === "fa" ? "افزودن نویسنده/ادیتور" : "Add author/editor"}
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" onClick={save} disabled={saving || tooMuch}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
          {lang === "fa" ? "ذخیره سهم‌بندی" : "Save split"}
        </Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir={lang === "fa" ? "rtl" : "ltr"} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {lang === "fa" ? "افزودن نویسنده/ادیتور" : "Add author / editor"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{lang === "fa" ? "نقش" : "Role"}</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={addRole === "author" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAddRole("author")}
                  className="justify-center"
                >
                  {lang === "fa" ? "نویسنده" : "Author"}
                </Button>
                <Button
                  type="button"
                  variant={addRole === "editor" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAddRole("editor")}
                  className="justify-center"
                >
                  {lang === "fa" ? "ادیتور" : "Editor"}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {lang === "fa" ? "ایمیل کاربر ثبت‌شده" : "Registered user email"}
              </Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                {lang === "fa" ? "انصراف" : "Cancel"}
              </Button>
              <Button type="button" size="sm" onClick={submitAdd} disabled={addingLookup}>
                {addingLookup ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
                {lang === "fa" ? "افزودن" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
