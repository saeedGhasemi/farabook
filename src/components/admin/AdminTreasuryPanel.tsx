// Admin "Treasury" panel: dynamic platform fees + transaction overview.
// All four fees support either a fixed credit amount OR a percentage.
import { useEffect, useMemo, useState } from "react";
import {
  Banknote, Loader2, Save, ArrowDownCircle, ArrowUpCircle, Coins,
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

  const load = async () => {
    const [{ data: f }, { data: txs }] = await Promise.all([
      supabase.from("platform_fee_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("credit_transactions")
        .select("id, user_id, amount, reason, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
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
        <CardContent dir="rtl">
          {loadingTx ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : tx.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">هنوز تراکنشی ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">زمان</TableHead>
                    <TableHead className="text-right">دلیل</TableHead>
                    <TableHead className="text-right">مبلغ</TableHead>
                    <TableHead className="text-right">کاربر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tx.slice(0, 50).map((t) => {
                    const amt = Number(t.amount);
                    const isTreasury = TREASURY_REASONS.has(t.reason);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={isTreasury ? "default" : "secondary"} className="text-[10px]">
                            {t.reason}
                          </Badge>
                        </TableCell>
                        <TableCell className={`font-mono text-sm ${amt < 0 ? "text-destructive" : "text-accent"}`}>
                          {amt > 0 ? "+" : ""}{amt.toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {String(t.user_id).slice(0, 8)}…
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
    </div>
  );
};
