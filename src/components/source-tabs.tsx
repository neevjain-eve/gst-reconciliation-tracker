"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/sources", label: "Overview", exact: true },
  { href: "/sources/upload", label: "Upload files" },
  { href: "/sources/manual", label: "Manual entry" },
  { href: "/sources/zoho", label: "Zoho Books" },
  { href: "/sources/gsp", label: "GSTR-2B API" },
];

export function SourceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Data sources" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
