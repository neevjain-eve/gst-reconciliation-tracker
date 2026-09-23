import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Notice, PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { MonthlyChart, StatusBars } from "@/components/charts";
import { RunReconciliation } from "@/components/run-reconciliation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IMPORT_TYPE_LABEL } from "@/lib/constants";
import { getDashboard } from "@/lib/dashboard";
import { getFilterOptions, parseFilters, withDefaults } from "@/lib/filters";
import { requireCtx } from "@/lib/session";
import { cn, formatDateTime, formatINR, formatINRCompact } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function Kpi({ label, value, sub, tone, title }: { label: string; value: number; sub: string; tone?: "good" | "risk" | "neutral"; title?: string }) {
  return (
    <Card title={title}>
      <CardContent className="p-4 pt-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("tnum mt-1 text-2xl font-semibold tracking-tight", tone === "risk" && value > 0 && "text-red-700", tone === "good" && "text-emerald-800")} title={formatINR(value)}>
          {formatINRCompact(value)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const options = await getFilterOptions(ctx.orgId);
  const filters = await withDefaults(ctx.orgId, parseFilters(sp));
  const d = await getDashboard(ctx.orgId, filters);

  const gstins = options.clients.flatMap((c) => c.gstins.map((g) => ({ id: g.id, label: `${c.name} · ${g.gstin}` })));
  const trackerHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ fy: filters.fy });
    if (filters.clientId) q.set("client", filters.clientId);
    if (filters.gstinId) q.set("gstin", filters.gstinId);
    if (filters.period) q.set("period", filters.period);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `/reconciliation?${q}`;
  };

  if (!options.clients.length) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState title="Add your first client" action={<Button asChild><Link href="/clients">Add client <ArrowRight /></Link></Button>}>
          Register a client and its GSTIN, then upload a purchase register and GSTR-2B (or connect Zoho Books) to start reconciling.
        </EmptyState>
      </>
    );
  }

  const totalDocs = d.counts.books + d.counts.gstr2b;
  const totalResults = Object.values(d.statusCounts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Input tax credit in books vs GSTR-2B · FY ${filters.fy}${d.lastRunAt ? ` · last reconciled ${formatDateTime(d.lastRunAt)}` : ""}`}
        actions={<RunReconciliation gstins={gstins} fys={options.fys} defaultGstinId={filters.gstinId ?? gstins[0]?.id} defaultFy={filters.fy} />}
      />
      <FilterBar options={options} currentFy={filters.fy} show={{ client: true, gstin: true, fy: true, period: true }} />

      {totalDocs === 0 ? (
        <Notice tone="info">
          No bills or GSTR-2B records for this selection yet. <Link href="/sources/upload" className="font-medium underline">Upload data</Link> or <Link href="/sources/zoho" className="font-medium underline">connect Zoho Books</Link>, then run reconciliation.
        </Notice>
      ) : !d.hasResults ? (
        <Notice tone="warn">
          {totalDocs.toLocaleString("en-IN")} documents are imported but not reconciled yet. Click <strong>Run reconciliation</strong>.
        </Notice>
      ) : d.outdated ? (
        <Notice tone="warn">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" /> Data changed since the last reconciliation – matched and status figures may be out of date. Run reconciliation again.
          </span>
        </Notice>
      ) : null}

      <section aria-label="Key figures" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Purchase ITC in books" value={d.booksItc} sub={`${d.counts.books.toLocaleString("en-IN")} bills (eligible ITC)`} title="Total ITC on purchase bills in Zoho Books / manual / uploaded books" />
        <Kpi label="ITC in GSTR-2B" value={d.gstr2bItc} sub={`${d.counts.gstr2b.toLocaleString("en-IN")} supplier documents`} />
        <Kpi label="Matched ITC" value={d.matchedItc} tone="good" sub="Supported by GSTR-2B" title="ITC on documents matched (or accepted by a reviewer), limited to what GSTR-2B shows" />
        <Kpi label="Unmatched ITC" value={d.unmatchedItc} tone="risk" sub="In books, not supported by 2B" title="Books ITC minus matched ITC – at risk until the supplier reports it" />
        <Kpi label="Variance (books − 2B)" value={d.variance} sub={d.variance >= 0 ? "Books exceed GSTR-2B" : "GSTR-2B exceeds books"} title={`GSTR-2B ITC not in books: ${formatINR(d.gstr2bOnlyItc)}`} />
      </section>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Invoices by reconciliation status</CardTitle>
            <CardDescription>{totalResults.toLocaleString("en-IN")} results – click a status to open it in the tracker</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBars counts={d.statusCounts} hrefFor={(s) => trackerHref({ status: s })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monthly ITC</CardTitle>
            <CardDescription>Books vs GSTR-2B vs matched, FY {filters.fy}</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyChart data={d.monthly} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Suppliers with the most unsupported ITC</CardTitle>
            <CardDescription>Books ITC not matched in GSTR-2B – who to chase first</CardDescription>
          </CardHeader>
          <CardContent>
            {d.topVendors.length ? (
              <ul className="divide-y">
                {d.topVendors.map((v) => (
                  <li key={v.vendorId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <Link href={trackerHref({ vendor: v.vendorId })} className="min-w-0 hover:underline">
                      <span className="block truncate font-medium">{v.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {v.gstin} · {v.count} document{v.count === 1 ? "" : "s"}
                      </span>
                    </Link>
                    <span className="tnum font-semibold text-red-700">{formatINR(v.itc)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing outstanding – every eligible bill is supported by GSTR-2B.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review progress</CardTitle>
            <CardDescription>Decisions recorded on results</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {(["PENDING", "ACCEPTED", "REJECTED", "REVIEWED", "FOLLOW_UP"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{k === "FOLLOW_UP" ? "Follow-up required" : k.charAt(0) + k.slice(1).toLowerCase()}</dt>
                  <dd className="tnum font-medium">{(d.decisionCounts[k] ?? 0).toLocaleString("en-IN")}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Recent imports</p>
              <ul className="space-y-1.5">
                {d.recentImports.length ? (
                  d.recentImports.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">
                        {IMPORT_TYPE_LABEL[j.type]} · {j.gstin?.client.name ?? "—"}
                      </span>
                      <Badge tone={j.status === "COMPLETED" ? "green" : j.status === "FAILED" ? "red" : "amber"}>{j.importedRows} new</Badge>
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-muted-foreground">No imports yet.</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
