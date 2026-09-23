import { describe, expect, it } from "vitest";
import { buildGstin, gstinCheckChar, hasValidGstinFormat, isValidGstin, normalizeGstin, panFromGstin } from "@/lib/gstin";

describe("GSTIN", () => {
  it("validates a well-known valid GSTIN", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
  });
  it("round-trips generated GSTINs through the checksum", () => {
    const g = buildGstin("29", "AABCA1234A");
    expect(g).toHaveLength(15);
    expect(isValidGstin(g)).toBe(true);
    expect(gstinCheckChar(g.slice(0, 14))).toBe(g[14]);
  });
  it("rejects a wrong check character but accepts the format", () => {
    const g = buildGstin("29", "AABCA1234A");
    const bad = g.slice(0, 14) + (g[14] === "A" ? "B" : "A");
    expect(hasValidGstinFormat(bad)).toBe(true);
    expect(isValidGstin(bad)).toBe(false);
  });
  it("rejects malformed input and unknown state codes", () => {
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isValidGstin("00AAPFU0939F1ZV")).toBe(false);
    expect(isValidGstin("27aapfu0939f1zv")).toBe(true); // normalised to upper-case
  });
  it("normalises whitespace and case; extracts PAN", () => {
    expect(normalizeGstin(" 27aapfu0939 f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(panFromGstin("27AAPFU0939F1ZV")).toBe("AAPFU0939F");
  });
});
