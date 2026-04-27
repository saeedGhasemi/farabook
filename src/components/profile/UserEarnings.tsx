// User-facing earnings & expenses dashboard.
// Shows credit transaction history split into income vs spending,
// plus running totals. Reads from RLS-protected `credit_transactions`.
import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const REASON_FA: Record<string, string> = {
  book_purchase: "خرید کتاب",
  revenue_share_publisher: "سهم ناشر از فروش",
  revenue_share_author: "سهم نویسنده از فروش",
  revenue_share_editor: "سهم ادیتور از فروش",
  publisher_signup_fee: "هزینه درخواست ناشر",
  book_publish_fee: "هزینه انتشار کتاب",
  editor_order_fee: "هزینه سفارش ادیت",
  credit_purchase_approved: "خرید اعتبار (تأیید شده)",
  admin_grant: "اعطای ادمین",
  admin_deduct: "کسر ادمین",
  seed_starter_credits: "اعتبار اولیه",
};

interface Props {
  userId: string;
}

export const UserEarnings = ({ userId }: Props) => {
  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("credit_transactions")
        .select("id, amount, reason, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (!cancelled) {
        setTx((data as any[]) || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const stats = useMemo(() => {
    let income = 0, spent = 0;
    tx.forEach((t) => {
      const a = Number(t.amount);
      if (a > 0) income += a; else spent += Math.abs(a);
    });
    return { income, spent, balance: income - spent };
  }, [tx]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin me-2" /> در حال بارگذاری…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">جمع درآمد</div>
              <div className="text-xl font-display font-bold">{stats.income.toLocaleString("fa-IR")}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/20 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">جمع هزینه</div>
              <div className="text-xl font-display font-bold">{stats.spent.toLocaleString("fa-IR")}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center">
              <Wallet className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">موجودی فعلی</div>
              <div className="text-xl font-display font-bold gold-text">
                {stats.balance.toLocaleString("fa-IR")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardContent className="p-3" dir="rtl">
          {tx.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">هنوز تراکنشی ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">زمان</TableHead>
                    <TableHead className="text-right">عنوان</TableHead>
                    <TableHead className="text-right whitespace-nowrap">مبلغ</TableHead>
                    <TableHead className="text-right">جزئیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tx.map((t) => {
                    const amt = Number(t.amount);
                    const positive = amt > 0;
                    const meta = (t.metadata || {}) as any;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[11px] border-0 ${
                              positive
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {REASON_FA[t.reason] || t.reason}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={`text-sm font-bold whitespace-nowrap tabular-nums ${
                            positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                          }`}
                        >
                          {positive ? "+" : "−"}
                          {Math.abs(amt).toLocaleString("fa-IR")} اعتبار
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-[260px] truncate">
                          {meta.book_id ? `کتاب: ${String(meta.book_id).slice(0, 8)}…` : ""}
                          {meta.percent ? ` • ${meta.percent}%` : ""}
                          {meta.complexity ? ` • ضریب ${meta.complexity}×` : ""}
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
