import { describe, expect, it } from "vitest";
import { normalizeInvoiceNumber } from "@/lib/reconcile/normalize";
import { editRatio, gstinSimilarity, invoiceNumberSimilarity, levenshtein } from "@/lib/reconcile/similarity";

describe("normalizeInvoiceNumber", () => {
  it("makes separators, case and leading zeros irrelevant", () => {
    const variants = ["INV/2024-25/00123", "inv-2024-25-123", "INV 2024-25 0123", " INV.2024.25.123 "];
    const set = new Set(variants.map(normalizeInvoiceNumber));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe("INV202425123");
  });
  it("handles spreadsheet artefacts and empties", () => {
    expect(normalizeInvoiceNumber("123.0")).toBe("123");
    expect(normalizeInvoiceNumber("0")).toBe("0");
    expect(normalizeInvoiceNumber("000")).toBe("0");
    expect(normalizeInvoiceNumber(null)).toBe("");
    expect(normalizeInvoiceNumber(" - ")).toBe("");
  });
  it("keeps genuinely different numbers different", () => {
    expect(normalizeInvoiceNumber("INV-101")).not.toBe(normalizeInvoiceNumber("INV-110"));
    expect(normalizeInvoiceNumber("A-1")).not.toBe(normalizeInvoiceNumber("B-1"));
  });
});

describe("similarity", () => {
  it("levenshtein", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(editRatio("", "")).toBe(1);
  });
  it("invoice number similarity tiers", () => {
    expect(invoiceNumberSimilarity("INV123", "INV123")).toBe(1);
    expect(invoiceNumberSimilarity("INV123", "INV124")).toBeGreaterThan(0.8); // typo
    expect(invoiceNumberSimilarity("45", "INV20252645")).toBeGreaterThanOrEqual(0.7); // containment
    expect(invoiceNumberSimilarity("AB4501", "XY4501")).toBeGreaterThanOrEqual(0.75); // same sequence
    expect(invoiceNumberSimilarity("ABCDEF", "XYZ123")).toBe(0);
    expect(invoiceNumberSimilarity("", "")).toBe(0);
  });
  it("gstin similarity", () => {
    expect(gstinSimilarity("29AABCA1234A1ZK", "29AABCA1234A1ZK")).toBe(1);
    expect(gstinSimilarity("29AABCA1234A1ZK", "27AABCA1234A1ZK")).toBe(0.6); // same PAN
    expect(gstinSimilarity("29AABCA1234A1ZK", "29AABCA1234A1ZQ")).toBe(0.6); // 1-char typo
    expect(gstinSimilarity("29AABCA1234A1ZK", "07XYZPQ9999Q1ZA")).toBe(0);
  });
});
