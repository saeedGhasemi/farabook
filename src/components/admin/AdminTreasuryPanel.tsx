// Admin "Treasury" panel: dynamic platform fees + transaction overview.
// All four fees support either a fixed credit amount OR a percentage.
import { useEffect, useMemo, useState } from "react";
import {
  Banknote, Loader2, Save, ArrowDownCircle, ArrowUpCircle, Coins, Search, Filter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Mode = "percent" | "fixed";

interface Fees {
  book_purchase_mode: Mode;     book_purchase_value: number;
  editor_order_mode: Mode;      editor_order_value: number;
  publisher_signup_mode: Mode;  publisher_signup_value: number;
  book_publish_mode: Mode;      book_publish_value: number;
}

const ROW_LABELS: { key: keyof Fees; label: string; hint: string }[] = [
  { key: "book_purchase_mode" as any, label: "خرید کتاب", hint: "از مبلغ هر خرید کتاب کسر می‌شود." },
  { key: "editor_order_mode" as any, label: "سفارش ادیت", hint: "روی مبلغ توافقی ادیت اعمال می‌شود." },
  { key: "publisher_signup_mode" as any, label: "درخواست ناشر شدن", hint: "هزینهٔ ثبت درخواست ناشر شدن." },
  { key: "book_publish_mode" as any, label: "انتشار اولیهٔ کتاب", hint: "بر اساس ضریب پیچیدگی (۱ تا ۱۰) ضرب می‌شود." },
];

const FIELD_PAIRS: Array<[keyof Fees, keyof Fees, string, string]> = [
  ["book_purchase_mode", "book_purchase_value", "خرید کتاب", "Book purchase"],
  ["editor_order_mode", "editor_order_value", "سفارش ادیت", "Editor order"],
  ["publisher_signup_mode", "publisher_signup_value", "درخواست ناشر شدن", "Publisher signup"],
  ["book_publish_mode", "book_publish_value", "انتشار اولیهٔ کتاب (× ضریب پیچیدگی)", "Initial publish (× complexity)"],
];

const TREASURY_REASONS = new Set([
  "book_purchase",            // negative on buyer; treasury gains the platform fee
  "publisher_signup_fee",
  "book_publish_fee",
  "editor_order_fee",
]);

export const AdminTreasuryPanel = () => {
  const [fees, setFees] = useState<Fees | null>(null);
  const [draft, setDraft] = useState<Fees | null>(null);
  const [saving, setSaving] = useState(false);
  const [tx, setTx] = useState<any[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [filterDir, setFilterDir] = useState<"all" | "in" | "out">("all");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [filterQuery, setFilterQuery] = useState("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const load = async () => {
    const [{ data: f }, { data: txs }] = await Promise.all([
      supabase.from("platform_fee_settings").select("*").eq("id", 1).maybeSingle(),
      (supabase.rpc as any)("admin_recent_transactions", { _limit: 200 }),
    ]);
    if (f) {
      const fees: Fees = {
        book_purchase_mode: (f as any).book_purchase_mode,
        book_purchase_value: Number((f as any).book_purchase_value),
        editor_order_mode: (f as any).editor_order_mode,
        editor_order_value: Number((f as any).editor_order_value),
        publisher_signup_mode: (f as any).publisher_signup_mode,
        publisher_signup_value: Number((f as any).publisher_signup_value),
        book_publish_mode: (f as any).book_publish_mode,
        book_publish_value: Number((f as any).book_publish_value),
      };
      setFees(fees);
      setDraft(fees);
    }
    setTx((txs as any[]) || []);
    setLoadingTx(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const { error } = await (supabase.rpc as any)("admin_update_platform_fees", { _settings: draft });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تنظیمات کارمزد ذخیره شد");
    load();
  };

  // Treasury aggregates: sum of fees that came from buyers/publishers.
  // Heuristic: treasury earnings = (purchases × fee%) + publisher_signup_fee + book_publish_fee + editor_order_fee.
  const stats = useMemo(() => {
    if (!fees) return { earnings: 0, distributed: 0, txCount: 0 };
    let earnings = 0;
    let distributed = 0;
    for (const t of tx) {
      const amt = Number(t.amount || 0);
      const r = t.reason || "";
      if (r === "book_purchase" && amt < 0) {
        // platform fee portion of purchase
        const cost = Math.abs(amt);
        const fee = fees.book_purchase_mode === "percent"
          ? Math.round(cost * fees.book_purchase_value / 100)
          : Math.min(cost, fees.book_purchase_value);
        earnings += fee;
      } else if (r === "publisher_signup_fee" || r === "book_publish_fee" || r === "editor_order_fee") {
        earnings += Math.abs(amt);
      } else if (r.startsWith("revenue_share")) {
        distributed += Math.abs(amt);
      }
    }
    return { earnings, distributed, txCount: tx.length };
  }, [tx, fees]);

  if (!draft) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin me-2" /> در حال بارگذاری…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center">
              <Coins className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">درآمد صندوق سامانه</div>
              <div className="text-xl font-display font-bold">
                {stats.earnings.toLocaleString("fa-IR")} اعتبار
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
              <ArrowUpCircle className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">سهم پرداخت‌شده به ذی‌نفعان</div>
              <div className="text-xl font-display font-bold">
                {stats.distributed.toLocaleString("fa-IR")} اعتبار
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
              <ArrowDownCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">تعداد تراکنش‌های اخیر</div>
              <div className="text-xl font-display font-bold">
                {stats.txCount.toLocaleString("fa-IR")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fee settings */}
      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-accent" /> تنظیم کارمزدهای سامانه
          </CardTitle>
          <Button onClick={save} disabled={saving} size="sm" className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            ذخیره
          </Button>
        </CardHeader>
        <CardContent className="space-y-3" dir="rtl">
          {FIELD_PAIRS.map(([modeKey, valKey, fa]) => {
            const mode = draft[modeKey] as Mode;
            const val = draft[valKey] as number;
            return (
              <div key={modeKey} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-3 rounded-lg border bg-background/40">
                <div className="sm:col-span-5">
                  <div className="text-sm font-medium">{fa}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {ROW_LABELS.find((r) => r.key === modeKey)?.hint}
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <Select
                    value={mode}
                    onValueChange={(v) => setDraft({ ...draft, [modeKey]: v as Mode } as any)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">درصدی (٪)</SelectItem>
                      <SelectItem value="fixed">ثابت (اعتبار)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-3">
                  <Input
                    type="number"
                    min={0}
                    value={val}
                    onChange={(e) => setDraft({ ...draft, [valKey]: Number(e.target.value) || 0 } as any)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="sm:col-span-1 text-xs text-muted-foreground text-center">
                  {mode === "percent" ? "%" : "اعتبار"}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Recent transactions */}
      <Card className="glass">
        <CardHeader>
          <CardTitle>تراکنش‌های اخیر صندوق</CardTitle>
        </CardHeader>
        <CardContent dir="rtl" className="space-y-3">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-3">
              <label className="text-[11px] text-muted-foreground mb-1 block">جهت تراکنش</label>
              <Select value={filterDir} onValueChange={(v) => setFilterDir(v as any)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="in">واریز به صندوق (سبز)</SelectItem>
                  <SelectItem value="out">برداشت از صندوق (قرمز)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <label className="text-[11px] text-muted-foreground mb-1 block">نوع رویداد</label>
              <Select value={filterReason} onValueChange={setFilterReason}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه رویدادها</SelectItem>
                  <SelectItem value="book_purchase">خرید کتاب</SelectItem>
                  <SelectItem value="publisher_signup_fee">هزینه ناشر شدن</SelectItem>
                  <SelectItem value="book_publish_fee">هزینه انتشار کتاب</SelectItem>
                  <SelectItem value="editor_order_fee">هزینه سفارش ادیت</SelectItem>
                  <SelectItem value="revenue_share">سهم فروش (همه)</SelectItem>
                  <SelectItem value="admin_adjust">تنظیم دستی ادمین</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] text-muted-foreground mb-1 block">از تاریخ</label>
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] text-muted-foreground mb-1 block">تا تاریخ</label>
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] text-muted-foreground mb-1 block">جستجو</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-2 text-muted-foreground" />
                <Input
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="کاربر، کتاب…"
                  className="h-9 text-sm ps-7"
                />
              </div>
            </div>
          </div>

          {loadingTx ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : tx.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">هنوز تراکنشی ثبت نشده است.</p>
          ) : (() => {
            const reasonLabels: Record<string, string> = {
              book_purchase: "خرید کتاب",
              publisher_signup_fee: "هزینه ناشر شدن",
              book_publish_fee: "هزینه انتشار کتاب",
              editor_order_fee: "هزینه سفارش ادیت",
              revenue_share_publisher: "سهم فروش — ناشر",
              revenue_share_author: "سهم فروش — نویسنده",
              revenue_share_editor: "سهم فروش — ادیتور",
              seed_starter_credits: "اعتبار اولیه",
              admin_adjust: "تنظیم دستی ادمین",
            };

            // Compute treasury-perspective amount for each row
            const rows = tx.map((t) => {
              const amt = Number(t.amount || 0);
              const r: string = t.reason || "";
              let treasuryAmt = 0; // + means money in, - means money out
              if (r === "book_purchase" && amt < 0 && fees) {
                const cost = Math.abs(amt);
                const fee = fees.book_purchase_mode === "percent"
                  ? Math.round(cost * fees.book_purchase_value / 100)
                  : Math.min(cost, fees.book_purchase_value);
                treasuryAmt = fee;
              } else if (r === "publisher_signup_fee" || r === "book_publish_fee" || r === "editor_order_fee") {
                treasuryAmt = Math.abs(amt);
              } else if (r.startsWith("revenue_share")) {
                treasuryAmt = -Math.abs(amt);
              } else {
                treasuryAmt = amt; // fallback (admin_adjust etc.)
              }
              return { ...t, _treasuryAmt: treasuryAmt };
            });

            const filtered = rows.filter((t) => {
              if (filterDir === "in" && t._treasuryAmt <= 0) return false;
              if (filterDir === "out" && t._treasuryAmt >= 0) return false;
              if (filterReason !== "all") {
                if (filterReason === "revenue_share") {
                  if (!String(t.reason || "").startsWith("revenue_share")) return false;
                } else if (t.reason !== filterReason) {
                  return false;
                }
              }
              if (filterFrom) {
                if (new Date(t.created_at) < new Date(filterFrom)) return false;
              }
              if (filterTo) {
                const to = new Date(filterTo);
                to.setHours(23, 59, 59, 999);
                if (new Date(t.created_at) > to) return false;
              }
              if (filterQuery.trim()) {
                const q = filterQuery.trim().toLowerCase();
                const hay = [t.user_name, t.user_email, t.buyer_name, t.book_title, reasonLabels[t.reason] || t.reason]
                  .filter(Boolean).join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

            const totalIn = filtered.filter(r => r._treasuryAmt > 0).reduce((s, r) => s + r._treasuryAmt, 0);
            const totalOut = filtered.filter(r => r._treasuryAmt < 0).reduce((s, r) => s + Math.abs(r._treasuryAmt), 0);

            return (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0">
                    جمع واریز: +{totalIn.toLocaleString("fa-IR")} اعتبار
                  </Badge>
                  <Badge className="bg-destructive/15 text-destructive border-0">
                    جمع برداشت: −{totalOut.toLocaleString("fa-IR")} اعتبار
                  </Badge>
                  <span className="text-muted-foreground">({filtered.length.toLocaleString("fa-IR")} ردیف)</span>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">زمان</TableHead>
                        <TableHead className="text-right">رویداد</TableHead>
                        <TableHead className="text-right">جزئیات</TableHead>
                        <TableHead className="text-right">مبلغ صندوق</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.slice(0, 200).map((t) => {
                        const treasuryAmt = t._treasuryAmt as number;
                        const positive = treasuryAmt > 0;
                        const reasonFa = reasonLabels[t.reason] || t.reason;
                        const userName = t.user_name || String(t.user_id).slice(0, 8);
                        const buyerName = t.buyer_name;
                        const bookTitle = t.book_title;
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(t.created_at).toLocaleString("fa-IR")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={`text-[11px] whitespace-nowrap border-0 ${
                                  positive
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                    : treasuryAmt < 0
                                      ? "bg-destructive/15 text-destructive"
                                      : "bg-secondary text-secondary-foreground"
                                }`}
                              >
                                {reasonFa}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs leading-relaxed">
                              {bookTitle && (
                                <div className="font-medium truncate max-w-[260px]">📖 {bookTitle}</div>
                              )}
                              <div className="text-muted-foreground">
                                {t.reason === "book_purchase"
                                  ? <>خریدار: <span className="font-medium text-foreground">{userName}</span></>
                                  : t.reason?.startsWith("revenue_share_")
                                    ? <>گیرنده: <span className="font-medium text-foreground">{userName}</span>{buyerName && <> · از خرید: {buyerName}</>}</>
                                    : <>کاربر: <span className="font-medium text-foreground">{userName}</span></>
                                }
                                {t.user_email && <span className="block text-[10px] opacity-70">{t.user_email}</span>}
                              </div>
                            </TableCell>
                            <TableCell
                              className={`text-sm font-bold whitespace-nowrap tabular-nums ${
                                positive ? "text-emerald-600 dark:text-emerald-400" : treasuryAmt < 0 ? "text-destructive" : "text-muted-foreground"
                              }`}
                            >
                              {positive ? "+" : treasuryAmt < 0 ? "−" : ""}
                              {Math.abs(treasuryAmt).toLocaleString("fa-IR")} اعتبار
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">با این فیلترها نتیجه‌ای یافت نشد.</p>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
};
