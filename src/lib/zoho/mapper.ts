import { parseDateInput, validateInvoiceDate } from "@/lib/dates";
import { hasValidGstinChecksum, hasValidGstinFormat, normalizeGstin } from "@/lib/gstin";
import { r2, validateAmounts } from "@/lib/money";
import type { NormalizedDoc } from "@/lib/import/types";

type Bill = Record<string, unknown>;
type Line = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export interface MapResult {
  doc?: NormalizedDoc;
  /** Not an error: the bill is simply outside the reconciliation (draft, unregistered supplier …). */
  skip?: string;
  /** Row-level problem: the bill could not be converted. */
  error?: string;
  warnings: string[];
}

/** Statuses that never carry claimable ITC. */
export const IGNORED_BILL_STATUSES = new Set(["draft", "void", "pending_approval"]);
/** Zoho India GST treatments with no supplier GSTIN / no ITC. */
const NON_REGISTERED = new Set(["business_none", "consumer", "overseas", "special_economic_zone_overseas"]);

/**
 * Map a Zoho Books bill (GET /books/v3/bills/{id}) to our normalised document.
 *
 * The GST fields Zoho exposes on a bill are `gst_no` (supplier GSTIN), `gst_treatment`, `source_of_supply`,
 * `destination_of_supply`, `is_reverse_charge_applied`, `sub_total`, `taxes[]` ({ tax_name, tax_amount }) and
 * `line_items[]`. Tax heads are read from the tax names (IGST / CGST / SGST / UTGST / CESS); an
 * unrecognised or combined "GST18" tax is split by intra/inter-state. Verify against your own organisation's tax
 * setup – see docs/INTEGRATIONS.md.
 */
export function mapZohoBill(bill: Bill, opts: { now?: Date } = {}): MapResult {
  const warnings: string[] = [];
  const billNumber = str(bill.bill_number);
  const label = billNumber || str(bill.bill_id) || "bill";
  const status = str(bill.status).toLowerCase();
  if (IGNORED_BILL_STATUSES.has(status)) return { skip: `Bill ${label} is ${status}`, warnings };

  const treatment = str(bill.gst_treatment).toLowerCase();
  if (NON_REGISTERED.has(treatment)) return { skip: `Bill ${label}: supplier is ${treatment.replace(/_/g, " ")} (no GSTIN, no ITC)`, warnings };

  const gstin = normalizeGstin(bill.gst_no ?? bill.vendor_gst_no ?? bill.gstin);
  if (!gstin) return { skip: `Bill ${label}: no supplier GSTIN on the bill`, warnings };
  if (!hasValidGstinFormat(gstin)) return { error: `Bill ${label}: supplier GSTIN “${gstin}” is not valid`, warnings };
  if (!hasValidGstinChecksum(gstin)) warnings.push(`Bill ${label}: GSTIN ${gstin} has an invalid check digit – possible typo in Zoho`);

  if (!billNumber) return { error: `Bill ${str(bill.bill_id)}: missing bill number`, warnings };
  const date = parseDateInput(str(bill.date));
  if (!date) return { error: `Bill ${label}: invalid bill date “${str(bill.date)}”`, warnings };
  const dateErr = validateInvoiceDate(date, opts.now);
  if (dateErr) return { error: `Bill ${label}: ${dateErr}`, warnings };

  const lines = (Array.isArray(bill.line_items) ? bill.line_items : []) as Line[];
  const inclusive = bill.is_inclusive_tax === true;
  const total = num(bill.total);
  const taxTotal = num(bill.tax_total);
  let taxable = inclusive ? total - taxTotal : num(bill.sub_total);
  if (!taxable && lines.length) taxable = lines.reduce((s, l) => s + num(l.item_total), 0);

  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  let cess = 0;
  let combinedGst = 0;
  let unknown = 0;
  const taxes = (Array.isArray(bill.taxes) ? bill.taxes : []) as Line[];
  for (const t of taxes) {
    const name = str(t.tax_name).toUpperCase();
    const amt = num(t.tax_amount);
    if (!amt) continue;
    if (name.includes("IGST")) igst += amt;
    else if (name.includes("CGST")) cgst += amt;
    else if (name.includes("SGST") || name.includes("UTGST")) sgst += amt;
    else if (name.includes("CESS")) cess += amt;
    else if (/^GST/.test(name)) combinedGst += amt;
    else unknown += amt;
  }
  if (combinedGst || unknown || (!taxes.length && taxTotal)) {
    const leftover = combinedGst + unknown || taxTotal;
    const inter = str(bill.source_of_supply) && str(bill.destination_of_supply) && str(bill.source_of_supply) !== str(bill.destination_of_supply);
    if (inter) igst += leftover;
    else {
      cgst += leftover / 2;
      sgst += leftover / 2;
    }
    warnings.push(`Bill ${label}: tax split inferred from ${inter ? "inter" : "intra"}-state supply (tax names not recognised)`);
  }

  const amounts = { taxableValue: r2(taxable), igst: r2(igst), cgst: r2(cgst), sgst: r2(sgst), cess: r2(cess), invoiceValue: r2(total || taxable + igst + cgst + sgst + cess) };
  const check = validateAmounts(amounts);
  if (check.errors.length) return { error: `Bill ${label}: ${check.errors.join("; ")}`, warnings };
  check.warnings.forEach((w) => warnings.push(`Bill ${label}: ${w}`));

  const ineligible = lines.length > 0 && lines.every((l) => str(l.itc_eligibility).toLowerCase().startsWith("ineligible"));

  return {
    warnings,
    doc: {
      docType: "INVOICE",
      supplierGstin: gstin,
      supplierName: str(bill.vendor_name) || `Supplier ${gstin}`,
      invoiceNumber: billNumber,
      invoiceDate: date,
      placeOfSupply: str(bill.destination_of_supply) || str(bill.place_of_supply) || null,
      reverseCharge: bill.is_reverse_charge_applied === true,
      itc: !ineligible,
      ...amounts,
      externalId: str(bill.bill_id),
      externalModifiedAt: str(bill.last_modified_time) || undefined,
      raw: bill,
    },
  };
}
