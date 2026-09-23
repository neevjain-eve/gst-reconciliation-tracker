import { describe, expect, it } from "vitest";
import { mapZohoBill } from "@/lib/zoho/mapper";
import { buildGstin } from "@/lib/gstin";
import { dcFromLocation, safeApiDomain } from "@/lib/zoho/config";

const NOW = new Date(Date.UTC(2025, 5, 15));
const GSTIN = buildGstin("29", "AABCA1234A");

const bill = (o: Record<string, unknown> = {}) => ({
  bill_id: "4000000001",
  bill_number: "INV/2025/0042",
  date: "2025-05-10",
  status: "open",
  vendor_name: "Acme Supplies",
  gst_no: GSTIN,
  gst_treatment: "business_gst",
  source_of_supply: "KA",
  destination_of_supply: "KA",
  sub_total: 10000,
  total: 11800,
  taxes: [
    { tax_name: "CGST (9%)", tax_amount: 900 },
    { tax_name: "SGST (9%)", tax_amount: 900 },
  ],
  line_items: [{ item_total: 10000 }],
  last_modified_time: "2025-05-11T10:00:00+0530",
  ...o,
});

describe("mapZohoBill", () => {
  it("maps an intra-state bill with CGST + SGST", () => {
    const r = mapZohoBill(bill(), { now: NOW });
    expect(r.error).toBeUndefined();
    expect(r.doc).toMatchObject({ supplierGstin: GSTIN, invoiceNumber: "INV/2025/0042", taxableValue: 10000, cgst: 900, sgst: 900, igst: 0, invoiceValue: 11800, itc: true, externalId: "4000000001" });
  });

  it("maps IGST and cess by tax name", () => {
    const r = mapZohoBill(bill({ destination_of_supply: "MH", taxes: [{ tax_name: "IGST18", tax_amount: 1800 }, { tax_name: "Compensation Cess", tax_amount: 50 }], total: 11850 }), { now: NOW });
    expect(r.doc).toMatchObject({ igst: 1800, cgst: 0, sgst: 0, cess: 50 });
  });

  it("splits a combined GST tax by place of supply and warns", () => {
    const intra = mapZohoBill(bill({ taxes: [{ tax_name: "GST18", tax_amount: 1800 }] }), { now: NOW });
    expect(intra.doc).toMatchObject({ cgst: 900, sgst: 900, igst: 0 });
    expect(intra.warnings.join()).toMatch(/inferred/);
    const inter = mapZohoBill(bill({ destination_of_supply: "MH", taxes: [{ tax_name: "GST18", tax_amount: 1800 }] }), { now: NOW });
    expect(inter.doc).toMatchObject({ igst: 1800, cgst: 0 });
  });

  it("derives the taxable value for tax-inclusive bills", () => {
    const r = mapZohoBill(bill({ is_inclusive_tax: true, sub_total: 11800, total: 11800, tax_total: 1800 }), { now: NOW });
    expect(r.doc?.taxableValue).toBe(10000);
  });

  it.each(["draft", "void", "pending_approval"])("skips %s bills", (status) => {
    const r = mapZohoBill(bill({ status }), { now: NOW });
    expect(r.doc).toBeUndefined();
    expect(r.skip).toBeTruthy();
  });

  it("skips unregistered suppliers and bills without a GSTIN (not errors)", () => {
    expect(mapZohoBill(bill({ gst_treatment: "business_none" }), { now: NOW }).skip).toBeTruthy();
    expect(mapZohoBill(bill({ gst_no: "" }), { now: NOW }).skip).toBeTruthy();
  });

  it("rejects malformed rows with a readable error", () => {
    expect(mapZohoBill(bill({ gst_no: "NOT-A-GSTIN" }), { now: NOW }).error).toMatch(/GSTIN/);
    expect(mapZohoBill(bill({ bill_number: "" }), { now: NOW }).error).toMatch(/bill number/);
    expect(mapZohoBill(bill({ date: "31-31-2025" }), { now: NOW }).error).toMatch(/date/);
    expect(mapZohoBill(bill({ date: "2030-01-01" }), { now: NOW }).error).toBeTruthy();
    expect(mapZohoBill(bill({ igst: 0, taxes: [{ tax_name: "CGST", tax_amount: -5 }] }), { now: NOW }).error).toBeTruthy();
  });

  it("flags ineligible ITC when every line is ineligible", () => {
    const r = mapZohoBill(bill({ line_items: [{ item_total: 10000, itc_eligibility: "ineligible" }] }), { now: NOW });
    expect(r.doc?.itc).toBe(false);
  });

  it("keeps the original payload untouched", () => {
    const b = bill();
    expect(mapZohoBill(b, { now: NOW }).doc?.raw).toBe(b);
  });
});

describe("zoho config helpers", () => {
  it("only allows Zoho-owned API hosts", () => {
    expect(safeApiDomain("https://www.zohoapis.in", "in")).toBe("https://www.zohoapis.in");
    expect(safeApiDomain("https://evil.example.com", "in")).toBe("https://www.zohoapis.in");
    expect(safeApiDomain("https://www.zohoapis.in.evil.com", "in")).toBe("https://www.zohoapis.in");
    expect(safeApiDomain(undefined, "com")).toBe("https://www.zohoapis.com");
  });
  it("maps the redirect location to a data centre", () => {
    expect(dcFromLocation("us")).toBe("com");
    expect(dcFromLocation("IN")).toBe("in");
    expect(dcFromLocation("xx")).toBeNull();
  });
});
