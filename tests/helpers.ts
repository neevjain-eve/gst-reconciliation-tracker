import { buildGstin } from "@/lib/gstin";
import { normalizeInvoiceNumber } from "@/lib/reconcile/normalize";
import type { BooksDoc, GstrDoc } from "@/lib/reconcile/types";

export const SUPPLIER_A = buildGstin("29", "AABCA1234A"); // Karnataka
export const SUPPLIER_B = buildGstin("27", "AABCB5678B"); // Maharashtra
export const SUPPLIER_B_KA = buildGstin("29", "AABCB5678B"); // same PAN, other state

let seq = 0;
type Over = Partial<BooksDoc & GstrDoc>;

function base(prefix: string, o: Over) {
  const invoiceNumber = o.invoiceNumber ?? "INV-001";
  const taxable = o.taxableValue ?? 10000;
  const cgst = o.cgst ?? taxable * 0.09;
  const sgst = o.sgst ?? taxable * 0.09;
  return {
    id: o.id ?? `${prefix}${++seq}`,
    supplierGstin: o.supplierGstin ?? SUPPLIER_A,
    supplierName: o.supplierName ?? "Acme Supplies",
    invoiceNumber,
    invoiceNumberNorm: o.invoiceNumberNorm ?? normalizeInvoiceNumber(invoiceNumber),
    invoiceDate: o.invoiceDate ?? new Date(Date.UTC(2025, 3, 10)),
    docType: o.docType ?? "INVOICE",
    taxableValue: taxable,
    igst: o.igst ?? 0,
    cgst,
    sgst,
    cess: o.cess ?? 0,
    invoiceValue: taxable + cgst + sgst + (o.igst ?? 0),
    taxPeriodId: "p1",
    vendorId: "v1",
    createdAt: ++seq,
  } as const;
}

export const books = (o: Over = {}): BooksDoc => ({ ...base("b", o), itcEligible: o.itcEligible ?? true });
export const g2b = (o: Over = {}): GstrDoc => ({ ...base("g", o), itcAvailable: o.itcAvailable ?? true, itcReason: o.itcReason ?? null });
