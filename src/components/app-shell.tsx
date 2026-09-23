"use client";

import { BarChart3, ClipboardCheck, FileSpreadsheet, History, LayoutDashboard, LogOut, Menu, Plug, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reconciliation", label: "Reconciliation", icon: ClipboardCheck },
  { href: "/sources", label: "Data sources", icon: Plug },
  { href: "/clients", label: "Clients & GSTINs", icon: Users },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/audit", label: "Audit log", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ user, orgName, children }: { user: { name: string; email: string; role: string }; orgName: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BarChart3 className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">GST Recon</span>
        <span className="block max-w-[10.5rem] truncate text-xs text-muted-foreground">{orgName}</span>
      </span>
    </Link>
  );

  const account = (
    <div className="border-t p-3">
      <div className="mb-2 px-2">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {user.email} · {user.role.toLowerCase()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card lg:flex">
        {brand}
        {nav}
        {account}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-card px-4 py-2 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BarChart3 className="size-4" />
          </span>
          GST Recon
        </Link>
        <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md p-2 hover:bg-accent">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {open ? (
        <div className="fixed inset-0 top-[49px] z-20 flex flex-col overflow-y-auto bg-card lg:hidden">
          {nav}
          {account}
        </div>
      ) : null}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
