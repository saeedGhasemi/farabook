import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Shield, Users, CreditCard, BookCheck, UserPlus, Trash2, Loader2, Check, X, AlertCircle, Power, PowerOff, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { RoleGuard } from "@/components/RoleGuard";
import { UserDetailDialog } from "@/components/admin/UserDetailDialog";
import type { AppRole } from "@/hooks/useRoles";

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

interface UserRow {
  id: string;
  display_name: string | null;
  roles: AppRole[];
  credits: number;
  is_active: boolean;
}

const AdminInner = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [credReqs, setCredReqs] = useState<any[]>([]);
  const [pubReqs, setPubReqs] = useState<any[]>([]);
  const [allBooks, setAllBooks] = useState<any[]>([]);
  const [bookFilter, setBookFilter] = useState<"pending_review" | "approved" | "rejected" | "all">("pending_review");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<AppRole | "">("");

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: tx }, { data: cReq }, { data: pReq }, { data: books }] =
      await Promise.all([
        supabase.from("profiles").select("id, display_name, is_active"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("credit_transactions").select("user_id, amount"),
        supabase.from("credit_purchase_requests").select("*").order("created_at", { ascending: false }),
        supabase.from("publisher_upgrade_requests").select("*").order("created_at", { ascending: false }),
        supabase
          .from("books")
          .select("id, title, author, publisher_id, status, review_status, reject_reason, reviewed_at, created_at")
          .order("created_at", { ascending: false }),
      ]);

    const roleMap = new Map<string, AppRole[]>();
    ((roles as any[]) || []).forEach((r) => {
      const arr = roleMap.get(r.user_id) || [];
      arr.push(r.role as AppRole);
      roleMap.set(r.user_id, arr);
    });

    const credMap = new Map<string, number>();
    ((tx as any[]) || []).forEach((r) => {
      credMap.set(r.user_id, (credMap.get(r.user_id) || 0) + Number(r.amount || 0));
    });

    setUsers(
      ((profiles as any[]) || []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        roles: roleMap.get(p.id) || [],
        credits: credMap.get(p.id) || 0,
        is_active: p.is_active !== false,
      })),
    );
    setCredReqs((cReq as any[]) || []);
    setPubReqs((pReq as any[]) || []);
    setAllBooks((books as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredBooks = useMemo(() => {
    if (bookFilter === "all") return allBooks;
    return allBooks.filter((b) => (b.review_status || "approved") === bookFilter);
  }, [allBooks, bookFilter]);

  const bookCounts = useMemo(() => {
    const counts = { pending_review: 0, approved: 0, rejected: 0, all: allBooks.length };
    allBooks.forEach((b) => {
      const s = (b.review_status || "approved") as keyof typeof counts;
      if (s in counts) counts[s] = (counts[s] as number) + 1;
    });
    return counts;
  }, [allBooks]);

  const grantRole = async (userId: string, role: AppRole) => {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[role]} اعطا شد`);
      load();
    }
  };

  const revokeRole = async (userId: string, role: AppRole) => {
    if (role === "user") return toast.error("نقش کاربر عادی قابل حذف نیست");
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[role]} لغو شد`);
      load();
    }
  };

  const approveCredit = async (req: any) => {
    const { error: txErr } = await supabase.from("credit_transactions").insert({
      user_id: req.user_id,
      amount: req.amount,
      reason: "credit_purchase_approved",
      metadata: { request_id: req.id },
    });
    if (txErr) return toast.error(txErr.message);
    await supabase
      .from("credit_purchase_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    toast.success("اعتبار اضافه شد");
    load();
  };

  const rejectCredit = async (req: any) => {
    await supabase
      .from("credit_purchase_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    toast.success("درخواست رد شد");
    load();
  };

  const approvePubRequest = async (req: any) => {
    // grant publisher role
    await supabase.from("user_roles").insert({ user_id: req.user_id, role: "publisher" as AppRole });
    // create publisher profile if missing
    const slug = (req.display_name || "publisher").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "") + "-" + req.user_id.slice(0, 6);
    await supabase.from("publisher_profiles").upsert(
      {
        user_id: req.user_id,
        display_name: req.display_name,
        slug,
        bio: req.bio,
        website: req.website,
        is_trusted: false,
        is_active: true,
      },
      { onConflict: "user_id" },
    );
    // deduct credits if offered
    if (Number(req.credits_offered) > 0) {
      await supabase.from("credit_transactions").insert({
        user_id: req.user_id,
        amount: -Number(req.credits_offered),
        reason: "publisher_upgrade_fee",
      });
    }
    await supabase
      .from("publisher_upgrade_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    toast.success("کاربر به ناشر ارتقا یافت");
    load();
  };

  const rejectPubRequest = async (req: any) => {
    await supabase
      .from("publisher_upgrade_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    toast.success("درخواست رد شد");
    load();
  };

  const approveBook = async (book: any, trusted: boolean) => {
    await supabase
      .from("books")
      .update({
        review_status: "approved",
        status: "published",
        reviewed_at: new Date().toISOString(),
        published_at: book.published_at || new Date().toISOString(),
      })
      .eq("id", book.id);
    toast.success("کتاب تأیید و منتشر شد");
    load();
  };

  const rejectBook = async (book: any) => {
    const reason = window.prompt("دلیل رد را وارد کنید:") || "";
    await supabase
      .from("books")
      .update({ review_status: "rejected", reject_reason: reason, reviewed_at: new Date().toISOString() })
      .eq("id", book.id);
    toast.success("کتاب رد شد");
    load();
  };

  const giveCredits = async (userId: string) => {
    const amt = Number(window.prompt("مقدار اعتبار (مثبت یا منفی):") || "0");
    if (!amt) return;
    const { error } = await supabase.from("credit_transactions").insert({
      user_id: userId,
      amount: amt,
      reason: amt > 0 ? "admin_grant" : "admin_deduct",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("اعتبار به‌روز شد");
      load();
    }
  };

  // ===== Bulk actions =====
  const selectedArr = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const bulkSetActive = async (active: boolean) => {
    if (selectedArr.length === 0) return;
    if (!confirm(`${active ? "فعال‌سازی" : "غیرفعال‌سازی"} ${selectedArr.length} کاربر؟`)) return;
    const { error } = await (supabase.from("profiles") as any)
      .update({ is_active: active })
      .in("id", selectedArr);
    if (error) toast.error(error.message);
    else {
      toast.success(`${selectedArr.length} کاربر ${active ? "فعال" : "غیرفعال"} شد`);
      setSelectedIds(new Set());
      load();
    }
  };

  const bulkDelete = async () => {
    if (selectedArr.length === 0) return;
    if (!confirm(`حذف کامل ${selectedArr.length} کاربر و تمام داده‌های آن‌ها؟ این عمل غیرقابل بازگشت است.`)) return;
    let ok = 0;
    let fail = 0;
    for (const uid of selectedArr) {
      const { error } = await (supabase.rpc as any)("admin_purge_user", { _user_id: uid });
      if (error) fail++;
      else ok++;
    }
    if (fail) toast.error(`${ok} حذف شد، ${fail} خطا`);
    else toast.success(`${ok} کاربر حذف شد`);
    setSelectedIds(new Set());
    load();
  };

  const bulkGrantRole = async () => {
    if (selectedArr.length === 0 || !bulkRole) return;
    const rows = selectedArr.map((uid) => ({ user_id: uid, role: bulkRole as AppRole }));
    const { error } = await supabase.from("user_roles").upsert(rows, { onConflict: "user_id,role" });
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[bulkRole as AppRole]} به ${selectedArr.length} کاربر داده شد`);
      setSelectedIds(new Set());
      setBulkRole("");
      load();
    }
  };

  const bulkRevokeRole = async () => {
    if (selectedArr.length === 0 || !bulkRole) return;
    if (bulkRole === "user") return toast.error("نقش کاربر عادی قابل حذف نیست");
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .in("user_id", selectedArr)
      .eq("role", bulkRole);
    if (error) toast.error(error.message);
    else {
      toast.success(`نقش ${ROLE_LABEL[bulkRole as AppRole]} از ${selectedArr.length} کاربر گرفته شد`);
      setSelectedIds(new Set());
      setBulkRole("");
      load();
    }
  };

  const bulkAdjustCredits = async () => {
    if (selectedArr.length === 0) return;
    const amt = Number(window.prompt(`مقدار اعتبار برای ${selectedArr.length} کاربر (مثبت یا منفی):`) || "0");
    if (!amt) return;
    const reason = window.prompt("دلیل:") || (amt > 0 ? "bulk_grant" : "bulk_deduct");
    const rows = selectedArr.map((uid) => ({ user_id: uid, amount: amt, reason }));
    const { error } = await supabase.from("credit_transactions").insert(rows);
    if (error) toast.error(error.message);
    else {
      toast.success("اعتبار به‌روز شد");
      setSelectedIds(new Set());
      load();
    }
  };

  if (loading) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="container py-8 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow">
          <Shield className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold gold-text">پنل سوپر ادمین</h1>
          <p className="text-sm text-muted-foreground">مدیریت کامل کاربران، نقش‌ها، اعتبارات و انتشار</p>
        </div>
      </div>

      <Tabs defaultValue="users" dir="rtl">
        <TabsList className="glass">
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-4 h-4" /> کاربران ({users.length})
          </TabsTrigger>
          <TabsTrigger value="credits" className="gap-2">
            <CreditCard className="w-4 h-4" /> درخواست اعتبار ({credReqs.filter((r) => r.status === "pending").length})
          </TabsTrigger>
          <TabsTrigger value="publishers" className="gap-2">
            <UserPlus className="w-4 h-4" /> درخواست ناشر ({pubReqs.filter((r) => r.status === "pending").length})
          </TabsTrigger>
          <TabsTrigger value="books" className="gap-2">
            <BookCheck className="w-4 h-4" /> کتاب‌ها ({bookCounts.pending_review} در انتظار)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card className="glass">
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle>مدیریت کاربران و نقش‌ها</CardTitle>
              <Input
                placeholder="جستجو نام یا شناسه…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </CardHeader>
            <CardContent dir="rtl">
              {(() => {
                const filtered = users.filter((u) => {
                  if (!search.trim()) return true;
                  const q = search.toLowerCase();
                  return (u.display_name || "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
                });
                const allChecked = filtered.length > 0 && filtered.every((u) => selectedIds.has(u.id));
                const someChecked = filtered.some((u) => selectedIds.has(u.id));
                const toggleAll = (checked: boolean) => {
                  setSelectedIds((prev) => {
                    const n = new Set(prev);
                    if (checked) filtered.forEach((u) => n.add(u.id));
                    else filtered.forEach((u) => n.delete(u.id));
                    return n;
                  });
                };
                return (
                  <>
                    {/* Bulk actions toolbar */}
                    {selectedArr.length > 0 && (
                      <div className="mb-3 p-3 rounded-lg border bg-accent/30 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">
                          {selectedArr.length.toLocaleString("fa-IR")} کاربر انتخاب‌شده
                        </span>
                        <div className="h-4 w-px bg-border mx-1" />
                        <Button size="sm" variant="outline" onClick={() => bulkSetActive(true)} className="gap-1">
                          <Power className="w-3.5 h-3.5" /> فعال‌سازی
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => bulkSetActive(false)} className="gap-1">
                          <PowerOff className="w-3.5 h-3.5" /> غیرفعال‌سازی
                        </Button>
                        <Button size="sm" variant="outline" onClick={bulkAdjustCredits} className="gap-1">
                          <CreditCard className="w-3.5 h-3.5" /> تنظیم اعتبار گروهی
                        </Button>
                        <div className="flex items-center gap-1">
                          <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as AppRole)}>
                            <SelectTrigger className="h-8 w-36"><SelectValue placeholder="انتخاب نقش…" /></SelectTrigger>
                            <SelectContent>
                              {ALL_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline" onClick={bulkGrantRole} disabled={!bulkRole} className="gap-1">
                            <Plus className="w-3.5 h-3.5" /> اعطا
                          </Button>
                          <Button size="sm" variant="outline" onClick={bulkRevokeRole} disabled={!bulkRole} className="gap-1">
                            <Minus className="w-3.5 h-3.5" /> لغو
                          </Button>
                        </div>
                        <div className="flex-1" />
                        <Button size="sm" variant="destructive" onClick={bulkDelete} className="gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> حذف کامل
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                          پاک‌کردن انتخاب
                        </Button>
                      </div>
                    )}

                    {/* Single responsive table for both mobile and desktop */}
                    <div className="w-full overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right w-10">
                              <Checkbox
                                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                                onCheckedChange={(c) => toggleAll(!!c)}
                                aria-label="انتخاب همه"
                              />
                            </TableHead>
                            <TableHead className="text-right">کاربر</TableHead>
                            <TableHead className="text-right">نقش‌ها</TableHead>
                            <TableHead className="text-right whitespace-nowrap">اعتبار</TableHead>
                            <TableHead className="text-right whitespace-nowrap">وضعیت</TableHead>
                            <TableHead className="text-right whitespace-nowrap w-28">عملیات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((u) => {
                            const checked = selectedIds.has(u.id);
                            return (
                              <TableRow
                                key={u.id}
                                data-state={checked ? "selected" : undefined}
                                className={`hover:bg-accent/20 ${u.is_active ? "" : "opacity-60"}`}
                              >
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => toggleOne(u.id, !!c)}
                                    aria-label="انتخاب کاربر"
                                  />
                                </TableCell>
                                <TableCell className="cursor-pointer" onClick={() => setSelectedUserId(u.id)}>
                                  <div className="font-medium truncate max-w-[200px]">{u.display_name || "—"}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}…</div>
                                </TableCell>
                                <TableCell className="cursor-pointer" onClick={() => setSelectedUserId(u.id)}>
                                  <div className="flex flex-wrap gap-1">
                                    {u.roles.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                                    {u.roles.map((r) => (
                                      <Badge key={r} variant={r === "super_admin" ? "default" : "secondary"} className="text-[10px]">
                                        {ROLE_LABEL[r]}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell className="cursor-pointer whitespace-nowrap" onClick={() => setSelectedUserId(u.id)}>
                                  <Badge variant="outline">{u.credits.toLocaleString("fa-IR")}</Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {u.is_active ? (
                                    <Badge variant="secondary" className="text-[10px]">فعال</Badge>
                                  ) : (
                                    <Badge variant="destructive" className="text-[10px]">غیرفعال</Badge>
                                  )}
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                                  <Button size="sm" variant="outline" onClick={() => setSelectedUserId(u.id)}>
                                    جزئیات
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {filtered.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-6">کاربری یافت نشد</p>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>درخواست‌های خرید اعتبار</CardTitle>
            </CardHeader>
            <CardContent>
              {credReqs.length === 0 ? (
                <p className="text-muted-foreground text-sm">درخواستی وجود ندارد.</p>
              ) : (
                <div className="space-y-2">
                  {credReqs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div>
                        <div className="font-medium">{Number(r.amount).toLocaleString("fa-IR")} اعتبار</div>
                        <div className="text-xs text-muted-foreground">
                          کاربر: {r.user_id.slice(0, 8)}… • ref: {r.payment_reference || "—"} • {r.note || ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "destructive"}>
                          {r.status}
                        </Badge>
                        {r.status === "pending" && (
                          <>
                            <Button size="sm" onClick={() => approveCredit(r)} className="gap-1">
                              <Check className="w-3.5 h-3.5" /> تأیید
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => rejectCredit(r)} className="gap-1">
                              <X className="w-3.5 h-3.5" /> رد
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publishers" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>درخواست‌های ارتقا به ناشر</CardTitle>
            </CardHeader>
            <CardContent>
              {pubReqs.length === 0 ? (
                <p className="text-muted-foreground text-sm">درخواستی وجود ندارد.</p>
              ) : (
                <div className="space-y-2">
                  {pubReqs.map((r) => (
                    <div key={r.id} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium">{r.display_name}</div>
                        <Badge variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "destructive"}>
                          {r.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">{r.bio}</div>
                      <div className="text-xs text-muted-foreground">
                        وب‌سایت: {r.website || "—"} • هزینه پیشنهادی: {Number(r.credits_offered).toLocaleString("fa-IR")} اعتبار
                      </div>
                      {r.status === "pending" && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={() => approvePubRequest(r)} className="gap-1">
                            <Check className="w-3.5 h-3.5" /> تأیید و ارتقا
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectPubRequest(r)} className="gap-1">
                            <X className="w-3.5 h-3.5" /> رد
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="books" className="mt-4">
          <Card className="glass">
            <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
              <CardTitle>مدیریت کتاب‌ها</CardTitle>
              <div className="flex gap-1 flex-wrap">
                {([
                  ["pending_review", "در انتظار", bookCounts.pending_review],
                  ["approved", "تأیید شده", bookCounts.approved],
                  ["rejected", "رد شده", bookCounts.rejected],
                  ["all", "همه", bookCounts.all],
                ] as const).map(([key, label, count]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={bookFilter === key ? "default" : "outline"}
                    onClick={() => setBookFilter(key as typeof bookFilter)}
                    className="gap-1"
                  >
                    {label} <Badge variant="secondary" className="ms-1">{count}</Badge>
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {filteredBooks.length === 0 ? (
                <p className="text-muted-foreground text-sm">موردی در این فیلتر نیست.</p>
              ) : (
                <div className="space-y-2">
                  {filteredBooks.map((b) => {
                    const status = (b.review_status || "approved") as string;
                    return (
                      <div key={b.id} className="p-3 rounded-lg border bg-card">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="font-medium flex items-center gap-2">
                              {b.title}
                              <Badge
                                variant={
                                  status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary"
                                }
                              >
                                {status === "pending_review" ? "در انتظار" : status === "approved" ? "تأیید شده" : "رد شده"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {b.author} • ناشر: {b.publisher_id?.slice(0, 8) || "—"}…
                              {b.reviewed_at && ` • بررسی: ${new Date(b.reviewed_at).toLocaleDateString("fa-IR")}`}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {status !== "approved" && (
                              <Button size="sm" onClick={() => approveBook(b, false)} className="gap-1">
                                <Check className="w-3.5 h-3.5" /> تأیید
                              </Button>
                            )}
                            {status !== "rejected" && (
                              <Button size="sm" variant="outline" onClick={() => rejectBook(b)} className="gap-1">
                                <X className="w-3.5 h-3.5" /> رد
                              </Button>
                            )}
                          </div>
                        </div>
                        {status === "rejected" && b.reject_reason && (
                          <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span><strong>دلیل رد:</strong> {b.reject_reason}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <UserDetailDialog
        userId={selectedUserId}
        open={!!selectedUserId}
        onOpenChange={(v) => !v && setSelectedUserId(null)}
        onChanged={load}
      />
    </motion.div>
  );
};

const Admin = () => (
  <RoleGuard roles={["super_admin", "admin"]} redirectTo="/auth">
    <AdminInner />
  </RoleGuard>
);

export default Admin;
