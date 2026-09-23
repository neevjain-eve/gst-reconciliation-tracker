import { daysBetween, toISODate } from "@/lib/dates";
import { panFromGstin } from "@/lib/gstin";
import { r2 } from "@/lib/money";
import { formatINR } from "@/lib/utils";
import { gstinSimilarity, invoiceNumberSimilarity } from "./similarity";
import {
  DEFAULT_ENGINE_OPTIONS,
  type BooksDoc,
  type DiffSeverity,
  type EngineDoc,
  type EngineOptions,
  type EngineResult,
  type FieldDiff,
  type GstrDoc,
  type MatchMethodStr,
  type ReconStatusStr,
} from "./types";

/**
 * Reconciliation engine (pure – no I/O).
 *
 *  1. Duplicates   – same supplier GSTIN + normalised invoice number appearing more than once on one side.
 *                    The copy closest to the other side is kept as the primary; the rest are DUPLICATE_INVOICE.
 *  2. Exact pass   – supplier GSTIN + normalised invoice number identical → MATCHED / MATCHED_WITH_VARIANCE /
 *                    TAX_MISMATCH depending on the amount differences.
 *  3. Fuzzy pass   – leftovers are scored (GSTIN 35, invoice no. 30, taxable 15, date 10, tax 10). Pairs are
 *                    assigned greedily by score:
 *                      ≥ autoMatchScore and only one identity field differs → INVOICE_NUMBER_MISMATCH / GSTIN_MISMATCH
 *                      ≥ reviewScore                                          → NEEDS_REVIEW
 *  4. Leftovers    – MISSING_IN_GSTR2B (books only) and MISSING_IN_BOOKS (GSTR-2B only).
 *
 * Every input document appears in exactly one result.
 */
export function reconcile(books: BooksDoc[], gstr2b: GstrDoc[], options: Partial<EngineOptions> = {}): EngineResult[] {
  const opts: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  const results: EngineResult[] = [];

  // 1 ── duplicates
  const dup = resolveDuplicates(books, gstr2b);
  for (const { doc, primary } of dup.duplicateBooks) {
    results.push(
      singleSided({
        b: doc,
        status: "DUPLICATE_INVOICE",
        explanation: `Duplicate bill: supplier GSTIN ${doc.supplierGstin} and invoice number “${doc.invoiceNumber}” (normalised ${doc.invoiceNumberNorm}) are already booked as ${primary.invoiceNumber} dated ${toISODate(primary.invoiceDate)} for ${formatINR(primary.taxableValue)}. Booking it twice would double-claim ITC of ${formatINR(taxOf(doc))}.`,
      }),
    );
  }
  for (const { doc, primary } of dup.duplicateGstr) {
    results.push(
      singleSided({
        g: doc,
        status: "DUPLICATE_INVOICE",
        explanation: `Appears more than once in GSTR-2B: supplier GSTIN ${doc.supplierGstin}, invoice “${doc.invoiceNumber}” (also ${primary.invoiceNumber} dated ${toISODate(primary.invoiceDate)}). Only one copy is used for matching.`,
      }),
    );
  }

  // 2 ── exact pass
  const gByKey = new Map<string, GstrDoc>();
  for (const g of dup.primaryGstr) gByKey.set(keyOf(g), g);
  const usedG = new Set<string>();
  const usedB = new Set<string>();
  for (const b of dup.primaryBooks) {
    const g = gByKey.get(keyOf(b));
    if (!g) continue;
    usedB.add(b.id);
    usedG.add(g.id);
    results.push(pairResult(b, g, opts, { fuzzy: false }));
  }

  // 3 ── fuzzy pass on the leftovers
  const restB = dup.primaryBooks.filter((b) => !usedB.has(b.id));
  const restG = dup.primaryGstr.filter((g) => !usedG.has(g.id));
  for (const r of fuzzyPass(restB, restG, opts)) {
    usedB.add(r.b.id);
    usedG.add(r.g.id);
    results.push(pairResult(r.b, r.g, opts, { fuzzy: true, score: r.score }));
  }

  // 4 ── leftovers
  for (const b of dup.primaryBooks) {
    if (usedB.has(b.id)) continue;
    results.push(
      singleSided({
        b,
        status: "MISSING_IN_GSTR2B",
        explanation: `Booked on ${toISODate(b.invoiceDate)} but no matching supplier-reported document was found in GSTR-2B for this GSTIN. ${
          b.itcEligible ? `ITC of ${formatINR(taxOf(b))} is not supported by GSTR-2B until the supplier reports it (check later 2B periods or follow up with the supplier).` : "The bill is marked ITC-ineligible in books, so no ITC is at risk."
        }`,
      }),
    );
  }
  for (const g of dup.primaryGstr) {
    if (usedG.has(g.id)) continue;
    results.push(
      singleSided({
        g,
        status: "MISSING_IN_BOOKS",
        explanation: `Reported by the supplier in GSTR-2B (${toISODate(g.invoiceDate)}) but not found in books. ${
          g.itcAvailable ? `Potential ITC of ${formatINR(taxOf(g))} – check whether the bill is unrecorded, belongs to another GSTIN, or was booked under a different supplier.` : `GSTR-2B marks ITC as not available${g.itcReason ? ` (${g.itcReason})` : ""}.`
        }`,
      }),
    );
  }

  return results;
}

// ───────────────────────────── helpers ─────────────────────────────

const group = (t: EngineDoc["docType"]) => (t === "CREDIT_NOTE" ? "C" : "I");
const sign = (t: EngineDoc["docType"]) => (t === "CREDIT_NOTE" ? -1 : 1);
export const taxOf = (d: EngineDoc) => r2(d.igst + d.cgst + d.sgst + d.cess);
const keyOf = (d: EngineDoc) => `${d.supplierGstin}|${d.invoiceNumberNorm}|${group(d.docType)}`;

function byOrder<T extends EngineDoc>(a: T, b: T) {
  return a.invoiceDate.getTime() - b.invoiceDate.getTime() || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function resolveDuplicates(books: BooksDoc[], gstr: GstrDoc[]) {
  const bBy = groupBy(books, keyOf);
  const gBy = groupBy(gstr, keyOf);
  const keys = [...new Set([...bBy.keys(), ...gBy.keys()])];

  const primaryBooks: BooksDoc[] = [];
  const primaryGstr: GstrDoc[] = [];
  const duplicateBooks: { doc: BooksDoc; primary: BooksDoc }[] = [];
  const duplicateGstr: { doc: GstrDoc; primary: GstrDoc }[] = [];

  for (const key of keys) {
    const bs = [...(bBy.get(key) ?? [])].sort(byOrder);
    const gs = [...(gBy.get(key) ?? [])].sort(byOrder);
    let pb = bs[0];
    let pg = gs[0];
    if ((bs.length > 1 || gs.length > 1) && bs.length && gs.length) {
      // keep the pair of copies that agree best, so a stray typo'd duplicate is the one flagged
      let best = Number.POSITIVE_INFINITY;
      for (const b of bs)
        for (const g of gs) {
          const d = Math.abs(b.taxableValue - g.taxableValue) + Math.abs(taxOf(b) - taxOf(g));
          if (d < best) {
            best = d;
            pb = b;
            pg = g;
          }
        }
    }
    if (pb) {
      primaryBooks.push(pb);
      for (const b of bs) if (b !== pb) duplicateBooks.push({ doc: b, primary: pb });
    }
    if (pg) {
      primaryGstr.push(pg);
      for (const g of gs) if (g !== pg) duplicateGstr.push({ doc: g, primary: pg });
    }
  }
  return { primaryBooks, primaryGstr, duplicateBooks, duplicateGstr };
}

// ───────────────────────────── scoring ─────────────────────────────

export interface PairScore {
  score: number;
  parts: { gstin: number; invoice: number; date: number; taxable: number; tax: number };
}

function amountScore(a: number, b: number, max: number, opts: EngineOptions) {
  const diff = Math.abs(a - b);
  if (diff <= opts.roundingTolerance) return max;
  const base = Math.max(Math.abs(a), Math.abs(b));
  const pct = base > 0 ? diff / base : 1;
  if (pct <= 0.02) return max * 0.66;
  if (pct <= 0.1) return max * 0.33;
  return 0;
}

/** Identity-confidence score (0-100) for a candidate books↔GSTR-2B pair. */
export function scorePair(b: EngineDoc, g: EngineDoc, opts: EngineOptions = DEFAULT_ENGINE_OPTIONS): PairScore {
  const days = Math.abs(daysBetween(b.invoiceDate, g.invoiceDate));
  const parts = {
    gstin: 35 * gstinSimilarity(b.supplierGstin, g.supplierGstin),
    invoice: 30 * invoiceNumberSimilarity(b.invoiceNumberNorm, g.invoiceNumberNorm),
    date: days === 0 ? 10 : days <= 3 ? 7 : days <= 31 ? 4 : 0,
    taxable: amountScore(b.taxableValue, g.taxableValue, 15, opts),
    tax: amountScore(taxOf(b), taxOf(g), 10, opts),
  };
  const score = Math.round(parts.gstin + parts.invoice + parts.date + parts.taxable + parts.tax);
  return { score: Math.min(100, score), parts };
}

interface Candidate {
  b: BooksDoc;
  g: GstrDoc;
  score: number;
}

function fuzzyPass(books: BooksDoc[], gstr: GstrDoc[], opts: EngineOptions): Candidate[] {
  if (!books.length || !gstr.length) return [];
  const byGstin = groupBy(gstr, (g) => g.supplierGstin);
  const byPan = groupBy(gstr, (g) => panFromGstin(g.supplierGstin));
  const byNorm = groupBy(gstr, (g) => g.invoiceNumberNorm);
  const byDateAmount = groupBy(gstr, (g) => `${toISODate(g.invoiceDate)}|${Math.round(g.taxableValue)}`);

  const candidates: Candidate[] = [];
  for (const b of books) {
    const pool = new Set<GstrDoc>();
    for (const list of [
      byGstin.get(b.supplierGstin),
      byPan.get(panFromGstin(b.supplierGstin)),
      byNorm.get(b.invoiceNumberNorm),
      byDateAmount.get(`${toISODate(b.invoiceDate)}|${Math.round(b.taxableValue)}`),
    ]) {
      list?.forEach((g) => pool.add(g));
    }
    for (const g of pool) {
      if (group(b.docType) !== group(g.docType)) continue;
      const { score } = scorePair(b, g, opts);
      if (score >= opts.reviewScore) candidates.push({ b, g, score });
    }
  }

  candidates.sort((x, y) => y.score - x.score || x.b.id.localeCompare(y.b.id) || x.g.id.localeCompare(y.g.id));
  const usedB = new Set<string>();
  const usedG = new Set<string>();
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (usedB.has(c.b.id) || usedG.has(c.g.id)) continue;
    usedB.add(c.b.id);
    usedG.add(c.g.id);
    chosen.push(c);
  }
  return chosen;
}

// ───────────────────────────── comparison ─────────────────────────────

const AMOUNT_FIELDS = [
  ["taxableValue", "Taxable value"],
  ["igst", "IGST"],
  ["cgst", "CGST"],
  ["sgst", "SGST"],
  ["cess", "Cess"],
] as const;

function severity(absDiff: number, opts: EngineOptions): DiffSeverity {
  if (absDiff === 0) return "ok";
  if (absDiff <= opts.roundingTolerance) return "rounding";
  if (absDiff <= opts.varianceTolerance) return "variance";
  return "mismatch";
}

export function compareDocs(b: EngineDoc, g: EngineDoc, opts: EngineOptions) {
  const diffs: FieldDiff[] = [];

  diffs.push({
    field: "supplierGstin",
    label: "Supplier GSTIN",
    books: b.supplierGstin,
    gstr2b: g.supplierGstin,
    diff: null,
    severity: b.supplierGstin === g.supplierGstin ? "ok" : "mismatch",
  });
  diffs.push({
    field: "invoiceNumber",
    label: "Invoice number",
    books: b.invoiceNumber,
    gstr2b: g.invoiceNumber,
    diff: null,
    severity:
      b.invoiceNumber === g.invoiceNumber ? "ok" : b.invoiceNumberNorm === g.invoiceNumberNorm ? "rounding" : "mismatch",
  });
  const days = daysBetween(b.invoiceDate, g.invoiceDate);
  diffs.push({
    field: "invoiceDate",
    label: "Invoice date",
    books: toISODate(b.invoiceDate),
    gstr2b: toISODate(g.invoiceDate),
    diff: days,
    severity: days === 0 ? "ok" : "variance",
  });

  let maxAmountDiff = 0;
  for (const [field, label] of AMOUNT_FIELDS) {
    const d = r2(b[field] - g[field]);
    maxAmountDiff = Math.max(maxAmountDiff, Math.abs(d));
    diffs.push({ field, label, books: b[field], gstr2b: g[field], diff: d, severity: severity(Math.abs(d), opts) });
  }

  const level: "clean" | "variance" | "mismatch" =
    maxAmountDiff <= opts.roundingTolerance ? "clean" : maxAmountDiff <= opts.varianceTolerance ? "variance" : "mismatch";

  return { diffs, level, days };
}

function describeAmountDiffs(diffs: FieldDiff[]): string {
  return diffs
    .filter((d) => AMOUNT_FIELDS.some(([f]) => f === d.field) && d.severity !== "ok")
    .map((d) => `${d.label}: books ${formatINR(d.books as number)} vs GSTR-2B ${formatINR(d.gstr2b as number)} (Δ ${formatINR(d.diff)})`)
    .join("; ");
}

// ───────────────────────────── result builders ─────────────────────────────

function pairResult(
  b: BooksDoc,
  g: GstrDoc,
  opts: EngineOptions,
  how: { fuzzy: false } | { fuzzy: true; score: number },
): EngineResult {
  const cmp = compareDocs(b, g, opts);
  const scored = scorePair(b, g, opts);
  const gstinSame = b.supplierGstin === g.supplierGstin;
  const invSame = b.invoiceNumberNorm === g.invoiceNumberNorm;

  let status: ReconStatusStr;
  let method: MatchMethodStr;
  let explanation: string;
  const amountNote = describeAmountDiffs(cmp.diffs);
  const itcNote = !g.itcAvailable
    ? ` GSTR-2B marks ITC as not available${g.itcReason ? ` (${g.itcReason})` : ""}.`
    : !b.itcEligible
      ? " Books mark this bill ITC-ineligible, so it is not counted as claimed ITC."
      : "";

  if (!how.fuzzy) {
    method = b.invoiceNumber.trim().toUpperCase() === g.invoiceNumber.trim().toUpperCase() ? "EXACT" : "NORMALIZED";
    const base = `Supplier GSTIN and invoice number match${method === "NORMALIZED" ? ` after normalisation (“${b.invoiceNumber}” ≈ “${g.invoiceNumber}” → ${b.invoiceNumberNorm})` : ""}.`;
    if (cmp.level === "mismatch") {
      status = "TAX_MISMATCH";
      explanation = `${base} Amounts disagree beyond the ${formatINR(opts.varianceTolerance)} tolerance – ${amountNote}.`;
    } else if (cmp.level === "variance" || cmp.days !== 0 || (!g.itcAvailable && b.itcEligible)) {
      status = "MATCHED_WITH_VARIANCE";
      const bits: string[] = [];
      if (cmp.level === "variance") bits.push(amountNote);
      if (cmp.days !== 0) bits.push(`invoice date differs by ${Math.abs(cmp.days)} day(s) (books ${toISODate(b.invoiceDate)}, GSTR-2B ${toISODate(g.invoiceDate)})`);
      explanation = `${base}${bits.length ? ` Variance: ${bits.join("; ")}.` : ""}${itcNote}`;
    } else {
      status = "MATCHED";
      explanation = `${base} Date and all tax amounts agree${amountNote ? ` (rounding differences ≤ ${formatINR(opts.roundingTolerance)} ignored)` : ""}.${itcNote}`;
    }
    if (b.docType !== g.docType) explanation += ` Note: books type is ${b.docType.replace("_", " ").toLowerCase()}, GSTR-2B type is ${g.docType.replace("_", " ").toLowerCase()}.`;
  } else {
    method = "FUZZY";
    if (!gstinSame && !invSame) status = "NEEDS_REVIEW";
    else if (how.score >= opts.autoMatchScore) status = gstinSame ? "INVOICE_NUMBER_MISMATCH" : "GSTIN_MISMATCH";
    else status = "NEEDS_REVIEW";

    const signals: string[] = [];
    if (gstinSame) signals.push("same supplier GSTIN");
    else if (panFromGstin(b.supplierGstin) === panFromGstin(g.supplierGstin)) signals.push("same supplier PAN (different state registration)");
    else if (gstinSimilarity(b.supplierGstin, g.supplierGstin) > 0) signals.push("supplier GSTINs differ by a 1–2 character typo");
    if (invSame) signals.push("same invoice number");
    else if (invoiceNumberSimilarity(b.invoiceNumberNorm, g.invoiceNumberNorm) > 0) signals.push("similar invoice numbers");
    if (cmp.days === 0) signals.push("same date");
    else if (Math.abs(cmp.days) <= 31) signals.push(`dates ${Math.abs(cmp.days)} day(s) apart`);
    const taxableDiff = cmp.diffs.find((d) => d.field === "taxableValue");
    if (taxableDiff && taxableDiff.severity !== "mismatch") signals.push(taxableDiff.severity === "variance" ? "taxable value close" : "same taxable value");

    const head =
      status === "GSTIN_MISMATCH"
        ? `Invoice number matches but supplier GSTIN differs: books ${b.supplierGstin} vs GSTR-2B ${g.supplierGstin}.`
        : status === "INVOICE_NUMBER_MISMATCH"
          ? `Same supplier GSTIN but invoice numbers differ: books “${b.invoiceNumber}” vs GSTR-2B “${g.invoiceNumber}”.`
          : `Possible match – not confident enough to auto-classify. Books “${b.invoiceNumber}” (${b.supplierGstin}) vs GSTR-2B “${g.invoiceNumber}” (${g.supplierGstin}).`;
    explanation = `${head} Paired on: ${signals.join(", ") || "amounts only"} (score ${scored.score}/100).${amountNote ? ` Differences – ${amountNote}.` : ""}${status === "NEEDS_REVIEW" ? " Verify the documents before accepting." : ""}${itcNote}`;
  }

  const confidence = how.fuzzy ? how.score : scored.score;
  return build({ b, g, status, method, confidence, explanation, diffs: cmp.diffs, isPair: true });
}

function singleSided(a: { b?: BooksDoc; g?: GstrDoc; status: ReconStatusStr; explanation: string }): EngineResult {
  return build({ b: a.b, g: a.g, status: a.status, method: "NONE", confidence: 100, explanation: a.explanation, diffs: [], isPair: false });
}

function build(a: {
  b?: BooksDoc;
  g?: GstrDoc;
  status: ReconStatusStr;
  method: MatchMethodStr;
  confidence: number;
  explanation: string;
  diffs: FieldDiff[];
  isPair: boolean;
}): EngineResult {
  const { b, g } = a;
  const src = (b ?? g) as EngineDoc;
  const s = sign(src.docType);
  const booksItc = b && b.itcEligible ? s * taxOf(b) : 0;
  const gstr2bItc = g && g.itcAvailable ? s * taxOf(g) : 0;
  const matchedItc = a.isPair ? s * Math.min(Math.abs(booksItc), Math.abs(gstr2bItc)) : 0;
  return {
    pairKey: `${b?.id ?? "-"}|${g?.id ?? "-"}`,
    status: a.status,
    matchMethod: a.method,
    confidence: a.confidence,
    explanation: a.explanation,
    differences: a.diffs,
    invoiceId: b?.id ?? null,
    gstr2bRecordId: g?.id ?? null,
    vendorId: (b ?? g)!.vendorId,
    taxPeriodId: (g ?? b)!.taxPeriodId,
    docType: src.docType,
    supplierGstin: src.supplierGstin,
    supplierName: src.supplierName,
    invoiceNumber: src.invoiceNumber,
    invoiceDate: src.invoiceDate,
    booksTaxable: b ? b.taxableValue : null,
    booksTax: b ? taxOf(b) : null,
    gstr2bTaxable: g ? g.taxableValue : null,
    gstr2bTax: g ? taxOf(g) : null,
    taxableVariance: r2((b?.taxableValue ?? 0) - (g?.taxableValue ?? 0)),
    taxVariance: r2((b ? taxOf(b) : 0) - (g ? taxOf(g) : 0)),
    booksItc: r2(booksItc),
    gstr2bItc: r2(gstr2bItc),
    matchedItc: r2(matchedItc),
  };
}
