export type DocTypeStr = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export type ReconStatusStr =
  | "MATCHED"
  | "MATCHED_WITH_VARIANCE"
  | "MISSING_IN_GSTR2B"
  | "MISSING_IN_BOOKS"
  | "DUPLICATE_INVOICE"
  | "GSTIN_MISMATCH"
  | "INVOICE_NUMBER_MISMATCH"
  | "TAX_MISMATCH"
  | "NEEDS_REVIEW";

export type MatchMethodStr = "EXACT" | "NORMALIZED" | "FUZZY" | "NONE";

/** Fields shared by a books invoice and a GSTR-2B record, as numbers/dates (no Prisma types). */
export interface EngineDoc {
  id: string;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceNumberNorm: string;
  invoiceDate: Date;
  docType: DocTypeStr;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  invoiceValue: number;
  taxPeriodId: string;
  vendorId: string;
  /** epoch ms – only used for deterministic tie-breaking */
  createdAt: number;
}

export interface BooksDoc extends EngineDoc {
  itcEligible: boolean;
}

export interface GstrDoc extends EngineDoc {
  itcAvailable: boolean;
  itcReason?: string | null;
  supplierFilingPeriod?: string | null;
}

export interface EngineOptions {
  /** Differences up to this many ₹ per component are treated as rounding and ignored. */
  roundingTolerance: number;
  /** Differences up to this many ₹ per component are a "variance"; above it, a mismatch. */
  varianceTolerance: number;
  /** Fuzzy pairs scoring at least this are auto-classified (invoice-number / GSTIN mismatch). */
  autoMatchScore: number;
  /** Fuzzy pairs scoring at least this (but below autoMatchScore) are surfaced as "Needs review". */
  reviewScore: number;
}

export type DiffSeverity = "ok" | "rounding" | "variance" | "mismatch";

export interface FieldDiff {
  field: "supplierGstin" | "invoiceNumber" | "invoiceDate" | "taxableValue" | "igst" | "cgst" | "sgst" | "cess";
  label: string;
  books: string | number | null;
  gstr2b: string | number | null;
  /** books − GSTR-2B for numeric fields, days for dates */
  diff: number | null;
  severity: DiffSeverity;
}

export interface EngineResult {
  pairKey: string;
  status: ReconStatusStr;
  matchMethod: MatchMethodStr;
  confidence: number;
  explanation: string;
  differences: FieldDiff[];
  invoiceId: string | null;
  gstr2bRecordId: string | null;
  vendorId: string;
  taxPeriodId: string;
  docType: DocTypeStr;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  booksTaxable: number | null;
  booksTax: number | null;
  gstr2bTaxable: number | null;
  gstr2bTax: number | null;
  taxableVariance: number;
  taxVariance: number;
  booksItc: number;
  gstr2bItc: number;
  matchedItc: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  roundingTolerance: 1,
  varianceTolerance: 100,
  autoMatchScore: 80,
  reviewScore: 55,
};
