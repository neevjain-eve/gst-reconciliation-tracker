import { describe, expect, it } from "vitest";
import { reconcile, scorePair } from "@/lib/reconcile/engine";
import { DEFAULT_ENGINE_OPTIONS } from "@/lib/reconcile/types";
import { books, g2b, SUPPLIER_A, SUPPLIER_B, SUPPLIER_B_KA } from "./helpers";

const one = (b: Parameters<typeof reconcile>[0], g: Parameters<typeof reconcile>[1]) => {
  const r = reconcile(b, g);
  expect(r).toHaveLength(1);
  return r[0];
};

describe("exact matching", () => {
  it("MATCHED when everything agrees", () => {
    const r = one([books()], [g2b()]);
    expect(r.status).toBe("MATCHED");
    expect(r.matchMethod).toBe("EXACT");
    expect(r.confidence).toBe(100);
    expect(r.matchedItc).toBe(1800);
    expect(r.taxVariance).toBe(0);
  });

  it("normalises invoice numbers before matching", () => {
    const r = one([books({ invoiceNumber: "INV/25-26/00045" })], [g2b({ invoiceNumber: "inv-25-26-45" })]);
    expect(r.status).toBe("MATCHED");
    expect(r.matchMethod).toBe("NORMALIZED");
    expect(r.explanation).toMatch(/after normalisation/);
  });

  it("ignores rounding differences within ₹1", () => {
    const r = one([books({ cgst: 900.4, sgst: 900.4 })], [g2b({ cgst: 900, sgst: 900 })]);
    expect(r.status).toBe("MATCHED");
  });

  it("MATCHED_WITH_VARIANCE for small amount differences and for date-only differences", () => {
    const small = one([books({ cgst: 950, sgst: 950 })], [g2b({ cgst: 900, sgst: 900 })]);
    expect(small.status).toBe("MATCHED_WITH_VARIANCE");
    expect(small.taxVariance).toBe(100);
    expect(small.explanation).toMatch(/CGST/);

    const date = one([books({ invoiceDate: new Date(Date.UTC(2025, 3, 12)) })], [g2b()]);
    expect(date.status).toBe("MATCHED_WITH_VARIANCE");
    expect(date.explanation).toMatch(/date differs by 2 day/);
  });

  it("MATCHED_WITH_VARIANCE when GSTR-2B says ITC is not available", () => {
    const r = one([books()], [g2b({ itcAvailable: false, itcReason: "POS provision" })]);
    expect(r.status).toBe("MATCHED_WITH_VARIANCE");
    expect(r.gstr2bItc).toBe(0);
    expect(r.matchedItc).toBe(0);
    expect(r.explanation).toMatch(/POS provision/);
  });

  it("TAX_MISMATCH when amounts differ beyond tolerance", () => {
    const r = one([books({ taxableValue: 20000 })], [g2b({ taxableValue: 10000 })]);
    expect(r.status).toBe("TAX_MISMATCH");
    expect(r.matchedItc).toBe(1800); // ITC is limited to what GSTR-2B supports
    expect(r.taxVariance).toBe(1800);
    expect(r.differences.find((d) => d.field === "cgst")?.severity).toBe("mismatch");
  });

  it("flags an IGST vs CGST/SGST head mismatch", () => {
    const r = one([books({ cgst: 0, sgst: 0, igst: 1800 })], [g2b()]);
    expect(r.status).toBe("TAX_MISMATCH");
  });
});

describe("duplicates", () => {
  it("flags the extra books copy and keeps the one closest to GSTR-2B as primary", () => {
    const good = books({ id: "b-good" });
    const typo = books({ id: "b-typo", taxableValue: 12000 });
    const res = reconcile([typo, good], [g2b()]);
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.invoiceId === "b-good")?.status).toBe("MATCHED");
    expect(res.find((r) => r.invoiceId === "b-typo")?.status).toBe("DUPLICATE_INVOICE");
  });
  it("flags duplicates inside GSTR-2B", () => {
    const res = reconcile([books()], [g2b({ id: "g1" }), g2b({ id: "g2" })]);
    expect(res.filter((r) => r.status === "DUPLICATE_INVOICE")).toHaveLength(1);
    expect(res.filter((r) => r.status === "MATCHED")).toHaveLength(1);
  });
  it("duplicates count as unmatched ITC, never as matched", () => {
    const res = reconcile([books(), books()], [g2b()]);
    const dup = res.find((r) => r.status === "DUPLICATE_INVOICE")!;
    expect(dup.booksItc).toBe(1800);
    expect(dup.matchedItc).toBe(0);
  });
});

describe("fuzzy matching", () => {
  it("INVOICE_NUMBER_MISMATCH: same supplier, date and amounts, typo in the number", () => {
    const r = one([books({ invoiceNumber: "AB-1042" })], [g2b({ invoiceNumber: "AB-1024" })]);
    expect(r.status).toBe("INVOICE_NUMBER_MISMATCH");
    expect(r.matchMethod).toBe("FUZZY");
    expect(r.confidence).toBeGreaterThanOrEqual(80);
    expect(r.explanation).toMatch(/invoice numbers differ/);
  });

  it("GSTIN_MISMATCH: same invoice number, supplier GSTIN typo'd / other state of same PAN", () => {
    const r = one([books({ supplierGstin: SUPPLIER_B })], [g2b({ supplierGstin: SUPPLIER_B_KA })]);
    expect(r.status).toBe("GSTIN_MISMATCH");
    expect(r.explanation).toMatch(/GSTIN differs/);
  });

  it("NEEDS_REVIEW when both GSTIN and invoice number differ but the rest agrees", () => {
    const r = one([books({ supplierGstin: SUPPLIER_B, invoiceNumber: "X-77" })], [g2b({ supplierGstin: SUPPLIER_B_KA, invoiceNumber: "X-771" })]);
    expect(r.status).toBe("NEEDS_REVIEW");
  });

  it("NEEDS_REVIEW for a low-confidence same-supplier pair (recurring amounts, different invoices)", () => {
    const r = one(
      [books({ invoiceNumber: "RENT-FEB", invoiceDate: new Date(Date.UTC(2025, 4, 1)) })],
      [g2b({ invoiceNumber: "R/2025/01", invoiceDate: new Date(Date.UTC(2025, 3, 1)) })],
    );
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.confidence).toBeLessThan(80);
  });

  it("does not pair unrelated documents", () => {
    const res = reconcile(
      [books({ supplierGstin: SUPPLIER_A, invoiceNumber: "A1", taxableValue: 5000 })],
      [g2b({ supplierGstin: SUPPLIER_B, invoiceNumber: "Z999", taxableValue: 77000, invoiceDate: new Date(Date.UTC(2025, 8, 1)) })],
    );
    expect(res.map((r) => r.status).sort()).toEqual(["MISSING_IN_BOOKS", "MISSING_IN_GSTR2B"]);
  });

  it("pairs one-to-one, best score first", () => {
    const b1 = books({ id: "b1", invoiceNumber: "AB-1042" });
    const b2 = books({ id: "b2", invoiceNumber: "AB-2000", taxableValue: 33000, invoiceDate: new Date(Date.UTC(2025, 3, 20)) });
    const g1 = g2b({ id: "g1", invoiceNumber: "AB-1024" });
    const res = reconcile([b1, b2], [g1]);
    expect(res.find((r) => r.invoiceId === "b1")?.gstr2bRecordId).toBe("g1");
    expect(res.find((r) => r.invoiceId === "b2")?.status).toBe("MISSING_IN_GSTR2B");
  });
});

describe("missing documents and ITC", () => {
  it("MISSING_IN_GSTR2B / MISSING_IN_BOOKS", () => {
    const res = reconcile([books({ invoiceNumber: "ONLY-BOOKS", taxableValue: 5000, supplierGstin: SUPPLIER_A })], [g2b({ invoiceNumber: "ONLY-2B", taxableValue: 90000, supplierGstin: SUPPLIER_B, invoiceDate: new Date(Date.UTC(2025, 5, 1)) })]);
    const missing2b = res.find((r) => r.status === "MISSING_IN_GSTR2B")!;
    expect(missing2b.booksItc).toBe(900);
    expect(missing2b.matchedItc).toBe(0);
    expect(missing2b.taxVariance).toBe(900);
    const missingBooks = res.find((r) => r.status === "MISSING_IN_BOOKS")!;
    expect(missingBooks.gstr2bItc).toBe(16200);
    expect(missingBooks.taxVariance).toBe(-16200);
  });

  it("credit notes carry negative ITC", () => {
    const r = one([books({ docType: "CREDIT_NOTE" })], [g2b({ docType: "CREDIT_NOTE" })]);
    expect(r.status).toBe("MATCHED");
    expect(r.booksItc).toBe(-1800);
    expect(r.matchedItc).toBe(-1800);
  });

  it("books ITC-ineligible bills are not counted as ITC", () => {
    const r = one([books({ itcEligible: false })], [g2b()]);
    expect(r.booksItc).toBe(0);
    expect(r.matchedItc).toBe(0);
  });
});

describe("invariants", () => {
  it("every input document appears in exactly one result; pair keys are unique and deterministic", () => {
    const B = [
      books({ id: "b1", invoiceNumber: "A1" }),
      books({ id: "b2", invoiceNumber: "A2", taxableValue: 4000 }),
      books({ id: "b3", invoiceNumber: "A2", taxableValue: 4000 }), // dup
      books({ id: "b4", invoiceNumber: "A9", supplierGstin: SUPPLIER_B, taxableValue: 1234 }),
      books({ id: "b5", invoiceNumber: "Q-500", taxableValue: 8000 }),
    ];
    const G = [
      g2b({ id: "g1", invoiceNumber: "A1" }),
      g2b({ id: "g2", invoiceNumber: "A2", taxableValue: 4000 }),
      g2b({ id: "g3", invoiceNumber: "NEW-1", supplierGstin: SUPPLIER_B, taxableValue: 50000, invoiceDate: new Date(Date.UTC(2025, 7, 1)) }),
      g2b({ id: "g4", invoiceNumber: "Q-5OO", taxableValue: 8000 }), // O vs 0 typo
    ];
    const r1 = reconcile(B, G);
    const r2 = reconcile(B, G);
    expect(r2.map((r) => r.pairKey)).toEqual(r1.map((r) => r.pairKey));
    expect(new Set(r1.map((r) => r.pairKey)).size).toBe(r1.length);

    const bIds = r1.flatMap((r) => (r.invoiceId ? [r.invoiceId] : [])).sort();
    const gIds = r1.flatMap((r) => (r.gstr2bRecordId ? [r.gstr2bRecordId] : [])).sort();
    expect(bIds).toEqual(B.map((b) => b.id).sort());
    expect(gIds).toEqual(G.map((g) => g.id).sort());
  });

  it("scores identical documents at 100 and unrelated ones near 0", () => {
    expect(scorePair(books(), g2b(), DEFAULT_ENGINE_OPTIONS).score).toBe(100);
    expect(scorePair(books(), g2b({ supplierGstin: SUPPLIER_B, invoiceNumber: "ZZ", taxableValue: 1, invoiceDate: new Date(Date.UTC(2026, 1, 1)) })).score).toBeLessThan(15);
  });

  it("handles empty inputs", () => {
    expect(reconcile([], [])).toEqual([]);
    expect(reconcile([books()], [])[0].status).toBe("MISSING_IN_GSTR2B");
    expect(reconcile([], [g2b()])[0].status).toBe("MISSING_IN_BOOKS");
  });
});
