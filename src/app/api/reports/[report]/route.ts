import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { reportToCsv, reportToXlsx } from "@/lib/export";
import { parseFilters, withDefaults } from "@/lib/filters";
import { buildReport, REPORT_META, reportSubtitle, type ReportKey } from "@/lib/reports";
import { ApiError } from "@/lib/session";

export const maxDuration = 60;

/** GET /api/reports/<report>?format=csv|xlsx&client=&gstin=&fy=&period=&vendor=&status=&decision=&q= */
export const GET = apiRoute<{ report: string }>(async (req, ctx, { report }) => {
  if (!REPORT_META.some((m) => m.key === report)) throw new ApiError(404, "Unknown report");
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const filters = await withDefaults(ctx.orgId, parseFilters(sp));

  // a non-member must not be able to scope an export to another organisation's client / GSTIN
  if (filters.gstinId && !(await prisma.gstinRegistration.findFirst({ where: { id: filters.gstinId, organizationId: ctx.orgId }, select: { id: true } }))) throw new ApiError(404, "GSTIN not found");
  if (filters.clientId && !(await prisma.client.findFirst({ where: { id: filters.clientId, organizationId: ctx.orgId }, select: { id: true } }))) throw new ApiError(404, "Client not found");

  const built = await buildReport(report as ReportKey, ctx.orgId, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${report}-${filters.fy}-${stamp}.${format}`;

  await audit(null, ctx, {
    action: "REPORT_EXPORTED",
    entityType: "Report",
    summary: `Exported “${built.title}” as ${format.toUpperCase()} (${built.rows.length} rows)`,
    metadata: { report, format, filters },
  });

  if (format === "csv") {
    return new NextResponse(reportToCsv(built), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  }
  const buf = await reportToXlsx(built, {
    subtitle: reportSubtitle(filters),
    generatedBy: ctx.email,
    filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])),
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
