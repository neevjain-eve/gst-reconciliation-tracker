import { describe, expect, it } from "vitest";
import { financialYearOf, isValidFinancialYear, monthsOfFinancialYear, parseDateInput, parseReturnPeriod, validateInvoiceDate } from "@/lib/dates";
import { parseAmount, validateAmounts } from "@/lib/money";

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("parseDateInput", () => {
  it("parses Indian and ISO formats", () => {
    expect(iso(parseDateInput("05-04-2025"))).toBe("2025-04-05");
    expect(iso(parseDateInput("05/04/2025"))).toBe("2025-04-05");
    expect(iso(parseDateInput("2025-04-05"))).toBe("2025-04-05");
    expect(iso(parseDateInput("5-Apr-2025"))).toBe("2025-04-05");
    expect(iso(parseDateInput("05 Sept 2025"))).toBe("2025-09-05");
    expect(iso(parseDateInput("05-04-25"))).toBe("2025-04-05");
  });
  it("parses Excel serials and Date objects", () => {
    expect(iso(parseDateInput(45752))).toBe("2025-04-05");
    expect(iso(parseDateInput("45752"))).toBe("2025-04-05");
    expect(iso(parseDateInput(new Date("2025-04-05T10:00:00Z")))).toBe("2025-04-05");
  });
  it("rejects impossible dates", () => {
    expect(parseDateInput("31-02-2025")).toBeNull();
    expect(parseDateInput("hello")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
  it("validates GST-era, non-future dates", () => {
    const now = new Date(Date.UTC(2026, 8, 21));
    expect(validateInvoiceDate(new Date(Date.UTC(2017, 5, 30)), now)).toMatch(/before GST/);
    expect(validateInvoiceDate(new Date(Date.UTC(2026, 11, 1)), now)).toMatch(/future/);
    expect(validateInvoiceDate(new Date(Date.UTC(2026, 8, 1)), now)).toBeNull();
  });
});

describe("financial year & periods", () => {
  it("derives FY", () => {
    expect(financialYearOf(2025, 4)).toBe("2025-26");
    expect(financialYearOf(2026, 3)).toBe("2025-26");
    expect(financialYearOf(2099, 12)).toBe("2099-00");
    expect(isValidFinancialYear("2025-26")).toBe(true);
    expect(isValidFinancialYear("2025-27")).toBe(false);
  });
  it("lists the 12 months of an FY starting April", () => {
    const m = monthsOfFinancialYear("2025-26");
    expect(m[0]).toEqual({ year: 2025, month: 4 });
    expect(m[11]).toEqual({ year: 2026, month: 3 });
  });
  it("parses GST return periods", () => {
    expect(parseReturnPeriod("042025")).toEqual({ year: 2025, month: 4 });
    expect(parseReturnPeriod("132025")).toBeNull();
  });
});

describe("amounts", () => {
  it("parses accountant-style numbers", () => {
    expect(parseAmount("1,23,456.50")).toBe(123456.5);
    expect(parseAmount("₹ 1,000")).toBe(1000);
    expect(parseAmount("Rs. 500")).toBe(500);
    expect(parseAmount("(250.00)")).toBe(-250);
    expect(parseAmount("-")).toBeUndefined();
    expect(parseAmount("")).toBeUndefined();
    expect(Number.isNaN(parseAmount("abc"))).toBe(true);
  });
  it("validates amount sets", () => {
    expect(validateAmounts({ taxableValue: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0, invoiceValue: 1180 })).toEqual({ errors: [], warnings: [] });
    expect(validateAmounts({ taxableValue: -5, igst: 0, cgst: 0, sgst: 0, cess: 0 }).errors[0]).toMatch(/negative/);
    expect(validateAmounts({ taxableValue: 1000, igst: 180, cgst: 90, sgst: 90, cess: 0 }).errors[0]).toMatch(/IGST cannot/);
    expect(validateAmounts({ taxableValue: 1000, igst: 0, cgst: 90, sgst: 40, cess: 0 }).warnings.join()).toMatch(/CGST and SGST differ/);
    expect(validateAmounts({ taxableValue: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0, invoiceValue: 2000 }).warnings.join()).toMatch(/differs from taxable/);
  });
});
