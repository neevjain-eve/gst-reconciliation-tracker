import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { toISODate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { persistImport, type ImportSummary } from "@/lib/import/run";
import type { NormalizedDoc, ParseOutcome, RowIssue } from "@/lib/import/types";
import { ApiError } from "@/lib/session";
import { getBill, listBillPage, sessionFromConnection, ZohoError, type ZohoBillSummary } from "./client";
import { IGNORED_BILL_STATUSES, mapZohoBill } from "./mapper";

/** Stay inside Vercel's 60 s function limit: stop fetching bill details after this long, import what we have, report the rest as "remaining". */
const FETCH_BUDGET_MS = 38_000;
const MAX_DETAIL_FETCHES = 400;
const CONCURRENCY = 3;
const MAX_LIST_PAGES = 100; // 20 000 bills
const MAX_SKIP_CACHE = 5000;
const RUNNING_LOCK_MS = 10 * 60_000;

export interface ZohoSyncSummary extends ImportSummary {
  listed: number;
  fetched: number;
  skippedBills: number;
  retired: number;
  /** Bills still waiting for a detail fetch – run the sync again (the scheduled job does this automatically). */
  remaining: number;
}

export interface SyncOptions {
  userId: string | null;
  /** Ignore the "unchanged since last sync" shortcut and re-read every bill. */
  full?: boolean;
  /** Milliseconds available for fetching details (tests / cron override). */
  budgetMs?: number;
}

/**
 * Pull purchase bills from Zoho Books for one connected GSTIN and store them as immutable Invoice rows.
 *
 * 1. List all bills (cheap, paged). The list is used to decide what needs fetching:
 *    – dated before `syncFromDate`, or status draft/void → never imported
 *    – `last_modified_time` equals what we stored → unchanged, skipped
 *    – recorded in `skipCache` (e.g. no supplier GSTIN) and not modified since → skipped
 * 2. Fetch full bill detail for new/changed bills within the time budget (GSTIN and tax lines are only reliably on the detail).
 * 3. Map → validate → `persistImport` (same pipeline as file upload: versioned rows, never edited in place).
 * 4. Bills that vanished from Zoho, or became draft/void, are *retired* (superseded, kept in history) so ITC totals stay honest.
 */
export async function syncZohoConnection(connectionId: string, orgId: string, opts: SyncOptions): Promise<ZohoSyncSummary> {
  const conn = await prisma.zohoConnection.findFirst({ where: { id: connectionId, organizationId: orgId }, include: { gstin: true } });
  if (!conn) throw new ApiError(404, "Zoho connection not found");
  if (conn.status === "PENDING_ORG_SELECTION" || !conn.zohoOrganizationId) throw new ApiError(400, "Choose the Zoho Books organisation for this GSTIN first.");
  if (conn.status === "ERROR") throw new ApiError(400, "Zoho access needs to be re-authorised. Reconnect this GSTIN.");

  const running = await prisma.importJob.findFirst({
    where: { organizationId: orgId, gstinRegistrationId: conn.gstinRegistrationId, type: "ZOHO_SYNC", status: "RUNNING", startedAt: { gt: new Date(Date.now() - RUNNING_LOCK_MS) } },
    select: { id: true },
  });
  if (running) throw new ApiError(409, "A sync for this GSTIN is already running.");

  const job = await prisma.importJob.create({
    data: {
      organizationId: orgId,
      gstinRegistrationId: conn.gstinRegistrationId,
      type: "ZOHO_SYNC",
      status: "RUNNING",
      createdById: opts.userId,
      meta: { zohoOrganizationId: conn.zohoOrganizationId, full: !!opts.full } as Prisma.InputJsonValue,
    },
  });

  try {
    const session = sessionFromConnection(conn);
    const started = Date.now();
    const budget = opts.budgetMs ?? FETCH_BUDGET_MS;

    // ── 1. list ────────────────────────────────────────────────────────────────────────
    const listed: ZohoBillSummary[] = [];
    let listComplete = true;
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const r = await listBillPage(session, page);
      listed.push(...r.bills);
      if (!r.hasMore) break;
      if (page === MAX_LIST_PAGES || Date.now() - started > budget / 2) {
        listComplete = false;
        break;
      }
    }

    const from = conn.syncFromDate ? toISODate(conn.syncFromDate) : null;
    const skipCache = (conn.skipCache && typeof conn.skipCache === "object" && !Array.isArray(conn.skipCache) ? conn.skipCache : {}) as Record<string, string>;
    const stored = await prisma.invoice.findMany({
      where: { gstinRegistrationId: conn.gstinRegistrationId, source: "ZOHO_BOOKS", supersededAt: null },
      select: { id: true, externalId: true, externalModifiedAt: true },
    });
    const storedByExt = new Map(stored.map((s) => [s.externalId!, s]));

    const candidates: ZohoBillSummary[] = [];
    const retireIds = new Set<string>();
    let skippedBills = 0;
    for (const b of listed) {
      const status = (b.status ?? "").toLowerCase();
      if (IGNORED_BILL_STATUSES.has(status)) {
        skippedBills++;
        if (storedByExt.has(b.bill_id)) retireIds.add(b.bill_id);
        continue;
      }
      if (from && b.date && b.date < from) {
        skippedBills++;
        continue;
      }
      const mod = b.last_modified_time;
      if (!opts.full && mod) {
        if (storedByExt.get(b.bill_id)?.externalModifiedAt === mod) continue; // unchanged
        if (skipCache[b.bill_id] === mod) {
          skippedBills++;
          continue;
        }
      }
      candidates.push(b);
    }
    // bills that disappeared from Zoho (only trustworthy when we saw the whole list)
    if (listComplete) {
      const seen = new Set(listed.map((b) => b.bill_id));
      for (const s of stored) if (!seen.has(s.externalId!)) retireIds.add(s.externalId!);
    }

    // ── 2. fetch details within budget ─────────────────────────────────────────────────
    const docs: NormalizedDoc[] = [];
    const issues: RowIssue[] = [];
    const newSkips: Record<string, string> = {};
    let errorRows = 0;
    let fetched = 0;
    let cursor = 0;
    const work = candidates.slice(0, MAX_DETAIL_FETCHES);

    const worker = async () => {
      while (cursor < work.length && Date.now() - started < budget) {
        const b = work[cursor++];
        try {
          const bill = await getBill(session, b.bill_id);
          fetched++;
          const m = mapZohoBill(bill);
          m.warnings.forEach((w) => issues.push({ row: 0, severity: "warning", message: w }));
          if (m.doc) docs.push(m.doc);
          else if (m.skip) {
            skippedBills++;
            if (b.last_modified_time) newSkips[b.bill_id] = b.last_modified_time;
            if (storedByExt.has(b.bill_id)) retireIds.add(b.bill_id);
          } else if (m.error) {
            errorRows++;
            issues.push({ row: 0, severity: "error", message: m.error });
          }
        } catch (e) {
          if (e instanceof ZohoError && (e.status === 401 || e.status === 403)) throw e; // auth problem – abort whole sync
          errorRows++;
          issues.push({ row: 0, severity: "error", message: `Bill ${b.bill_number ?? b.bill_id}: ${e instanceof ZohoError ? e.message : "could not be read from Zoho"}` });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const remaining = candidates.length - cursor;

    // ── 3. persist (same immutable pipeline as uploads) ────────────────────────────────
    const outcome: ParseOutcome = { docs, issues, totalRows: fetched, errorRows };
    const summary = await persistImport({
      orgId,
      userId: opts.userId,
      gstinRegistrationId: conn.gstinRegistrationId,
      kind: "BOOKS",
      type: "ZOHO_SYNC",
      outcome,
      booksSource: "ZOHO_BOOKS",
      skipped: skippedBills,
      jobId: job.id,
      meta: { zohoOrganizationId: conn.zohoOrganizationId, listed: listed.length, remaining },
    });

    // ── 4. retire deleted / voided bills ───────────────────────────────────────────────
    let retired = 0;
    if (retireIds.size) {
      const r = await prisma.invoice.updateMany({
        where: { gstinRegistrationId: conn.gstinRegistrationId, source: "ZOHO_BOOKS", supersededAt: null, externalId: { in: [...retireIds] } },
        data: { supersededAt: new Date() },
      });
      retired = r.count;
      if (retired) {
        await audit(null, { orgId, userId: opts.userId }, {
          action: "ZOHO_BILLS_RETIRED",
          entityType: "ZohoConnection",
          entityId: conn.id,
          summary: `${retired} Zoho bill(s) were deleted, voided or moved to draft in Zoho Books and no longer count as purchases (kept in history)`,
          metadata: { count: retired },
        });
      }
    }

    // ── 5. bookkeeping ─────────────────────────────────────────────────────────────────
    const mergedSkips = { ...skipCache, ...newSkips };
    const keys = Object.keys(mergedSkips);
    if (keys.length > MAX_SKIP_CACHE) for (const k of keys.slice(0, keys.length - MAX_SKIP_CACHE)) delete mergedSkips[k];
    await prisma.zohoConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null, skipCache: mergedSkips as Prisma.InputJsonValue },
    });

    return { ...summary, listed: listed.length, fetched, skippedBills, retired, remaining };
  } catch (e) {
    const revoked = e instanceof ZohoError && (e.status === 401 || e.status === 403 || e.code === "invalid_code" || e.code === "invalid_client");
    const message = revoked ? "Zoho rejected the saved authorisation. Reconnect this GSTIN to Zoho Books." : e instanceof ZohoError ? e.message : "Sync failed unexpectedly.";
    if (!(e instanceof ZohoError)) console.error("[zoho] sync failed", e);
    await prisma.importJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date(), errors: [{ row: 0, severity: "error", message }] as Prisma.InputJsonValue },
    });
    await prisma.zohoConnection.update({ where: { id: conn.id }, data: { lastSyncError: message, ...(revoked ? { status: "ERROR" as const } : {}) } });
    throw e instanceof ZohoError ? new ApiError(revoked ? 401 : 502, message) : e;
  }
}
