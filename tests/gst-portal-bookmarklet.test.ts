import { describe, expect, it } from "vitest";
import { buildBookmarklet, HELPERS_SRC, MAIN_SRC } from "@/lib/gst-portal-bookmarklet";

type Info = { month: number; year: number; monthName: string; fy: string; fyLong: string; quarter: number };
const h = new Function(`${HELPERS_SRC}; return { periodInfo, defaultPeriod, classify, pickIndex, returnNames };`)() as {
  periodInfo: (p: string) => Info | null;
  defaultPeriod: (d: Date) => string;
  classify: (opts: string[]) => string | null;
  pickIndex: (kind: string, opts: string[], info: Info) => number;
  returnNames: (text: string) => string[];
};

describe("GSTR-2B bookmarklet helpers", () => {
  it("maps a month to financial year and quarter", () => {
    expect(h.periodInfo("04-2026")).toMatchObject({ fy: "2026-27", fyLong: "2026-2027", quarter: 1, monthName: "april" });
    expect(h.periodInfo("3/2026")).toMatchObject({ fy: "2025-26", quarter: 4, monthName: "march" });
    expect(h.periodInfo("12-2025")).toMatchObject({ fy: "2025-26", quarter: 3 });
    expect(h.periodInfo("09-2099")).toMatchObject({ fy: "2099-00" });
  });

  it("rejects bad input", () => {
    for (const bad of ["", "13-2026", "00-2026", "2026-04", "04-26", "abc"]) expect(h.periodInfo(bad)).toBeNull();
  });

  it("defaults to the previous month, across a year boundary", () => {
    expect(h.defaultPeriod(new Date(2026, 8, 21))).toBe("08-2026");
    expect(h.defaultPeriod(new Date(2026, 0, 5))).toBe("12-2025");
  });

  it("recognises portal dropdowns by their options", () => {
    expect(h.classify(["Select", "2026-27", "2025-26"])).toBe("fy");
    expect(h.classify(["Select", "Quarter 1 (Apr - Jun)", "Quarter 2 (Jul - Sep)"])).toBe("quarter");
    expect(h.classify(["Select", "April", "May", "June"])).toBe("month");
    expect(h.classify(["Select", "August 2026", "September 2026"])).toBe("month");
    expect(h.classify(["Select", "Yes", "No"])).toBeNull();
  });

  it("picks the right option", () => {
    const info = h.periodInfo("08-2026")!;
    expect(h.pickIndex("fy", ["Select", "2026-27", "2025-26"], info)).toBe(1);
    expect(h.pickIndex("quarter", ["Select", "Quarter 1 (Apr - Jun)", "Quarter 2 (Jul - Sep)"], info)).toBe(2);
    expect(h.pickIndex("month", ["Select", "July", "August", "September"], info)).toBe(2);
    expect(h.pickIndex("month", ["Select", "July 2026", "August 2026"], info)).toBe(2);
    expect(h.pickIndex("month", ["Select", "July"], info)).toBe(-1);
  });
});

describe("telling the GSTR-2B tile from its neighbours", () => {
  // The portal's tiles render without whitespace between elements, so "GSTR-1" runs
  // straight into the next word – the names have to be found without word boundaries.
  it("reads the return names out of a tile's text", () => {
    expect(h.returnNames("gstr-1details of outward suppliesdownloadprepare online")).toEqual(["gstr1"]);
    expect(h.returnNames("gstr-2bauto-drafted itc statementviewdownload")).toEqual(["gstr2b"]);
    expect(h.returnNames("gstr 2b summary of gstr-2b")).toEqual(["gstr2b"]);
    expect(h.returnNames("gstr-1…gstr-2b…gstr-3b…")).toEqual(["gstr1", "gstr2b", "gstr3b"]);
    expect(h.returnNames("file returnsdashboard")).toEqual([]);
  });
});

describe("bookmarklet URL", () => {
  const url = buildBookmarklet();

  it("is a javascript: URL whose code parses as one line", () => {
    expect(url.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(url.slice("javascript:".length));
    expect(code).not.toMatch(/\n/);
    expect(() => new Function(code)).not.toThrow();
    expect(code.startsWith("void ")).toBe(true);
  });

  it("never touches login fields, storage or the network", () => {
    const src = HELPERS_SRC + MAIN_SRC;
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|\.submit\(|WebSocket|localStorage|sessionStorage|document\.cookie/);
    expect(src).not.toMatch(/\.value\s*=[^=]/);
  });
});
