/**
 * Header aliases → canonical field. Headers are compared after lower-casing and stripping every
 * non-alphanumeric character, so "Taxable Value (₹)" and "taxable_value" both become "taxablevalue".
 * Covers our own template, the official GSTR-2B Excel (B2B and B2B-CDNR sheets) and typical Zoho/Tally exports.
 */
export const headerKey = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export type CanonicalField =
  | "supplierGstin"
  | "supplierName"
  | "invoiceNumber"
  | "invoiceDate"
  | "docType"
  | "taxableValue"
  | "igst"
  | "cgst"
  | "sgst"
  | "cess"
  | "invoiceValue"
  | "placeOfSupply"
  | "reverseCharge"
  | "itc"
  | "itcReason"
  | "rate"
  | "supplierFilingPeriod"
  | "supplierFilingDate"
  | "notes";

const ALIASES: Record<CanonicalField, string[]> = {
  supplierGstin: ["suppliergstin", "gstinofsupplier", "gstinuinofsupplier", "vendorgstin", "gstin", "gstno", "gstinno", "ctin", "suppliergstnumber", "vendorgstno", "gstidentificationnumber", "gstinuin"],
  supplierName: ["suppliername", "tradelegalname", "tradename", "legalname", "vendorname", "supplier", "vendor", "partyname", "nameofsupplier", "nameofvendor"],
  invoiceNumber: ["invoicenumber", "invoiceno", "invno", "billnumber", "billno", "billnum", "documentnumber", "documentno", "docno", "docnumber", "notenumber", "noteno", "debitcreditnoteno", "vendorinvoiceno", "supplierinvoiceno", "supplierinvoicenumber"],
  invoiceDate: ["invoicedate", "billdate", "date", "documentdate", "docdate", "notedate", "supplierinvoicedate", "vendorinvoicedate"],
  docType: ["documenttype", "doctype", "invoicetype", "notetype", "typeofdocument", "transactiontype"],
  taxableValue: ["taxablevalue", "taxableamount", "taxableamt", "taxable", "assessablevalue", "subtotal", "basicvalue"],
  igst: ["igst", "igstamount", "igstamt", "integratedtax", "integratedgst"],
  cgst: ["cgst", "cgstamount", "cgstamt", "centraltax", "centralgst"],
  sgst: ["sgst", "sgstamount", "sgstamt", "sgstutgst", "stateuttax", "statetax", "stategst", "utgst"],
  cess: ["cess", "cessamount", "cessamt"],
  invoiceValue: ["invoicevalue", "invoiceamount", "billamount", "totalamount", "total", "notevalue", "grandtotal", "invoicetotal"],
  placeOfSupply: ["placeofsupply", "pos"],
  reverseCharge: ["reversecharge", "supplyattractreversecharge", "rcm", "reversechargeapplicable", "reversechargeapplied"],
  itc: ["itcavailability", "itcavailable", "itceligible", "itceligibility", "eligibilityforitc", "eligibleforitc", "itc"],
  itcReason: ["reason", "itcreason"],
  rate: ["rate", "rateofgst", "taxrate", "gstrate"],
  supplierFilingPeriod: ["gstr1iffgstr5period", "gstr1period", "supplierfilingperiod", "filingperiod", "gstr1iffperiod"],
  supplierFilingDate: ["gstr1iffgstr5filingdate", "gstr1filingdate", "supplierfilingdate", "filingdate"],
  notes: ["notes", "remarks", "narration", "description"],
};

const LOOKUP = new Map<string, CanonicalField>();
for (const [field, aliases] of Object.entries(ALIASES) as [CanonicalField, string[]][]) {
  for (const a of aliases) if (!LOOKUP.has(a)) LOOKUP.set(a, field);
}

export function canonicalField(header: unknown): CanonicalField | null {
  return LOOKUP.get(headerKey(header)) ?? null;
}

export const REQUIRED_FIELDS: CanonicalField[] = ["supplierGstin", "invoiceNumber", "invoiceDate", "taxableValue"];

/** Index of the header row: the earliest of the first 30 rows with the most recognisable column names. */
export function detectHeaderRow(matrix: unknown[][]): { index: number; score: number } {
  let best = { index: -1, score: 0 };
  const limit = Math.min(matrix.length, 30);
  for (let i = 0; i < limit; i++) {
    const seen = new Set<CanonicalField>();
    for (const cell of matrix[i]) {
      const f = canonicalField(cell);
      if (f) seen.add(f);
    }
    if (seen.size > best.score) best = { index: i, score: seen.size };
  }
  return best;
}
