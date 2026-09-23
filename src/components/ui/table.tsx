import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
));
Table.displayName = "Table";

const THead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("[&_tr]:border-b bg-muted/60", className)} {...props} />;
const TBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
const TR = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...props} />;
const TH = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} {...props} />
);
const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;

export { Table, TBody, TD, TH, THead, TR };
