import { hasValidGstinChecksum, hasValidGstinFormat, normalizeGstin } from "@/lib/gstin";
import { parseDateInput, validateInvoiceDate } from "@/lib/dates";
import { parseAmount, r2, validateAmounts } from "@/lib/money";
import { canonicalField, detectHeaderRow, REQUIRED_FIELDS, type CanonicalField } from "./columns";
import type { Sheet } from "./parse-file";
import type { DocTypeValue, NormalizedDoc, ParseOutcome, RowIssue } from "./types";

export type ImportKind = "books" | "gstr2b";

export function coerceDocType(v: unknown, fallback: DocTypeValue = "INVOICE"): DocTypeValue {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (s.includes("credit") || ["c", "cn", "cr"].includes(s)) return "CREDIT_NOTE";
  if (s.includes("debit") || ["d", "dn", "db"].includes(s)) return "DEBIT_NOTE";
  return fallback;
}

export function coerceBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return dflt;
  return /^(y|yes|true|1|eligible|available)$/.test(s);
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

/** Turn one sheet (matrix of cells) into validated documents + per-row issues. */
export function mapSheet(sheet: Sheet, kind: ImportKind, opts: { now?: Date; defaultDocType?: DocTypeValue } = {}): ParseOutcome {
  const now = opts.now ?? new Date();
  const issues: RowIssue[] = [];
  const empty: ParseOutcome = { docs: [], issues, totalRows: 0, errorRows: 0 };

  const header = detectHeaderRow(sheet.matrix);
  if (header.index < 0 || header.score < 4) {
    issues.push({ row: 0, severity: "error", message: `Sheet “${sheet.name}”: could not find a header row. Expected columns such as Supplier GSTIN, Invoice Number, Invoice Date, Taxable Value, CGST, SGST, IGST.` });
    return empty;
  }
  const headerRow = sheet.matrix[header.index];
  const colOf = new Map<CanonicalField, number>();
  headerRow.forEach((cell, i) => {
    const f = canonicalField(cell);
    if (f && !colOf.has(f)) colOf.set(f, i);
  });
  const missing = REQUIRED_FIELDS.filter((f) => !colOf.has(f));
  if (missing.length) {
    issues.push({ row: header.index + 1, severity: "error", message: `Sheet “${sheet.name}”: missing required column(s): ${missing.join(", ")}.` });
    return empty;
  }
  if (!colOf.has("igst") && !colOf.has("cgst") && !colOf.has("sgst")) {
    issues.push({ row: header.index + 1, severity: "error", message: `Sheet “${sheet.name}”: no tax columns found (IGST / CGST / SGST).` });
    return empty;
  }

  const get = (row: unknown[], f: CanonicalField) => (colOf.has(f) ? row[colOf.get(f)!] : undefined);
  const headerNames = headerRow.map((h) => text(h));

  type Built = { doc: NormalizedDoc; rate: number | null };
  const built: Built[] = [];
  let totalRows = 0;
  const badRows = new Set<number>();

  for (let i = header.index + 1; i < sheet.matrix.length; i++) {
    const row = sheet.matrix[i];
    if (!row || row.every((c) => c === null || c === undefined || text(c) === "")) continue;
    const rowNo = i + 1;
    // footer rows such as "Total" / "Grand total" carry a label and at most one figure
    const populated = row.filter((c) => c !== null && c !== undefined && text(c) !== "");
    if (populated.length <= 2 && /^(grand\s+)?(sub\s*)?totals?\b/i.test(text(populated[0]))) continue;
    const gstinCell = text(get(row, "supplierGstin"));
    const invCell = text(get(row, "invoiceNumber"));
    // footer / subtotal rows
    if (!gstinCell && !invCell) continue;
    totalRows++;

    const rowIssues: RowIssue[] = [];
    const err = (field: string, message: string) => rowIssues.push({ row: rowNo, field, severity: "error", message });
    const warn = (field: string, message: string) => rowIssues.push({ row: rowNo, field, severity: "warning", message });

    const supplierGstin = normalizeGstin(gstinCell);
    if (!supplierGstin) err("supplierGstin", "Supplier GSTIN is required");
    else if (!hasValidGstinFormat(supplierGstin)) err("supplierGstin", `“${gstinCell}” is not a valid GSTIN format`);
    else if (!hasValidGstinChecksum(supplierGstin)) warn("supplierGstin", `GSTIN ${supplierGstin} has an invalid check digit – possible typo`);

    const invoiceNumber = invCell;
    if (!invoiceNumber) err("invoiceNumber", "Invoice number is required");
    else if (invoiceNumber.length > 50) err("invoiceNumber", "Invoice number is longer than 50 characters");

    const date = parseDateInput(get(row, "invoiceDate"));
    if (!date) err("invoiceDate", `“${text(get(row, "invoiceDate"))}” is not a valid date (use DD-MM-YYYY)`);
    else {
      const bad = validateInvoiceDate(date, now);
      if (bad) err("invoiceDate", bad);
    }

    const amt = (f: CanonicalField, required: boolean): number => {
      const v = parseAmount(get(row, f));
      if (v === undefined) {
        if (required) err(f, `${f === "taxableValue" ? "Taxable value" : f} is required`);
        return 0;
      }
      if (Number.isNaN(v)) {
        err(f, `“${text(get(row, f))}” is not a valid amount`);
        return 0;
      }
      return v;
    };
    const taxableValue = amt("taxableValue", true);
    const igst = amt("igst", false);
    const cgst = amt("cgst", false);
    const sgst = amt("sgst", false);
    const cess = amt("cess", false);
    const invVal = parseAmount(get(row, "invoiceValue"));
    const invoiceValue = invVal === undefined || Number.isNaN(invVal) ? undefined : invVal;

    const docType = coerceDocType(get(row, "docType"), opts.defaultDocType ?? "INVOICE");

    if (!rowIssues.some((r) => r.severity === "error")) {
      const check = validateAmounts({ taxableValue, igst, cgst, sgst, cess, invoiceValue });
      check.errors.forEach((m) => err("amounts", m));
      check.warnings.forEach((m) => warn("amounts", m));
    }

    issues.push(...rowIssues);
    if (rowIssues.some((r) => r.severity === "error")) {
      badRows.add(rowNo);
      continue;
    }

    const filingDate = parseDateInput(get(row, "supplierFilingDate"));
    const rateVal = parseAmount(get(row, "rate"));
    const raw: Record<string, unknown> = { _sheet: sheet.name, _row: rowNo };
    row.forEach((cell, ci) => {
      if (headerNames[ci]) raw[headerNames[ci]] = cell instanceof Date ? cell.toISOString().slice(0, 10) : cell;
    });

    built.push({
      rate: rateVal === undefined || Number.isNaN(rateVal) ? null : rateVal,
      doc: {
        docType,
        supplierGstin,
        supplierName: text(get(row, "supplierName")) || `Supplier ${supplierGstin}`,
        invoiceNumber,
        invoiceDate: date!,
        placeOfSupply: text(get(row, "placeOfSupply")) || null,
        reverseCharge: coerceBool(get(row, "reverseCharge"), false),
        itc: coerceBool(get(row, "itc"), true),
        itcReason: text(get(row, "itcReason")) || null,
        supplierFilingPeriod: text(get(row, "supplierFilingPeriod")) || null,
        supplierFilingDate: filingDate,
        taxableValue: r2(taxableValue),
        igst: r2(igst),
        cgst: r2(cgst),
        sgst: r2(sgst),
        cess: r2(cess),
        invoiceValue: r2(invoiceValue ?? taxableValue + igst + cgst + sgst + cess),
        notes: kind === "books" ? text(get(row, "notes")) || null : null,
        raw,
      },
    });
  }

  const docs = kind === "gstr2b" ? mergeRateRows(built) : built.map((b) => b.doc);
  return { docs, issues, totalRows, errorRows: badRows.size };
}

/**
 * The portal's GSTR-2B Excel lists an invoice once per tax rate. Rows for the same document with
 * *different* rates are summed into one document; a repeated identical rate is a genuine duplicate and is kept as a separate row.
 */
function mergeRateRows(rows: { doc: NormalizedDoc; rate: number | null }[]): NormalizedDoc[] {
  const out: NormalizedDoc[] = [];
  const index = new Map<string, { doc: NormalizedDoc; rates: Set<number> }>();
  for (const { doc, rate } of rows) {
    if (rate === null) {
      out.push(doc);
      continue;
    }
    const key = `${doc.supplierGstin}|${doc.invoiceNumber}|${doc.docType}|${doc.invoiceDate.toISOString()}`;
    const hit = index.get(key);
    if (!hit || hit.rates.has(rate)) {
      out.push(doc);
      index.set(key, { doc, rates: new Set([rate]) });
      continue;
    }
    hit.rates.add(rate);
    hit.doc.taxableValue = r2(hit.doc.taxableValue + doc.taxableValue);
    hit.doc.igst = r2(hit.doc.igst + doc.igst);
    hit.doc.cgst = r2(hit.doc.cgst + doc.cgst);
    hit.doc.sgst = r2(hit.doc.sgst + doc.sgst);
    hit.doc.cess = r2(hit.doc.cess + doc.cess);
    hit.doc.invoiceValue = Math.max(hit.doc.invoiceValue, doc.invoiceValue);
  }
  return out;
}
