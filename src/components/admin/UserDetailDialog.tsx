import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check, X, Save, Trash2, Plus, BookOpen, CreditCard, Shield, User as UserIcon, MessageSquare } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { AppRole } from "@/hooks/useRoles";
import {
  classifyTx,
  computeTotals,
  formatFa,
  reasonLabel,
  txAmountClass,
  txBadgeClass,
} from "@/lib/tx-display";

const ALL_ROLES: AppRole[] = ["super_admin", "admin", "moderator", "reviewer", "publisher", "editor", "user"];
const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "سوپر ادمین",
  admin: "ادمین",
  moderator: "ناظر محتوا",
  reviewer: "منتقد",
  publisher: "ناشر",
  editor: "ادیتور",
  user: "کاربر عادی",
};

interface Props {
  userId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}

export const UserDetailDialog = ({ userId, open, onOpenChange, onChanged }: Props) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [credits, setCredits] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [userBooks, setUserBooks] = useState<any[]>([]);
  const [authoredBooks, setAuthoredBooks] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [highlights, setHighlights] = useState<any[]>([]);
  const [publisherProfile, setPublisherProfile] = useState<any>(null);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const [
      { data: prof },
      { data: r },
      { data: tx },
      { data: ub },
      { data: ab },
      { data: cm },
      { data: hl },
      { data: pp },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("credit_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("user_books").select("*, books(id, title, author, cover_url)").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("books").select("id, title, status, review_status, created_at").eq("publisher_id", userId).order("created_at", { ascending: false }),
      supabase.from("book_comments").select("*, books(title)").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      supabase.from("highlights").select("*, books(title)").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      supabase.from("publisher_profiles").select("*").eq("user_id", userId).maybeSingle(),
    ]);
    setProfile(prof || { id: userId, display_name: "", bio: "", contact_email: "", contact_phone: "", website: "", avatar_url: "" });
    setRoles(((r as any[]) || []).map((x) => x.role as AppRole));
    const total = ((tx as any[]) || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    setCredits(total);
    setTransactions((tx as any[]) || []);
    setUserBooks((ub as any[]) || []);
    setAuthoredBooks((ab as any[]) || []);
    setComments((cm as any[]) || []);
    setHighlights((hl as any[]) || []);
    setPublisherProfile(pp || null);
    setLoading(false);
  };

  useEffect(() => {
    if (open && userId) load();
  }, [open, userId]);

  const saveProfile = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: profile.display_name,
        bio: profile.bio,
        contact_email: profile.contact_email,
        contact_phone: profile.contact_phone,
        website: profile.website,
        avatar_url: profile.avatar_url,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("پروفایل ذخیره شد");
      onChanged?.();
    }
  };

  const grantRole = async (role: AppRole) => {
    if (!userId) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[role]} اعطا شد`);
      load();
      onChanged?.();
    }
  };

  const revokeRole = async (role: AppRole) => {
    if (!userId) return;
    if (role === "user") return toast.error("نقش کاربر عادی قابل حذف نیست");
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[role]} لغو شد`);
      load();
      onChanged?.();
    }
  };

  const adjustCredits = async () => {
    if (!userId) return;
    const amt = Number(window.prompt("مقدار اعتبار (مثبت یا منفی):") || "0");
    if (!amt) return;
    const reason = window.prompt("دلیل:") || (amt > 0 ? "admin_grant" : "admin_deduct");
    const { error } = await supabase.from("credit_transactions").insert({
      user_id: userId,
      amount: amt,
      reason,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("اعتبار به‌روز شد");
      load();
      onChanged?.();
    }
  };

  const deleteComment = async (id: string) => {
    if (!confirm("حذف این کامنت؟")) return;
    const { error } = await supabase.from("book_comments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("حذف شد");
      load();
    }
  };

  const removeUserBook = async (id: string) => {
    if (!confirm("حذف این کتاب از قفسه کاربر؟")) return;
    const { error } = await supabase.from("user_books").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("حذف شد");
      load();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            جزئیات کاربر
            {userId && <span className="text-xs text-muted-foreground font-mono">{userId.slice(0, 8)}…</span>}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !profile ? (
          <p className="text-muted-foreground py-8 text-center">کاربر یافت نشد</p>
        ) : (
          <Tabs defaultValue="profile">
            <TabsList className="w-full flex-wrap h-auto">
              <TabsTrigger value="profile" className="gap-1"><UserIcon className="w-3.5 h-3.5" /> پروفایل</TabsTrigger>
              <TabsTrigger value="roles" className="gap-1"><Shield className="w-3.5 h-3.5" /> نقش‌ها ({roles.length})</TabsTrigger>
              <TabsTrigger value="credits" className="gap-1"><CreditCard className="w-3.5 h-3.5" /> اعتبار</TabsTrigger>
              <TabsTrigger value="library" className="gap-1"><BookOpen className="w-3.5 h-3.5" /> کتابخانه ({userBooks.length})</TabsTrigger>
              <TabsTrigger value="published" className="gap-1"><BookOpen className="w-3.5 h-3.5" /> منتشرشده ({authoredBooks.length})</TabsTrigger>
              <TabsTrigger value="activity" className="gap-1"><MessageSquare className="w-3.5 h-3.5" /> فعالیت</TabsTrigger>
            </TabsList>

            {/* Profile */}
            <TabsContent value="profile" className="space-y-3 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>نام نمایشی</Label>
                  <Input value={profile.display_name || ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
                </div>
                <div>
                  <Label>ایمیل تماس</Label>
                  <Input value={profile.contact_email || ""} onChange={(e) => setProfile({ ...profile, contact_email: e.target.value })} />
                </div>
                <div>
                  <Label>تلفن</Label>
                  <Input value={profile.contact_phone || ""} onChange={(e) => setProfile({ ...profile, contact_phone: e.target.value })} />
                </div>
                <div>
                  <Label>وب‌سایت</Label>
                  <Input value={profile.website || ""} onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>آواتار (URL)</Label>
                  <Input value={profile.avatar_url || ""} onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>بیوگرافی</Label>
                  <Textarea rows={3} value={profile.bio || ""} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
                </div>
              </div>
              {publisherProfile && (
                <div className="p-3 rounded-lg border bg-muted/30 text-sm">
                  <div className="font-medium mb-1">پروفایل ناشر</div>
                  <div className="text-xs text-muted-foreground">
                    {publisherProfile.display_name} • slug: {publisherProfile.slug} •{" "}
                    {publisherProfile.is_trusted ? <Badge variant="default" className="text-[10px]">معتمد</Badge> : <Badge variant="secondary" className="text-[10px]">عادی</Badge>}
                  </div>
                </div>
              )}
              <Button onClick={saveProfile} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                ذخیره پروفایل
              </Button>
            </TabsContent>

            {/* Roles */}
            <TabsContent value="roles" className="space-y-3 mt-4">
              <div className="flex flex-wrap gap-2">
                {roles.length === 0 && <span className="text-sm text-muted-foreground">بدون نقش</span>}
                {roles.map((r) => (
                  <Badge
                    key={r}
                    variant={r === "super_admin" ? "default" : "secondary"}
                    className="cursor-pointer gap-1 text-sm py-1 px-2"
                    onClick={() => revokeRole(r)}
                    title="کلیک برای حذف"
                  >
                    {ROLE_LABEL[r]}
                    {r !== "user" && <X className="w-3 h-3" />}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Select onValueChange={(v) => grantRole(v as AppRole)}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="افزودن نقش" /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.filter((r) => !roles.includes(r)).map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* Credits */}
            <TabsContent value="credits" className="space-y-3 mt-4">
              <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div>
                  <div className="text-xs text-muted-foreground">موجودی فعلی</div>
                  <div className="text-2xl font-bold">{credits.toLocaleString("fa-IR")}</div>
                </div>
                <Button onClick={adjustCredits} className="gap-1"><Plus className="w-4 h-4" /> تنظیم اعتبار</Button>
              </div>
              {(() => {
                const totals = computeTotals(transactions);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2 rounded border">
                      <div className="text-[10px] text-muted-foreground">واریز</div>
                      <div className="font-bold text-sm text-emerald-600 dark:text-emerald-400">{formatFa(totals.income)}</div>
                    </div>
                    <div className="p-2 rounded border">
                      <div className="text-[10px] text-muted-foreground">شارژ/اعطا</div>
                      <div className="font-bold text-sm text-orange-500 dark:text-orange-400">{formatFa(totals.topUp)}</div>
                    </div>
                    <div className="p-2 rounded border">
                      <div className="text-[10px] text-muted-foreground">برداشت</div>
                      <div className="font-bold text-sm text-destructive">{formatFa(totals.spent)}</div>
                    </div>
                    <div className="p-2 rounded border">
                      <div className="text-[10px] text-muted-foreground">بالانس</div>
                      <div className="font-bold text-sm">{formatFa(totals.balance)}</div>
                    </div>
                  </div>
                );
              })()}
              <div className="max-h-72 overflow-y-auto rounded border">
                {transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">تراکنشی نیست</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">زمان</TableHead>
                        <TableHead className="text-right">عنوان</TableHead>
                        <TableHead className="text-right text-emerald-600 dark:text-emerald-400">واریز</TableHead>
                        <TableHead className="text-right text-destructive">برداشت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((t) => {
                        const amt = Number(t.amount);
                        const kind = classifyTx(amt, t.reason);
                        const isWithdrawal = kind === "withdrawal";
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="text-[11px] whitespace-nowrap">
                              {new Date(t.created_at).toLocaleDateString("fa-IR")}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] border-0 ${txBadgeClass[kind]}`}>{reasonLabel(t.reason)}</Badge>
                            </TableCell>
                            <TableCell className={`text-xs font-bold tabular-nums ${isWithdrawal ? "text-muted-foreground/30" : txAmountClass[kind]}`}>
                              {isWithdrawal ? "—" : `+${formatFa(Math.abs(amt))}`}
                            </TableCell>
                            <TableCell className={`text-xs font-bold tabular-nums ${isWithdrawal ? txAmountClass[kind] : "text-muted-foreground/30"}`}>
                              {isWithdrawal ? `−${formatFa(Math.abs(amt))}` : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            {/* Library */}
            <TabsContent value="library" className="space-y-2 mt-4">
              {userBooks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">کتابی در قفسه نیست</p>
              ) : userBooks.map((ub) => (
                <div key={ub.id} className="flex items-center justify-between gap-3 p-2 rounded border">
                  <div className="flex items-center gap-3 min-w-0">
                    {ub.books?.cover_url && <img src={ub.books.cover_url} className="w-10 h-14 object-cover rounded" alt="" />}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{ub.books?.title || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {ub.books?.author} • {ub.acquired_via} • پیشرفت: {Math.round(Number(ub.progress) * 100)}%
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeUserBook(ub.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </TabsContent>

            {/* Published */}
            <TabsContent value="published" className="space-y-2 mt-4">
              {authoredBooks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">کتابی منتشر نکرده</p>
              ) : authoredBooks.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-2 rounded border">
                  <div>
                    <div className="font-medium">{b.title}</div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] me-1">{b.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">{b.review_status}</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleDateString("fa-IR")}</div>
                </div>
              ))}
            </TabsContent>

            {/* Activity */}
            <TabsContent value="activity" className="space-y-3 mt-4">
              <div>
                <div className="font-medium mb-2 text-sm">کامنت‌ها ({comments.length})</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">کامنتی نیست</p>
                  ) : comments.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-2 p-2 rounded border text-sm">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">روی: {c.books?.title || "—"}</div>
                        <div className="line-clamp-2">{c.body}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteComment(c.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-medium mb-2 text-sm">هایلایت‌ها ({highlights.length})</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {highlights.length === 0 ? (
                    <p className="text-xs text-muted-foreground">هایلایتی نیست</p>
                  ) : highlights.map((h) => (
                    <div key={h.id} className="p-2 rounded border text-sm">
                      <div className="text-xs text-muted-foreground">{h.books?.title || "—"} • صفحه {h.page_index + 1}</div>
                      <div className="line-clamp-2">{h.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
