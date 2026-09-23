export type DocTypeValue = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

/** A validated document ready to be stored as an Invoice (books) or a Gstr2bRecord. */
export interface NormalizedDoc {
  docType: DocTypeValue;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  placeOfSupply?: string | null;
  reverseCharge: boolean;
  /** books: ITC eligible · GSTR-2B: ITC available */
  itc: boolean;
  itcReason?: string | null;
  supplierFilingPeriod?: string | null;
  supplierFilingDate?: Date | null;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  invoiceValue: number;
  externalId?: string;
  externalModifiedAt?: string;
  notes?: string | null;
  /** The source row/payload exactly as received – stored untouched for audit. */
  raw?: unknown;
}

export interface RowIssue {
  /** 1-based row number in the source sheet/file (0 = whole file) */
  row: number;
  field?: string;
  severity: "error" | "warning";
  message: string;
}

export interface ParseOutcome {
  docs: NormalizedDoc[];
  issues: RowIssue[];
  totalRows: number;
  /** rows rejected because of errors */
  errorRows: number;
  /** for GSTR-2B JSON/XLSX: return period found inside the file */
  returnPeriod?: { year: number; month: number } | null;
  gstin?: string | null;
}
