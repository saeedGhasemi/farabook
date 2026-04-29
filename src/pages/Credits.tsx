import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Coins, Sparkles, Briefcase, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { CREDITS_PER_TOMAN, creditsToToman } from "@/lib/purchase";
import {
  classifyTx,
  collectBookIds,
  computeTotals,
  describeTx,
  formatFa,
  reasonLabel,
  txAmountClass,
  txBadgeClass,
} from "@/lib/tx-display";

const PRESETS = [50, 100, 250, 500, 1000];
const PUBLISHER_FEE = 200;

const Credits = () => {
  const { user, loading: authLoading } = useAuth();
  const { credits, refresh } = useCredits();
  const { isPublisher } = useRoles();

  const [amount, setAmount] = useState<number>(100);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [requests, setRequests] = useState<any[]>([]);
  const [pubName, setPubName] = useState("");
  const [pubBio, setPubBio] = useState("");
  const [pubSite, setPubSite] = useState("");
  const [pubReqs, setPubReqs] = useState<any[]>([]);
  const [tx, setTx] = useState<any[]>([]);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});

  const load = async () => {
    if (!user) return;
    const [{ data: cr }, { data: pr }, { data: t }] = await Promise.all([
      supabase
        .from("credit_purchase_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("publisher_upgrade_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("credit_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setRequests((cr as any[]) || []);
    setPubReqs((pr as any[]) || []);
    const txs = (t as any[]) || [];
    setTx(txs);
    const ids = collectBookIds(txs);
    if (ids.length) {
      const { data: bs } = await supabase.from("books").select("id, title").in("id", ids);
      const map: Record<string, string> = {};
      for (const b of (bs as any[]) || []) map[b.id] = b.title;
      setBookTitles(map);
    } else {
      setBookTitles({});
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  const submitPurchase = async () => {
    if (amount <= 0) return toast.error("مقدار معتبر نیست");
    const { error } = await supabase.from("credit_purchase_requests").insert({
      user_id: user.id,
      amount,
      payment_reference: ref || null,
      note: note || null,
    });
    if (error) return toast.error(error.message);
    toast.success("درخواست ثبت شد. منتظر تأیید ادمین باشید.");
    setRef("");
    setNote("");
    load();
  };

  const submitPublisherRequest = async () => {
    if (!pubName.trim()) return toast.error("نام انتشارات لازم است");
    if (credits < PUBLISHER_FEE) return toast.error(`حداقل ${PUBLISHER_FEE} اعتبار لازم است`);
    const { error } = await supabase.from("publisher_upgrade_requests").insert({
      user_id: user.id,
      display_name: pubName.trim(),
      bio: pubBio || null,
      website: pubSite || null,
      credits_offered: PUBLISHER_FEE,
    });
    if (error) return toast.error(error.message);
    toast.success("درخواست ارسال شد.");
    setPubName("");
    setPubBio("");
    setPubSite("");
    load();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="container py-8 space-y-6 max-w-4xl"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow">
          <Coins className="w-6 h-6 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold gold-text">اعتبار من</h1>
          <p className="text-sm text-muted-foreground">خرید اعتبار و ارتقا به ناشر</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">موجودی</div>
          <div className="text-3xl font-bold gold-text">{credits.toLocaleString("fa-IR")}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            ≈ {creditsToToman(credits).toLocaleString("fa-IR")} تومان
          </div>
        </div>
      </div>

      <Tabs defaultValue="buy" dir="rtl">
        <TabsList className="glass">
          <TabsTrigger value="buy" className="gap-2">
            <Sparkles className="w-4 h-4" /> خرید اعتبار
          </TabsTrigger>
          <TabsTrigger value="publisher" className="gap-2" disabled={isPublisher}>
            <Briefcase className="w-4 h-4" /> {isPublisher ? "ناشر هستید" : "ارتقا به ناشر"}
          </TabsTrigger>
          <TabsTrigger value="history">تاریخچه</TabsTrigger>
        </TabsList>

        <TabsContent value="buy" className="mt-4 space-y-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>درخواست خرید اعتبار</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={amount === p ? "default" : "outline"}
                    onClick={() => setAmount(p)}
                  >
                    {p.toLocaleString("fa-IR")}
                  </Button>
                ))}
              </div>
              <div>
                <label className="text-sm">مقدار اعتبار</label>
                <Input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  معادل <strong>{creditsToToman(amount).toLocaleString("fa-IR")} تومان</strong>
                  {" "}(هر {CREDITS_PER_TOMAN} اعتبار = ۱ تومان)
                </p>
              </div>
              <div>
                <label className="text-sm">شماره پیگیری پرداخت (اختیاری)</label>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="مثلاً شماره تراکنش بانکی" />
              </div>
              <div>
                <label className="text-sm">توضیح</label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>
              <Button onClick={submitPurchase} className="bg-gradient-warm">ارسال درخواست</Button>
              <p className="text-xs text-muted-foreground">
                درخواست شما توسط ادمین بررسی و در صورت تأیید، اعتبار به حساب شما اضافه می‌شود.
              </p>
            </CardContent>
          </Card>

          {requests.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">درخواست‌های قبلی</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                    <span>{Number(r.amount).toLocaleString("fa-IR")} اعتبار</span>
                    <Badge variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "destructive"}>
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="publisher" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>درخواست ارتقا به ناشر</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                هزینه ارتقا: <strong>{PUBLISHER_FEE.toLocaleString("fa-IR")} اعتبار</strong>. پس از تأیید ادمین، می‌توانید کتاب بسازید، ویترین اختصاصی داشته باشید و ادیتور دعوت کنید.
              </p>
              <div>
                <label className="text-sm">نام انتشارات</label>
                <Input value={pubName} onChange={(e) => setPubName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">معرفی</label>
                <Textarea value={pubBio} onChange={(e) => setPubBio(e.target.value)} rows={3} />
              </div>
              <div>
                <label className="text-sm">وب‌سایت (اختیاری)</label>
                <Input value={pubSite} onChange={(e) => setPubSite(e.target.value)} placeholder="https://..." />
              </div>
              <Button onClick={submitPublisherRequest} className="bg-gradient-warm">ارسال درخواست</Button>
              {pubReqs.length > 0 && (
                <div className="pt-2 border-t space-y-1">
                  {pubReqs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <span>{r.display_name}</span>
                      <Badge variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "destructive"}>
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          {(() => {
            const totals = computeTotals(tx);
            return (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="glass">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">جمع واریز</div>
                    <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatFa(totals.income)}</div>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">شارژ / اعطا</div>
                    <div className="text-xl font-bold text-orange-500 dark:text-orange-400">{formatFa(totals.topUp)}</div>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">جمع برداشت</div>
                    <div className="text-xl font-bold text-destructive">{formatFa(totals.spent)}</div>
                  </CardContent>
                </Card>
                <Card className="glass">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">بالانس</div>
                    <div className="text-xl font-bold gold-text">{formatFa(totals.balance)}</div>
                  </CardContent>
                </Card>
              </div>
            );
          })()}
          <Card className="glass">
            <CardHeader>
              <CardTitle>تاریخچه تراکنش‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              {tx.length === 0 ? (
                <p className="text-sm text-muted-foreground">تراکنشی وجود ندارد.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">زمان</TableHead>
                        <TableHead className="text-right">عنوان</TableHead>
                        <TableHead className="text-right whitespace-nowrap text-emerald-600 dark:text-emerald-400">واریز</TableHead>
                        <TableHead className="text-right whitespace-nowrap text-destructive">برداشت</TableHead>
                        <TableHead className="text-right">جزئیات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tx.map((r) => {
                        const amt = Number(r.amount);
                        const kind = classifyTx(amt, r.reason);
                        const isWithdrawal = kind === "withdrawal";
                        const meta = (r.metadata || {}) as any;
                        const title = meta.book_id ? bookTitles[meta.book_id] : undefined;
                        const description = describeTx(r.reason, amt, meta, title);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(r.created_at).toLocaleString("fa-IR")}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-[11px] border-0 ${txBadgeClass[kind]}`}>
                                {reasonLabel(r.reason)}
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-sm font-bold whitespace-nowrap tabular-nums ${isWithdrawal ? "text-muted-foreground/30" : txAmountClass[kind]}`}>
                              {isWithdrawal ? "—" : `+${formatFa(Math.abs(amt))}`}
                            </TableCell>
                            <TableCell className={`text-sm font-bold whitespace-nowrap tabular-nums ${isWithdrawal ? txAmountClass[kind] : "text-muted-foreground/30"}`}>
                              {isWithdrawal ? `−${formatFa(Math.abs(amt))}` : "—"}
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground max-w-[260px]">
                              {description}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default Credits;
