import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddFinancialYearForm, AddGstinForm, PeriodStatusSelect } from "@/components/client-forms";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { currentFinancialYear } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { stateName } from "@/lib/gstin";
import { requireCtx } from "@/lib/session";
import { monthLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Client" };
export const dynamic = "force-dynamic";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const client = await prisma.client.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { gstins: { orderBy: { gstin: "asc" }, include: { taxPeriods: { orderBy: [{ year: "desc" }, { month: "desc" }] }, zohoConnection: { select: { status: true, zohoOrganizationName: true } } } } },
  });
  if (!client) notFound();

  const regIds = client.gstins.map((g) => g.id);
  const [booksBy, gstrBy, resultsBy] = await Promise.all([
    prisma.invoice.groupBy({ by: ["taxPeriodId"], where: { gstinRegistrationId: { in: regIds }, supersededAt: null }, _count: { _all: true } }),
    prisma.gstr2bRecord.groupBy({ by: ["taxPeriodId"], where: { gstinRegistrationId: { in: regIds }, supersededAt: null }, _count: { _all: true } }),
    prisma.reconciliationResult.groupBy({ by: ["taxPeriodId"], where: { gstinRegistrationId: { in: regIds }, isStale: false, status: { notIn: ["MATCHED"] }, decision: { in: ["PENDING", "FOLLOW_UP"] } }, _count: { _all: true } }),
  ]);
  const count = (rows: { taxPeriodId: string | null; _count: { _all: number } }[], pid: string) => rows.find((r) => r.taxPeriodId === pid)?._count._all ?? 0;

  const thisFy = currentFinancialYear();
  const fySuggestions = (existing: Set<string>) => {
    const start = Number(thisFy.slice(0, 4));
    return [start + 1, start, start - 1, start - 2, start - 3].map((s) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`).filter((fy) => !existing.has(fy));
  };

  return (
    <>
      <PageHeader
        title={client.name}
        description={<>PAN {client.pan ?? "—"} · {client.gstins.length} GSTIN registration{client.gstins.length === 1 ? "" : "s"}</>}
        actions={
          <Button asChild variant="outline">
            <Link href="/clients">All clients</Link>
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="p-4">
          <AddGstinForm clientId={client.id} />
        </CardContent>
      </Card>

      <div className="space-y-6">
        {client.gstins.map((g) => {
          const fys = [...new Set(g.taxPeriods.map((p) => p.financialYear))];
          return (
            <Card key={g.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-mono text-base">{g.gstin}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {g.tradeName ? `${g.tradeName} · ` : ""}
                    {stateName(g.stateCode)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {g.zohoConnection?.status === "ACTIVE" ? <Badge tone="green">Zoho: {g.zohoConnection.zohoOrganizationName ?? "connected"}</Badge> : <Badge>Zoho not connected</Badge>}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/reconciliation?gstin=${g.id}`}>Open tracker</Link>
                  </Button>
                  <AddFinancialYearForm gstinRegistrationId={g.id} suggestions={fySuggestions(new Set(fys))} />
                </div>
              </CardHeader>
              <CardContent>
                {fys.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No tax periods yet – add a financial year.</p>
                ) : (
                  fys.map((fy) => (
                    <div key={fy} className="mb-4 last:mb-0">
                      <h4 className="mb-2 text-sm font-semibold">FY {fy}</h4>
                      <div className="rounded-md border">
                        <Table>
                          <THead>
                            <TR className="hover:bg-transparent">
                              <TH>Tax period</TH>
                              <TH className="text-right">Books bills</TH>
                              <TH className="text-right">GSTR-2B docs</TH>
                              <TH className="text-right">Open exceptions</TH>
                              <TH>Status</TH>
                            </TR>
                          </THead>
                          <TBody>
                            {g.taxPeriods
                              .filter((p) => p.financialYear === fy)
                              .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
                              .map((p) => {
                                const open = count(resultsBy, p.id);
                                return (
                                  <TR key={p.id}>
                                    <TD className="font-medium">{monthLabel(p.year, p.month)}</TD>
                                    <TD className="tnum text-right">{count(booksBy, p.id) || "—"}</TD>
                                    <TD className="tnum text-right">{count(gstrBy, p.id) || "—"}</TD>
                                    <TD className="tnum text-right">
                                      {open ? (
                                        <Link className="font-medium text-primary hover:underline" href={`/reconciliation?gstin=${g.id}&fy=${fy}&period=${p.year}-${String(p.month).padStart(2, "0")}`}>
                                          {open}
                                        </Link>
                                      ) : (
                                        "—"
                                      )}
                                    </TD>
                                    <TD>
                                      <PeriodStatusSelect id={p.id} status={p.status} />
                                    </TD>
                                  </TR>
                                );
                              })}
                          </TBody>
                        </Table>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
