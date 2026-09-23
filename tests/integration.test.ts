/**
 * Database integration tests: import → reconcile → decisions → re-import → tenant isolation → Zoho sync (mocked HTTP).
 * Runs only when RUN_DB_TESTS=true and DATABASE_URL points at a migrated PostgreSQL database
 * (`npm run test:db`). Each run creates its own organisations and deletes them afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildGstin } from "@/lib/gstin";

const enabled = process.env.RUN_DB_TESTS === "true";

const SUP1 = buildGstin("29", "AABCS1234K");
const SUP2 = buildGstin("27", "AAECP5678L");
const SUP3 = buildGstin("33", "AADCT9999M");
const CLIENT_GSTIN = buildGstin("29", "AABCC1111C");
const HEADER = "Supplier GSTIN,Supplier Name,Invoice Number,Invoice Date,Taxable Value,IGST,CGST,SGST,Cess";
const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join("\n"));

describe.skipIf(!enabled)("database integration", () => {
  type Db = typeof import("@/lib/db");
  let prisma: Db["prisma"];
  const orgs: string[] = [];
  let ctxA: { userId: string; orgId: string; role: "OWNER"; email: string; name: string };
  let ctxB: typeof ctxA;
  let regA: string;

  async function makeOrg(label: string) {
    const org = await prisma.organization.create({ data: { name: `itest-${label}-${randomUUID().slice(0, 8)}` } });
    orgs.push(org.id);
    const user = await prisma.user.create({ data: { organizationId: org.id, email: `${randomUUID()}@itest.example`, name: label, passwordHash: "x", role: "OWNER" } });
    const client = await prisma.client.create({ data: { organizationId: org.id, name: `Client ${label}`, pan: CLIENT_GSTIN.slice(2, 12) } });
    const gstin = label === "A" ? CLIENT_GSTIN : buildGstin("27", "AABCB2222B");
    const reg = await prisma.gstinRegistration.create({ data: { organizationId: org.id, clientId: client.id, gstin, stateCode: gstin.slice(0, 2) } });
    return { ctx: { userId: user.id, orgId: org.id, role: "OWNER" as const, email: user.email, name: label }, regId: reg.id };
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    ctxA = a.ctx;
    ctxB = b.ctx;
    regA = a.regId;
  });

  afterAll(async () => {
    for (const id of orgs) {
      await prisma.comment.deleteMany({ where: { organizationId: id } });
      await prisma.reconciliationResult.deleteMany({ where: { organizationId: id } });
      await prisma.reconciliationRun.deleteMany({ where: { organizationId: id } });
      await prisma.invoice.deleteMany({ where: { organizationId: id } });
      await prisma.gstr2bRecord.deleteMany({ where: { organizationId: id } });
      await prisma.importJob.deleteMany({ where: { organizationId: id } });
      await prisma.zohoConnection.deleteMany({ where: { organizationId: id } });
      await prisma.taxPeriod.deleteMany({ where: { organizationId: id } });
      await prisma.vendor.deleteMany({ where: { organizationId: id } });
      await prisma.gstinRegistration.deleteMany({ where: { organizationId: id } });
      await prisma.client.deleteMany({ where: { organizationId: id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  const books = csv(
    `${SUP1},Alpha Traders,INV/26-27/0001,05-04-2026,10000,0,900,900,0`,
    `${SUP2},Beta Metals,B-77,10-04-2026,20000,3600,0,0,0`,
    `${SUP3},Gamma Tools,G-5,12-04-2026,5000,0,450,450,0`,
  );
  const gstr2b = csv(
    `${SUP1},Alpha Traders,inv-26-27-1,05-04-2026,10000,0,900,900,0`,
    `${SUP2},Beta Metals,B-77,10-04-2026,20000,3600,0,0,0`,
    `${SUP1},Alpha Traders,Z-9,20-04-2026,3000,0,270,270,0`,
  );

  it("imports files once, rejects the identical file a second time, and stores originals", async () => {
    const { importUploadedFile } = await import("@/lib/import/run");
    const b = await importUploadedFile(ctxA, { type: "BOOKS", gstinRegistrationId: regA, file: { name: "books.csv", buffer: books }, replace: true, strict: false });
    expect(b).toMatchObject({ status: "COMPLETED", imported: 3, errorRows: 0 });
    const g = await importUploadedFile(ctxA, { type: "GSTR2B", gstinRegistrationId: regA, file: { name: "2b.csv", buffer: gstr2b }, period: { year: 2026, month: 4 }, replace: true, strict: false });
    expect(g.imported).toBe(3);

    await expect(importUploadedFile(ctxA, { type: "BOOKS", gstinRegistrationId: regA, file: { name: "books.csv", buffer: books }, replace: true, strict: false })).rejects.toMatchObject({ status: 409 });

    const inv = await prisma.invoice.findFirst({ where: { organizationId: ctxA.orgId, invoiceNumber: "INV/26-27/0001" } });
    expect(inv?.rawData).toBeTruthy();
    expect(inv?.invoiceNumberNorm).toBe("INV26271");
  });

  it("reconciles into the expected statuses", async () => {
    const { runReconciliation } = await import("@/lib/reconcile/run");
    const { stats } = await runReconciliation(ctxA, { gstinRegistrationId: regA, financialYear: "2026-27" });
    expect(stats.byStatus).toEqual({ MATCHED: 2, MISSING_IN_GSTR2B: 1, MISSING_IN_BOOKS: 1 });
    const results = await prisma.reconciliationResult.findMany({ where: { organizationId: ctxA.orgId } });
    const formatted = results.find((r) => r.invoiceNumber.toLowerCase().includes("inv"));
    expect(formatted?.status).toBe("MATCHED");
    expect(formatted?.matchMethod).toBe("NORMALIZED");
    expect(Number(formatted?.matchedItc)).toBe(1800);
  });

  it("keeps human decisions across re-runs and never touches the source rows", async () => {
    const { runReconciliation } = await import("@/lib/reconcile/run");
    const before = await prisma.invoice.findMany({ where: { organizationId: ctxA.orgId }, orderBy: { id: "asc" } });
    const missing = await prisma.reconciliationResult.findFirstOrThrow({ where: { organizationId: ctxA.orgId, status: "MISSING_IN_GSTR2B" } });
    await prisma.reconciliationResult.update({ where: { id: missing.id }, data: { decision: "FOLLOW_UP", assigneeId: ctxA.userId } });
    await prisma.comment.create({ data: { organizationId: ctxA.orgId, resultId: missing.id, authorId: ctxA.userId, body: "Chase Gamma Tools" } });

    await runReconciliation(ctxA, { gstinRegistrationId: regA, financialYear: "2026-27" });

    const after = await prisma.reconciliationResult.findUniqueOrThrow({ where: { id: missing.id } });
    expect(after).toMatchObject({ decision: "FOLLOW_UP", assigneeId: ctxA.userId, isStale: false });
    expect(await prisma.comment.count({ where: { resultId: missing.id } })).toBe(1);
    expect(await prisma.invoice.findMany({ where: { organizationId: ctxA.orgId }, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("supersedes instead of overwriting when GSTR-2B is re-imported, and flags decisions on vanished pairs as stale", async () => {
    const { importUploadedFile } = await import("@/lib/import/run");
    const { runReconciliation } = await import("@/lib/reconcile/run");
    const original = await prisma.gstr2bRecord.findMany({ where: { organizationId: ctxA.orgId }, orderBy: { id: "asc" } });
    expect(original).toHaveLength(3);

    // supplier amended B-77 and Z-9 disappeared
    const amended = csv(`${SUP1},Alpha Traders,inv-26-27-1,05-04-2026,10000,0,900,900,0`, `${SUP2},Beta Metals,B-77,10-04-2026,20000,3000,0,0,0`);
    const r = await importUploadedFile(ctxA, { type: "GSTR2B", gstinRegistrationId: regA, file: { name: "2b-v2.csv", buffer: amended }, period: { year: 2026, month: 4 }, replace: true, strict: false });
    expect(r).toMatchObject({ imported: 1, unchanged: 1, superseded: 2 });

    const all = await prisma.gstr2bRecord.findMany({ where: { organizationId: ctxA.orgId } });
    expect(all).toHaveLength(4); // nothing deleted
    expect(all.filter((x) => x.supersededAt)).toHaveLength(2);
    for (const o of original) {
      const now = all.find((x) => x.id === o.id)!;
      expect(now.taxableValue).toEqual(o.taxableValue);
      expect(now.igst).toEqual(o.igst);
      expect(now.rawData).toEqual(o.rawData);
    }

    const { stats } = await runReconciliation(ctxA, { gstinRegistrationId: regA, financialYear: "2026-27" });
    expect(stats.byStatus.TAX_MISMATCH ?? stats.byStatus.MATCHED_WITH_VARIANCE).toBe(1);
  });

  it("isolates organisations", async () => {
    const { getRegistration } = await import("@/lib/import/run");
    const { getDashboard } = await import("@/lib/dashboard");
    await expect(getRegistration(ctxB.orgId, regA)).rejects.toMatchObject({ status: 404 });

    const a = await getDashboard(ctxA.orgId, { fy: "2026-27" });
    const b = await getDashboard(ctxB.orgId, { fy: "2026-27" });
    expect(a.booksItc).toBeGreaterThan(0);
    expect(b).toMatchObject({ booksItc: 0, gstr2bItc: 0, matchedItc: 0 });
    expect(await prisma.reconciliationResult.count({ where: { organizationId: ctxB.orgId } })).toBe(0);
    expect(await prisma.vendor.count({ where: { organizationId: ctxB.orgId } })).toBe(0);
  });

  it("writes an audit trail for imports and runs", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: ctxA.orgId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toContain("IMPORT_COMPLETED");
    expect(actions).toContain("RECON_RUN");
  });
});

describe.skipIf(!enabled)("Zoho Books sync (mocked HTTP)", () => {
  let prisma: typeof import("@/lib/db")["prisma"];
  let orgId = "";
  let userId = "";
  let regId = "";
  let connId = "";

  type Bill = Record<string, unknown>;
  let list: Bill[] = [];
  let details: Record<string, Bill> = {};
  let detailCalls: string[] = [];

  const summary = (b: Bill) => ({ bill_id: b.bill_id, bill_number: b.bill_number, date: b.date, status: b.status, vendor_name: b.vendor_name, last_modified_time: b.last_modified_time });
  const bill = (id: string, over: Bill = {}): Bill => ({
    bill_id: id,
    bill_number: `Z-${id}`,
    date: "2026-05-02",
    status: "open",
    vendor_name: "Zoho Vendor",
    gst_no: SUP1,
    gst_treatment: "business_gst",
    source_of_supply: "KA",
    destination_of_supply: "KA",
    sub_total: 10000,
    total: 11800,
    taxes: [
      { tax_name: "CGST (9%)", tax_amount: 900 },
      { tax_name: "SGST (9%)", tax_amount: 900 },
    ],
    line_items: [{ item_total: 10000 }],
    last_modified_time: "2026-05-03T10:00:00+0530",
    ...over,
  });

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const { encrypt } = await import("@/lib/crypto");
    const org = await prisma.organization.create({ data: { name: `itest-zoho-${randomUUID().slice(0, 8)}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { organizationId: orgId, email: `${randomUUID()}@itest.example`, name: "Z", passwordHash: "x", role: "OWNER" } });
    userId = user.id;
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Zoho client", pan: CLIENT_GSTIN.slice(2, 12) } });
    const reg = await prisma.gstinRegistration.create({ data: { organizationId: orgId, clientId: client.id, gstin: CLIENT_GSTIN, stateCode: "29" } });
    regId = reg.id;
    const conn = await prisma.zohoConnection.create({
      data: {
        organizationId: orgId,
        gstinRegistrationId: regId,
        dc: "in",
        zohoOrganizationId: "60000001",
        zohoOrganizationName: "Test Org",
        accessTokenEnc: encrypt("access-token-plain"),
        refreshTokenEnc: encrypt("refresh-token-plain"),
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "ZohoBooks.bills.READ",
        apiDomain: "https://www.zohoapis.in",
        status: "ACTIVE",
      },
    });
    connId = conn.id;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://www.zohoapis.in");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken access-token-plain");
        expect(url.searchParams.get("organization_id")).toBe("60000001");
        const m = /^\/books\/v3\/bills\/(.+)$/.exec(url.pathname);
        if (m) {
          detailCalls.push(m[1]);
          return new Response(JSON.stringify({ code: 0, bill: details[m[1]] }), { status: 200 });
        }
        if (url.pathname === "/books/v3/bills") return new Response(JSON.stringify({ code: 0, bills: list.map(summary), page_context: { has_more_page: false } }), { status: 200 });
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.reconciliationResult.deleteMany({ where: { organizationId: orgId } });
    await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.importJob.deleteMany({ where: { organizationId: orgId } });
    await prisma.zohoConnection.deleteMany({ where: { organizationId: orgId } });
    await prisma.taxPeriod.deleteMany({ where: { organizationId: orgId } });
    await prisma.vendor.deleteMany({ where: { organizationId: orgId } });
    await prisma.gstinRegistration.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  const active = () => prisma.invoice.findMany({ where: { organizationId: orgId, source: "ZOHO_BOOKS", supersededAt: null } });

  it("imports valid bills, ignores drafts, remembers bills with no GSTIN", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    const b1 = bill("101");
    const draft = bill("102", { status: "draft" });
    const noGstin = bill("103", { gst_no: "" });
    list = [b1, draft, noGstin];
    details = { "101": b1, "102": draft, "103": noGstin };
    detailCalls = [];

    const r = await syncZohoConnection(connId, orgId, { userId });
    expect(r).toMatchObject({ imported: 1, listed: 3, remaining: 0, retired: 0 });
    expect(detailCalls.sort()).toEqual(["101", "103"]); // the draft never needs a detail call
    const rows = await active();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "101", supplierGstin: SUP1, invoiceNumber: "Z-101" });
    expect(Number(rows[0].cgst)).toBe(900);

    const conn = await prisma.zohoConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(conn.lastSyncedAt).toBeTruthy();
    expect(conn.accessTokenEnc).not.toContain("access-token-plain");
    expect(conn.refreshTokenEnc.startsWith("v1.")).toBe(true);
  });

  it("does not re-fetch unchanged bills", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    detailCalls = [];
    const r = await syncZohoConnection(connId, orgId, { userId: null });
    expect(detailCalls).toEqual([]);
    expect(r.imported).toBe(0);
  });

  it("versions a changed bill instead of editing it", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    const changed = bill("101", { sub_total: 12000, total: 14160, taxes: [{ tax_name: "CGST (9%)", tax_amount: 1080 }, { tax_name: "SGST (9%)", tax_amount: 1080 }], last_modified_time: "2026-05-09T09:00:00+0530" });
    list = [changed, bill("102", { status: "draft" }), bill("103", { gst_no: "" })];
    details["101"] = changed;
    detailCalls = [];

    const r = await syncZohoConnection(connId, orgId, { userId: null });
    expect(detailCalls).toEqual(["101"]);
    expect(r).toMatchObject({ imported: 1, superseded: 1 });
    const all = await prisma.invoice.findMany({ where: { organizationId: orgId, source: "ZOHO_BOOKS", externalId: "101" }, orderBy: { createdAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(Number(all[0].taxableValue)).toBe(10000); // the original stays as history
    expect(all[0].supersededAt).toBeTruthy();
    expect(Number(all[1].taxableValue)).toBe(12000);
    expect(all[1].supersededAt).toBeNull();
  });

  it("retires bills that are voided or deleted in Zoho", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    list = [bill("101", { status: "void", last_modified_time: "2026-05-10T09:00:00+0530" })];
    const r = await syncZohoConnection(connId, orgId, { userId: null });
    expect(r.retired).toBe(1);
    expect(await active()).toHaveLength(0);
    expect(await prisma.invoice.count({ where: { organizationId: orgId, source: "ZOHO_BOOKS" } })).toBe(2); // history kept
  });

  it("refuses to run two syncs at once", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    await prisma.importJob.create({ data: { organizationId: orgId, gstinRegistrationId: regId, type: "ZOHO_SYNC", status: "RUNNING" } });
    await expect(syncZohoConnection(connId, orgId, { userId: null })).rejects.toMatchObject({ status: 409 });
    await prisma.importJob.updateMany({ where: { organizationId: orgId, status: "RUNNING" }, data: { status: "FAILED" } });
  });

  it("marks the connection as needing re-authorisation when Zoho rejects the token", async () => {
    const { syncZohoConnection } = await import("@/lib/zoho/sync");
    const orig = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 57, message: "You are not authorized" }), { status: 401 })));
    // force the refresh path to fail as well
    await prisma.zohoConnection.update({ where: { id: connId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    process.env.ZOHO_CLIENT_ID = "id";
    process.env.ZOHO_CLIENT_SECRET = "secret";
    process.env.ZOHO_REDIRECT_URI = "http://localhost:3000/api/zoho/callback";
    await expect(syncZohoConnection(connId, orgId, { userId: null })).rejects.toMatchObject({ status: 401 });
    const conn = await prisma.zohoConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(conn.status).toBe("ERROR");
    expect(conn.lastSyncError).toMatch(/Reconnect/);
    vi.stubGlobal("fetch", orig);
  });
});
