import ExcelJS from "exceljs";
import { buildGstin } from "@/lib/gstin";

export type TemplateKind = "books" | "gstr2b";

const SUP1 = buildGstin("29", "AABCS1234K");
const SUP2 = buildGstin("27", "AAECP5678L");

const BOOKS_HEADERS = ["Supplier GSTIN", "Supplier Name", "Invoice Number", "Invoice Date", "Document Type", "Taxable Value", "IGST", "CGST", "SGST", "Cess", "Invoice Value", "Place of Supply", "Reverse Charge", "ITC Eligible", "Notes"];
const GSTR2B_HEADERS = ["Supplier GSTIN", "Supplier Name", "Invoice Number", "Invoice Date", "Document Type", "Taxable Value", "IGST", "CGST", "SGST", "Cess", "Invoice Value", "Place of Supply", "Reverse Charge", "ITC Availability", "Reason"];

function sampleRows(kind: TemplateKind): (string | number)[][] {
  const last = kind === "books" ? ["Yes", "Office supplies"] : ["Yes", ""];
  return [
    [SUP1, "Sri Lakshmi Traders", "INV/25-26/0045", "05-04-2025", "Invoice", 100000, 0, 9000, 9000, 0, 118000, "29", "No", ...last],
    [SUP2, "Pune Steel Works", "PSW-1182", "12-04-2025", "Invoice", 250000, 45000, 0, 0, 0, 295000, "29", "No", ...last],
    [SUP1, "Sri Lakshmi Traders", "CN-007", "20-04-2025", "Credit note", 10000, 0, 900, 900, 0, 11800, "29", "No", ...last],
  ];
}

const RULES: [string, string][] = [
  ["Supplier GSTIN", "Required. 15 characters, valid format and check digit."],
  ["Supplier Name", "Recommended. Used for the vendor master."],
  ["Invoice Number", "Required. Up to 50 characters. Separators, case and leading zeros are ignored when matching."],
  ["Invoice Date", "Required. DD-MM-YYYY (or YYYY-MM-DD). Not before 01-07-2017 and not in the future."],
  ["Document Type", "Invoice, Credit note or Debit note. Blank = Invoice."],
  ["Taxable Value", "Required. Positive number; use Credit note for reversals."],
  ["IGST / CGST / SGST / Cess", "Numbers, blank = 0. IGST cannot be combined with CGST/SGST."],
  ["Invoice Value", "Optional. Defaults to taxable value + taxes."],
  ["Place of Supply", "Optional. State code or name."],
  ["Reverse Charge", "Yes / No. Default No."],
  ["ITC Eligible / ITC Availability", "Yes / No. Default Yes (books: eligible for ITC; GSTR-2B: ITC available)."],
  ["GSTR-2B files", "The official GSTR-2B Excel (B2B and B2B-CDNR tabs) and JSON from the GST portal can be uploaded as they are – no template needed."],
];

export function templateCsv(kind: TemplateKind): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const headers = kind === "books" ? BOOKS_HEADERS : GSTR2B_HEADERS;
  return [headers, ...sampleRows(kind)].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export async function templateXlsx(kind: TemplateKind): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = kind === "books" ? BOOKS_HEADERS : GSTR2B_HEADERS;
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  for (const r of sampleRows(kind)) ws.addRow(r);
  ws.columns.forEach((c, i) => {
    c.width = Math.max(14, headers[i].length + 4);
  });
  // keep GSTIN / invoice number / date columns as text so Excel does not reformat them
  for (const col of [1, 3, 4, 12]) ws.getColumn(col).numFmt = "@";
  for (const col of [6, 7, 8, 9, 10, 11]) ws.getColumn(col).numFmt = "#,##0.00";

  const help = wb.addWorksheet("Instructions");
  help.addRow(["Column", "Rule"]).font = { bold: true };
  RULES.forEach((r) => help.addRow(r));
  help.getColumn(1).width = 32;
  help.getColumn(2).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
