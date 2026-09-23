import { Download } from "lucide-react";
import type { Metadata } from "next";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getFilterOptions, parseFilters, withDefaults } from "@/lib/filters";
import { buildReport, REPORT_META, reportSubtitle, type Cell, type Report } from "@/lib/reports";
import { requireCtx } from "@/lib/session";
import { cn, formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

function cell(v: Cell, type: Report["columns"][number]["type"]) {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "money") return formatINR(Number(v), { decimals: 0 });
  if (type === "date") return formatDate(v as Date);
  if (type === "percent") return `${v}%`;
  if (type === "int") return Number(v).toLocaleString("en-IN");
  return String(v);
}

function Preview({ report, max }: { report: Report; max: number }) {
  if (!report.rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No data for this selection yet – run reconciliation first.</p>;
  const cols = report.columns.slice(0, 10);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.type === "text" ? "text-left" : "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.slice(0, max).map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {cols.map((c) => (
                <td key={c.key} className={cn("px-3 py-2", c.type === "text" ? "max-w-[16rem] truncate text-left" : "tnum text-right")}>
                  {cell(row[c.key], c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length > max ? <p className="px-3 py-2 text-xs text-muted-foreground">Showing {max} of {report.rows.length.toLocaleString("en-IN")} rows – download for the full report.</p> : null}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const [options, filters] = await Promise.all([getFilterOptions(ctx.orgId), withDefaults(ctx.orgId, parseFilters(sp))]);
  const [monthly, vendors] = await Promise.all([buildReport("monthly-itc", ctx.orgId, filters), buildReport("vendor-summary", ctx.orgId, filters)]);

  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ client: filters.clientId, gstin: filters.gstinId, fy: filters.fy, period: filters.period, vendor: filters.vendorId })) if (v) q.set(k, v);
  const href = (key: string, format: "xlsx" | "csv") => `/api/reports/${key}?${new URLSearchParams({ ...Object.fromEntries(q), format })}`;

  return (
    <>
      <PageHeader title="Reports" description={`Exports respect the filters below · ${reportSubtitle(filters)}`} />
      <FilterBar options={options} currentFy={filters.fy} show={{ client: true, gstin: true, fy: true, period: true, vendor: true }} />

      <div className="mb-6 grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Monthly ITC summary</CardTitle>
            <CardDescription>Books vs GSTR-2B vs matched, per tax period</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Preview report={monthly} max={12} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vendor-wise summary</CardTitle>
            <CardDescription>Suppliers with the most ITC not yet supported by GSTR-2B</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Preview report={vendors} max={8} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Download</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_META.map((m) => (
          <Card key={m.key}>
            <CardContent className="flex h-full flex-col justify-between gap-3 p-4 pt-4">
              <div>
                <h3 className="text-sm font-semibold">{m.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={href(m.key, "xlsx")}>
                    <Download /> Excel
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={href(m.key, "csv")}>
                    <Download /> CSV
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">CSV cells that start with = + - or @ are escaped so spreadsheets never run them as formulas. Every export is recorded in the audit log.</p>
    </>
  );
}
