import { parseDateInput, parseReturnPeriod } from "@/lib/dates";
import { hasValidGstinFormat, normalizeGstin } from "@/lib/gstin";
import { r2, validateAmounts } from "@/lib/money";
import type { NormalizedDoc, ParseOutcome, RowIssue } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Parses the GSTR-2B JSON as downloaded from the GST portal or returned by a GSP:
 *   { data: { gstin, rtnprd, docdata: { b2b: [{ ctin, trdnm, supprd, supfildt, inv: [...] }], cdnr: [{ ctin, nt: [...] }] } } }
 * Amounts are read from `items[]` (summed) when present, otherwise from the document-level
 * txval / igst / cgst / sgst / cess fields. Sections other than B2B and CDNR are reported, not imported.
 */
export function parseGstr2bJson(input: unknown): ParseOutcome {
  const issues: RowIssue[] = [];
  const docs: NormalizedDoc[] = [];
  let totalRows = 0;
  let errorRows = 0;

  const root = isObj(input) && isObj(input.data) ? input.data : isObj(input) ? input : null;
  if (!root) {
    return { docs, issues: [{ row: 0, severity: "error", message: "Not a valid GSTR-2B JSON document." }], totalRows: 0, errorRows: 0 };
  }
  const docdata = isObj(root.docdata) ? root.docdata : root;
  const gstin = root.gstin ? normalizeGstin(root.gstin) : null;
  const returnPeriod = typeof root.rtnprd === "string" ? parseReturnPeriod(root.rtnprd) : null;

  const build = (
    supplier: Obj,
    d: Obj,
    docType: NormalizedDoc["docType"],
    numberKey: string,
    label: string,
    idx: number,
  ) => {
    totalRows++;
    const ctin = normalizeGstin(supplier.ctin);
    const number = String(d[numberKey] ?? d.inum ?? "").trim();
    const date = parseDateInput(d.dt);
    const items = arr(d.items);
    const src: Obj = items.length ? {} : d;
    const sum = (k: string) => (items.length ? items.reduce((s, it) => s + n(it[k]), 0) : n(src[k]));
    const amounts = { taxableValue: r2(sum("txval")), igst: r2(sum("igst")), cgst: r2(sum("cgst")), sgst: r2(sum("sgst")), cess: r2(sum("cess")) };

    const problems: string[] = [];
    if (!hasValidGstinFormat(ctin)) problems.push(`invalid supplier GSTIN “${ctin}”`);
    if (!number) problems.push("missing document number");
    if (!date) problems.push("invalid date");
    const check = validateAmounts(amounts);
    problems.push(...check.errors);
    if (problems.length) {
      errorRows++;
      issues.push({ row: idx + 1, severity: "error", message: `${label} #${idx + 1}: ${problems.join("; ")}` });
      return;
    }
    check.warnings.forEach((w) => issues.push({ row: idx + 1, severity: "warning", message: `${label} ${number}: ${w}` }));

    docs.push({
      docType,
      supplierGstin: ctin,
      supplierName: String(supplier.trdnm ?? `Supplier ${ctin}`).trim(),
      invoiceNumber: number,
      invoiceDate: date!,
      placeOfSupply: d.pos ? String(d.pos) : null,
      reverseCharge: String(d.rev ?? "N").toUpperCase() === "Y",
      itc: String(d.itcavl ?? "Y").toUpperCase() === "Y",
      itcReason: d.rsn ? String(d.rsn) : null,
      supplierFilingPeriod: supplier.supprd ? String(supplier.supprd) : null,
      supplierFilingDate: parseDateInput(supplier.supfildt),
      ...amounts,
      invoiceValue: r2(n(d.val) || amounts.taxableValue + amounts.igst + amounts.cgst + amounts.sgst + amounts.cess),
      raw: { section: label, supplier: { ctin: supplier.ctin, trdnm: supplier.trdnm, supprd: supplier.supprd, supfildt: supplier.supfildt }, document: d },
    });
  };

  let i = 0;
  for (const supplier of arr(docdata.b2b)) for (const inv of arr(supplier.inv)) build(supplier, inv, "INVOICE", "inum", "B2B", i++);
  for (const supplier of arr(docdata.cdnr)) {
    for (const note of arr(supplier.nt)) {
      const t = String(note.typ ?? note.ntty ?? "C").toUpperCase();
      build(supplier, note, t.startsWith("D") ? "DEBIT_NOTE" : "CREDIT_NOTE", "ntnum", "CDNR", i++);
    }
  }

  for (const skipped of ["b2ba", "cdnra", "isd", "impg", "impgsez"]) {
    const c = Array.isArray(docdata[skipped]) ? (docdata[skipped] as unknown[]).length : 0;
    if (c) issues.push({ row: 0, severity: "warning", message: `Section “${skipped.toUpperCase()}” (${c} entries) is not imported – only B2B and CDNR are reconciled.` });
  }
  if (!docs.length && !errorRows) issues.push({ row: 0, severity: "error", message: "No B2B or CDNR documents found in this GSTR-2B JSON." });

  return { docs, issues, totalRows, errorRows, returnPeriod, gstin };
}
