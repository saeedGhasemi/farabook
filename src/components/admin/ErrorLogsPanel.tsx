// Admin panel that surfaces user-visible runtime errors and failed attempts.
// Lets admins triage issues quickly: filter by source, search by message, see
// stack + context, mark / clear old entries.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Search, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ErrorRow {
  id: string;
  created_at: string;
  user_id: string | null;
  level: string;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  route: string | null;
  user_agent: string | null;
  context: any;
}

const LEVEL_COLOR: Record<string, string> = {
  error: "bg-destructive/15 text-destructive border-destructive/40",
  warn: "bg-amber-500/15 text-amber-600 border-amber-500/40",
  info: "bg-sky-500/15 text-sky-600 border-sky-500/40",
};

const LevelIcon = ({ level }: { level: string }) => {
  if (level === "error") return <AlertTriangle className="w-3.5 h-3.5" />;
  if (level === "warn") return <AlertCircle className="w-3.5 h-3.5" />;
  return <Info className="w-3.5 h-3.5" />;
};

export const ErrorLogsPanel = () => {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [detail, setDetail] = useState<ErrorRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("client_error_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error(`خطا در بارگذاری: ${error.message}`);
    } else {
      setRows((data ?? []) as ErrorRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sources = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.source));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (levelFilter !== "all" && r.level !== levelFilter) return false;
      if (q && !(`${r.message} ${r.source} ${r.route ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, sourceFilter, levelFilter]);

  const clearOlderThan = async (days: number) => {
    if (!confirm(`حذف لاگ‌های قدیمی‌تر از ${days} روز؟`)) return;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { error } = await supabase
      .from("client_error_logs")
      .delete()
      .lt("created_at", cutoff);
    if (error) toast.error(error.message);
    else { toast.success("حذف شد"); load(); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          لاگ خطاهای کاربران
          <Badge variant="outline" className="ms-2">{filtered.length} / {rows.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            بروزرسانی
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearOlderThan(7)}>
            حذف &gt; ۷ روز
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearOlderThan(0)}>
            پاک‌سازی همه
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="جستجو در پیام، منبع، مسیر…"
              className="ps-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="منبع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه منابع</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="سطح" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه سطح‌ها</SelectItem>
              <SelectItem value="error">خطا</SelectItem>
              <SelectItem value="warn">هشدار</SelectItem>
              <SelectItem value="info">اطلاعات</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">زمان</TableHead>
                <TableHead>سطح</TableHead>
                <TableHead>منبع</TableHead>
                <TableHead>پیام</TableHead>
                <TableHead>مسیر</TableHead>
                <TableHead>کاربر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  چیزی برای نمایش نیست 🎉
                </TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetail(r)}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("fa-IR")}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${LEVEL_COLOR[r.level] ?? ""}`}>
                      <LevelIcon level={r.level} />
                      {r.level}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.source}</TableCell>
                  <TableCell className="max-w-[420px] truncate text-sm">{r.message}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.route ?? "—"}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {r.user_id ? r.user_id.slice(0, 8) : "anon"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${LEVEL_COLOR[detail?.level ?? "error"]}`}>
                <LevelIcon level={detail?.level ?? "error"} />
                {detail?.level}
              </span>
              <span className="font-mono text-sm">{detail?.source}</span>
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">پیام</div>
                <div className="rounded bg-muted p-2 font-mono whitespace-pre-wrap break-words">{detail.message}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">زمان: </span>{new Date(detail.created_at).toLocaleString("fa-IR")}</div>
                <div className="font-mono"><span className="text-muted-foreground">کاربر: </span>{detail.user_id ?? "anon"}</div>
                <div className="col-span-2 font-mono break-all"><span className="text-muted-foreground">URL: </span>{detail.url ?? "—"}</div>
                <div className="col-span-2 font-mono break-all"><span className="text-muted-foreground">UA: </span>{detail.user_agent ?? "—"}</div>
              </div>
              {detail.stack && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Stack</div>
                  <pre className="rounded bg-muted p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words">{detail.stack}</pre>
                </div>
              )}
              {detail.context && Object.keys(detail.context).length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Context</div>
                  <pre className="rounded bg-muted p-2 text-[11px] overflow-x-auto">{JSON.stringify(detail.context, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
