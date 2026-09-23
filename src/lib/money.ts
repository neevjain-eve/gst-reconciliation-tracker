/** Money helpers. Amounts are ₹ with 2 decimals; comparisons are done on rounded values. */

export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse an amount typed or exported by accounting software:
 * "1,23,456.50", "₹ 1,000", "Rs. 500", "(250.00)" (negative), "1000 Dr".
 * Returns `undefined` for blank / "-" cells, `NaN` when the text is not a number.
 */
export function parseAmount(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  let s = String(value).trim();
  if (s === "" || s === "-" || s === "—") return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr|,|\s/gi, "");
  if (/(cr|dr)$/i.test(s)) s = s.replace(/(cr|dr)$/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return Number.NaN;
  const n = Number(s);
  return negative ? -n : n;
}

export interface TaxAmounts {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export function totalTax(t: TaxAmounts): number {
  return r2(t.igst + t.cgst + t.sgst + t.cess);
}

export interface AmountCheck {
  errors: string[];
  warnings: string[];
}

const MAX_AMOUNT = 100_000_000_000; // ₹10,000 crore – anything above is certainly a typo

/** Validates the amounts on a single document. Amounts must be non-negative; use the document type for credit notes. */
export function validateAmounts(a: {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  invoiceValue?: number;
}): AmountCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields: [string, number | undefined][] = [
    ["Taxable value", a.taxableValue],
    ["IGST", a.igst],
    ["CGST", a.cgst],
    ["SGST", a.sgst],
    ["Cess", a.cess],
    ["Invoice value", a.invoiceValue],
  ];
  for (const [label, v] of fields) {
    if (v === undefined) continue;
    if (!Number.isFinite(v)) errors.push(`${label} is not a valid number`);
    else if (v < 0) errors.push(`${label} cannot be negative (use document type “Credit note” for reversals)`);
    else if (v > MAX_AMOUNT) errors.push(`${label} is implausibly large`);
  }
  if (errors.length) return { errors, warnings };

  if (a.igst > 0 && (a.cgst > 0 || a.sgst > 0)) errors.push("IGST cannot be charged together with CGST/SGST on the same document");
  if (Math.abs(a.cgst - a.sgst) > 1) warnings.push("CGST and SGST differ – they are normally equal");

  const tax = totalTax(a);
  if (a.taxableValue > 0 && tax / a.taxableValue > 0.5) warnings.push("Tax exceeds 50% of taxable value – please check the amounts");

  if (a.invoiceValue !== undefined) {
    const expected = r2(a.taxableValue + tax);
    if (Math.abs(a.invoiceValue - expected) > 5 + expected * 0.001) {
      warnings.push(`Invoice value ${a.invoiceValue.toFixed(2)} differs from taxable + tax (${expected.toFixed(2)})`);
    }
  }
  return { errors, warnings };
}
