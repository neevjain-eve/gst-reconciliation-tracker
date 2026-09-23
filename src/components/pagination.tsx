import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Server-rendered pager that preserves every other query parameter. */
export function Pagination({ basePath, params, page, pageSize, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:bg-accent";
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row">
      <span className="tnum">
        {from}–{to} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-2">
        <span className="tnum text-xs">
          Page {page} of {pages}
        </span>
        {page > 1 ? (
          <Link className={linkCls} href={href(page - 1)} prefetch={false}>
            <ChevronLeft className="size-3.5" /> Prev
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")}>
            <ChevronLeft className="size-3.5" /> Prev
          </span>
        )}
        {page < pages ? (
          <Link className={linkCls} href={href(page + 1)} prefetch={false}>
            Next <ChevronRight className="size-3.5" />
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-40")}>
            Next <ChevronRight className="size-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
