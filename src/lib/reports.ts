import type { Prisma } from "@prisma/client";
import { getMonthlySeries } from "./dashboard";
import { prisma } from "./db";
import { matchedFilter, resultWhere, type Filters } from "./filters";
import { r2 } from "./money";
import { monthLabel, num } from "./utils";

export type ReportKey = "reconciliation" | "vendor-summary" | "monthly-itc" | "missing-in-2b" | "books-not-in-2b" | "2b-not-in-books" | "variance";

export interface ReportColumn {
  key: string;
  header: string;
  type: "text" | "money" | "int" | "date" | "percent";
  width?: number;
}
export type Cell = string | number | Date | null;
export interface Report {
  key: ReportKey;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  truncated: boolean;
}

export const REPORT_META: { key: ReportKey; title: string; description: string }[] = [
  { key: "reconciliation", title: "Full reconciliation", description: "Every result with status, decision, amounts and explanation." },
  { key: "vendor-summary", title: "Vendor-wise summary", description: "ITC in books, in GSTR-2B and matched, per supplier – find who to chase." },
  { key: "monthly-itc", title: "Monthly ITC summary", description: "Books vs GSTR-2B vs matched ITC for each tax period." },
  { key: "missing-in-2b", title: "Missing in GSTR-2B", description: "Bills in books that the supplier has not reported – ITC not yet claimable." },
  { key: "books-not-in-2b", title: "Books not confirmed by GSTR-2B", description: "Every books bill without a clean GSTR-2B match (missing, mismatched, duplicate, needs review) with the unsupported ITC." },
  { key: "2b-not-in-books", title: "GSTR-2B not in books", description: "Supplier-reported documents you have not booked – possible missed ITC." },
  { key: "variance", title: "Variance report", description: "Paired documents whose amounts differ, largest tax variance first." },
];

export const MAX_EXPORT_ROWS = 50_000;

const RESULT_COLUMNS: ReportColumn[] = [
  { key: "client", header: "Client", type: "text", width: 24 },
  { key: "gstin", header: "Client GSTIN", type: "text", width: 18 },
  { key: "period", header: "Tax period", type: "text", width: 11 },
  { key: "supplierGstin", header: "Supplier GSTIN", type: "text", width: 18 },
  { key: "supplierName", header: "Supplier", type: "text", width: 28 },
  { key: "invoiceNumber", header: "Invoice no.", type: "text", width: 18 },
  { key: "invoiceDate", header: "Invoice date", type: "date", width: 13 },
  { key: "docType", header: "Doc type", type: "text", width: 12 },
  { key: "status", header: "Status", type: "text", width: 24 },
  { key: "confidence", header: "Confidence", type: "int", width: 11 },
  { key: "decision", header: "Decision", type: "text", width: 12 },
  { key: "assignee", header: "Follow-up owner", type: "text", width: 18 },
  { key: "booksTaxable", header: "Books taxable", type: "money", width: 15 },
  { key: "booksTax", header: "Books tax", type: "money", width: 14 },
  { key: "gstr2bTaxable", header: "GSTR-2B taxable", type: "money", width: 15 },
  { key: "gstr2bTax", header: "GSTR-2B tax", type: "money", width: 14 },
  { key: "taxableVariance", header: "Taxable variance", type: "money", width: 15 },
  { key: "taxVariance", header: "Tax variance", type: "money", width: 14 },
  { key: "booksItc", header: "Books ITC", type: "money", width: 14 },
  { key: "gstr2bItc", header: "GSTR-2B ITC", type: "money", width: 14 },
  { key: "matchedItc", header: "Matched ITC", type: "money", width: 14 },
  { key: "explanation", header: "Explanation", type: "text", width: 80 },
];

const UNSUPPORTED: ReportColumn = { key: "unsupportedItc", header: "ITC not supported by GSTR-2B", type: "money", width: 18 };

type ResultWithRefs = Prisma.ReconciliationResultGetPayload<{
  include: { taxPeriod: true; gstin: { include: { client: true } }; assignee: { select: { name: true } } };
}>;

const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function resultRow(r: ResultWithRefs): Record<string, Cell> {
  const opt = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return {
    client: r.gstin.client.name,
    gstin: r.gstin.gstin,
    period: r.taxPeriod ? `${String(r.taxPeriod.month).padStart(2, "0")}-${r.taxPeriod.year}` : "",
    supplierGstin: r.supplierGstin,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    docType: humanize(r.docType),
    status: humanize(r.status),
    confidence: r.confidence,
    decision: humanize(r.decision),
    assignee: r.assignee?.name ?? "",
    booksTaxable: opt(r.booksTaxable),
    booksTax: opt(r.booksTax),
    gstr2bTaxable: opt(r.gstr2bTaxable),
    gstr2bTax: opt(r.gstr2bTax),
    taxableVariance: num(r.taxableVariance),
    taxVariance: num(r.taxVariance),
    booksItc: num(r.booksItc),
    gstr2bItc: num(r.gstr2bItc),
    matchedItc: num(r.matchedItc),
    unsupportedItc: r2(Math.max(num(r.booksItc) - num(r.matchedItc), 0)),
    explanation: r.explanation,
  };
}

async function resultReport(key: ReportKey, orgId: string, f: Filters, extra: Prisma.ReconciliationResultWhereInput | null, limit: number, withUnsupported = false, sort?: (a: Record<string, Cell>, b: Record<string, Cell>) => number): Promise<Report> {
  const where: Prisma.ReconciliationResultWhereInput = extra ? { AND: [resultWhere(orgId, f, { ignoreStatus: !!extra.status }), extra] } : resultWhere(orgId, f);
  const rows = await prisma.reconciliationResult.findMany({
    where,
    include: { taxPeriod: true, gstin: { include: { client: true } }, assignee: { select: { name: true } } },
    orderBy: [{ supplierName: "asc" }, { invoiceDate: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const truncated = rows.length > limit;
  let mapped = rows.slice(0, limit).map(resultRow);
  if (sort) mapped = mapped.sort(sort);
  const columns = withUnsupported ? [...RESULT_COLUMNS.slice(0, 21), UNSUPPORTED, RESULT_COLUMNS[21]] : RESULT_COLUMNS;
  return { key, title: REPORT_META.find((m) => m.key === key)!.title, columns, rows: mapped, truncated };
}

export async function buildReport(key: ReportKey, orgId: string, f: Filters, opts: { limit?: number } = {}): Promise<Report> {
  const limit = opts.limit ?? MAX_EXPORT_ROWS;
  const title = REPORT_META.find((m) => m.key === key)!.title;

  switch (key) {
    case "reconciliation":
      return resultReport(key, orgId, f, null, limit);
    case "missing-in-2b":
      return resultReport(key, orgId, f, { status: "MISSING_IN_GSTR2B" }, limit, true);
    case "2b-not-in-books":
      return resultReport(key, orgId, f, { status: "MISSING_IN_BOOKS" }, limit);
    case "books-not-in-2b":
      return resultReport(
        key,
        orgId,
        f,
        { status: { in: ["MISSING_IN_GSTR2B", "GSTIN_MISMATCH", "INVOICE_NUMBER_MISMATCH", "TAX_MISMATCH", "NEEDS_REVIEW", "DUPLICATE_INVOICE"] }, invoiceId: { not: null } },
        limit,
        true,
        (a, b) => num(b.unsupportedItc) - num(a.unsupportedItc),
      );
    case "variance":
      return resultReport(
        key,
        orgId,
        f,
        { invoiceId: { not: null }, gstr2bRecordId: { not: null }, OR: [{ taxVariance: { not: 0 } }, { taxableVariance: { not: 0 } }], status: { notIn: ["MATCHED", "DUPLICATE_INVOICE"] } },
        limit,
        false,
        (a, b) => Math.abs(num(b.taxVariance)) - Math.abs(num(a.taxVariance)),
      );

    case "monthly-itc": {
      const series = await getMonthlySeries(orgId, f);
      return {
        key,
        title,
        truncated: false,
        columns: [
          { key: "period", header: "Tax period", type: "text", width: 14 },
          { key: "books", header: "ITC in books", type: "money", width: 16 },
          { key: "gstr2b", header: "ITC in GSTR-2B", type: "money", width: 16 },
          { key: "matched", header: "Matched ITC", type: "money", width: 16 },
          { key: "unmatched", header: "Books ITC not matched", type: "money", width: 20 },
          { key: "gstr2bOnly", header: "GSTR-2B ITC not in books", type: "money", width: 22 },
          { key: "variance", header: "Variance (books − 2B)", type: "money", width: 20 },
        ],
        rows: series.map((m) => ({
          period: m.label,
          books: m.books,
          gstr2b: m.gstr2b,
          matched: m.matched,
          unmatched: r2(Math.max(m.books - m.matched, 0)),
          gstr2bOnly: r2(Math.max(m.gstr2b - m.matched, 0)),
          variance: r2(m.books - m.gstr2b),
        })),
      };
    }

    case "vendor-summary": {
      const where = resultWhere(orgId, f, { ignoreStatus: true });
      const [totals, matched, exceptions] = await Promise.all([
        prisma.reconciliationResult.groupBy({ by: ["vendorId"], where, _sum: { booksItc: true, gstr2bItc: true }, _count: { _all: true } }),
        prisma.reconciliationResult.groupBy({ by: ["vendorId"], where: { AND: [where, matchedFilter()] }, _sum: { matchedItc: true } }),
        prisma.reconciliationResult.groupBy({ by: ["vendorId"], where: { AND: [where, { status: { notIn: ["MATCHED"] } }] }, _count: { _all: true } }),
      ]);
      const ids = totals.map((t) => t.vendorId).filter((x): x is string => !!x);
      const vendors = await prisma.vendor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, gstin: true } });
      const rows = totals
        .filter((t) => t.vendorId)
        .map((t) => {
          const v = vendors.find((x) => x.id === t.vendorId);
          const books = num(t._sum.booksItc);
          const gstr = num(t._sum.gstr2bItc);
          const m = num(matched.find((x) => x.vendorId === t.vendorId)?._sum.matchedItc);
          const ex = exceptions.find((x) => x.vendorId === t.vendorId)?._count._all ?? 0;
          const docs = t._count._all;
          return {
            vendor: v?.name ?? "—",
            gstin: v?.gstin ?? "",
            documents: docs,
            books: r2(books),
            gstr2b: r2(gstr),
            matched: r2(m),
            unmatched: r2(Math.max(books - m, 0)),
            variance: r2(books - gstr),
            exceptions: ex,
            matchRate: docs ? Math.round(((docs - ex) / docs) * 100) : 0,
          } as Record<string, Cell>;
        })
        .sort((a, b) => num(b.unmatched) - num(a.unmatched));
      return {
        key,
        title,
        truncated: false,
        columns: [
          { key: "vendor", header: "Supplier", type: "text", width: 30 },
          { key: "gstin", header: "Supplier GSTIN", type: "text", width: 18 },
          { key: "documents", header: "Documents", type: "int", width: 11 },
          { key: "books", header: "ITC in books", type: "money", width: 16 },
          { key: "gstr2b", header: "ITC in GSTR-2B", type: "money", width: 16 },
          { key: "matched", header: "Matched ITC", type: "money", width: 16 },
          { key: "unmatched", header: "Books ITC not matched", type: "money", width: 20 },
          { key: "variance", header: "Variance (books − 2B)", type: "money", width: 20 },
          { key: "exceptions", header: "Exceptions", type: "int", width: 11 },
          { key: "matchRate", header: "Clean match %", type: "percent", width: 13 },
        ],
        rows,
      };
    }
  }
}

export function reportSubtitle(f: Filters & { fy?: string }) {
  const parts: string[] = [];
  if (f.fy) parts.push(`FY ${f.fy}`);
  if (f.period) parts.push(monthLabel(Number(f.period.slice(0, 4)), Number(f.period.slice(5, 7))));
  return parts.join(" · ");
}
