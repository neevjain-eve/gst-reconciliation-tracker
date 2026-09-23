import { BarChart3 } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BarChart3 className="size-5" />
        </span>
        <div className="leading-tight">
          <p className="text-lg font-semibold">GST Reconciliation Tracker</p>
          <p className="text-xs text-muted-foreground">Books vs GSTR-2B, without the spreadsheet gymnastics</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
    </div>
  );
}
