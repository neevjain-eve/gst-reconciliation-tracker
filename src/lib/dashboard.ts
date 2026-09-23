import type { DocType, ReconStatus } from "@prisma/client";
import { prisma } from "./db";
import { docWhere, matchedFilter, resultWhere, type Filters } from "./filters";
import { r2 } from "./money";
import { monthLabel, num } from "./utils";

type TaxSums = { igst: unknown; cgst: unknown; sgst: unknown; cess: unknown };
const sumTax = (s: { _sum: Partial<TaxSums> | null }) => num(s._sum?.igst) + num(s._sum?.cgst) + num(s._sum?.sgst) + num(s._sum?.cess);
const signed = (docType: DocType, v: number) => (docType === "CREDIT_NOTE" ? -v : v);
const TAX = { igst: true, cgst: true, sgst: true, cess: true } as const;


/** Per-month ITC in books vs GSTR-2B vs matched for the selected FY (ignores the single-month filter). */
export async function getMonthlySeries(orgId: string, f: Filters) {
  const dwFy = docWhere(orgId, f, { ignorePeriod: true });
  const rwFy = resultWhere(orgId, f, { ignorePeriod: true, ignoreStatus: true });
  const [booksBy, gstrBy, matchedBy] = await Promise.all([
    prisma.invoice.groupBy({ by: ["taxPeriodId", "docType"], where: { ...dwFy, itcEligible: true }, _sum: TAX }),
    prisma.gstr2bRecord.groupBy({ by: ["taxPeriodId", "docType"], where: { ...dwFy, itcAvailable: true }, _sum: TAX }),
    prisma.reconciliationResult.groupBy({ by: ["taxPeriodId"], where: { AND: [rwFy, matchedFilter()] }, _sum: { matchedItc: true } }),
  ]);
  const periodIds = [...new Set([...booksBy.map((b) => b.taxPeriodId), ...gstrBy.map((b) => b.taxPeriodId), ...matchedBy.map((b) => b.taxPeriodId).filter((x): x is string => !!x)])];
  const periods = await prisma.taxPeriod.findMany({ where: { id: { in: periodIds } }, select: { id: true, year: true, month: true } });
  const byKey = new Map<string, { year: number; month: number; books: number; gstr2b: number; matched: number }>();
  const slot = (id: string) => {
    const p = periods.find((x) => x.id === id);
    if (!p) return null;
    const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
    if (!byKey.has(key)) byKey.set(key, { year: p.year, month: p.month, books: 0, gstr2b: 0, matched: 0 });
    return byKey.get(key)!;
  };
  for (const b of booksBy) {
    const s = slot(b.taxPeriodId);
    if (s) s.books += signed(b.docType, sumTax(b));
  }
  for (const g of gstrBy) {
    const s = slot(g.taxPeriodId);
    if (s) s.gstr2b += signed(g.docType, sumTax(g));
  }
  for (const m of matchedBy) {
    const s = m.taxPeriodId ? slot(m.taxPeriodId) : null;
    if (s) s.matched += num(m._sum.matchedItc);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, label: monthLabel(v.year, v.month), books: r2(v.books), gstr2b: r2(v.gstr2b), matched: r2(v.matched) }));
}

export async function getDashboard(orgId: string, f: Filters) {
  const dw = docWhere(orgId, f);
  const rw = resultWhere(orgId, f, { ignoreStatus: true });

  const [booksRows, gstrRows, matchedAgg, statusRows, decisionRows, booksCount, gstrCount, linkedBooks, linkedGstr, lastRun, imports, openFollowUps] = await Promise.all([
    prisma.invoice.groupBy({ by: ["docType"], where: { ...dw, itcEligible: true }, _sum: TAX }),
    prisma.gstr2bRecord.groupBy({ by: ["docType"], where: { ...dw, itcAvailable: true }, _sum: TAX }),
    prisma.reconciliationResult.aggregate({ where: { AND: [rw, matchedFilter()] }, _sum: { matchedItc: true } }),
    prisma.reconciliationResult.groupBy({ by: ["status"], where: rw, _count: { _all: true } }),
    prisma.reconciliationResult.groupBy({ by: ["decision"], where: rw, _count: { _all: true } }),
    prisma.invoice.count({ where: dw }),
    prisma.gstr2bRecord.count({ where: dw }),
    prisma.reconciliationResult.count({ where: { ...rw, invoiceId: { not: null } } }),
    prisma.reconciliationResult.count({ where: { ...rw, gstr2bRecordId: { not: null } } }),
    prisma.reconciliationRun.findFirst({
      where: { organizationId: orgId, ...(f.gstinId ? { gstinRegistrationId: f.gstinId } : f.clientId ? { gstin: { clientId: f.clientId } } : {}), ...(f.fy ? { financialYear: f.fy } : {}) },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.importJob.findMany({
      where: { organizationId: orgId },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { gstin: { select: { gstin: true, client: { select: { name: true } } } } },
    }),
    prisma.reconciliationResult.count({ where: { ...rw, decision: "FOLLOW_UP" } }),
  ]);

  const booksItc = r2(booksRows.reduce((s, r) => s + signed(r.docType, sumTax(r)), 0));
  const gstr2bItc = r2(gstrRows.reduce((s, r) => s + signed(r.docType, sumTax(r)), 0));
  const matchedItc = r2(num(matchedAgg._sum.matchedItc));

  const statusCounts = Object.fromEntries(statusRows.map((s) => [s.status, s._count._all])) as Partial<Record<ReconStatus, number>>;
  const decisionCounts = Object.fromEntries(decisionRows.map((d) => [d.decision, d._count._all]));

  const monthly = await getMonthlySeries(orgId, f);

  // ── vendors with the most unsupported ITC ──
  const atRisk = await prisma.reconciliationResult.groupBy({
    by: ["vendorId"],
    where: { AND: [rw, { status: { notIn: ["MATCHED", "MATCHED_WITH_VARIANCE", "MISSING_IN_BOOKS"] }, decision: { notIn: ["ACCEPTED", "REJECTED"] } }] },
    _sum: { booksItc: true, matchedItc: true },
    _count: { _all: true },
  });
  const ranked = atRisk
    .filter((v) => v.vendorId)
    .map((v) => ({ vendorId: v.vendorId as string, itc: r2(num(v._sum.booksItc) - num(v._sum.matchedItc)), count: v._count._all }))
    .filter((v) => v.itc > 0)
    .sort((a, b) => b.itc - a.itc)
    .slice(0, 6);
  const vendorRows = await prisma.vendor.findMany({ where: { id: { in: ranked.map((r) => r.vendorId) } }, select: { id: true, name: true, gstin: true } });
  const topVendors = ranked.map((r) => ({ ...r, name: vendorRows.find((v) => v.id === r.vendorId)?.name ?? "—", gstin: vendorRows.find((v) => v.id === r.vendorId)?.gstin ?? "" }));

  return {
    booksItc,
    gstr2bItc,
    matchedItc,
    unmatchedItc: r2(Math.max(booksItc - matchedItc, 0)),
    gstr2bOnlyItc: r2(Math.max(gstr2bItc - matchedItc, 0)),
    variance: r2(booksItc - gstr2bItc),
    statusCounts,
    decisionCounts,
    monthly,
    topVendors,
    counts: { books: booksCount, gstr2b: gstrCount },
    hasResults: linkedBooks + linkedGstr > 0,
    outdated: linkedBooks !== booksCount || linkedGstr !== gstrCount,
    lastRunAt: lastRun?.createdAt ?? null,
    recentImports: imports,
    openFollowUps,
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
