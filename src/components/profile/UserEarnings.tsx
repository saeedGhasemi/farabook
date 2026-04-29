// User-facing earnings & expenses dashboard.
// Two distinct columns: «واریز» (green / orange for top-ups) and «برداشت» (red).
// Reads from RLS-protected `credit_transactions`.
import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Wallet, ArrowDownCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

interface Props {
  userId: string;
}

export const UserEarnings = ({ userId }: Props) => {
  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<any[]>([]);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});

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
      if (cancelled) return;
      const txs = (data as any[]) || [];
      setTx(txs);
      const ids = collectBookIds(txs);
      if (ids.length) {
        const { data: bs } = await supabase.from("books").select("id, title").in("id", ids);
        const map: Record<string, string> = {};
        for (const b of (bs as any[]) || []) map[b.id] = b.title;
        if (!cancelled) setBookTitles(map);
      } else {
        setBookTitles({});
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const stats = useMemo(() => computeTotals(tx), [tx]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin me-2" /> در حال بارگذاری…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">جمع واریز</div>
              <div className="text-xl font-display font-bold text-emerald-600 dark:text-emerald-400">
                {formatFa(stats.income)}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
              <ArrowDownCircle className="w-5 h-5 text-orange-500 dark:text-orange-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">شارژ / اعطا</div>
              <div className="text-xl font-display font-bold text-orange-500 dark:text-orange-400">
                {formatFa(stats.topUp)}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">جمع برداشت</div>
              <div className="text-xl font-display font-bold text-destructive">
                {formatFa(stats.spent)}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center">
              <Wallet className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">بالانس</div>
              <div className="text-xl font-display font-bold gold-text">
                {formatFa(stats.balance)}
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
                    <TableHead className="text-right whitespace-nowrap text-emerald-600 dark:text-emerald-400">واریز</TableHead>
                    <TableHead className="text-right whitespace-nowrap text-destructive">برداشت</TableHead>
                    <TableHead className="text-right">جزئیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tx.map((t) => {
                    const amt = Number(t.amount);
                    const kind = classifyTx(amt, t.reason);
                    const meta = (t.metadata || {}) as any;
                    const isWithdrawal = kind === "withdrawal";
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString("fa-IR")}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[11px] border-0 ${txBadgeClass[kind]}`}>
                            {reasonLabel(t.reason)}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-sm font-bold whitespace-nowrap tabular-nums ${isWithdrawal ? "text-muted-foreground/30" : txAmountClass[kind]}`}>
                          {isWithdrawal ? "—" : `+${formatFa(Math.abs(amt))}`}
                        </TableCell>
                        <TableCell className={`text-sm font-bold whitespace-nowrap tabular-nums ${isWithdrawal ? txAmountClass[kind] : "text-muted-foreground/30"}`}>
                          {isWithdrawal ? `−${formatFa(Math.abs(amt))}` : "—"}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-[260px]">
                          {meta.book_title
                            ? <span>کتاب: <span className="text-foreground font-medium">{meta.book_title}</span></span>
                            : meta.book_id
                              ? <span>کتاب #{String(meta.book_id).slice(0, 6)}</span>
                              : null}
                          {meta.percent ? <span> · {meta.percent}٪ سهم</span> : null}
                          {meta.complexity ? <span> · ضریب {meta.complexity}×</span> : null}
                          {meta.note ? <div className="opacity-80">{meta.note}</div> : null}
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
