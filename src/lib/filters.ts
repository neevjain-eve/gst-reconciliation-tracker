import type { Decision, Prisma, ReconStatus } from "@prisma/client";
import { currentFinancialYear, isValidFinancialYear } from "./dates";
import { prisma } from "./db";

export const RECON_STATUSES: ReconStatus[] = [
  "MATCHED",
  "MATCHED_WITH_VARIANCE",
  "MISSING_IN_GSTR2B",
  "MISSING_IN_BOOKS",
  "DUPLICATE_INVOICE",
  "GSTIN_MISMATCH",
  "INVOICE_NUMBER_MISMATCH",
  "TAX_MISMATCH",
  "NEEDS_REVIEW",
];
export const DECISIONS: Decision[] = ["PENDING", "ACCEPTED", "REJECTED", "REVIEWED", "FOLLOW_UP"];

/** Filters shared by the dashboard, tracker and reports (all optional, all come from the URL). */
export interface Filters {
  clientId?: string;
  gstinId?: string;
  fy?: string;
  period?: string; // YYYY-MM
  vendorId?: string;
  status?: ReconStatus;
  decision?: Decision;
  assigneeId?: string;
  q?: string;
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseFilters(sp: SP): Filters {
  const status = first(sp.status);
  const decision = first(sp.decision);
  const fy = first(sp.fy);
  const period = first(sp.period);
  return {
    clientId: first(sp.client),
    gstinId: first(sp.gstin),
    fy: fy && isValidFinancialYear(fy) ? fy : undefined,
    period: period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : undefined,
    vendorId: first(sp.vendor),
    status: RECON_STATUSES.includes(status as ReconStatus) ? (status as ReconStatus) : undefined,
    decision: DECISIONS.includes(decision as Decision) ? (decision as Decision) : undefined,
    assigneeId: first(sp.assignee),
    q: first(sp.q)?.trim().slice(0, 80) || undefined,
  };
}

/** Most recent FY that actually has reconciliation results (or imported bills); falls back to the current FY. */
export async function defaultFinancialYear(orgId: string): Promise<string> {
  const r = await prisma.reconciliationResult.findFirst({
    where: { organizationId: orgId, isStale: false },
    orderBy: { taxPeriod: { year: "desc" } },
    select: { taxPeriod: { select: { financialYear: true, year: true, month: true } } },
  });
  if (r?.taxPeriod) return r.taxPeriod.financialYear;
  const i = await prisma.invoice.findFirst({
    where: { organizationId: orgId, supersededAt: null },
    orderBy: { invoiceDate: "desc" },
    select: { taxPeriod: { select: { financialYear: true } } },
  });
  return i?.taxPeriod.financialYear ?? currentFinancialYear();
}

export async function withDefaults(orgId: string, f: Filters): Promise<Filters & { fy: string }> {
  return { ...f, fy: f.fy ?? (await defaultFinancialYear(orgId)) };
}

/** Where-clause pieces common to Invoice / Gstr2bRecord / ReconciliationResult. */
export function scopeParts(f: Filters) {
  const gstin = f.gstinId ? { gstinRegistrationId: f.gstinId } : f.clientId ? { gstin: { clientId: f.clientId } } : {};
  const taxPeriod: { financialYear?: string; year?: number; month?: number } = {};
  if (f.fy) taxPeriod.financialYear = f.fy;
  if (f.period) {
    taxPeriod.year = Number(f.period.slice(0, 4));
    taxPeriod.month = Number(f.period.slice(5, 7));
  }
  return { gstin, taxPeriod: Object.keys(taxPeriod).length ? { taxPeriod } : {} };
}

export interface DocWhere {
  organizationId: string;
  supersededAt: null;
  gstinRegistrationId?: string;
  gstin?: { clientId: string };
  taxPeriod?: { financialYear?: string; year?: number; month?: number };
  vendorId?: string;
}

/** For Invoice and Gstr2bRecord (identical column names). */
export function docWhere(orgId: string, f: Filters, opts: { ignorePeriod?: boolean } = {}): DocWhere {
  const s = scopeParts(opts.ignorePeriod ? { ...f, period: undefined } : f);
  return { organizationId: orgId, supersededAt: null, ...s.gstin, ...s.taxPeriod, ...(f.vendorId ? { vendorId: f.vendorId } : {}) };
}

export function resultWhere(orgId: string, f: Filters, opts: { ignorePeriod?: boolean; ignoreStatus?: boolean } = {}): Prisma.ReconciliationResultWhereInput {
  const s = scopeParts(opts.ignorePeriod ? { ...f, period: undefined } : f);
  const where: Prisma.ReconciliationResultWhereInput = { organizationId: orgId, isStale: false, ...s.gstin, ...s.taxPeriod };
  if (f.vendorId) where.vendorId = f.vendorId;
  if (f.status && !opts.ignoreStatus) where.status = f.status;
  if (f.decision) where.decision = f.decision;
  if (f.assigneeId) where.assigneeId = f.assigneeId === "none" ? null : f.assigneeId;
  if (f.q) {
    where.OR = [
      { invoiceNumber: { contains: f.q, mode: "insensitive" } },
      { supplierName: { contains: f.q, mode: "insensitive" } },
      { supplierGstin: { contains: f.q.toUpperCase() } },
    ];
  }
  return where;
}

/** Results whose ITC counts as matched: system-matched (unless rejected) or explicitly accepted. */
export function matchedFilter(): Prisma.ReconciliationResultWhereInput {
  return {
    OR: [{ status: { in: ["MATCHED", "MATCHED_WITH_VARIANCE"] }, decision: { not: "REJECTED" } }, { decision: "ACCEPTED" }],
  };
}

export async function getFilterOptions(orgId: string) {
  const [clients, periods, vendors, users] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, gstins: { select: { id: true, gstin: true, tradeName: true }, orderBy: { gstin: "asc" } } },
    }),
    prisma.taxPeriod.findMany({ where: { organizationId: orgId }, distinct: ["financialYear", "year", "month"], select: { financialYear: true, year: true, month: true }, orderBy: [{ year: "desc" }, { month: "desc" }] }),
    prisma.vendor.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, gstin: true }, take: 1000 }),
    prisma.user.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const fys = [...new Set(periods.map((p) => p.financialYear))].sort().reverse();
  const months = periods.map((p) => ({ value: `${p.year}-${String(p.month).padStart(2, "0")}`, year: p.year, month: p.month, fy: p.financialYear }));
  return { clients, fys, months, vendors, users };
}
export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;
