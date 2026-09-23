import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { requireCtx } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  const org = await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } });
  return (
    <AppShell user={{ name: ctx.name, email: ctx.email, role: ctx.role }} orgName={org?.name ?? ""}>
      {children}
    </AppShell>
  );
}
