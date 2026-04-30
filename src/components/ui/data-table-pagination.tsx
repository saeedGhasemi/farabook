import { useMemo, useState, useEffect } from "react";
import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZES = [10, 25, 50, 100];

/** Reusable client-side pagination state for tables.
 *  - Persists chosen page size in localStorage per `storageKey`.
 *  - Resets to first page whenever `total` shrinks below the current page. */
export function usePagination<T>(items: T[], storageKey = "table.pageSize", defaultSize = 25) {
  const [pageSize, setPageSizeRaw] = useState<number>(() => {
    if (typeof window === "undefined") return defaultSize;
    const v = Number(localStorage.getItem(storageKey));
    return PAGE_SIZES.includes(v) ? v : defaultSize;
  });
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => { if (page > pageCount) setPage(1); }, [page, pageCount]);

  const setPageSize = (n: number) => {
    setPageSizeRaw(n);
    setPage(1);
    try { localStorage.setItem(storageKey, String(n)); } catch { /* ignore */ }
  };

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );
  const startIndex = (page - 1) * pageSize; // 0-based offset for row numbering

  return { page, setPage, pageSize, setPageSize, pageCount, total, pageItems, startIndex };
}

interface ControlsProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  className?: string;
}

export const TablePaginationControls = ({
  page, pageCount, pageSize, total, setPage, setPageSize, className,
}: ControlsProps) => {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 pt-3 text-xs ${className ?? ""}`} dir="rtl">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>تعداد در صفحه:</span>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="h-7 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden sm:inline">
          نمایش {from.toLocaleString("fa-IR")}–{to.toLocaleString("fa-IR")} از {total.toLocaleString("fa-IR")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setPage(1)} disabled={page <= 1}>
          <ChevronsRight className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setPage(page - 1)} disabled={page <= 1}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <span className="px-2 tabular-nums">
          {page.toLocaleString("fa-IR")} / {pageCount.toLocaleString("fa-IR")}
        </span>
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setPage(pageCount)} disabled={page >= pageCount}>
          <ChevronsLeft className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};
