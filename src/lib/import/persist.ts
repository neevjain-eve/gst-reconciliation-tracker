import { randomUUID } from "node:crypto";
import type { Gstr2bSource, InvoiceSource, Prisma } from "@prisma/client";
import { sha256 } from "@/lib/crypto";
import { financialYearOf, periodOfDate, toISODate } from "@/lib/dates";
import { panFromGstin } from "@/lib/gstin";
import { normalizeInvoiceNumber } from "@/lib/reconcile/normalize";
import { chunk } from "@/lib/utils";
import type { NormalizedDoc } from "./types";

type Tx = Prisma.TransactionClient;

/** Stable hash of a document's economic content – detects "same document re-imported" vs "document changed". */
export function contentHash(d: NormalizedDoc): string {
  return sha256(
    [
      d.supplierGstin,
      d.invoiceNumber,
      normalizeInvoiceNumber(d.invoiceNumber),
      d.docType,
      toISODate(d.invoiceDate),
      d.taxableValue.toFixed(2),
      d.igst.toFixed(2),
      d.cgst.toFixed(2),
      d.sgst.toFixed(2),
      d.cess.toFixed(2),
      d.invoiceValue.toFixed(2),
      d.itc ? 1 : 0,
      d.reverseCharge ? 1 : 0,
    ].join("|"),
  );
}

export async function ensureVendors(tx: Tx, orgId: string, docs: NormalizedDoc[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const d of docs) if (!names.has(d.supplierGstin)) names.set(d.supplierGstin, d.supplierName);
  const gstins = [...names.keys()];
  for (const part of chunk(gstins, 1000)) {
    await tx.vendor.createMany({
      data: part.map((gstin) => ({ organizationId: orgId, gstin, name: names.get(gstin)!, pan: panFromGstin(gstin) })),
      skipDuplicates: true,
    });
  }
  const map = new Map<string, string>();
  for (const part of chunk(gstins, 1000)) {
    const rows = await tx.vendor.findMany({ where: { organizationId: orgId, gstin: { in: part } }, select: { id: true, gstin: true } });
    rows.forEach((r) => map.set(r.gstin, r.id));
  }
  return map;
}

export async function ensurePeriods(tx: Tx, orgId: string, gstinRegistrationId: string, periods: { year: number; month: number }[]): Promise<Map<string, string>> {
  const uniq = new Map(periods.map((p) => [`${p.year}-${p.month}`, p]));
  await tx.taxPeriod.createMany({
    data: [...uniq.values()].map((p) => ({
      organizationId: orgId,
      gstinRegistrationId,
      year: p.year,
      month: p.month,
      financialYear: financialYearOf(p.year, p.month),
    })),
    skipDuplicates: true,
  });
  const rows = await tx.taxPeriod.findMany({ where: { gstinRegistrationId }, select: { id: true, year: true, month: true } });
  return new Map(rows.map((r) => [`${r.year}-${r.month}`, r.id]));
}

export interface SaveResult {
  imported: number;
  unchanged: number;
  superseded: number;
  createdIds?: string[];
}

/**
 * Store books invoices without ever editing imported rows.
 *  • externalId (Zoho bill_id): unchanged → skipped; changed → old row superseded, new row inserted.
 *  • no externalId (upload / manual): rows identical to an already-imported row of the same source are skipped.
 */
export async function saveBooksInvoices(
  tx: Tx,
  a: { orgId: string; userId: string | null; gstinRegistrationId: string; source: InvoiceSource; importJobId: string | null; docs: NormalizedDoc[] },
): Promise<SaveResult> {
  const { orgId, gstinRegistrationId, source } = a;
  if (!a.docs.length) return { imported: 0, unchanged: 0, superseded: 0 };

  const vendors = await ensureVendors(tx, orgId, a.docs);
  const periods = await ensurePeriods(tx, orgId, gstinRegistrationId, a.docs.map((d) => periodOfDate(d.invoiceDate)));

  const externalIds = a.docs.flatMap((d) => (d.externalId ? [d.externalId] : []));
  const existingExt = new Map<string, { id: string; contentHash: string; supersededAt: Date | null }[]>();
  for (const part of chunk(externalIds, 1000)) {
    const rows = await tx.invoice.findMany({
      where: { gstinRegistrationId, source, externalId: { in: part } },
      select: { id: true, externalId: true, contentHash: true, supersededAt: true },
    });
    for (const r of rows) {
      const list = existingExt.get(r.externalId!) ?? [];
      list.push(r);
      existingExt.set(r.externalId!, list);
    }
  }

  const existingKeys = new Set<string>();
  const plain = a.docs.filter((d) => !d.externalId);
  if (plain.length) {
    const gstins = [...new Set(plain.map((d) => d.supplierGstin))];
    for (const part of chunk(gstins, 1000)) {
      const rows = await tx.invoice.findMany({
        where: { gstinRegistrationId, source, supersededAt: null, supplierGstin: { in: part } },
        select: { supplierGstin: true, invoiceNumberNorm: true, docType: true, contentHash: true },
      });
      rows.forEach((r) => existingKeys.add(`${r.supplierGstin}|${r.invoiceNumberNorm}|${r.docType}|${r.contentHash}`));
    }
  }

  const now = new Date();
  const toCreate: Prisma.InvoiceCreateManyInput[] = [];
  let unchanged = 0;
  let superseded = 0;

  for (const d of a.docs) {
    const hash = contentHash(d);
    const norm = normalizeInvoiceNumber(d.invoiceNumber);
    const p = periodOfDate(d.invoiceDate);
    const id = randomUUID();

    if (d.externalId) {
      const versions = existingExt.get(d.externalId) ?? [];
      const active = versions.find((v) => !v.supersededAt);
      if (active && active.contentHash === hash) {
        unchanged++;
        continue;
      }
      const sameHashOld = versions.find((v) => v.contentHash === hash && v.supersededAt);
      if (sameHashOld) {
        // content flipped back to an earlier version: re-activate it rather than violate the unique key
        if (active) await tx.invoice.update({ where: { id: active.id }, data: { supersededAt: now, supersededById: sameHashOld.id } });
        await tx.invoice.update({ where: { id: sameHashOld.id }, data: { supersededAt: null, supersededById: null } });
        superseded += active ? 1 : 0;
        continue;
      }
      if (active) {
        await tx.invoice.update({ where: { id: active.id }, data: { supersededAt: now, supersededById: id } });
        superseded++;
      }
    } else {
      const key = `${d.supplierGstin}|${norm}|${d.docType}|${hash}`;
      if (existingKeys.has(key)) {
        unchanged++;
        continue;
      }
    }

    toCreate.push({
      id,
      organizationId: orgId,
      gstinRegistrationId,
      taxPeriodId: periods.get(`${p.year}-${p.month}`)!,
      vendorId: vendors.get(d.supplierGstin)!,
      source,
      externalId: d.externalId ?? null,
      externalModifiedAt: d.externalModifiedAt ?? null,
      importJobId: a.importJobId,
      createdById: a.userId,
      docType: d.docType,
      supplierGstin: d.supplierGstin,
      supplierName: d.supplierName,
      invoiceNumber: d.invoiceNumber,
      invoiceNumberNorm: norm,
      invoiceDate: d.invoiceDate,
      placeOfSupply: d.placeOfSupply ?? null,
      reverseCharge: d.reverseCharge,
      itcEligible: d.itc,
      taxableValue: d.taxableValue,
      igst: d.igst,
      cgst: d.cgst,
      sgst: d.sgst,
      cess: d.cess,
      invoiceValue: d.invoiceValue,
      contentHash: hash,
      rawData: (d.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      notes: d.notes ?? null,
    });
  }

  for (const part of chunk(toCreate, 500)) await tx.invoice.createMany({ data: part, skipDuplicates: true });
  return { imported: toCreate.length, unchanged, superseded, createdIds: toCreate.map((r) => r.id as string) };
}

/**
 * Store GSTR-2B records for one return period.
 * With `replace`, the file is treated as the complete 2B for the period: identical records stay untouched
 * (so review decisions survive), records no longer present are superseded, new/changed ones are inserted.
 */
export async function saveGstr2bRecords(
  tx: Tx,
  a: {
    orgId: string;
    gstinRegistrationId: string;
    period: { year: number; month: number };
    source: Gstr2bSource;
    importJobId: string | null;
    docs: NormalizedDoc[];
    replace: boolean;
  },
): Promise<SaveResult & { taxPeriodId: string }> {
  const { orgId, gstinRegistrationId } = a;
  const periods = await ensurePeriods(tx, orgId, gstinRegistrationId, [a.period]);
  const taxPeriodId = periods.get(`${a.period.year}-${a.period.month}`)!;
  const vendors = await ensureVendors(tx, orgId, a.docs);

  const existing = await tx.gstr2bRecord.findMany({
    where: { gstinRegistrationId, taxPeriodId, supersededAt: null },
    select: { id: true, supplierGstin: true, invoiceNumberNorm: true, docType: true, contentHash: true },
  });
  const pool = new Map<string, string[]>();
  for (const r of existing) {
    const k = `${r.supplierGstin}|${r.invoiceNumberNorm}|${r.docType}|${r.contentHash}`;
    const ids = pool.get(k) ?? [];
    ids.push(r.id);
    pool.set(k, ids);
  }

  const toCreate: Prisma.Gstr2bRecordCreateManyInput[] = [];
  let unchanged = 0;
  for (const d of a.docs) {
    const hash = contentHash(d);
    const norm = normalizeInvoiceNumber(d.invoiceNumber);
    const k = `${d.supplierGstin}|${norm}|${d.docType}|${hash}`;
    const ids = pool.get(k);
    if (ids && ids.length) {
      ids.pop();
      unchanged++;
      continue;
    }
    toCreate.push({
      organizationId: orgId,
      gstinRegistrationId,
      taxPeriodId,
      vendorId: vendors.get(d.supplierGstin)!,
      source: a.source,
      importJobId: a.importJobId,
      docType: d.docType,
      supplierGstin: d.supplierGstin,
      supplierName: d.supplierName,
      invoiceNumber: d.invoiceNumber,
      invoiceNumberNorm: norm,
      invoiceDate: d.invoiceDate,
      placeOfSupply: d.placeOfSupply ?? null,
      reverseCharge: d.reverseCharge,
      itcAvailable: d.itc,
      itcReason: d.itcReason ?? null,
      supplierFilingPeriod: d.supplierFilingPeriod ?? null,
      supplierFilingDate: d.supplierFilingDate ?? null,
      taxableValue: d.taxableValue,
      igst: d.igst,
      cgst: d.cgst,
      sgst: d.sgst,
      cess: d.cess,
      invoiceValue: d.invoiceValue,
      contentHash: hash,
      rawData: (d.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    });
  }

  let superseded = 0;
  if (a.replace) {
    const stale = [...pool.values()].flat();
    for (const part of chunk(stale, 1000)) {
      await tx.gstr2bRecord.updateMany({ where: { id: { in: part } }, data: { supersededAt: new Date() } });
    }
    superseded = stale.length;
  }
  for (const part of chunk(toCreate, 500)) await tx.gstr2bRecord.createMany({ data: part });
  return { imported: toCreate.length, unchanged, superseded, taxPeriodId };
}
