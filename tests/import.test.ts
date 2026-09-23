import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildGstin } from "@/lib/gstin";
import { parseGstr2bJson } from "@/lib/import/gstr2b-json";
import { detectFileKind, UploadError } from "@/lib/import/parse-file";
import { parseBooksUpload, parseGstr2bUpload } from "@/lib/import/process";
import { templateCsv, templateXlsx } from "@/lib/import/templates";

const SUP = buildGstin("29", "AABCS1234K");
const SUP2 = buildGstin("27", "AAECP5678L");
const NOW = new Date(Date.UTC(2026, 8, 21));

describe("books CSV upload", () => {
  it("parses our own template (CSV and XLSX) without errors", async () => {
    const csv = await parseBooksUpload("t.csv", Buffer.from(templateCsv("books")), NOW);
    expect(csv.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(csv.docs).toHaveLength(3);
    expect(csv.docs[2].docType).toBe("CREDIT_NOTE");
    expect(csv.docs[0]).toMatchObject({ invoiceNumber: "INV/25-26/0045", cgst: 9000, invoiceValue: 118000 });

    const xlsx = await parseBooksUpload("t.xlsx", await templateXlsx("books"), NOW);
    expect(xlsx.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(xlsx.docs).toHaveLength(3);
  });

  it("reports row-level errors and keeps valid rows", async () => {
    const csv = [
      "GSTIN of Supplier,Vendor Name,Bill No,Bill Date,Taxable Amount,CGST Amount,SGST Amount,IGST",
      `${SUP},Good Co,B-1,05-04-2025,"1,000.00",90,90,`,
      "BADGSTIN,Bad Co,B-2,05-04-2025,1000,90,90,",
      `${SUP},No date,B-3,32-13-2025,1000,90,90,`,
      `${SUP},Negative,B-4,05-04-2025,-1000,90,90,`,
      `${SUP},IGST+CGST,B-5,05-04-2025,1000,90,90,180`,
      `${SUP},Future,B-6,05-04-2027,1000,90,90,`,
    ].join("\n");
    const out = await parseBooksUpload("x.csv", Buffer.from(csv), NOW);
    expect(out.docs.map((d) => d.invoiceNumber)).toEqual(["B-1"]);
    expect(out.docs[0].taxableValue).toBe(1000);
    expect(out.errorRows).toBe(5);
    const msgs = out.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/not a valid GSTIN/);
    expect(msgs).toMatch(/not a valid date/);
    expect(msgs).toMatch(/cannot be negative/);
    expect(msgs).toMatch(/IGST cannot be charged/);
    expect(msgs).toMatch(/future/);
  });

  it("warns (but imports) when the GSTIN check digit is wrong", async () => {
    const bad = SUP.slice(0, 14) + (SUP[14] === "A" ? "B" : "A");
    const out = await parseBooksUpload("x.csv", Buffer.from(`Supplier GSTIN,Invoice Number,Invoice Date,Taxable Value,CGST,SGST\n${bad},A1,05-04-2025,1000,90,90`), NOW);
    expect(out.docs).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ severity: "warning" });
  });

  it("rejects files without recognisable headers", async () => {
    const out = await parseBooksUpload("x.csv", Buffer.from("a,b,c\n1,2,3"), NOW);
    expect(out.docs).toHaveLength(0);
    expect(out.issues[0].message).toMatch(/header row/);
  });
});

describe("file validation", () => {
  it("checks extension and magic bytes", () => {
    expect(() => detectFileKind("x.exe", Buffer.from("MZ"))).toThrow(UploadError);
    expect(() => detectFileKind("x.xlsx", Buffer.from("not a zip"))).toThrow(/not a valid Excel/);
    expect(() => detectFileKind("x.csv", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toThrow(/Excel/);
    expect(detectFileKind("A.CSV", Buffer.from("a,b"))).toBe("csv");
    expect(detectFileKind("2b.json", Buffer.from("{}"))).toBe("json");
  });
});

async function portalWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Read me").addRow(["This is the GSTR-2B help sheet"]);
  const b2b = wb.addWorksheet("B2B");
  b2b.addRow(["Goods and Services Tax - GSTR-2B"]);
  b2b.addRow(["GSTIN", buildGstin("29", "AABCA1234A")]);
  b2b.addRow([]);
  b2b.addRow(["", "", "Invoice details", "", "", "", "", "", "Amount"]);
  b2b.addRow([
    "GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "Place of supply",
    "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)",
    "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason",
  ]);
  // one invoice at two rates → two rows, must be merged into one document
  b2b.addRow([SUP, "Sri Lakshmi Traders", "INV-45", "Regular", "05-04-2025", 129000, "29-Karnataka", "No", 18, 100000, 0, 9000, 9000, 0, "Apr-25", "11-05-2025", "Yes", ""]);
  b2b.addRow([SUP, "Sri Lakshmi Traders", "INV-45", "Regular", "05-04-2025", 129000, "29-Karnataka", "No", 5, 10000, 0, 250, 250, 0, "Apr-25", "11-05-2025", "Yes", ""]);
  b2b.addRow([SUP2, "Pune Steel Works", "PSW-1", "Regular", "12-04-2025", 295000, "29-Karnataka", "No", 18, 250000, 45000, 0, 0, 0, "Apr-25", "11-05-2025", "No", "POS provisions"]);
  const cdn = wb.addWorksheet("B2B-CDNR");
  cdn.addRow(["GSTIN of supplier", "Trade/Legal name", "Note number", "Note type", "Note Date", "Note Value(₹)", "Place of supply", "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "ITC Availability"]);
  cdn.addRow([SUP, "Sri Lakshmi Traders", "CN-7", "Credit note", "20-04-2025", 11800, "29", "No", 18, 10000, 0, 900, 900, 0, "Yes"]);
  b2b.addRow([]);
  b2b.addRow(["Total"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("GSTR-2B portal Excel", () => {
  it("finds the header row, merges multi-rate rows, reads notes and ITC flags", async () => {
    const out = await parseGstr2bUpload("GSTR2B.xlsx", await portalWorkbook(), NOW);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(out.docs).toHaveLength(3);
    const inv45 = out.docs.find((d) => d.invoiceNumber === "INV-45")!;
    expect(inv45).toMatchObject({ taxableValue: 110000, cgst: 9250, sgst: 9250, invoiceValue: 129000, itc: true, docType: "INVOICE" });
    const psw = out.docs.find((d) => d.invoiceNumber === "PSW-1")!;
    expect(psw).toMatchObject({ itc: false, itcReason: "POS provisions", igst: 45000 });
    const cn = out.docs.find((d) => d.invoiceNumber === "CN-7")!;
    expect(cn.docType).toBe("CREDIT_NOTE");
  });

  it("does not merge a genuinely repeated row (same rate) – it stays a duplicate for the engine", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("B2B");
    ws.addRow(["GSTIN of supplier", "Invoice number", "Invoice Date", "Rate(%)", "Taxable Value (₹)", "Central Tax(₹)", "State/UT Tax(₹)"]);
    ws.addRow([SUP, "A-1", "05-04-2025", 18, 1000, 90, 90]);
    ws.addRow([SUP, "A-1", "05-04-2025", 18, 1000, 90, 90]);
    const out = await parseGstr2bUpload("x.xlsx", Buffer.from(await wb.xlsx.writeBuffer()), NOW);
    expect(out.docs).toHaveLength(2);
  });
});

describe("GSTR-2B JSON", () => {
  const json = {
    data: {
      gstin: buildGstin("29", "AABCA1234A"),
      rtnprd: "042025",
      docdata: {
        b2b: [
          {
            ctin: SUP,
            trdnm: "Sri Lakshmi Traders",
            supprd: "042025",
            supfildt: "11-05-2025",
            inv: [
              { inum: "INV-45", typ: "R", dt: "05-04-2025", val: 118000, pos: "29", rev: "N", itcavl: "Y", items: [{ rt: 18, txval: 100000, igst: 0, cgst: 9000, sgst: 9000, cess: 0 }] },
              { inum: "INV-46", dt: "06-04-2025", val: 11800, pos: "29", rev: "N", itcavl: "N", rsn: "C", txval: 10000, cgst: 900, sgst: 900 },
            ],
          },
        ],
        cdnr: [{ ctin: SUP, trdnm: "Sri Lakshmi Traders", nt: [{ ntnum: "CN-7", typ: "C", dt: "20-04-2025", val: 11800, itcavl: "Y", txval: 10000, cgst: 900, sgst: 900 }] }],
        b2ba: [{ ctin: SUP }],
      },
    },
  };
  it("parses B2B (items and document-level amounts) and CDNR, and reports skipped sections", () => {
    const out = parseGstr2bJson(json);
    expect(out.gstin).toBe(json.data.gstin);
    expect(out.returnPeriod).toEqual({ year: 2025, month: 4 });
    expect(out.docs).toHaveLength(3);
    expect(out.docs[0]).toMatchObject({ invoiceNumber: "INV-45", taxableValue: 100000, cgst: 9000, itc: true, supplierFilingPeriod: "042025" });
    expect(out.docs[1]).toMatchObject({ itc: false, itcReason: "C", taxableValue: 10000 });
    expect(out.docs[2]).toMatchObject({ docType: "CREDIT_NOTE", invoiceNumber: "CN-7" });
    expect(out.issues.some((i) => /B2BA/.test(i.message))).toBe(true);
  });
  it("rejects garbage", () => {
    expect(parseGstr2bJson("nope").docs).toHaveLength(0);
    expect(parseGstr2bJson({ data: { docdata: {} } }).issues[0].severity).toBe("error");
  });
});
