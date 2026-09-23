import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const ENTITY_LABELS: Record<string, string> = {
  ReconciliationResult: "Reconciliation result",
  ReconciliationRun: "Reconciliation run",
  Invoice: "Bill",
  ImportJob: "Import",
  ZohoConnection: "Zoho Books",
  Client: "Client",
  GstinRegistration: "GSTIN",
  TaxPeriod: "Tax period",
  User: "User",
  Report: "Report",
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const entity = one(sp.entity);
  const user = one(sp.user);
  const q = one(sp.q)?.trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const where: Prisma.AuditLogWhereInput = { organizationId: ctx.orgId };
  if (entity && entity in ENTITY_LABELS) where.entityType = entity;
  if (user) where.userId = user === "system" ? null : user;
  if (q) where.OR = [{ summary: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }];

  const [total, rows, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: { select: { name: true } } } }),
    prisma.user.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of imports, reconciliation runs, decisions, notes, exports and settings. Entries cannot be edited or deleted from the app." />
      <form className="mb-5 grid gap-2 rounded-lg border bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]" role="search">
        <Select name="entity" aria-label="What changed" defaultValue={entity ?? ""}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="user" aria-label="Who" defaultValue={user ?? ""}>
          <option value="">Anyone</option>
          <option value="system">System / scheduled</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Input name="q" aria-label="Search" placeholder="Search the description" defaultValue={q ?? ""} />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Filter
          </Button>
          {entity || user || q ? (
            <Button asChild variant="ghost">
              <Link href="/audit">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No matching entries" />
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>When</TH>
                  <TH>Who</TH>
                  <TH>What</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <TR key={a.id} className="align-top">
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</TD>
                    <TD className="whitespace-nowrap text-xs">{a.user?.name ?? "System"}</TD>
                    <TD className="text-xs text-muted-foreground">{ENTITY_LABELS[a.entityType] ?? a.entityType}</TD>
                    <TD>
                      {a.entityType === "ReconciliationResult" && a.entityId ? (
                        <Link href={`/reconciliation/${a.entityId}`} className="hover:underline">
                          {a.summary}
                        </Link>
                      ) : (
                        a.summary
                      )}
                      {a.before || a.after ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-primary">Before / after</summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                        </details>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination basePath="/audit" params={{ entity, user, q }} page={page} pageSize={PAGE_SIZE} total={total} />
        </div>
      )}
    </>
  );
}
