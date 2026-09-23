import ExcelJS from "exceljs";
import Papa from "papaparse";

export class UploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface UploadLimits {
  maxBytes: number;
  maxRows: number;
}

export function uploadLimits(): UploadLimits {
  return {
    maxBytes: Number(process.env.MAX_UPLOAD_MB ?? 4) * 1024 * 1024,
    maxRows: Number(process.env.MAX_UPLOAD_ROWS ?? 20000),
  };
}

export type FileKind = "csv" | "xlsx" | "json";

/** Decide the file kind from name + magic bytes; never trust the client-supplied MIME type alone. */
export function detectFileKind(name: string, buf: Buffer): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new UploadError("The file has an .xlsx extension but is not a valid Excel workbook.");
    return "xlsx";
  }
  if (ext === "csv" || ext === "txt") {
    if (buf.subarray(0, 4).toString("hex") === "504b0304") throw new UploadError("This looks like an Excel file – rename it to .xlsx or export as CSV.");
    if (buf.subarray(0, 2000).includes(0)) throw new UploadError("The CSV file contains binary data.");
    return "csv";
  }
  if (ext === "json") return "json";
  throw new UploadError("Unsupported file type. Upload a .csv, .xlsx or (for GSTR-2B) .json file.");
}

/** Reject zip bombs: sum the uncompressed sizes declared in the zip central directory. */
export function assertSafeZip(buf: Buffer, maxUncompressed = 150 * 1024 * 1024) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UploadError("Corrupt Excel file (zip directory not found).");
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new UploadError("Corrupt Excel file (bad zip entry).");
    total += buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
    if (total > maxUncompressed) throw new UploadError("Excel file expands to an unreasonable size and was rejected.");
  }
}

export interface Sheet {
  name: string;
  matrix: unknown[][];
}

export function parseCsv(buf: Buffer, limits: UploadLimits): Sheet[] {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<unknown[]>(text, { skipEmptyLines: "greedy" });
  if (parsed.data.length > limits.maxRows + 40) throw new UploadError(`File has more than ${limits.maxRows} rows. Split it into smaller files.`);
  return [{ name: "csv", matrix: parsed.data as unknown[][] }];
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return cellValue(o.result as ExcelJS.CellValue);
    if ("text" in o) return o.text;
    if ("error" in o) return null;
    return null;
  }
  return v;
}

export async function parseXlsx(buf: Buffer, limits: UploadLimits): Promise<Sheet[]> {
  assertSafeZip(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new UploadError("Could not read the Excel workbook. Save it again as .xlsx (not .xls) and retry.");
  }
  const sheets: Sheet[] = [];
  let rowBudget = limits.maxRows + 60;
  for (const ws of wb.worksheets) {
    if (ws.state !== "visible") continue;
    const cols = Math.min(ws.columnCount, 60);
    const matrix: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      rowBudget--;
      if (rowBudget < 0) throw new UploadError(`Workbook has more than ${limits.maxRows} rows. Split it into smaller files.`);
      const cells: unknown[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellValue(row.getCell(c).value));
      matrix[rowNumber - 1] = cells; // keep the original row numbering
    });
    // fill holes so callers can iterate safely
    for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
    sheets.push({ name: ws.name, matrix });
  }
  if (!sheets.length) throw new UploadError("The workbook has no visible sheets.");
  return sheets;
}
