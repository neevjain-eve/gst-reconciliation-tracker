/**
 * Invoice-number normalisation.
 *
 * Suppliers and accountants type the same number differently: "INV/2024-25/00123", "inv-2024-25-123",
 * "INV 2024-25 123". We upper-case, split on every non-alphanumeric separator, strip leading zeros from
 * each numeric run *before* joining, and concatenate:
 *
 *   "INV/2024-25/00123" → tokens [INV, 2024, 25, 00123] → "INV202425123"
 *   "inv-2024-25-123"   →                                → "INV202425123"
 */
export function normalizeInvoiceNumber(raw: unknown): string {
  let s = String(raw ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .trim();
  // spreadsheet artefact: 123 stored as number and exported as "123.0"
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.replace(/(?<![0-9])0+(?=[0-9])/g, ""))
    .join("");
}

/** Trailing run of digits in an already-normalised number ("INV202425123" → "202425123"). */
export function trailingDigits(norm: string): string {
  const m = /(\d+)$/.exec(norm);
  return m ? m[1] : "";
}
