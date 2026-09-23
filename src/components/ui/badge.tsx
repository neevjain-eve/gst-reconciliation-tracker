import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-slate-200 bg-slate-100 text-slate-700",
      green: "border-emerald-200 bg-emerald-50 text-emerald-800",
      amber: "border-amber-200 bg-amber-50 text-amber-900",
      orange: "border-orange-200 bg-orange-50 text-orange-900",
      red: "border-red-200 bg-red-50 text-red-800",
      blue: "border-blue-200 bg-blue-50 text-blue-800",
      violet: "border-violet-200 bg-violet-50 text-violet-800",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
