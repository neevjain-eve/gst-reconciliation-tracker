import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getRegistration } from "@/lib/import/run";
import { num } from "@/lib/utils";
import { chunk } from "@/lib/utils";
import { reconcile } from "./engine";
import { DEFAULT_ENGINE_OPTIONS, type BooksDoc, type EngineOptions, type EngineResult, type GstrDoc } from "./types";

export interface RunStats {
  books: number;
  gstr2b: number;
  results: number;
  byStatus: Record<string, number>;
  carriedDecisions: number;
  staleKept: number;
}

/** Statuses whose paired ITC counts as "matched" (unless the reviewer rejected it). */
export const MATCHED_STATUSES = ["MATCHED", "MATCHED_WITH_VARIANCE"] as const;

/**
 * Re-run reconciliation for one GSTIN + financial year.
 * Source documents are read-only. Results are derived data: rows a human has touched (decision, owner or comments)
 * are kept and only their system fields refreshed; untouched rows are rebuilt.
 */
export async function runReconciliation(
  who: { orgId: string; userId: string | null },
  a: { gstinRegistrationId: string; financialYear: string; options?: Partial<EngineOptions> },
): Promise<{ runId: string; stats: RunStats }> {
  const reg = await getRegistration(who.orgId, a.gstinRegistrationId);
  const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...stripUndefined(a.options ?? {}) };

  const [invoices, records] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: who.orgId, gstinRegistrationId: reg.id, supersededAt: null, taxPeriod: { financialYear: a.financialYear } },
    }),
    prisma.gstr2bRecord.findMany({
      where: { organizationId: who.orgId, gstinRegistrationId: reg.id, supersededAt: null, taxPeriod: { financialYear: a.financialYear } },
    }),
  ]);

  const books: BooksDoc[] = invoices.map((i) => ({
    id: i.id,
    supplierGstin: i.supplierGstin,
    supplierName: i.supplierName,
    invoiceNumber: i.invoiceNumber,
    invoiceNumberNorm: i.invoiceNumberNorm,
    invoiceDate: i.invoiceDate,
    docType: i.docType,
    taxableValue: num(i.taxableValue),
    igst: num(i.igst),
    cgst: num(i.cgst),
    sgst: num(i.sgst),
    cess: num(i.cess),
    invoiceValue: num(i.invoiceValue),
    taxPeriodId: i.taxPeriodId,
    vendorId: i.vendorId,
    createdAt: i.createdAt.getTime(),
    itcEligible: i.itcEligible,
  }));
  const gstr: GstrDoc[] = records.map((r) => ({
    id: r.id,
    supplierGstin: r.supplierGstin,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    invoiceNumberNorm: r.invoiceNumberNorm,
    invoiceDate: r.invoiceDate,
    docType: r.docType,
    taxableValue: num(r.taxableValue),
    igst: num(r.igst),
    cgst: num(r.cgst),
    sgst: num(r.sgst),
    cess: num(r.cess),
    invoiceValue: num(r.invoiceValue),
    taxPeriodId: r.taxPeriodId,
    vendorId: r.vendorId,
    createdAt: r.createdAt.getTime(),
    itcAvailable: r.itcAvailable,
    itcReason: r.itcReason,
    supplierFilingPeriod: r.supplierFilingPeriod,
  }));

  const results = reconcile(books, gstr, options);
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const stats: RunStats = { books: books.length, gstr2b: gstr.length, results: results.length, byStatus, carriedDecisions: 0, staleKept: 0 };

  const runId = await prisma.$transaction(
    async (tx) => {
      const run = await tx.reconciliationRun.create({
        data: {
          organizationId: who.orgId,
          gstinRegistrationId: reg.id,
          financialYear: a.financialYear,
          options: options as unknown as Prisma.InputJsonValue,
          stats: stats as unknown as Prisma.InputJsonValue,
          createdById: who.userId,
        },
      });

      const existing = await tx.reconciliationResult.findMany({
        where: { organizationId: who.orgId, gstinRegistrationId: reg.id, taxPeriod: { financialYear: a.financialYear } },
        select: { id: true, pairKey: true, decision: true, assigneeId: true, _count: { select: { comments: true } } },
      });
      const touched = existing.filter((e) => e.decision !== "PENDING" || e.assigneeId || e._count.comments > 0);
      const untouched = existing.filter((e) => !touched.includes(e));
      const touchedByKey = new Map(touched.map((e) => [e.pairKey, e.id]));

      for (const part of chunk(untouched.map((e) => e.id), 1000)) await tx.reconciliationResult.deleteMany({ where: { id: { in: part } } });

      const fresh: Prisma.ReconciliationResultCreateManyInput[] = [];
      const seen = new Set<string>();
      for (const r of results) {
        const data = toRow(r, who.orgId, run.id, reg.id);
        const keptId = touchedByKey.get(r.pairKey);
        if (keptId) {
          seen.add(r.pairKey);
          stats.carriedDecisions++;
          await tx.reconciliationResult.update({ where: { id: keptId }, data: { ...data, isStale: false } });
        } else {
          fresh.push(data);
        }
      }
      for (const part of chunk(fresh, 500)) await tx.reconciliationResult.createMany({ data: part });

      const staleIds = touched.filter((t) => !seen.has(t.pairKey)).map((t) => t.id);
      stats.staleKept = staleIds.length;
      if (staleIds.length) await tx.reconciliationResult.updateMany({ where: { id: { in: staleIds } }, data: { isStale: true } });

      await tx.reconciliationRun.update({ where: { id: run.id }, data: { stats: stats as unknown as Prisma.InputJsonValue } });
      await audit(tx, who, {
        action: "RECON_RUN",
        entityType: "ReconciliationRun",
        entityId: run.id,
        summary: `Reconciled ${reg.gstin} for FY ${a.financialYear}: ${books.length} bills vs ${gstr.length} GSTR-2B records → ${results.length} results`,
        metadata: { options, byStatus },
      });
      return run.id;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return { runId, stats };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function toRow(r: EngineResult, orgId: string, runId: string, gstinRegistrationId: string): Prisma.ReconciliationResultCreateManyInput {
  return {
    organizationId: orgId,
    runId,
    gstinRegistrationId,
    taxPeriodId: r.taxPeriodId,
    vendorId: r.vendorId,
    invoiceId: r.invoiceId,
    gstr2bRecordId: r.gstr2bRecordId,
    pairKey: r.pairKey,
    status: r.status,
    matchMethod: r.matchMethod,
    confidence: r.confidence,
    explanation: r.explanation,
    differences: r.differences as unknown as Prisma.InputJsonValue,
    docType: r.docType,
    supplierGstin: r.supplierGstin,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    booksTaxable: r.booksTaxable,
    booksTax: r.booksTax,
    gstr2bTaxable: r.gstr2bTaxable,
    gstr2bTax: r.gstr2bTax,
    taxableVariance: r.taxableVariance,
    taxVariance: r.taxVariance,
    booksItc: r.booksItc,
    gstr2bItc: r.gstr2bItc,
    matchedItc: r.matchedItc,
  };
}
