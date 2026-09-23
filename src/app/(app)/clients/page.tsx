import type { Metadata } from "next";
import Link from "next/link";
import { AddClientDialog } from "@/components/client-forms";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { stateName } from "@/lib/gstin";
import { requireCtx } from "@/lib/session";

export const metadata: Metadata = { title: "Clients & GSTINs" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const ctx = await requireCtx();
  const clients = await prisma.client.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { gstins: { orderBy: { gstin: "asc" }, include: { zohoConnection: { select: { status: true } }, _count: { select: { invoices: { where: { supersededAt: null } }, gstr2bRecords: { where: { supersededAt: null } } } } } } },
  });

  return (
    <>
      <PageHeader title="Clients & GSTINs" description="Each client can have several GSTIN registrations. Data, tax periods and integrations are tracked per GSTIN." actions={<AddClientDialog />} />
      {clients.length === 0 ? (
        <EmptyState title="No clients yet" action={<AddClientDialog />}>
          Add a client with its GSTIN to start tracking purchase ITC.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/clients/${c.id}`} className="block truncate text-base font-semibold hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">PAN {c.pan ?? "—"}</p>
                </div>
                <Link href={`/clients/${c.id}`} className="shrink-0 text-xs font-medium text-primary hover:underline">
                  Open
                </Link>
              </div>
              <ul className="divide-y rounded-md border">
                {c.gstins.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px]">{g.gstin}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {g.tradeName ? `${g.tradeName} · ` : ""}
                        {stateName(g.stateCode)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Badge>{g._count.invoices} bills</Badge>
                      <Badge>{g._count.gstr2bRecords} in 2B</Badge>
                      {g.zohoConnection?.status === "ACTIVE" ? <Badge tone="green">Zoho</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
