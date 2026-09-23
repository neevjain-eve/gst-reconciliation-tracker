import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ResultQuickActions } from "@/components/result-quick-actions";
import { RunReconciliation } from "@/components/run-reconciliation";
import { DecisionBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { STATUS_META, STATUS_ORDER } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getFilterOptions, parseFilters, resultWhere, withDefaults } from "@/lib/filters";
import { requireCtx } from "@/lib/session";
import { cn, formatDate, formatINR, num } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Reconciliation" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const SORTS: Record<string, (dir: "asc" | "desc") => Prisma.ReconciliationResultOrderByWithRelationInput> = {
  supplier: (d) => ({ supplierName: d }),
  invoice: (d) => ({ invoiceNumber: d }),
  date: (d) => ({ invoiceDate: d }),
  status: (d) => ({ status: d }),
  confidence: (d) => ({ confidence: d }),
  variance: (d) => ({ taxVariance: d }),
  itc: (d) => ({ booksItc: d }),
  decision: (d) => ({ decision: d }),
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [options, filters] = await Promise.all([getFilterOptions(ctx.orgId), withDefaults(ctx.orgId, parseFilters(sp))]);

  const sortKey = one(sp.sort) && one(sp.sort)! in SORTS ? one(sp.sort)! : "supplier";
  const dir: "asc" | "desc" = one(sp.dir) === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const where = resultWhere(ctx.orgId, filters);
  const [total, rows, statusGroups, agg] = await Promise.all([
    prisma.reconciliationResult.count({ where }),
    prisma.reconciliationResult.findMany({
      where,
      orderBy: [SORTS[sortKey](dir), { supplierName: "asc" }, { invoiceDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { assignee: { select: { name: true } }, gstin: { select: { gstin: true } } },
    }),
    prisma.reconciliationResult.groupBy({ by: ["status"], where: resultWhere(ctx.orgId, filters, { ignoreStatus: true }), _count: { _all: true } }),
    prisma.reconciliationResult.aggregate({ where, _sum: { booksItc: true, gstr2bItc: true, matchedItc: true } }),
  ]);
  const counts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
  const allCount = statusGroups.reduce((s, g) => s + g._count._all, 0);

  const gstins = options.clients.flatMap((c) => c.gstins.map((g) => ({ id: g.id, label: `${c.name} · ${g.gstin}` })));
  const params: Record<string, string | undefined> = {
    client: filters.clientId,
    gstin: filters.gstinId,
    fy: filters.fy,
    period: filters.period,
    vendor: filters.vendorId,
    status: filters.status,
    decision: filters.decision,
    assignee: filters.assigneeId,
    q: filters.q,
    sort: sortKey === "supplier" && dir === "asc" ? undefined : sortKey,
    dir: sortKey === "supplier" && dir === "asc" ? undefined : dir,
  };
  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : "";
  };
  const exportQs = (fmt: string) => {
    const u = new URLSearchParams(qs({ sort: undefined, dir: undefined }).slice(1));
    u.set("format", fmt);
    return `?${u}`;
  };

  const SortTH = ({ k, children, right }: { k: string; children: React.ReactNode; right?: boolean }) => {
    const active = sortKey === k;
    const next = active && dir === "asc" ? "desc" : "asc";
    const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TH className={right ? "text-right" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={`/reconciliation${qs({ sort: k, dir: next, page: undefined })}`} className={cn("inline-flex items-center gap-1 hover:text-foreground", right && "flex-row-reverse", active ? "text-foreground" : "")} prefetch={false}>
          {children}
          <Icon className="size-3 opacity-70" />
        </Link>
      </TH>
    );
  };

  return (
    <>
      <PageHeader
        title="Reconciliation tracker"
        description={`Books (Zoho / manual / uploaded) vs GSTR-2B · FY ${filters.fy}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reports/reconciliation${exportQs("xlsx")}`}>
                <Download /> Excel
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reports/reconciliation${exportQs("csv")}`}>
                <Download /> CSV
              </a>
            </Button>
            {gstins.length ? <RunReconciliation gstins={gstins} fys={options.fys} defaultGstinId={filters.gstinId ?? gstins[0]?.id} defaultFy={filters.fy} /> : null}
          </>
        }
      />
      <FilterBar options={options} currentFy={filters.fy} show={{ client: true, gstin: true, fy: true, period: true, vendor: true, status: true, decision: true, assignee: true, search: true }} />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1.5">
        <Link href={`/reconciliation${qs({ status: undefined, page: undefined })}`} prefetch={false} className={cn("rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent", !filters.status && "border-primary bg-primary/5 text-primary")}>
          All <span className="tnum ml-1 text-muted-foreground">{allCount.toLocaleString("en-IN")}</span>
        </Link>
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <Link
            key={s}
            href={`/reconciliation${qs({ status: s, page: undefined })}`}
            prefetch={false}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent", filters.status === s && "border-primary bg-primary/5 text-primary")}
          >
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: STATUS_META[s].dot }} />
            {STATUS_META[s].label} <span className="tnum text-muted-foreground">{counts[s].toLocaleString("en-IN")}</span>
          </Link>
        ))}
      </nav>

      {total === 0 ? (
        <EmptyState
          title={allCount === 0 && !filters.q && !filters.status ? "Nothing reconciled yet" : "No results match these filters"}
          action={
            allCount === 0 ? (
              <Button asChild>
                <Link href="/sources/upload">Import data</Link>
              </Button>
            ) : undefined
          }
        >
          {allCount === 0 ? "Import bills and GSTR-2B, then choose Run reconciliation." : "Try clearing a filter or searching for a different invoice number."}
        </EmptyState>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <SortTH k="supplier">Supplier</SortTH>
                  <SortTH k="invoice">Invoice</SortTH>
                  <SortTH k="date">Date</SortTH>
                  <SortTH k="status">Status</SortTH>
                  <SortTH k="confidence" right>
                    Conf.
                  </SortTH>
                  <TH className="text-right">Books tax</TH>
                  <TH className="text-right">GSTR-2B tax</TH>
                  <SortTH k="variance" right>
                    Variance
                  </SortTH>
                  <SortTH k="decision">Decision / owner</SortTH>
                  <TH className="w-10">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const variance = num(r.taxVariance);
                  return (
                    <TR key={r.id}>
                      <TD className="max-w-[13rem]">
                        <span className="block truncate font-medium" title={r.supplierName}>
                          {r.supplierName}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">{r.supplierGstin}</span>
                      </TD>
                      <TD className="whitespace-nowrap">
                        <Link href={`/reconciliation/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.invoiceNumber}
                        </Link>
                        {r.docType !== "INVOICE" ? <span className="block text-xs text-muted-foreground">{r.docType === "CREDIT_NOTE" ? "Credit note" : "Debit note"}</span> : null}
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{formatDate(r.invoiceDate)}</TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="tnum text-right text-xs">{r.matchMethod === "NONE" ? "—" : `${r.confidence}%`}</TD>
                      <TD className="tnum text-right">{formatINR(r.booksTax === null ? null : num(r.booksTax))}</TD>
                      <TD className="tnum text-right">{formatINR(r.gstr2bTax === null ? null : num(r.gstr2bTax))}</TD>
                      <TD className={cn("tnum text-right", variance !== 0 && "font-medium text-red-700")}>{r.booksTax !== null && r.gstr2bTax !== null ? formatINR(variance) : "—"}</TD>
                      <TD>
                        <DecisionBadge decision={r.decision} />
                        {r.assignee || r.followUpDueDate ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {r.assignee?.name ?? "Unassigned"}
                            {r.followUpDueDate ? ` · due ${formatDate(r.followUpDueDate)}` : ""}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        <ResultQuickActions id={r.id} decision={r.decision} label={`${r.invoiceNumber}`} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
          <Pagination basePath="/reconciliation" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
        </div>
      )}

      {total > 0 ? (
        <p className="tnum mt-3 text-xs text-muted-foreground">
          For the {total.toLocaleString("en-IN")} result{total === 1 ? "" : "s"} shown: books ITC {formatINR(num(agg._sum.booksItc), { decimals: 0 })} · GSTR-2B ITC {formatINR(num(agg._sum.gstr2bItc), { decimals: 0 })} · matched ITC {formatINR(num(agg._sum.matchedItc), { decimals: 0 })}
        </p>
      ) : null}
    </>
  );
}
