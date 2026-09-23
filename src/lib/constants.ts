import type { DecisionStr, ReconStatusStr } from "./constants-types";

export type Tone = "neutral" | "green" | "amber" | "orange" | "red" | "blue" | "violet";

export const STATUS_META: Record<ReconStatusStr, { label: string; tone: Tone; hint: string; dot: string }> = {
  MATCHED: { label: "Matched", tone: "green", hint: "Supplier GSTIN, invoice number, date and amounts agree.", dot: "#0ca30c" },
  MATCHED_WITH_VARIANCE: { label: "Matched with variance", tone: "amber", hint: "Same document; small amount, date or ITC-availability difference.", dot: "#fab219" },
  MISSING_IN_GSTR2B: { label: "Missing in GSTR-2B", tone: "red", hint: "Booked, but the supplier has not reported it – ITC at risk.", dot: "#d03b3b" },
  MISSING_IN_BOOKS: { label: "Missing in books", tone: "blue", hint: "In GSTR-2B but not booked – possible missed ITC.", dot: "#2a78d6" },
  DUPLICATE_INVOICE: { label: "Duplicate invoice", tone: "violet", hint: "Same supplier and invoice number appears more than once.", dot: "#4a3aa7" },
  GSTIN_MISMATCH: { label: "GSTIN mismatch", tone: "orange", hint: "Invoice matches but the supplier GSTIN differs.", dot: "#ec835a" },
  INVOICE_NUMBER_MISMATCH: { label: "Invoice no. mismatch", tone: "orange", hint: "Supplier matches; invoice numbers differ (typo / format).", dot: "#ec835a" },
  TAX_MISMATCH: { label: "Tax mismatch", tone: "orange", hint: "Same document; amounts differ beyond tolerance.", dot: "#ec835a" },
  NEEDS_REVIEW: { label: "Needs review", tone: "amber", hint: "Possible match below the auto-classify confidence.", dot: "#c98500" },
};

export const STATUS_ORDER: ReconStatusStr[] = [
  "MATCHED",
  "MATCHED_WITH_VARIANCE",
  "MISSING_IN_GSTR2B",
  "MISSING_IN_BOOKS",
  "DUPLICATE_INVOICE",
  "GSTIN_MISMATCH",
  "INVOICE_NUMBER_MISMATCH",
  "TAX_MISMATCH",
  "NEEDS_REVIEW",
];

export const DECISION_META: Record<DecisionStr, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "neutral" },
  ACCEPTED: { label: "Accepted", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  REVIEWED: { label: "Reviewed", tone: "blue" },
  FOLLOW_UP: { label: "Follow-up required", tone: "amber" },
};

export const DOC_TYPE_LABEL = { INVOICE: "Invoice", CREDIT_NOTE: "Credit note", DEBIT_NOTE: "Debit note" } as const;
export const SOURCE_LABEL = { ZOHO_BOOKS: "Zoho Books", MANUAL: "Manual entry", FILE_UPLOAD: "File upload", GSP: "GSP API" } as const;
export const IMPORT_TYPE_LABEL = { BOOKS_FILE: "Books upload", GSTR2B_FILE: "GSTR-2B upload", ZOHO_SYNC: "Zoho Books sync", GSP_FETCH: "GSP fetch" } as const;
