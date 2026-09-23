/**
 * Demo data for the GST Reconciliation Tracker.
 *
 *   npm run db:seed                 create the demo firm (skips if it already exists)
 *   SEED_RESET=true npm run db:seed wipe the demo firm and recreate it
 *
 * Everything is fictional: names, GSTINs (syntactically valid, check digit computed) and amounts.
 * Data is generated from a fixed random seed, so every run produces the same firm, the same bills and the same
 * reconciliation outcome. It goes through the real import pipeline and the real matching engine – nothing is
 * inserted into the result tables by hand – so the demo also works as a smoke test.
 *
 * Refuses to run against production unless SEED_ALLOW_PRODUCTION=true (it creates users with a known password).
 */
import { PrismaClient, type InvoiceSource } from "@prisma/client";
import bcrypt from "bcryptjs";
import { audit } from "../src/lib/audit";
import { sha256 } from "../src/lib/crypto";
import { buildGstin } from "../src/lib/gstin";
import { persistImport } from "../src/lib/import/run";
import { saveBooksInvoices } from "../src/lib/import/persist";
import type { NormalizedDoc, ParseOutcome } from "../src/lib/import/types";
import { runReconciliation } from "../src/lib/reconcile/run";
import { r2 } from "../src/lib/money";

const prisma = new PrismaClient();

const DEMO_ORG = "Sharma & Associates, Chartered Accountants";
const FY = "2026-27";
/** Apr–Aug 2026. GSTR-2B for September is generated on 14 October, so it is not seeded. */
const MONTHS = [4, 5, 6, 7, 8].map((m) => ({ year: 2026, month: m }));
const PASSWORD = process.env.SEED_PASSWORD || "DemoPass#2026";

// ────────────────────────────── deterministic randomness ──────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260921);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// ────────────────────────────── the demo firm ──────────────────────────────
interface Supplier {
  name: string;
  state: string;
  pan: string;
  prefix: string;
  /** state code of a second registration of the same PAN – used for GSTIN-mismatch cases */
  altState: string;
  rates: number[];
  gstin: string;
  altGstin: string;
}
const supplier = (name: string, state: string, pan: string, prefix: string, altState: string, rates: number[]): Supplier => ({
  name,
  state,
  pan,
  prefix,
  altState,
  rates,
  gstin: buildGstin(state, pan),
  altGstin: buildGstin(altState, pan),
});

const SUPPLIERS: Supplier[] = [
  supplier("Sri Lakshmi Yarns", "33", "AAFCS4821K", "SLY", "29", [5, 12]),
  supplier("Mahalaxmi Dyes & Chemicals", "27", "AABCM7310D", "MDC", "24", [18]),
  supplier("Kaveri Packaging Industries", "29", "AAECK5527H", "KPI", "33", [18]),
  supplier("Bharat Freight Carriers", "29", "AAJFB2246R", "BFC", "27", [5, 12]),
  supplier("Deccan Steel Traders", "36", "AAHCD9083M", "DST", "29", [18]),
  supplier("Om Sai Stationers", "29", "ABCPO3382Q", "OSS", "36", [12, 18]),
  supplier("Gujarat Polyfilms Ltd", "24", "AACCG6675B", "GPF", "27", [18, 28]),
  supplier("Nilgiri Lubricants", "33", "AADFN1290L", "NLB", "29", [18, 28]),
  supplier("Pune Precision Tools", "27", "AAKCP8841N", "PPT", "29", [18]),
  supplier("Vaishnavi IT Services", "29", "AAOCV4467G", "VIT", "36", [18]),
  supplier("Eastern Cotton Mills", "19", "AABCE3395P", "ECM", "29", [5]),
  supplier("Hyderabad Bearings", "36", "AAGCH7726E", "HBR", "33", [18]),
  supplier("Ace Office Interiors", "29", "AAFFA5518J", "AOI", "27", [18]),
  supplier("Kerala Spices Exports", "32", "AAICK6094C", "KSE", "29", [5]),
  supplier("Delhi Electricals Co", "07", "AAECD1183F", "DEC", "29", [18, 28]),
];

type Scenario =
  | "exact"
  | "formatting"
  | "rounding"
  | "variance"
  | "itcBlockedIn2b"
  | "taxMismatch"
  | "missingIn2b"
  | "missingInBooks"
  | "gstinMismatch"
  | "invoiceNoTypo"
  | "duplicate"
  | "needsReview"
  | "creditNote"
  | "lateFiled"
  | "ineligibleBooks";

interface ClientSpec {
  name: string;
  pan: string;
  gstins: { state: string; trade: string; books: "ZOHO" | "UPLOAD" | "MIXED"; perMonth: number; supplierIdx: number[]; featured?: Scenario[][] }[];
}
const CLIENTS: ClientSpec[] = [
  {
    name: "Bengaluru Textiles Pvt Ltd",
    pan: "AABCB1234F",
    gstins: [
      { state: "29", trade: "Bengaluru Textiles – Peenya", books: "ZOHO", perMonth: 22, supplierIdx: [0, 1, 2, 3, 4, 5, 6, 7, 10, 11] },
      { state: "33", trade: "Bengaluru Textiles – Tiruppur unit", books: "ZOHO", perMonth: 8, supplierIdx: [0, 3, 7, 10, 13], featured: [["variance"], ["missingIn2b", "formatting"], ["creditNote"], ["taxMismatch"], ["lateFiled", "missingInBooks"]] },
    ],
  },
  {
    name: "Kaveri Auto Components LLP",
    pan: "AAFFK5678L",
    gstins: [{ state: "29", trade: "Kaveri Auto Components", books: "UPLOAD", perMonth: 13, supplierIdx: [2, 4, 5, 6, 7, 8, 11, 12, 14], featured: [["taxMismatch"], ["missingInBooks", "creditNote"], ["gstinMismatch"], ["invoiceNoTypo", "itcBlockedIn2b"], ["needsReview", "ineligibleBooks"]] }],
  },
  {
    name: "Deccan Foods Pvt Ltd",
    pan: "AABCD9012P",
    gstins: [{ state: "36", trade: "Deccan Foods", books: "MIXED", perMonth: 10, supplierIdx: [1, 2, 3, 4, 9, 11, 12, 13], featured: [["missingInBooks"], ["duplicate", "rounding"], ["variance", "creditNote"], ["taxMismatch", "gstinMismatch"], ["missingIn2b", "invoiceNoTypo"]] }],
  },
];

// ────────────────────────────── invoice generation ──────────────────────────────
const QUOTA: Record<Exclude<Scenario, "exact">, number> = {
  formatting: 0.06,
  rounding: 0.05,
  variance: 0.04,
  itcBlockedIn2b: 0.02,
  taxMismatch: 0.035,
  missingIn2b: 0.05,
  missingInBooks: 0.035,
  gstinMismatch: 0.025,
  invoiceNoTypo: 0.025,
  duplicate: 0.02,
  needsReview: 0.02,
  creditNote: 0.03,
  lateFiled: 0.05,
  ineligibleBooks: 0.02,
};

const variantFormat = (n: string) => n.replace(/\//g, "-").replace(/-0+(\d)/g, "-$1").toLowerCase();
const typo = (n: string) => n.replace(/(\d)(\d)(?=\D*$)/, "$2$1");

interface Pair {
  books: NormalizedDoc[];
  g2b: (NormalizedDoc & { period: { year: number; month: number } })[];
}

function makePair(s: Scenario, clientState: string, sup: Supplier, seq: number, m: { year: number; month: number }, isLastMonth: boolean): Pair {
  const rate = pick(sup.rates);
  const inter = sup.state !== clientState;
  const taxable = r2(between(4_000, 240_000));
  const day = int(1, 27);
  const date = utc(m.year, m.month, day);
  const taxOf = (t: number, r: number) => {
    const total = r2((t * r) / 100);
    return inter ? { igst: total, cgst: 0, sgst: 0, cess: 0 } : { igst: 0, cgst: r2(total / 2), sgst: r2(total - r2(total / 2)), cess: 0 };
  };
  const number = `${sup.prefix}/26-27/${pad(seq, 4)}`;
  const mk = (over: Partial<NormalizedDoc> = {}): NormalizedDoc => {
    const t = { ...taxOf(taxable, rate), ...over };
    const base: NormalizedDoc = {
      docType: "INVOICE",
      supplierGstin: sup.gstin,
      supplierName: sup.name,
      invoiceNumber: number,
      invoiceDate: date,
      placeOfSupply: clientState,
      reverseCharge: false,
      itc: true,
      taxableValue: taxable,
      igst: t.igst,
      cgst: t.cgst,
      sgst: t.sgst,
      cess: 0,
      invoiceValue: 0,
      ...over,
    };
    base.invoiceValue = r2(base.taxableValue + base.igst + base.cgst + base.sgst + base.cess);
    return base;
  };
  const inPeriod = (d: NormalizedDoc, period = m): Pair["g2b"][number] => ({
    ...d,
    supplierFilingPeriod: `${pad(period.month)}${period.year}`,
    supplierFilingDate: utc(period.year, period.month + 1 > 12 ? 1 : period.month + 1, 11),
    raw: { source: "GSTR-2B (sample)", b2b: { ctin: d.supplierGstin, inum: d.invoiceNumber, dt: d.invoiceDate.toISOString().slice(0, 10), val: d.invoiceValue, txval: d.taxableValue, igst: d.igst, cgst: d.cgst, sgst: d.sgst } },
    period,
  });
  const nextMonth = { year: m.month === 12 ? m.year + 1 : m.year, month: m.month === 12 ? 1 : m.month + 1 };

  switch (s) {
    case "exact":
      return { books: [mk()], g2b: [inPeriod(mk())] };
    case "formatting":
      return { books: [mk({ invoiceNumber: variantFormat(number) })], g2b: [inPeriod(mk())] };
    case "rounding": {
      const g = mk();
      if (g.igst) g.igst = r2(g.igst + 0.4);
      else g.cgst = r2(g.cgst + 0.4);
      g.invoiceValue = r2(g.taxableValue + g.igst + g.cgst + g.sgst);
      return { books: [mk()], g2b: [inPeriod(g)] };
    }
    case "variance": {
      const g = mk();
      const cut = 37.5;
      if (g.igst) g.igst = r2(g.igst - cut);
      else {
        g.cgst = r2(g.cgst - cut / 2);
        g.sgst = r2(g.sgst - cut / 2);
      }
      g.invoiceValue = r2(g.taxableValue + g.igst + g.cgst + g.sgst);
      return { books: [mk()], g2b: [inPeriod(g)] };
    }
    case "itcBlockedIn2b":
      return { books: [mk()], g2b: [inPeriod({ ...mk(), itc: false, itcReason: "Blocked under Section 17(5) – reported by supplier" })] };
    case "taxMismatch": {
      // supplier reported the goods at a lower rate than the rate on the bill in books
      const lower = rate === 18 ? 12 : rate === 28 ? 18 : 5;
      const g = mk({ ...taxOf(taxable, lower) });
      return { books: [mk()], g2b: [inPeriod(g)] };
    }
    case "missingIn2b":
      return { books: [mk()], g2b: [] };
    case "missingInBooks":
      return { books: [], g2b: [inPeriod(mk())] };
    case "gstinMismatch":
      return { books: [mk({ supplierGstin: sup.altGstin })], g2b: [inPeriod(mk())] };
    case "invoiceNoTypo":
      return { books: [mk({ invoiceNumber: typo(number) })], g2b: [inPeriod(mk())] };
    case "duplicate": {
      const b = mk();
      // booked twice (same bill entered again a few days later)
      return { books: [b, { ...b, invoiceDate: b.invoiceDate, notes: "Entered twice by mistake (demo)" }], g2b: [inPeriod(mk())] };
    }
    case "needsReview": {
      // same supplier, same date and amounts, but the number on the bill is completely different
      return { books: [mk({ invoiceNumber: `PO${int(1000, 9999)}` })], g2b: [inPeriod(mk())] };
    }
    case "creditNote": {
      const cn = mk({ docType: "CREDIT_NOTE", invoiceNumber: `${sup.prefix}/CN/26-27/${pad(seq, 3)}`, taxableValue: r2(taxable * 0.1), ...taxOf(r2(taxable * 0.1), rate) });
      cn.invoiceValue = r2(cn.taxableValue + cn.igst + cn.cgst + cn.sgst);
      return { books: [cn], g2b: [inPeriod(cn)] };
    }
    case "lateFiled":
      // supplier reported the bill one month late → appears in the next month's GSTR-2B
      return isLastMonth ? { books: [mk()], g2b: [inPeriod(mk())] } : { books: [mk()], g2b: [inPeriod(mk(), nextMonth)] };
    case "ineligibleBooks": {
      const b = mk({ itc: false, notes: "Blocked credit – staff welfare / food (Section 17(5))" });
      return { books: [b], g2b: [inPeriod(mk({ itc: false }))] };
    }
  }
}

function deckFor(n: number, allowExotic: boolean): Scenario[] {
  const deck: Scenario[] = [];
  for (const [k, q] of Object.entries(QUOTA) as [Exclude<Scenario, "exact">, number][]) {
    if (!allowExotic && (k === "duplicate" || k === "needsReview")) continue;
    const c = Math.max(q * n >= 0.5 ? Math.round(q * n) : 0, allowExotic && n >= 20 ? 1 : 0);
    for (let i = 0; i < c; i++) deck.push(k);
  }
  while (deck.length < n) deck.push("exact");
  return shuffle(deck.slice(0, n));
}

// ────────────────────────────── database helpers ──────────────────────────────
async function wipe(orgId: string) {
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { organizationId: orgId } }),
    prisma.reconciliationResult.deleteMany({ where: { organizationId: orgId } }),
    prisma.reconciliationRun.deleteMany({ where: { organizationId: orgId } }),
    prisma.invoice.deleteMany({ where: { organizationId: orgId } }),
    prisma.gstr2bRecord.deleteMany({ where: { organizationId: orgId } }),
    prisma.importJob.deleteMany({ where: { organizationId: orgId } }),
    prisma.zohoConnection.deleteMany({ where: { organizationId: orgId } }),
    prisma.taxPeriod.deleteMany({ where: { organizationId: orgId } }),
    prisma.vendor.deleteMany({ where: { organizationId: orgId } }),
    prisma.gstinRegistration.deleteMany({ where: { organizationId: orgId } }),
    prisma.client.deleteMany({ where: { organizationId: orgId } }),
    prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
    prisma.user.deleteMany({ where: { organizationId: orgId } }),
    prisma.organization.delete({ where: { id: orgId } }),
  ]);
}

const outcome = (docs: NormalizedDoc[]): ParseOutcome => ({ docs, issues: [], totalRows: docs.length, errorRows: 0 });
const zohoShaped = (d: NormalizedDoc, i: number): NormalizedDoc => ({
  ...d,
  externalId: `4${String(60000000000 + i * 37).padStart(11, "0")}`,
  externalModifiedAt: `${d.invoiceDate.toISOString().slice(0, 10)}T11:20:00+0530`,
  raw: {
    demo: true,
    bill_id: `4${String(60000000000 + i * 37).padStart(11, "0")}`,
    bill_number: d.invoiceNumber,
    date: d.invoiceDate.toISOString().slice(0, 10),
    status: "open",
    vendor_name: d.supplierName,
    gst_no: d.supplierGstin,
    gst_treatment: "business_gst",
    sub_total: d.taxableValue,
    total: d.invoiceValue,
  },
});

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    console.error("Refusing to seed demo data with a known password in production. Set SEED_ALLOW_PRODUCTION=true to override.");
    process.exit(1);
  }

  const existing = await prisma.organization.findFirst({ where: { name: DEMO_ORG } });
  if (existing) {
    if (process.env.SEED_RESET !== "true") {
      console.log(`Demo organisation “${DEMO_ORG}” already exists – nothing to do. Use SEED_RESET=true to recreate it.`);
      return;
    }
    console.log("Removing the existing demo organisation…");
    await wipe(existing.id);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const org = await prisma.organization.create({ data: { name: DEMO_ORG } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: "priya@sharma-ca.example", name: "Priya Sharma", passwordHash, role: "OWNER" } });
  const rahul = await prisma.user.create({ data: { organizationId: org.id, email: "rahul@sharma-ca.example", name: "Rahul Iyer", passwordHash, role: "ADMIN" } });
  const anita = await prisma.user.create({ data: { organizationId: org.id, email: "anita@sharma-ca.example", name: "Anita Desai", passwordHash, role: "MEMBER" } });
  await audit(null, { orgId: org.id, userId: owner.id }, { action: "ORG_CREATED", entityType: "Organization", entityId: org.id, summary: `Organisation “${org.name}” created (demo data)` });

  let seq = 40;
  let zohoCounter = 0;
  const regs: { id: string; gstin: string; label: string }[] = [];

  for (const c of CLIENTS) {
    const client = await prisma.client.create({ data: { organizationId: org.id, name: c.name, pan: c.pan } });
    await audit(null, { orgId: org.id, userId: owner.id }, { action: "CLIENT_CREATED", entityType: "Client", entityId: client.id, summary: `Client “${c.name}” added` });

    for (const g of c.gstins) {
      const gstin = buildGstin(g.state, c.pan);
      const reg = await prisma.gstinRegistration.create({
        data: { organizationId: org.id, clientId: client.id, gstin, tradeName: g.trade, stateCode: g.state },
      });
      regs.push({ id: reg.id, gstin, label: `${c.name} · ${gstin}` });
      await prisma.taxPeriod.createMany({
        data: Array.from({ length: 12 }, (_, i) => {
          const month = ((i + 3) % 12) + 1;
          return { organizationId: org.id, gstinRegistrationId: reg.id, financialYear: FY, year: month >= 4 ? 2026 : 2027, month };
        }),
        skipDuplicates: true,
      });

      const sups = g.supplierIdx.map((i) => SUPPLIERS[i]);
      const booksAll: NormalizedDoc[] = [];
      const g2bByPeriod = new Map<string, Pair["g2b"]>();

      MONTHS.forEach((m, mi) => {
        const isLast = mi === MONTHS.length - 1;
        const deck = deckFor(g.perMonth, g.perMonth >= 20);
        // smaller GSTINs get a fixed set of "featured" exceptions per month so every status shows up in the demo
        const featured = g.featured?.[mi] ?? [];
        featured.forEach((f, i) => (deck[i] = f));
        for (const sc of deck) {
          const sup = pick(sups);
          const pair = makePair(mi === 0 && (sc === "duplicate" || sc === "needsReview") ? "exact" : sc, g.state, sup, ++seq, m, isLast);
          booksAll.push(...pair.books);
          for (const d of pair.g2b) {
            const key = `${d.period.year}-${d.period.month}`;
            const list = g2bByPeriod.get(key) ?? [];
            list.push(d);
            g2bByPeriod.set(key, list);
          }
        }
      });

      // ── books: split by source ──
      const split: Record<InvoiceSource, NormalizedDoc[]> = { ZOHO_BOOKS: [], FILE_UPLOAD: [], MANUAL: [] };
      booksAll.forEach((d, i) => {
        if (g.books === "ZOHO") split.ZOHO_BOOKS.push(d);
        else if (g.books === "UPLOAD") split.FILE_UPLOAD.push(d);
        else (i % 5 === 0 ? split.MANUAL : i % 2 === 0 ? split.ZOHO_BOOKS : split.FILE_UPLOAD).push(d);
      });

      if (split.ZOHO_BOOKS.length) {
        await persistImport({
          orgId: org.id,
          userId: rahul.id,
          gstinRegistrationId: reg.id,
          kind: "BOOKS",
          type: "ZOHO_SYNC",
          outcome: outcome(split.ZOHO_BOOKS.map((d) => zohoShaped(d, ++zohoCounter))),
          booksSource: "ZOHO_BOOKS",
          meta: { demo: true, note: "Sample bills shaped like Zoho Books data – no live Zoho connection." },
        });
      }
      if (split.FILE_UPLOAD.length) {
        const fileName = `purchase-register-apr-aug-2026-${gstin.slice(0, 2)}.xlsx`;
        await persistImport({
          orgId: org.id,
          userId: anita.id,
          gstinRegistrationId: reg.id,
          kind: "BOOKS",
          type: "BOOKS_FILE",
          fileName,
          fileHash: sha256(`${fileName}|${gstin}|seed`),
          outcome: outcome(split.FILE_UPLOAD.map((d) => ({ ...d, raw: { demo: true, row: `${d.invoiceNumber} | ${d.supplierGstin} | ${d.taxableValue}` } }))),
          booksSource: "FILE_UPLOAD",
        });
      }
      if (split.MANUAL.length) {
        await prisma.$transaction(async (tx) => {
          const res = await saveBooksInvoices(tx, {
            orgId: org.id,
            userId: anita.id,
            gstinRegistrationId: reg.id,
            source: "MANUAL",
            importJobId: null,
            docs: split.MANUAL.map((d) => ({ ...d, raw: { entered: "manual form", demo: true } })),
          });
          await audit(tx, { orgId: org.id, userId: anita.id }, { action: "INVOICE_CREATED", entityType: "Invoice", summary: `${res.imported} bills entered manually for ${gstin}` });
        });
      }

      // ── GSTR-2B: one import per return period ──
      for (const m of MONTHS) {
        const docs = g2bByPeriod.get(`${m.year}-${m.month}`) ?? [];
        if (!docs.length) continue;
        const useJson = g.books === "ZOHO";
        const fileName = `GSTR2B_${gstin}_${pad(m.month)}${m.year}.${useJson ? "json" : "xlsx"}`;
        await persistImport({
          orgId: org.id,
          userId: owner.id,
          gstinRegistrationId: reg.id,
          kind: "GSTR2B",
          type: "GSTR2B_FILE",
          fileName,
          fileHash: sha256(`${fileName}|seed`),
          outcome: outcome(docs.map(({ period: _p, ...d }) => d)),
          gstr2bSource: "FILE_UPLOAD",
          period: m,
          replace: true,
        });
      }

      const run = await runReconciliation({ orgId: org.id, userId: owner.id }, { gstinRegistrationId: reg.id, financialYear: FY });
      console.log(`  ${c.name} (${gstin}): ${run.stats.books} bills · ${run.stats.gstr2b} GSTR-2B records → ${JSON.stringify(run.stats.byStatus)}`);
    }
  }

  // ── review activity on the main GSTIN so the tracker shows decisions, owners, notes and history ──
  const main = regs[0];
  const results = await prisma.reconciliationResult.findMany({ where: { organizationId: org.id, gstinRegistrationId: main.id, isStale: false }, orderBy: [{ invoiceNumber: "asc" }] });
  const take = (status: string, n: number) => results.filter((r) => r.status === status).slice(0, n);
  const act = async (r: (typeof results)[number], who: { id: string; name: string }, decision: "ACCEPTED" | "REJECTED" | "REVIEWED" | "FOLLOW_UP", note: string, assignee?: { id: string }, due?: Date) => {
    await prisma.$transaction(async (tx) => {
      await tx.reconciliationResult.update({ where: { id: r.id }, data: { decision, decidedById: who.id, decidedAt: new Date(Date.UTC(2026, 8, 18, 10, 30)), assigneeId: assignee?.id ?? null, followUpDueDate: due ?? null } });
      await tx.comment.create({ data: { organizationId: org.id, resultId: r.id, authorId: who.id, kind: decision === "FOLLOW_UP" ? "FOLLOW_UP" : "NOTE", body: note, dueDate: due ?? null, createdAt: new Date(Date.UTC(2026, 8, 18, 10, 31)) } });
      await audit(tx, { orgId: org.id, userId: who.id }, {
        action: "RESULT_UPDATED",
        entityType: "ReconciliationResult",
        entityId: r.id,
        summary: `${r.invoiceNumber} (${r.supplierGstin}): PENDING → ${decision} · note added`,
        before: { decision: "PENDING", assigneeId: null, followUpDueDate: null },
        after: { decision, assigneeId: assignee?.id ?? null, followUpDueDate: due?.toISOString().slice(0, 10) ?? null },
        metadata: { note },
      });
    });
  };

  for (const r of take("MISSING_IN_GSTR2B", 3)) await act(r, anita, "FOLLOW_UP", "Supplier has not filed GSTR-1 yet. Emailed their accounts team; ask for confirmation before the 20th.", rahul, utc(2026, 9, 30));
  for (const r of take("MATCHED_WITH_VARIANCE", 2)) await act(r, rahul, "ACCEPTED", "Difference is a freight round-off on the supplier's side – within our tolerance, accepting.");
  for (const r of take("TAX_MISMATCH", 1)) await act(r, rahul, "REJECTED", "Supplier applied the wrong GST rate. Not claiming the excess ITC; debit note requested.");
  for (const r of take("MISSING_IN_BOOKS", 2)) await act(r, anita, "REVIEWED", "Goods received in the following month – bill will be booked then. No action now.");
  for (const r of take("DUPLICATE_INVOICE", 1)) await act(r, anita, "FOLLOW_UP", "Same bill entered twice. Delete the duplicate in Zoho Books and sync again.", anita, utc(2026, 9, 25));

  await prisma.taxPeriod.updateMany({ where: { gstinRegistrationId: main.id, financialYear: FY, year: 2026, month: 4 }, data: { status: "CLOSED" } });
  await prisma.taxPeriod.updateMany({ where: { gstinRegistrationId: main.id, financialYear: FY, year: 2026, month: 5 }, data: { status: "IN_REVIEW" } });

  const [inv, g2b, res] = await Promise.all([
    prisma.invoice.count({ where: { organizationId: org.id } }),
    prisma.gstr2bRecord.count({ where: { organizationId: org.id } }),
    prisma.reconciliationResult.count({ where: { organizationId: org.id } }),
  ]);
  console.log(`\nDemo firm ready: ${inv} bills, ${g2b} GSTR-2B records, ${res} reconciliation results.\n`);
  console.log("Sign in at /login with any of:");
  console.log(`  priya@sharma-ca.example   (owner)`);
  console.log(`  rahul@sharma-ca.example   (admin)`);
  console.log(`  anita@sharma-ca.example   (member)`);
  console.log(`  password: ${PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
