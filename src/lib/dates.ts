/** Date helpers. Every date in this app is a calendar date stored as UTC midnight. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** GST came into force on 1 July 2017; nothing earlier is a valid GST invoice date. */
export const GST_START = Date.UTC(2017, 6, 1);

function makeDate(y: number, m: number, d: number): Date | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // reject roll-overs such as 31-Feb
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/**
 * Parse the date formats accountants actually paste into spreadsheets:
 * DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, DD-MMM-YYYY, Excel serials and JS Dates.
 * Day-first is assumed for ambiguous numeric dates (India).
 */
export function parseDateInput(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (typeof value === "number") {
    // Excel 1900 date system serial
    if (value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return null;
  }

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d{5}$/.test(s)) return parseDateInput(Number(s));

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return makeDate(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return makeDate(year, +m[2], +m[1]);
  }

  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,4})[-/. ,]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return makeDate(year, mon, +m[1]);
  }

  return null;
}

/** Returns an error message, or null when the invoice date is acceptable. */
export function validateInvoiceDate(d: Date, now: Date = new Date()): string | null {
  if (d.getTime() < GST_START) return "Invoice date is before GST came into force (01-Jul-2017)";
  if (d.getTime() > now.getTime() + 2 * 86400000) return "Invoice date is in the future";
  return null;
}

export function financialYearOf(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function periodOfDate(d: Date): { year: number; month: number; financialYear: string } {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return { year, month, financialYear: financialYearOf(year, month) };
}

/** Financial year containing "now", e.g. "2026-27". */
export function currentFinancialYear(now: Date = new Date()): string {
  return financialYearOf(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/** "2025-26" → its 12 calendar months, April first. */
export function monthsOfFinancialYear(fy: string): { year: number; month: number }[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    return { year: month >= 4 ? start : start + 1, month };
  });
}

export function isValidFinancialYear(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]) && Number(m[1]) >= 2017;
}

/** GST "return period" string, MMYYYY. */
export function returnPeriodString(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}${year}`;
}

export function parseReturnPeriod(rp: string): { year: number; month: number } | null {
  const m = /^(\d{2})(\d{4})$/.exec(rp.trim());
  if (!m) return null;
  const month = +m[1];
  if (month < 1 || month > 12) return null;
  return { year: +m[2], month };
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
