import type { Gstr2bSource, ImportStatus, ImportType, InvoiceSource } from "@prisma/client";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ApiError, type Ctx } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { parseBooksUpload, parseGstr2bUpload } from "./process";
import { UploadError } from "./parse-file";
import { saveBooksInvoices, saveGstr2bRecords } from "./persist";
import type { ParseOutcome, RowIssue } from "./types";

export interface ImportSummary {
  jobId: string;
  status: ImportStatus;
  totalRows: number;
  imported: number;
  unchanged: number;
  superseded: number;
  skipped: number;
  errorRows: number;
  issues: RowIssue[];
  period?: string;
}

const MAX_STORED_ISSUES = 500;

interface PersistArgs {
  orgId: string;
  userId: string | null;
  gstinRegistrationId: string;
  kind: "BOOKS" | "GSTR2B";
  type: ImportType;
  fileName?: string | null;
  fileHash?: string | null;
  outcome: ParseOutcome;
  booksSource?: InvoiceSource;
  gstr2bSource?: Gstr2bSource;
  period?: { year: number; month: number } | null;
  replace?: boolean;
  strict?: boolean;
  skipped?: number;
  meta?: Record<string, unknown>;
  jobId?: string; // continue an existing job (Zoho chunked sync)
}

/** Shared tail of every import: create the job, store rows in one transaction, record the outcome + audit entry. */
export async function persistImport(a: PersistArgs): Promise<ImportSummary> {
  const { outcome } = a;
  const errorCount = outcome.errorRows;
  const strictFail = a.strict && errorCount > 0;

  const job = a.jobId
    ? await prisma.importJob.update({ where: { id: a.jobId }, data: { status: "RUNNING" } })
    : await prisma.importJob.create({
        data: {
          organizationId: a.orgId,
          gstinRegistrationId: a.gstinRegistrationId,
          type: a.type,
          status: "RUNNING",
          fileName: a.fileName ?? null,
          fileHash: a.fileHash ?? null,
          createdById: a.userId,
          meta: (a.meta ?? undefined) as object | undefined,
        },
      });

  const issues = outcome.issues.slice(0, MAX_STORED_ISSUES);
  try {
    if (strictFail || (!outcome.docs.length && errorCount > 0)) {
      const updated = await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", totalRows: outcome.totalRows, errorRows: errorCount, errors: issues as object[], completedAt: new Date() },
      });
      return summary(updated.id, "FAILED", outcome, { imported: 0, unchanged: 0, superseded: 0 }, a.skipped ?? 0, issues);
    }

    let saved = { imported: 0, unchanged: 0, superseded: 0 };
    let taxPeriodId: string | null = null;
    await prisma.$transaction(
      async (tx) => {
        if (a.kind === "BOOKS") {
          saved = await saveBooksInvoices(tx, {
            orgId: a.orgId,
            userId: a.userId,
            gstinRegistrationId: a.gstinRegistrationId,
            source: a.booksSource ?? "FILE_UPLOAD",
            importJobId: job.id,
            docs: outcome.docs,
          });
        } else {
          const r = await saveGstr2bRecords(tx, {
            orgId: a.orgId,
            gstinRegistrationId: a.gstinRegistrationId,
            period: a.period!,
            source: a.gstr2bSource ?? "FILE_UPLOAD",
            importJobId: job.id,
            docs: outcome.docs,
            replace: a.replace ?? true,
          });
          saved = r;
          taxPeriodId = r.taxPeriodId;
        }
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    const status: ImportStatus = errorCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status,
        taxPeriodId,
        totalRows: outcome.totalRows,
        importedRows: saved.imported,
        unchangedRows: saved.unchanged,
        skippedRows: a.skipped ?? 0,
        errorRows: errorCount,
        errors: issues as object[],
        completedAt: new Date(),
        meta: { ...(a.meta ?? {}), superseded: saved.superseded, replace: a.replace ?? null, period: a.period ?? null } as object,
      },
    });
    await audit(null, { orgId: a.orgId, userId: a.userId }, {
      action: "IMPORT_COMPLETED",
      entityType: "ImportJob",
      entityId: job.id,
      summary: `${a.type} import: ${saved.imported} new, ${saved.unchanged} unchanged, ${errorCount} rejected${a.fileName ? ` (${a.fileName})` : ""}`,
      metadata: { imported: saved.imported, unchanged: saved.unchanged, superseded: saved.superseded, errorRows: errorCount },
    });
    return summary(job.id, status, outcome, saved, a.skipped ?? 0, issues, a.period);
  } catch (e) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date(), errors: [{ row: 0, severity: "error", message: "Import failed and was rolled back. No data was saved." }] },
    });
    throw e;
  }
}

function summary(
  jobId: string,
  status: ImportStatus,
  o: ParseOutcome,
  saved: { imported: number; unchanged: number; superseded: number },
  skipped: number,
  issues: RowIssue[],
  period?: { year: number; month: number } | null,
): ImportSummary {
  return {
    jobId,
    status,
    totalRows: o.totalRows,
    imported: saved.imported,
    unchanged: saved.unchanged,
    superseded: saved.superseded,
    skipped,
    errorRows: o.errorRows,
    issues,
    period: period ? `${period.year}-${String(period.month).padStart(2, "0")}` : undefined,
  };
}

export async function getRegistration(orgId: string, id: string) {
  const reg = await prisma.gstinRegistration.findFirst({ where: { id, organizationId: orgId }, include: { client: true } });
  if (!reg) throw new ApiError(404, "GSTIN registration not found");
  return reg;
}

export async function importUploadedFile(
  ctx: Ctx,
  a: {
    type: "BOOKS" | "GSTR2B";
    gstinRegistrationId: string;
    file: { name: string; buffer: Buffer };
    period?: { year: number; month: number };
    replace: boolean;
    strict: boolean;
  },
): Promise<ImportSummary> {
  const reg = await getRegistration(ctx.orgId, a.gstinRegistrationId);
  const importType: ImportType = a.type === "BOOKS" ? "BOOKS_FILE" : "GSTR2B_FILE";
  const fileHash = sha256(a.file.buffer);

  const previous = await prisma.importJob.findFirst({
    where: {
      organizationId: ctx.orgId,
      gstinRegistrationId: reg.id,
      type: importType,
      fileHash,
      status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS"] },
    },
    orderBy: { startedAt: "desc" },
  });
  if (previous) throw new ApiError(409, `This exact file was already imported on ${formatDate(previous.startedAt)}. Upload a changed file, or reconcile the existing data.`);

  const outcome = a.type === "BOOKS" ? await parseBooksUpload(a.file.name, a.file.buffer) : await parseGstr2bUpload(a.file.name, a.file.buffer);

  let period = a.period ?? null;
  if (a.type === "GSTR2B") {
    if (outcome.gstin && outcome.gstin !== reg.gstin) {
      throw new UploadError(`This GSTR-2B is for GSTIN ${outcome.gstin}, but you selected ${reg.gstin}. Pick the matching registration.`);
    }
    period = a.period ?? outcome.returnPeriod ?? null;
    if (!period) throw new UploadError("Choose the GSTR-2B return period (month) for this file.");
    if (a.period && outcome.returnPeriod && (a.period.year !== outcome.returnPeriod.year || a.period.month !== outcome.returnPeriod.month)) {
      throw new UploadError(`The file is for return period ${String(outcome.returnPeriod.month).padStart(2, "0")}-${outcome.returnPeriod.year} but you selected ${String(a.period.month).padStart(2, "0")}-${a.period.year}.`);
    }
  }

  return persistImport({
    orgId: ctx.orgId,
    userId: ctx.userId,
    gstinRegistrationId: reg.id,
    kind: a.type,
    type: importType,
    fileName: a.file.name,
    fileHash,
    outcome,
    booksSource: "FILE_UPLOAD",
    gstr2bSource: "FILE_UPLOAD",
    period,
    replace: a.replace,
    strict: a.strict,
  });
}
